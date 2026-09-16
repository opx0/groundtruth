/**
 * A real report stream, built from the committed fixture bytes through the real
 * route handler.
 *
 * Nothing here hand-builds a card. Every event these helpers produce came out
 * of `createReportHandler` over a stub `SourceIo` that serves recorded bytes,
 * so a screen test asserts against what a browser would actually receive: the
 * spans `lib/templates/*` rendered, the traces `lib/report/sentence-view.ts`
 * flattened, the settle order the route wrote the lines in. This is the same
 * technique as `tests/unit/app/report-route.test.ts`, kept in its own file
 * because the screen tests need the `Response` itself -- a streaming body read
 * chunk by chunk -- and not only its text.
 *
 * One answer is derived rather than recorded, labelled `derived:` in its
 * payload URL: an empty FRS registry layer, for a registry ID no recorded
 * bytes cover. Every other answer is committed bytes, and the two air sources
 * are never asked for bytes at all -- their adapters fail before the network
 * because this deployment holds no key. Nothing reaches the network.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { z } from "zod";
import { SourceFailure } from "@/lib/evidence";
import type { Fetched, JsonValue, PayloadRef, SourceIo } from "@/lib/evidence";
import { createGeocodeHandler } from "@/app/api/geocode/handler";
import { createReportHandler } from "@/app/api/report/handler";
import { GeocodeApiResponseSchema, type GeocodeMatchView } from "@/app/lib/geocode-contract";
import { ReportEventSchema, type ReportEvent } from "@/app/lib/report-contract";
import { initialReportState, reportReducer, type ReportFlowState } from "@/app/lib/report-flow";
import { censusOrigin } from "../../evidence/helpers/sems-fixtures";

const fixturesDir = fileURLToPath(new URL("../../../fixtures/", import.meta.url));

export const RETRIEVED_AT = "2026-09-16T09:00:00Z";

/** The demo point of .dev/BRIEF.md A6 row 1, read out of the committed Census bytes rather than typed in. */
const HOUSTON = censusOrigin();

/* -------------------------------------------------------------------------- */
/* The stub io                                                                */
/* -------------------------------------------------------------------------- */

export type Answer =
	| { readonly fixture: string }
	| { readonly derived: string; readonly body: JsonValue }
	| { readonly fail: SourceFailure }
	| { readonly slow: number; readonly then: Answer };

function bytesOf(relative: string): Buffer {
	return readFileSync(`${fixturesDir}${relative}`);
}

function pause(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function ioOf(answerFor: (url: URL) => Answer): SourceIo {
	return {
		async get<Raw extends JsonValue>(url: URL, schema: z.ZodType<Raw>): Promise<Fetched<Raw>> {
			let answer = answerFor(url);
			while ("slow" in answer) {
				await pause(answer.slow);
				answer = answer.then;
			}
			if ("fail" in answer) throw answer.fail;
			const bytes = "fixture" in answer ? bytesOf(answer.fixture) : Buffer.from(JSON.stringify(answer.body), "utf8");
			const label = "fixture" in answer ? `fixture:${answer.fixture}` : answer.derived;
			const payload: PayloadRef = {
				url: label,
				sha256: createHash("sha256").update(bytes).digest("hex"),
				retrievedAt: RETRIEVED_AT,
			};
			const parsed = schema.safeParse(JSON.parse(bytes.toString("utf8")));
			if (!parsed.success) throw new SourceFailure("malformed", null);
			return { raw: parsed.data, payload };
		},
		query(parameter, value, adapterVersion, payload) {
			return { kind: "query", parameter, value, adapterVersion, payload };
		},
		now: () => RETRIEVED_AT,
	};
}

/* -------------------------------------------------------------------------- */
/* Routing one URL to one answer                                              */
/* -------------------------------------------------------------------------- */

const ECHO_SUMMARY = "echo/facilities-quarter-mi.json";
const ECHO_PAGE = "echo/facilities-page-quarter-mi.json";
const SEMS_LAYER = "sems/arcgis-5mi-houston.json";
/** The recorded Superfund layer answer with no rows in it, from a Nevada query. */
const SEMS_NO_RECORDS = "sems/arcgis-no-records-nevada.json";

const FRS_FIXTURES: ReadonlyMap<string, string> = new Map([
	["110000460885", "frs/arcgis-registry-110000460885.json"],
	["110000462703", "frs/arcgis-registry-110000462703-two-ids.json"],
]);

const NO_FEATURES: JsonValue = { features: [] };

export type Plan = {
	readonly echoSummary: Answer;
	readonly echoPage: Answer;
	readonly semsLayer: Answer;
	readonly status: (epaId: string) => Answer;
	readonly frs: (registryId: string) => Answer;
	readonly nfhl: Answer;
	readonly esri: Answer;
};

function epaIdOf(url: URL): string {
	const segments = url.pathname.split("/");
	return segments[segments.length - 2] ?? "";
}

function registryIdOf(url: URL): string {
	return /REGISTRY_ID='([^']*)'/.exec(url.searchParams.get("where") ?? "")?.[1] ?? "";
}

/** NFHL's host refuses non-US traffic, which is what this machine gets, so Esri's recorded copy answers instead. */
const NFHL_REFUSED = new SourceFailure("refused");

export const DEMO: Plan = {
	echoSummary: { fixture: ECHO_SUMMARY },
	echoPage: { fixture: ECHO_PAGE },
	semsLayer: { fixture: SEMS_LAYER },
	status: (epaId) => ({ fixture: `sems/envirofacts-${epaId}.json` }),
	frs: (registryId) => {
		const fixture = FRS_FIXTURES.get(registryId);
		return fixture === undefined ? { derived: `derived:frs-no-rows-${registryId}`, body: NO_FEATURES } : { fixture };
	},
	nfhl: { fail: NFHL_REFUSED },
	esri: { fixture: "fema/esri-no-polygon-houston.json" },
};

/**
 * One stream carrying all four card states:
 *
 * - **records** -- ECHO, over its recorded Houston bytes: seven facilities.
 * - **no-records** -- SEMS, over the recorded layer answer that has no rows in
 *   it.
 * - **unavailable** -- the flood card, with both layers refusing. The two air
 *   sources are unavailable too, for a cause of their own: this deployment
 *   holds no credential for either, which is .dev/BRIEF.md A6 beat 6 and the
 *   state the demo shows until an operator registers a key.
 * - **not-asked** -- the registry. FRS takes a registry ID rather than a locus,
 *   and a Superfund layer with no rows in it names none, so nothing was asked
 *   of FRS at all. It is the one card that still reaches this state: every
 *   source in .dev/BRIEF.md B2 now has an adapter, so a source with no key
 *   configured is one that was asked and could not be reached, not one nobody
 *   asked.
 *
 * `DEMO` is the other way round on the first two -- SEMS answers with fifteen
 * sites there and ECHO's card is built over the same bytes -- because a stream
 * cannot have SEMS both answering with records and naming no registry ID.
 */
export const FOUR_STATES: Plan = {
	...DEMO,
	semsLayer: { fixture: SEMS_NO_RECORDS },
	nfhl: { fail: NFHL_REFUSED },
	esri: { fail: new SourceFailure("refused") },
};

/** ECHO's summary answers late, so its card settles after every other source's. */
export function withSlowEcho(plan: Plan, ms: number): Plan {
	return { ...plan, echoSummary: { slow: ms, then: plan.echoSummary } };
}

function planned(plan: Plan): SourceIo {
	let echoCalls = 0;
	return ioOf((url) => {
		if (url.host === "echodata.epa.gov") {
			echoCalls += 1;
			return echoCalls === 1 ? plan.echoSummary : plan.echoPage;
		}
		if (url.host === "data.epa.gov") return plan.status(epaIdOf(url));
		if (url.host === "hazards.fema.gov") return plan.nfhl;
		if (url.pathname.includes("FRS_INTERESTS_SEMS")) return plan.semsLayer;
		if (url.pathname.includes("/FRS_INTERESTS/")) return plan.frs(registryIdOf(url));
		if (url.pathname.includes("USA_Flood_Hazard_Reduced_Set")) return plan.esri;
		throw new Error(`the stub io was asked for an unrouted URL: ${url.host}${url.pathname}`);
	});
}

/* -------------------------------------------------------------------------- */
/* Driving the route                                                          */
/* -------------------------------------------------------------------------- */

/** The streaming response itself, for a test that reads it chunk by chunk. */
export function reportResponse(plan: Plan = DEMO): Promise<Response> {
	const handler = createReportHandler(planned(plan));
	return handler(
		new Request("http://localhost/api/report", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ latitude: HOUSTON.latitude.value, longitude: HOUSTON.longitude.value }),
		}),
	);
}

export function eventsOf(raw: string): readonly ReportEvent[] {
	return raw
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line): ReportEvent => ReportEventSchema.parse(JSON.parse(line)));
}

export async function reportEvents(plan: Plan = DEMO): Promise<readonly ReportEvent[]> {
	const response = await reportResponse(plan);
	return eventsOf(await response.text());
}

/** Every event folded through the real reducer, which is what the screen renders from. */
export function stateOf(events: readonly ReportEvent[]): ReportFlowState {
	return events.reduce<ReportFlowState>((state, event) => reportReducer(state, { type: "event", event }), initialReportState);
}

export async function reportState(plan: Plan = DEMO): Promise<ReportFlowState> {
	return stateOf(await reportEvents(plan));
}

/* -------------------------------------------------------------------------- */
/* The match the screen is given                                              */
/* -------------------------------------------------------------------------- */

function censusIo(fixture: string): SourceIo {
	return ioOf(() => ({ fixture }));
}

/** The Houston demo match, exactly as the geocode route returns it, origin sentences included. */
export async function houstonMatch(): Promise<GeocodeMatchView> {
	const handler = createGeocodeHandler(censusIo("census/match-9311-e-ave-p.json"));
	const response = await handler(
		new Request("http://localhost/api/geocode", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ address: "9311 E Avenue P, Houston, TX 77012" }),
		}),
	);
	const parsed = GeocodeApiResponseSchema.parse(await response.json());
	if (parsed.status !== "matched") throw new Error(`expected a match, got ${parsed.status}`);
	return parsed.match;
}
