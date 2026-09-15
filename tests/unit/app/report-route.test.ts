/**
 * The report route, driven end to end from committed fixture bytes.
 *
 * Every record here is built by running a real adapter (`semsAdapter`,
 * `echoAdapter`, `floodZoneOutcome`, `lookupFrsFacility`) through the route's
 * own handler over a stub `SourceIo` that serves recorded bytes. Nothing
 * hand-builds a record, nothing invents a payload, and nothing reaches the
 * network.
 *
 * Two answers are derived rather than recorded, each labelled `derived:` in its
 * payload URL and each reaching a state the recorded bytes cannot: an ECHO
 * summary whose `QueryRows` is zero, and an NFHL answer with no features, which
 * no recording exists for because FEMA's host refuses non-US traffic
 * (docs/BRIEF.md B14). That is the technique `tests/unit/report/selection.test.ts`
 * already uses, for the same reason and with the same labelling.
 *
 * WHAT THE LEAK ASSERTIONS ARE MADE AGAINST. The response body is grepped as
 * raw text, before any parse: parsing it through `ReportEventSchema` would
 * re-apply the server's own key redaction on the way in and a test that did
 * that would pass whether or not the server had redacted anything.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { SourceFailure } from "@/lib/evidence";
import type { Fetched, JsonValue, PayloadRef, SourceIo } from "@/lib/evidence";
import { createReportHandler } from "@/app/api/report/handler";
import { ReportEventSchema, REDACTED, type CardView, type ReportEvent } from "@/app/lib/report-contract";
import { censusOrigin } from "../evidence/helpers/sems-fixtures";

const fixturesDir = fileURLToPath(new URL("../../fixtures/", import.meta.url));
const RETRIEVED_AT = "2026-09-16T09:00:00Z";

/** The demo point of docs/BRIEF.md A6 row 1, read out of the committed Census bytes rather than typed in. */
const HOUSTON = censusOrigin();
const LATITUDE = HOUSTON.latitude.value;
const LONGITUDE = HOUSTON.longitude.value;

/** `noUncheckedIndexedAccess` is on, and a test that silently skipped an index would assert nothing. */
function at<T>(items: readonly T[], index: number, what: string): T {
	const item = items[index];
	if (item === undefined) throw new Error(`no ${what} at index ${index}`);
	return item;
}

/* -------------------------------------------------------------------------- */
/* The stub io                                                                */
/* -------------------------------------------------------------------------- */

/** What one request is answered with: recorded bytes, bytes derived from them, a failure, or any of those late. */
type Answer =
	| { readonly fixture: string }
	| { readonly derived: string; readonly body: JsonValue }
	| { readonly fail: SourceFailure }
	| { readonly slow: number; readonly then: Answer };

function bytesOf(relative: string): Buffer {
	return readFileSync(`${fixturesDir}${relative}`);
}

function payloadOf(url: string, bytes: Buffer): PayloadRef {
	return { url, sha256: createHash("sha256").update(bytes).digest("hex"), retrievedAt: RETRIEVED_AT };
}

function pause(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJson(relative: string): JsonValue {
	const value: JsonValue = JSON.parse(bytesOf(relative).toString("utf8"));
	return value;
}

type Requested = { readonly urls: string[]; readonly io: SourceIo };

function ioOf(answerFor: (url: URL) => Answer): Requested {
	const urls: string[] = [];
	const io: SourceIo = {
		async get<Raw extends JsonValue>(url: URL, schema: z.ZodType<Raw>): Promise<Fetched<Raw>> {
			urls.push(url.toString());
			let answer = answerFor(url);
			while ("slow" in answer) {
				await pause(answer.slow);
				answer = answer.then;
			}
			if ("fail" in answer) throw answer.fail;
			const bytes = "fixture" in answer ? bytesOf(answer.fixture) : Buffer.from(JSON.stringify(answer.body), "utf8");
			const label = "fixture" in answer ? `fixture:${answer.fixture}` : answer.derived;
			// A body the adapter's own schema refuses is `malformed`, which is the
			// failure `lib/io/fetch-source-io.ts` throws for one. Letting the zod
			// error out of here instead would reach the card classified `unknown`,
			// and a stub that answered differently from the real io would pin a
			// sentence no deployment can produce.
			const parsed = schema.safeParse(JSON.parse(bytes.toString("utf8")));
			if (!parsed.success) throw new SourceFailure("malformed", null);
			return { raw: parsed.data, payload: payloadOf(label, bytes) };
		},
		query(parameter, value, adapterVersion, payload) {
			return { kind: "query", parameter, value, adapterVersion, payload };
		},
		now: () => RETRIEVED_AT,
	};
	return { urls, io };
}

/* -------------------------------------------------------------------------- */
/* Routing one URL to one answer                                              */
/* -------------------------------------------------------------------------- */

const ECHO_SUMMARY = "echo/facilities-quarter-mi.json";
const ECHO_PAGE = "echo/facilities-page-quarter-mi.json";
const SEMS_LAYER = "sems/arcgis-5mi-houston.json";

/** The two registry IDs FRS has recorded bytes for. Any other ID is answered with no rows, which is a real FRS answer. */
const FRS_FIXTURES: ReadonlyMap<string, string> = new Map([
	["110000460885", "frs/arcgis-registry-110000460885.json"],
	["110000462703", "frs/arcgis-registry-110000462703-two-ids.json"],
]);

const NO_FEATURES: JsonValue = { features: [] };

type Plan = {
	readonly echoSummary: Answer;
	readonly echoPage: Answer;
	readonly semsLayer: Answer;
	readonly status: (epaId: string) => Answer;
	readonly frs: (registryId: string) => Answer;
	readonly nfhl: Answer;
	readonly esri: Answer;
	/** Reached only with `AQS_EMAIL` and `AQS_KEY` set: without them the adapter fails before the network. */
	readonly aqs: Answer;
	/** Reached only with `AIRNOW_KEY` set, for the same reason. */
	readonly airnow: Answer;
};

/** The EPA ID out of `.../efservice/envirofacts_site/epa_id/<EPA_ID>/JSON`. */
function epaIdOf(url: URL): string {
	const segments = url.pathname.split("/");
	return segments[segments.length - 2] ?? "";
}

/** The registry ID out of ArcGIS's `where=REGISTRY_ID='<id>'`. */
function registryIdOf(url: URL): string {
	return /REGISTRY_ID='([^']*)'/.exec(url.searchParams.get("where") ?? "")?.[1] ?? "";
}

/**
 * NFHL's host refuses connections from outside the US, which is what this
 * machine gets, so the default plan refuses it and Esri's recorded copy
 * answers. That is also the case that leaves a non-null prior attempt on the
 * flood card. `NFHL_ANSWERS` below is the other deployment.
 */
const NFHL_REFUSED = new SourceFailure("refused");

const DEMO: Plan = {
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
	aqs: { fixture: "aqs/annual-summary-houston.json" },
	airnow: { fixture: "airnow/current-observations-houston.json" },
};

/**
 * The same demonstration point, answered by the layer `DEMO` refuses.
 *
 * `hazards.fema.gov` answered this project for the first time on 2026-09-17,
 * from a Compute Engine instance in `us-central1`, and
 * `fema/nfhl-minimal-hazard.json` is what it sent for the A6 point. Until then
 * no test in this file had driven the route through a successful NFHL
 * response, because there was none to drive it with: every flood assertion
 * here is about the fallback, the refusal that causes it, or an empty NFHL
 * answer that had to be derived.
 *
 * `DEMO` keeps the refusal, because that is what a non-US host gets and the
 * whole reason the fallback exists. This plan is the deployed US server, and
 * only the flood source differs between the two, so a test that swaps them
 * changes one answer and nothing else.
 */
const NFHL_ANSWERS: Plan = { ...DEMO, nfhl: { fixture: "fema/nfhl-minimal-hazard.json" } };

/**
 * The one request an answering NFHL produces, written out rather than rebuilt
 * from `floodZoneQueryUrl`: a test that composed the URL the way the adapter
 * does would agree with the adapter about a wrong one.
 */
const NFHL_QUERY_URL =
	"https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query" +
	"?geometry=-95.261995884462%2C29.720658823001&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects" +
	"&outFields=FLD_ZONE%2CZONE_SUBTY%2CSFHA_TF%2CDFIRM_ID%2CFLD_AR_ID%2CSTATIC_BFE%2CSOURCE_CIT&returnGeometry=false&f=json";

function planned(plan: Plan): Requested {
	let echoCalls = 0;
	return ioOf((url) => {
		if (url.host === "echodata.epa.gov") {
			echoCalls += 1;
			return echoCalls === 1 ? plan.echoSummary : plan.echoPage;
		}
		if (url.host === "data.epa.gov") return plan.status(epaIdOf(url));
		if (url.host === "aqs.epa.gov") return plan.aqs;
		if (url.host === "www.airnowapi.org") return plan.airnow;
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

function postRequest(body: unknown): Request {
	return new Request("http://localhost/api/report", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

const CONFIRMED_POINT: unknown = { latitude: LATITUDE, longitude: LONGITUDE };

type Run = { readonly response: Response; readonly raw: string; readonly events: readonly ReportEvent[] };

async function report(plan: Plan, timeouts: Record<string, { readonly timeoutMs: number }> = {}): Promise<Run> {
	const { io } = planned(plan);
	return drive(io, timeouts);
}

function eventsOf(raw: string): readonly ReportEvent[] {
	return raw
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line): ReportEvent => ReportEventSchema.parse(JSON.parse(line)));
}

async function drive(io: SourceIo, timeouts: Record<string, { readonly timeoutMs: number }> = {}): Promise<Run> {
	const handler = createReportHandler(io, timeouts);
	const response = await handler(postRequest(CONFIRMED_POINT));
	const raw = await response.text();
	return { response, raw, events: eventsOf(raw) };
}

function cardFor(events: readonly ReportEvent[], source: string): CardView {
	for (const event of events) {
		if (event.type === "card" && event.card.source === source) return event.card;
	}
	throw new Error(`no card was emitted for ${source}`);
}

type Sentence = CardView["headlines"][number];

function textOf(sentence: Sentence): string {
	return sentence.spans.map((span) => span.text).join("");
}

/** Every sentence on a card, in reading order: status, prior attempts, headlines, then every record's sentences. */
function sentencesOf(card: CardView): readonly Sentence[] {
	const out: Sentence[] = [];
	if (card.status !== null) out.push(card.status);
	out.push(...card.priorAttempts, ...card.headlines);
	for (const listing of card.listings) {
		for (const entry of [...listing.shown, ...listing.rest]) out.push(...entry.sentences);
	}
	return out;
}

function textsOf(card: CardView): readonly string[] {
	return sentencesOf(card).map(textOf);
}

/** What each event is, in one string, so a whole stream can be asserted as one list. */
function shapeOf(event: ReportEvent): string {
	if (event.type === "card") return `card:${event.card.source}:${event.card.state}`;
	if (event.type === "groups") return "groups";
	return `end:${event.status}`;
}

/* -------------------------------------------------------------------------- */
/* A captured console, for every test in this file                            */
/* -------------------------------------------------------------------------- */

const CONSOLE_METHODS: readonly ["log", "info", "warn", "error", "debug"] = ["log", "info", "warn", "error", "debug"];

let consoleSpies: Array<ReturnType<typeof vi.spyOn>>;
let logged: unknown[];

beforeEach(() => {
	logged = [];
	const capture =
		(): ((...args: unknown[]) => void) =>
		(...args: unknown[]) => {
			logged.push(args);
		};
	consoleSpies = CONSOLE_METHODS.map((method) => vi.spyOn(console, method).mockImplementation(capture()));
});

afterEach(() => {
	for (const spy of consoleSpies) spy.mockRestore();
});

function serialize(value: unknown): string {
	return JSON.stringify(value) ?? "";
}

/* -------------------------------------------------------------------------- */
/* The air credentials, decided here rather than inherited                    */
/* -------------------------------------------------------------------------- */

/**
 * The three names the two air adapters read, cleared before every test in this
 * file and restored after it.
 *
 * Which state the air cards are in is the one thing in this report that a
 * value outside the process decides: `lib/adapters/aqs.ts` and
 * `lib/adapters/airnow.ts` read `process.env` at the point of use, and with
 * nothing there neither gets as far as a socket. So a developer who exports a
 * real `AQS_KEY` would otherwise run a different report from CI's -- with
 * different cards, different sentences and different counts -- and the two
 * states below would each pass only on one machine. Clearing them makes the
 * unconfigured state the default here and `withAirKeys` the one way out of it.
 */
const AIR_ENV: readonly string[] = ["AQS_EMAIL", "AQS_KEY", "AIRNOW_KEY"];

let airEnv: readonly { readonly name: string; readonly value: string | undefined }[];

beforeEach(() => {
	airEnv = AIR_ENV.map((name) => ({ name, value: process.env[name] }));
	for (const name of AIR_ENV) delete process.env[name];
});

afterEach(() => {
	for (const { name, value } of airEnv) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
});

/**
 * A run made by a deployment an operator has registered keys with. The values
 * are this file's own and reach no assertion: what they buy is the request,
 * which the stub io answers from committed bytes.
 */
async function withAirKeys<T>(run: () => Promise<T>): Promise<T> {
	process.env["AQS_EMAIL"] = "route-test@example.test";
	process.env["AQS_KEY"] = "route-test-aqs-key";
	process.env["AIRNOW_KEY"] = "route-test-airnow-key";
	return run();
}

/* -------------------------------------------------------------------------- */
/* 2. The whole route, over the Houston demo point                            */
/* -------------------------------------------------------------------------- */

describe("the Houston demo point, every source, one stream", () => {
	it("emits one card per source, then the groups, then a terminal event", async () => {
		const { response, events } = await report(DEMO);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("application/x-ndjson");

		// The exact sequence, for these bytes and this environment. Both air
		// sources are asked now, and both settle first because this deployment
		// holds no key for either: the adapter fails before it opens a socket,
		// which is an answer the card can state and not a source nobody asked.
		// Everything after that is the order these sources answered in -- ECHO
		// reads two pages, FEMA two layers, SEMS the layer and then fifteen
		// status rows four at a time, and FRS cannot start until SEMS has
		// finished. That this is stable is a property worth pinning; that it is
		// not a *fixed* order is what the settle-order test below proves, by
		// moving the delay and watching it change.
		expect(events.map(shapeOf)).toEqual([
			"card:aqs:asked",
			"card:airnow:asked",
			"card:echo:asked",
			"card:fema:asked",
			"card:sems:asked",
			"card:frs:asked",
			"groups",
			"end:complete",
		]);
	});

	it("renders the Superfund card's count and its nearest site from the agency's own fields", async () => {
		const { events } = await report(DEMO);
		const sems = cardFor(events, "sems");
		const texts = textsOf(sems);
		expect(sems.agency).toBe("EPA Superfund Enterprise Management System");
		expect(texts).toContain(
			"Superfund sites EPA's inventory lists within 5 miles of the mapped point: 15.",
		);
		expect(texts.some((text) => text.startsWith("VALERO PLUME, EPA ID TXN000622182. 0.76 km from the mapped point."))).toBe(
			true,
		);
	});

	it("renders the ECHO card, the flood card and the registry card, each naming what answered", async () => {
		const { events } = await report(DEMO);

		const echo = cardFor(events, "echo");
		expect(echo.agency).toBe("EPA Enforcement and Compliance History Online");
		expect(textsOf(echo)).toContain(
			`EPA Enforcement and Compliance History Online answered with records, retrieved ${RETRIEVED_AT}.`,
		);
		expect(textsOf(echo).some((text) => text.includes("CARGILL INCORPORATED"))).toBe(true);

		const fema = cardFor(events, "fema");
		// NFHL refused, so the Esri copy answered and the card is labelled for it.
		expect(fema.agency).toBe("Esri's reduced-set copy of FEMA's National Flood Hazard Layer");
		expect(fema.priorAttempts.map(textOf)).toContain(
			"FEMA's National Flood Hazard Layer could not be reached: the host refused the connection.",
		);

		const frs = cardFor(events, "frs");
		expect(frs.agency).toBe("EPA Facility Registry Service");
		expect(textsOf(frs).some((text) => text.includes("110000460885"))).toBe(true);
	});

	it("ties the Superfund site and the registry facility into one group, after every source has settled", async () => {
		const { events } = await report(DEMO);
		const groups = events.filter((event) => event.type === "groups");
		expect(groups.length).toBe(1);
		const event = at(groups, 0, "groups event");
		if (event.type !== "groups") throw new Error("expected the groups event");
		const spoken = event.cards.flatMap((card) => [...card.groups, ...card.crossReferences]).map(textOf);
		expect(spoken.some((text) => text.includes("110000460885"))).toBe(true);
	});

	it("puts both chrome numbers on every listing, agreeing with the count sentence beside them", async () => {
		const { events } = await report(DEMO);
		const sems = cardFor(events, "sems");
		const listing = at(sems.listings, 0, "SEMS listing");
		expect(listing.kind).toBe("sems-site");
		expect(listing.boundary).toBe("5 miles");
		expect(listing.ordering).toBe("distance");
		// 15 sites within five miles; the bound carries all of them, five shown.
		expect(listing.total).toBe(15);
		expect(listing.carried).toBe(15);
		expect(listing.shown.length).toBe(5);
		expect(listing.shown.length + listing.rest.length).toBe(listing.carried);
		expect(textsOf(sems)).toContain("Superfund sites EPA's inventory lists within 5 miles of the mapped point: 15.");
	});
});

/* -------------------------------------------------------------------------- */
/* 2b. The two air sources, in the two states a credential decides between    */
/* -------------------------------------------------------------------------- */

function mustStatus(card: CardView, source: string): Sentence {
	const status = card.status;
	if (status === null) throw new Error(`the ${source} card carries no status sentence`);
	return status;
}

/** The two air sources and the names `lib/evidence/records.ts` gives them, which is what the card prints. */
const AIR_AGENCIES: readonly (readonly [string, string])[] = [
	["aqs", "EPA Air Quality System"],
	["airnow", "EPA AirNow"],
];

describe("the two air sources, asked by a deployment holding no credential", () => {
	/**
	 * docs/BRIEF.md A6 beat 6, end to end, and the state the demo will show
	 * until an operator registers a key.
	 *
	 * The distinction this pins is the one registering the adapters bought.
	 * Until they were registered the report said these two sources were
	 * `not-asked` -- that nobody made the request -- which was true then and is
	 * a lie now: the request is made, `credentialsOrFail` refuses it before the
	 * network, and `not-configured` is a cause the card can state. A reader gets
	 * a sentence naming the source, saying it could not be reached, and saying
	 * why, which is what B7's "the status of every source" asks for.
	 */
	it("says of each one that it could not be reached, and why, rather than that nobody asked it", async () => {
		const { events } = await report(DEMO);

		for (const [source, agency] of AIR_AGENCIES) {
			const card = cardFor(events, source);
			expect(card.state).toBe("asked");
			expect(card.agency).toBe(agency);
			expect(textOf(mustStatus(card, source))).toBe(
				`${agency} could not be reached: this deployment holds no credential for it. It answered no-api-key.`,
			);

			// Machine-readable beside the prose, so the screen never has to read
			// the sentence to know which of B10's states this is.
			const trace = mustStatus(card, source).trace;
			if (trace === null || trace.scope !== "source") throw new Error(`the ${source} status lost its source trace`);
			expect(trace.source.status).toBe("unavailable");
			expect(trace.source.cause).toBe("not-configured");
			expect(trace.source.rawCode).toBe("no-api-key");

			// A source that could not be reached lists nothing and counts nothing:
			// there is no boundary sentence to place and no records to place it over.
			expect(card.listings).toEqual([]);
			expect(card.headlines).toEqual([]);
		}
	});

	it("makes no air request at all, because the failure is before the socket", async () => {
		const { urls, io } = planned(DEMO);
		await drive(io);

		expect(urls.some((url) => url.includes("aqs.epa.gov"))).toBe(false);
		expect(urls.some((url) => url.includes("airnowapi.org"))).toBe(false);
		// And the rest of the report is untouched by either failure.
		expect(urls.some((url) => url.includes("echodata.epa.gov"))).toBe(true);
	});
});

/** The two committed AirNow rows recombined: one with an index, one without, which no single fixture holds. */
function airnowBothStates(): JsonValue {
	const indexed = parseJson("airnow/current-observations-houston.json");
	const none = parseJson("airnow/derived-null-aqi.json");
	if (!isJsonArray(indexed) || !isJsonArray(none)) throw new Error("an AirNow fixture is not an array of rows");
	return [objectAt(indexed[0], "the ozone row"), objectAt(none[0], "the row with no index")];
}

describe("the two air sources, asked by a deployment an operator has given a key", () => {
	it("puts the monitor, its distance and the unverified-shape clause on the AQS card", async () => {
		const { events } = await withAirKeys(() => report(DEMO));
		const aqs = cardFor(events, "aqs");
		const texts = textsOf(aqs);

		expect(textOf(mustStatus(aqs, "aqs"))).toBe(
			`EPA Air Quality System answered with records, retrieved ${RETRIEVED_AT}.`,
		);
		expect(texts).toContain(`Searched within 50 km of the mapped point, retrieved ${RETRIEVED_AT}.`);
		expect(texts).toContain(
			"PM2.5 monitor 48-201-1035-88101 is 1.52 km from the mapped point, and measures its own location, not" +
				" this address. 2025 annual arithmetic mean: 10.385577 Micrograms/cubic meter (LC). AQS data lags collection by" +
				" six months or more. Observations in the summary: 104.",
		);
	});

	/**
	 * B2's nearest qualified monitor per pollutant, on the wire: one listing
	 * each, one record shown, the rest carried. The recorded Houston body holds
	 * twelve PM2.5 monitors and seventeen ozone monitors within 50 km, so both
	 * listings put one on the card and the rest behind "View all".
	 */
	it("gives each pollutant its own listing, showing the nearest and carrying the rest", async () => {
		const { events } = await withAirKeys(() => report(DEMO));
		const aqs = cardFor(events, "aqs");

		expect(aqs.listings.map((listing) => listing.boundary)).toEqual(["50 km", "50 km"]);
		const pm25 = at(aqs.listings, 0, "the PM2.5 listing");
		const ozone = at(aqs.listings, 1, "the ozone listing");
		expect(pm25.ordering).toBe("distance");
		expect(pm25.total).toBe(12);
		expect(pm25.shown.length).toBe(1);
		expect(pm25.rest.length).toBe(11);
		expect(ozone.total).toBe(17);
		expect(ozone.shown.length).toBe(1);
		expect(ozone.rest.length).toBe(16);
	});

	/**
	 * The widened `AirTemplates` shape, end to end. AirNow's two templates are
	 * split on whether the row carries an index, and the route hands the policy
	 * both, so the card describes a row in either state. The recorded demo body
	 * has an index on every row, so the two states are put on one card here the
	 * way `tests/unit/report/selection.test.ts` does it -- and the assertion is
	 * per record, because a card-level one cannot see a row that fell silent.
	 */
	it("describes an AirNow row in either index state, per row, with the template that declares it", async () => {
		const answered: Plan = { ...DEMO, airnow: { derived: "derived:airnow-one-index-one-not", body: airnowBothStates() } };
		const { events } = await withAirKeys(() => report(answered));
		const airnow = cardFor(events, "airnow");
		const listing = at(airnow.listings, 0, "the AirNow listing");
		const entries = [...listing.shown, ...listing.rest];

		expect(entries.length).toBe(2);
		for (const entry of entries) {
			expect(entry.sentences.length, `${entry.recordId.sourceRecordId} has no sentence`).toBeGreaterThan(0);
		}
		expect(entries.flatMap((entry) => entry.sentences.map((sentence) => sentence.templateId))).toEqual([
			"airnow-observation/summary@1",
			"airnow-observation/no-index@1",
		]);
		expect(entries.flatMap((entry) => entry.sentences.map(textOf))).toEqual([
			"AirNow reports an air quality index of 20 for Ozone in the Houston-Galveston-Brazoria reporting area, observed 2026-09-16." +
				" AirNow's observations describe the Houston-Galveston-Brazoria reporting area, not the mapped point.",
			// The second row is the authored null-index body, whose area is the
			// short name, and the qualification names the row's own area.
			"AirNow's PM2.5 observation for the Houston reporting area, observed 2026-09-16, carries no air quality" +
				" index. AirNow's observations describe the Houston reporting area, not the mapped point.",
		]);
	});
});

/* -------------------------------------------------------------------------- */
/* 3. A failing source is a card, not a stream error                          */
/* -------------------------------------------------------------------------- */

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
	return Array.isArray(value);
}

function objectAt(value: JsonValue | undefined, what: string): { readonly [key: string]: JsonValue } {
	if (value === null || value === undefined || typeof value !== "object" || isJsonArray(value)) {
		throw new Error(`${what} is not an object`);
	}
	return value;
}

/** The recorded ECHO summary with its row count set to zero, which is ECHO's own no-data answer. */
function echoNoRows(): JsonValue {
	const results = objectAt(objectAt(parseJson(ECHO_SUMMARY), ECHO_SUMMARY)["Results"], "Results");
	return { Results: { ...results, QueryRows: "0" } };
}

describe("one source that throws, one that times out and one that answers with nothing", () => {
	const BROKEN: Plan = {
		...DEMO,
		// SEMS's layer request is refused outright.
		semsLayer: { fail: new SourceFailure("refused") },
		// Both flood layers hang past their policy.
		nfhl: { slow: 80, then: { fixture: "fema/esri-no-polygon-houston.json" } },
		esri: { slow: 80, then: { fixture: "fema/esri-no-polygon-houston.json" } },
		// ECHO counts zero rows and never gets asked for a page.
		echoSummary: { derived: "derived:echo-zero-rows", body: echoNoRows() },
	};

	it("gives every source a card and still ends complete", async () => {
		const { events } = await report(BROKEN, { fema: { timeoutMs: 20 } });
		const shapes = events.map(shapeOf);
		expect(shapes.filter((shape) => shape.startsWith("card:")).length).toBe(6);
		expect(at(shapes, shapes.length - 1, "terminal event")).toBe("end:complete");
	});

	it("says the Superfund source could not be reached, and nothing about what it holds", async () => {
		const { events } = await report(BROKEN, { fema: { timeoutMs: 20 } });
		const sems = cardFor(events, "sems");
		expect(textsOf(sems)).toEqual([
			"EPA Superfund Enterprise Management System could not be reached: the host refused the connection.",
		]);
		expect(sems.listings).toEqual([]);
	});

	it("says the flood layer timed out, naming the dataset that was asked last", async () => {
		const { events } = await report(BROKEN, { fema: { timeoutMs: 20 } });
		const fema = cardFor(events, "fema");
		expect(textsOf(fema)).toContain(
			"Esri's reduced-set copy of FEMA's National Flood Hazard Layer could not be reached: the request timed out.",
		);
		expect(fema.priorAttempts.map(textOf)).toContain(
			"FEMA's National Flood Hazard Layer could not be reached: the request timed out.",
		);
	});

	it("says ECHO answered with no matching records, which is not the same as unavailable", async () => {
		const { events } = await report(BROKEN, { fema: { timeoutMs: 20 } });
		const echo = cardFor(events, "echo");
		const texts = textsOf(echo);
		expect(texts).toContain(
			`EPA Enforcement and Compliance History Online answered with no matching records, retrieved ${RETRIEVED_AT}.`,
		);
		expect(texts).toContain("No matching records within the stated boundary.");
	});

	it("does not ask the registry when nothing named a registry ID", async () => {
		const { events } = await report(BROKEN, { fema: { timeoutMs: 20 } });
		const frs = cardFor(events, "frs");
		expect(frs.state).toBe("not-asked");
		expect(frs.status).toBeNull();
		expect(frs.agency).toBe("EPA Facility Registry Service");
	});
});

/* -------------------------------------------------------------------------- */
/* 3b. A body the source's own reader cannot read                             */
/* -------------------------------------------------------------------------- */

describe("a source that answers with a body its own reader cannot read", () => {
	/** ArcGIS's layer shape with `features` replaced by a string: JSON, and not a layer. */
	const GARBLED: JsonValue = { features: "TXN000622182" };
	const UNREADABLE: Plan = { ...DEMO, semsLayer: { derived: "derived:sems-unreadable", body: GARBLED } };

	it("says the response could not be read, which is neither a refusal nor an empty answer", async () => {
		const { events } = await report(UNREADABLE);
		const sems = cardFor(events, "sems");
		// `malformed` has a sentence of its own, and it is the one B10 gives a
		// body we could not parse rather than a host we could not reach.
		expect(textsOf(sems)).toEqual([
			"EPA Superfund Enterprise Management System could not be reached: the response could not be read.",
		]);
		expect(sems.listings).toEqual([]);
		// The bytes that could not be read are quoted back on no card.
		expect(textsOf(sems).join(" ")).not.toContain("TXN000622182");
	});

	it("gives every other source its card and still ends complete", async () => {
		const { events } = await report(UNREADABLE);
		const shapes = events.map(shapeOf);
		expect(shapes.filter((shape) => shape.startsWith("card:")).length).toBe(6);
		// Nothing named a registry ID, so the registry was not asked.
		expect(shapes).toContain("card:frs:not-asked");
		expect(at(shapes, shapes.length - 1, "terminal event")).toBe("end:complete");
		expect(logged).toEqual([]);
	});
});

describe("the whole report failing before any card", () => {
	it("says so in one event, ends the stream and logs a fixed string", async () => {
		// The clock the report reads the confirmed point's payload from throws.
		// Nothing below that point is a source, so no card can be built and there
		// is nothing to say but that it failed.
		const { io } = planned(DEMO);
		const broken: SourceIo = {
			get: io.get.bind(io),
			query: io.query.bind(io),
			now: () => {
				throw new Error(`the clock failed at ${LATITUDE},${LONGITUDE}`);
			},
		};
		const { events, raw } = await drive(broken);

		expect(events.map(shapeOf)).toEqual(["end:failed"]);
		// The thrown error carried a coordinate in its own message on purpose.
		// Neither the body nor the log may repeat it.
		expect(raw).not.toContain(String(LATITUDE));
		expect(logged).toEqual([["report: run failed"]]);
		expect(serialize(logged)).not.toContain(String(LATITUDE));
	});
});

/* -------------------------------------------------------------------------- */
/* 4. Settle order, not a fixed order                                         */
/* -------------------------------------------------------------------------- */

describe("cards arrive as their sources settle", () => {
	function orderOf(events: readonly ReportEvent[], source: string): number {
		const index = events.findIndex((event) => event.type === "card" && event.card.source === source);
		if (index === -1) throw new Error(`no card for ${source}`);
		return index;
	}

	it("emits the fast card first, whichever source is the fast one", async () => {
		const slowEcho = await report({
			...DEMO,
			echoSummary: { slow: 60, then: { fixture: ECHO_SUMMARY } },
		});
		expect(orderOf(slowEcho.events, "sems")).toBeLessThan(orderOf(slowEcho.events, "echo"));

		// The same run with the delay moved proves the order is the settle order
		// and not the order the table happens to list the sources in.
		const slowSems = await report({
			...DEMO,
			semsLayer: { slow: 60, then: { fixture: SEMS_LAYER } },
		});
		expect(orderOf(slowSems.events, "echo")).toBeLessThan(orderOf(slowSems.events, "sems"));
	});
});

/* -------------------------------------------------------------------------- */
/* 5. The flood card names its dataset                                        */
/* -------------------------------------------------------------------------- */

describe("the flood card names the dataset that answered", () => {
	it("names Esri's copy on a polygon it answered, in the record's own sentence", async () => {
		const { events } = await report({ ...DEMO, esri: { fixture: "fema/esri-zone-ae-pasadena.json" } });
		const fema = cardFor(events, "fema");
		expect(fema.agency).toBe("Esri's reduced-set copy of FEMA's National Flood Hazard Layer");
		expect(
			textsOf(fema).some((text) => text.includes("Esri's reduced-set copy of FEMA's National Flood Hazard Layer")),
		).toBe(true);
		expect(at(fema.listings, 0, "flood listing").shown.length).toBe(1);
	});

	it("gives the two datasets different no-polygon wordings, each naming itself", async () => {
		const esri = await report(DEMO);
		// No recorded NFHL response exists -- the host refuses non-US traffic --
		// so the empty answer is derived and labelled as such.
		const nfhl = await report({
			...DEMO,
			nfhl: { derived: "derived:nfhl-no-features", body: NO_FEATURES },
		});

		const esriCard = cardFor(esri.events, "fema");
		const nfhlCard = cardFor(nfhl.events, "fema");
		expect(nfhlCard.agency).toBe("FEMA's National Flood Hazard Layer");
		expect(nfhlCard.priorAttempts).toEqual([]);

		const esriNote = textsOf(esriCard).find((text) => text.includes("no polygon") || text.includes("no 1%"));
		const nfhlNote = textsOf(nfhlCard).find((text) => text.includes("No digital FEMA designation"));
		expect(textsOf(esriCard)).toContain(
			"No 1% or 0.2% flood hazard polygon intersects this point in the Esri copy of FEMA's layer, dated 2026-03-11." +
				" This copy omits minimal-hazard areas, so it cannot tell minimal hazard from an unmapped area.",
		);
		expect(textsOf(nfhlCard)).toContain(
			"FEMA's own National Flood Hazard Layer answered with no polygon." +
				" No digital FEMA designation was available at this point.",
		);
		expect(esriNote).not.toEqual(nfhlNote);
	});

	/**
	 * The point docs/BRIEF.md A6 puts on screen, answered by the layer that
	 * holds it. Esri's copy carries no unshaded zone X, so it returns nothing
	 * here and the card can only say it cannot tell minimal hazard from an area
	 * that was never mapped. This is the first test in this file that drives the
	 * route over an NFHL answer with a polygon in it: every other flood
	 * assertion here is about the fallback, the refusal that causes it, a
	 * timeout, or an empty NFHL answer that had to be derived.
	 *
	 * The record is asserted as the one string the card puts on screen, not as a
	 * set of fragments looked for inside it. Every clause of
	 * `lib/templates/fema.ts` reads one column of the recorded row, a clause
	 * dies whole when its column is null, and a substring match would pass over
	 * a missing one. Nothing in it says anything about safety: the card states
	 * the designation FEMA recorded and stops, which is what docs/BRIEF.md C2
	 * requires of it.
	 */
	it("states FEMA's own zone X at the demo point, where the copy could only say it could not tell", async () => {
		const { events } = await report(NFHL_ANSWERS);
		const fema = cardFor(events, "fema");

		expect(fema.agency).toBe("FEMA's National Flood Hazard Layer");
		expect(fema.priorAttempts).toEqual([]);
		const record = at(at(fema.listings, 0, "flood listing").shown, 0, "flood record");
		expect(record.sentences.map(textOf)).toEqual([
			"The mapped point, a street-segment interpolation rather than a parcel boundary, is in zone X," +
				" outside the Special Flood Hazard Area." +
				" The zone subtype recorded for this area is AREA OF MINIMAL FLOOD HAZARD." +
				" FEMA's FIRM study identifier for this area is 48201C." +
				" The flood area ID recorded for this area is 48201C_8882." +
				" The source-citation lookup key recorded for this area is 48201C_FIRM1." +
				" Read from FEMA's National Flood Hazard Layer.",
		]);
		// The sentence this answer replaces, which `DEMO` still produces.
		expect(textsOf(fema)).not.toContain(
			"No 1% or 0.2% flood hazard polygon intersects this point in the Esri copy of FEMA's layer, dated 2026-03-11." +
				" This copy omits minimal-hazard areas, so it cannot tell minimal hazard from an unmapped area.",
		);
	});

	/**
	 * `floodZoneOutcome` falls back only when NFHL is unavailable, never when it
	 * answers, and a fallback that ran here would put Esri's reduced set behind
	 * a card labelled FEMA's own. The request list is where that is visible.
	 */
	it("never asks Esri's copy when the authoritative layer answers with a polygon", async () => {
		const { urls, io } = planned(NFHL_ANSWERS);
		await drive(io);

		expect(urls.filter((url) => url.startsWith("https://hazards.fema.gov/"))).toEqual([NFHL_QUERY_URL]);
		expect(urls.filter((url) => url.includes("USA_Flood_Hazard_Reduced_Set"))).toEqual([]);
	});
});

/* -------------------------------------------------------------------------- */
/* 6. Privacy                                                                 */
/* -------------------------------------------------------------------------- */

const ADDRESS_MARKER = "APT-9Z-DO-NOT-LEAK";

describe("no address reaches this route, and no coordinate reaches a log", () => {
	it("refuses a body that carries an address rather than stripping it and carrying on", async () => {
		const { urls, io } = planned(DEMO);
		const handler = createReportHandler(io);
		const response = await handler(
			postRequest({ latitude: LATITUDE, longitude: LONGITUDE, address: `9311 E Ave P, ${ADDRESS_MARKER}` }),
		);
		const body: unknown = await response.json();

		expect(response.status).toBe(400);
		expect(body).toEqual({ status: "invalid" });
		// No source was asked anything at all, so no adapter can have received it.
		expect(urls).toEqual([]);
		expect(serialize(body)).not.toContain(ADDRESS_MARKER);
		expect(serialize(logged)).not.toContain(ADDRESS_MARKER);
		expect(logged).toEqual([]);
	});

	it("sends no adapter a request carrying anything but coordinates and query parameters", async () => {
		const { urls, io } = planned(DEMO);
		await drive(io);
		expect(urls.length).toBeGreaterThan(0);
		for (const url of urls) {
			expect(url).not.toContain(ADDRESS_MARKER);
			expect(url.toLowerCase()).not.toContain("address");
		}
	});

	it("writes no log line at all on a report that ran, and none carrying the coordinate", async () => {
		const { raw } = await report(DEMO);
		expect(raw.length).toBeGreaterThan(0);
		expect(logged).toEqual([]);
		expect(serialize(logged)).not.toContain(String(LATITUDE));
		expect(serialize(logged)).not.toContain(String(LONGITUDE));
	});

	it("puts the coordinate in no sentence, no card label and no boundary on the wire", async () => {
		const { events } = await report(DEMO);
		const chrome: string[] = [];
		for (const event of events) {
			if (event.type !== "card") continue;
			chrome.push(event.card.agency);
			for (const sentence of sentencesOf(event.card)) chrome.push(textOf(sentence));
			for (const listing of event.card.listings) chrome.push(listing.boundary, listing.kind, listing.ordering);
		}
		expect(chrome.length).toBeGreaterThan(0);
		for (const text of chrome) {
			expect(text).not.toContain(String(LATITUDE));
			expect(text).not.toContain(String(LONGITUDE));
		}
	});
});

/* -------------------------------------------------------------------------- */
/* 7. A payload URL never carries a key                                       */
/* -------------------------------------------------------------------------- */

const KEY_SENTINEL = "SENTINEL-KEY-DO-NOT-SHIP";

describe("a payload URL carrying an API key does not reach the wire", () => {
	it("redacts the key an adapter failed to redact, and ships the rest of the URL unchanged", async () => {
		// The stub stamps the SEMS layer's payload with a URL carrying a key, the
		// way a future AQS or AirNow adapter would if its own redaction were
		// wrong. Every SEMS record's provenance then names that payload.
		const leaky = `https://aqs.epa.gov/data/api/annualData/byBox?param=88101&email=nobody%40example.gov&key=${KEY_SENTINEL}`;
		const { raw } = await report({
			...DEMO,
			semsLayer: { derived: leaky, body: parseJson(SEMS_LAYER) },
		});

		expect(raw).not.toContain(KEY_SENTINEL);
		expect(raw).toContain(`key=${REDACTED}`);
		expect(raw).toContain(`email=${REDACTED}`);
		// The rest of the citation survives: a redacted URL is still the request.
		expect(raw).toContain("param=88101");
	});

	/**
	 * The redaction above works on shape: it parses a string as a URL and
	 * rewrites the parameters it recognises. A source's own error text is not a
	 * URL, and both air adapters forward it verbatim into
	 * `SourceFailure.rawCode`, which `lib/templates/sources.ts` renders as
	 * "It answered {rawCode}." -- on the card. An audit drove exactly this and
	 * the key reached the wire, so the second redaction works on value.
	 */
	it("redacts a configured key out of a source's own error text, which is not a URL", async () => {
		const previous = process.env["AIRNOW_KEY"];
		process.env["AIRNOW_KEY"] = KEY_SENTINEL;
		try {
			const { raw } = await report({
				...DEMO,
				// The shape a real source answers with: prose, with the request
				// echoed back inside it, credential and all.
				semsLayer: {
					fail: new SourceFailure(
						"http",
						`Request not authenticated for https://www.airnowapi.org/aq/observation/latLong/current/?API_KEY=${KEY_SENTINEL}`,
					),
				},
			});

			expect(raw).not.toContain(KEY_SENTINEL);
			expect(raw).toContain(REDACTED);
			// The message is still the source's, minus the credential: B10 shows an
			// unknown status verbatim and the redaction takes the key, not the text.
			expect(raw).toContain("Request not authenticated for");
		} finally {
			if (previous === undefined) delete process.env["AIRNOW_KEY"];
			else process.env["AIRNOW_KEY"] = previous;
		}
	});

	it("leaves the report alone when no key is configured", async () => {
		// Which is this file's default state: `beforeEach` clears all three names.
		const { raw } = await report(DEMO);
		expect(raw).toContain("VALERO PLUME");
		expect(raw).not.toContain(REDACTED);
	});
});

/* -------------------------------------------------------------------------- */
/* 8. Every span of every sentence can be traced                              */
/* -------------------------------------------------------------------------- */

describe("the trace that crosses the wire answers what is behind every span", () => {
	it("resolves every slotted span of every sentence of every card from that sentence's one trace", async () => {
		const { events } = await report(DEMO);
		let checked = 0;
		for (const event of events) {
			const sentences: Sentence[] = [];
			if (event.type === "card") sentences.push(...sentencesOf(event.card));
			if (event.type === "groups") {
				for (const card of event.cards) sentences.push(...card.groups, ...card.crossReferences);
			}
			for (const sentence of sentences) {
				const slotted = sentence.spans.filter((span) => span.slot !== null);
				if (slotted.length === 0) continue;
				const trace = sentence.trace;
				expect(trace, `${sentence.templateId} has no trace`).not.toBeNull();
				if (trace === null) continue;
				for (const span of slotted) {
					const field = span.slot?.field ?? "";
					const value = trace.values.find((one) => one.field === field);
					expect(value, `${sentence.templateId}: no trace value for ${field}`).toBeDefined();
					expect(value?.displayed).toBe(span.text);
					checked += 1;
				}
			}
		}
		expect(checked).toBeGreaterThan(50);
	});

	it("carries no sentence subject on any event", async () => {
		const { events } = await report(DEMO);
		for (const event of events) {
			if (event.type !== "card") continue;
			for (const sentence of sentencesOf(event.card)) {
				expect(Object.keys(sentence).sort()).toEqual(["spans", "templateId", "trace"]);
			}
		}
	});
});

/* -------------------------------------------------------------------------- */
/* 9. A card that cannot be built costs that card and no other                */
/* -------------------------------------------------------------------------- */

/**
 * Is this the card event for one source? Read off the value the wire schema was
 * handed, with no assertion: a card event is `{type, card: {source, ...}}`.
 */
function isCardFor(value: unknown, source: string): boolean {
	if (typeof value !== "object" || value === null || !("type" in value) || !("card" in value)) return false;
	if (value.type !== "card") return false;
	const card = value.card;
	return typeof card === "object" && card !== null && "source" in card && card.source === source;
}

/**
 * A run in which one card's own pass through the wire schema throws.
 *
 * This is the one failure the source cannot be blamed for: it answered, the
 * card was built out of the records it answered with, and putting that card on
 * the wire is what failed. Nothing about any other source has gone wrong, and
 * an unbuildable card is the only way to reach that state -- `runSource` never
 * rejects.
 *
 * The response is parsed back in with the spy still installed, which is safe
 * and deliberate: the broken card is the one line that was never written.
 */
async function brokenCard(source: string, plan: Plan = DEMO): Promise<Run> {
	const { io } = planned(plan);
	const handler = createReportHandler(io);
	const parse = ReportEventSchema.parse.bind(ReportEventSchema);
	const spy = vi.spyOn(ReportEventSchema, "parse").mockImplementation((value: unknown): ReportEvent => {
		if (isCardFor(value, source)) throw new Error(`forced: the ${source} card cannot be parsed`);
		return parse(value);
	});
	try {
		const response = await handler(postRequest(CONFIRMED_POINT));
		const raw = await response.text();
		return { response, raw, events: eventsOf(raw) };
	} finally {
		spy.mockRestore();
	}
}

describe("a card that cannot be built", () => {
	it("still asks the registry, and still gives it a card, when the Superfund card is the one that fails", async () => {
		const { events } = await brokenCard("sems");

		// The registry card is emitted from inside the SEMS task, and FRS had
		// nothing wrong with it: SEMS answered, named its registry IDs, and the
		// lookups ran. A sibling losing its card may not cost FRS its own.
		const frs = cardFor(events, "frs");
		expect(frs.state).toBe("asked");
		expect(textsOf(frs).some((text) => text.includes("110000460885"))).toBe(true);

		expect(events.map(shapeOf)).toEqual([
			"card:aqs:asked",
			"card:airnow:asked",
			"card:echo:asked",
			"card:fema:asked",
			"card:frs:asked",
			"groups",
			"end:failed",
		]);
		// The card that could not be built is the only one missing, and the
		// stream is loud about it: a terminal `failed` and one fixed log line.
		expect(() => cardFor(events, "sems")).toThrow("no card was emitted for sems");
		expect(logged).toEqual([["report: a source card could not be built"]]);
	});

	/**
	 * The one card in the report that can still be `not-asked`. Every source in
	 * docs/BRIEF.md B2 has an adapter now, so the state is no longer reached at
	 * the top of the run: it is reached here, where the Superfund layer is
	 * refused, nothing names a registry ID and the registry is therefore not
	 * asked at all. A card carrying no sentences is still a card, and losing it
	 * costs the report exactly itself.
	 */
	it("keeps the rest of the report when the card that fails is the source nobody asked", async () => {
		const unasked: Plan = { ...DEMO, semsLayer: { fail: new SourceFailure("refused") } };
		const { events } = await brokenCard("frs", unasked);
		const shapes = events.map(shapeOf);

		// The settle order of the four that answered is not fixed -- that is what
		// the settle-order test proves -- so what is asserted is which cards are
		// on the stream, and that the registry's is not.
		expect([...shapes].sort()).toEqual([
			"card:airnow:asked",
			"card:aqs:asked",
			"card:echo:asked",
			"card:fema:asked",
			"card:sems:asked",
			"end:failed",
			"groups",
		]);
		expect(() => cardFor(events, "frs")).toThrow("no card was emitted for frs");
		expect(logged).toEqual([["report: a source card could not be built"]]);
	});

	it("speaks on no later event for a card the reader never got", async () => {
		const { events } = await brokenCard("sems");
		const groups = events.filter((event) => event.type === "groups");
		const event = at(groups, 0, "groups event");
		if (event.type !== "groups") throw new Error("expected the groups event");
		expect(event.cards.map((card) => card.source)).not.toContain("sems");
	});

	it("writes one fixed line about the failure, with nothing of the request in it", async () => {
		// The thrown error is the route's own, but the rule holds for any of
		// them: a card that could not be built is reported by a fixed string,
		// never the error, never its message, never a value from the request.
		// (The body is not asserted on here: B8 puts the mapped point in every
		// haversine provenance on purpose, and that round trip is not a leak.)
		await brokenCard("sems");
		expect(logged).toEqual([["report: a source card could not be built"]]);
		expect(serialize(logged)).not.toContain(String(LATITUDE));
		expect(serialize(logged)).not.toContain(String(LONGITUDE));
	});
});

/* -------------------------------------------------------------------------- */
/* 10. The client that goes away mid-stream                                   */
/* -------------------------------------------------------------------------- */

/** Waits for something the report does after the client has gone, or gives up. */
async function until(done: () => boolean, what: string): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		if (done()) return;
		await pause(5);
	}
	throw new Error(`the report never got as far as ${what}`);
}

describe("a client that disconnects mid-stream", () => {
	/**
	 * Every source that reaches the network answers late, so the report is
	 * genuinely mid-stream when the reader is cancelled: the two air cards are
	 * written first -- this deployment holds no key, so neither adapter gets as
	 * far as a request -- and nothing else can have settled yet.
	 */
	const LATE: Plan = {
		...DEMO,
		echoSummary: { slow: 30, then: { fixture: ECHO_SUMMARY } },
		semsLayer: { slow: 30, then: { fixture: SEMS_LAYER } },
		nfhl: { slow: 30, then: { fail: NFHL_REFUSED } },
		esri: { slow: 30, then: { fixture: "fema/esri-no-polygon-houston.json" } },
	};

	it("builds no further event, and lets the sources it already asked run to a stop", async () => {
		const { urls, io } = planned(LATE);
		const built: string[] = [];
		const parse = ReportEventSchema.parse.bind(ReportEventSchema);
		const spy = vi.spyOn(ReportEventSchema, "parse").mockImplementation((value: unknown): ReportEvent => {
			const event = parse(value);
			built.push(shapeOf(event));
			return event;
		});
		try {
			const response = await createReportHandler(io)(postRequest(CONFIRMED_POINT));
			const body = response.body;
			if (body === null) throw new Error("the report answered with no body");
			const reader = body.getReader();
			const first = await reader.read();
			expect(first.done).toBe(false);
			expect(new TextDecoder().decode(first.value)).toContain('"type":"card"');

			await reader.cancel();
			expect((await reader.read()).done).toBe(true);
			const whenTheClientLeft = [...built];
			expect(whenTheClientLeft).toEqual(["card:aqs:asked", "card:airnow:asked"]);

			// The report does not drop the requests it has already made: FRS is
			// the last thing it asks, and it is asked after the client has gone.
			await until(() => urls.some((url) => url.includes("/FRS_INTERESTS/")), "the registry lookups");
			await pause(20);

			// Not one event built for a client that is not there. That check is
			// first in `emit` because building an event costs a full schema parse
			// of a payload that can run to hundreds of kilobytes -- so the groups
			// event and the terminal event were never built at all.
			expect(built).toEqual(whenTheClientLeft);
			expect(logged).toEqual([]);
		} finally {
			spy.mockRestore();
		}
	});
});

/* -------------------------------------------------------------------------- */
/* The request this route will not act on                                     */
/* -------------------------------------------------------------------------- */

describe("the request carries a coordinate and nothing else", () => {
	it("refuses a missing, malformed or out-of-range body with the geocode route's own invalid shape", async () => {
		const { io } = planned(DEMO);
		const handler = createReportHandler(io);
		for (const body of [{}, { latitude: LATITUDE }, { latitude: "29", longitude: "-95" }, { latitude: 91, longitude: 0 }]) {
			const response = await handler(postRequest(body));
			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({ status: "invalid" });
		}
		const malformed = new Request("http://localhost/api/report", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: `{"latitude": ${LATITUDE},`,
		});
		const response = await handler(malformed);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ status: "invalid" });
		expect(logged).toEqual([]);
	});
});
