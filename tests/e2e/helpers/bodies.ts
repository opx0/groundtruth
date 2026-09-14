/**
 * The bytes the browser is served, produced by the real route handlers over the
 * committed fixtures.
 *
 * Playwright's test process is Node, so this file runs `createGeocodeHandler`
 * and `createReportHandler` -- the same two functions the `route.ts` files ship --
 * against a `SourceIo` that answers with recorded government bytes, and the
 * spec files fulfil the geocode and report routes at the browser with what came back.
 * Nothing here writes a sentence, a card or a line of NDJSON: every string the
 * browser renders came off a template in `lib/templates/` over bytes an agency
 * really sent. The server Playwright starts is the real production build and
 * knows nothing about any of this.
 *
 * WHAT IS REUSED AND WHAT IS RESTATED. The report half is
 * `tests/unit/app/helpers/report-stream-fixtures.ts`: its `Plan`, its `Answer`,
 * its `DEMO` and `FOUR_STATES`, and `reportResponse` itself. Two things it
 * cannot do are done here.
 *
 * 1. **The geocode half.** It exports `houstonMatch()`, the parsed match, and
 *    the browser needs the whole response -- and two responses it has no
 *    function for, the ambiguous list and the no-match. `geocodeBody` runs the
 *    real handler over any census fixture.
 * 2. **The air half.** `Plan` has no arm for AQS or AirNow: it was written
 *    while neither adapter was registered, and its io throws on a URL it does
 *    not route. Both are registered now (`app/api/report/handler.ts`'s
 *    `LOCUS_SOURCES`), so `AirPlan` below adds the two answers and `airIo`
 *    routes their two hosts. That is the brief's "add a plan, do not write a
 *    body", added here because this unit owns `tests/e2e/` and nothing else.
 *
 * THE AIR CREDENTIALS DECIDE WHICH REPORT THIS IS, so no value outside this
 * process may decide it. `lib/adapters/aqs.ts` and `lib/adapters/airnow.ts`
 * read `process.env` at the point of use: with a key the source is asked, and
 * without one it fails before the network with `not-configured`. Both states
 * are paths under test, so each body is built inside `withAir` or `withoutAir`,
 * which set the three variables and put back whatever was there. A developer
 * with a real `AQS_KEY` in their shell runs the same suite as CI.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { z } from "zod";
import { SourceFailure } from "@/lib/evidence";
import type { Fetched, JsonValue, PayloadRef, SourceIo } from "@/lib/evidence";
import { createGeocodeHandler } from "@/app/api/geocode/handler";
import { createReportHandler } from "@/app/api/report/handler";
import { NDJSON_CONTENT_TYPE } from "@/app/lib/report-contract";
import {
	DEMO,
	FOUR_STATES,
	houstonMatch,
	RETRIEVED_AT,
	reportResponse,
	type Answer,
	type Plan,
} from "@/tests/unit/app/helpers/report-stream-fixtures";

export { DEMO, FOUR_STATES };
export type { Plan };

const fixturesDir = fileURLToPath(new URL("../../fixtures/", import.meta.url));

/** What a route handler produced: the bytes, and the two headers the browser's own parse depends on. */
export type Body = {
	readonly status: number;
	readonly contentType: string;
	readonly body: string;
};

async function bodyOf(response: Response): Promise<Body> {
	return {
		status: response.status,
		contentType: response.headers.get("content-type") ?? "",
		body: await response.text(),
	};
}

/* -------------------------------------------------------------------------- */
/* The stub io                                                                */
/* -------------------------------------------------------------------------- */

function bytesOf(relative: string): Buffer {
	return readFileSync(`${fixturesDir}${relative}`);
}

function pause(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The same interpretation of an `Answer` the unit helper makes, over the same
 * fixture directory: a fixture's bytes, a derived body, a failure, or a delay
 * in front of one of those. Restated rather than imported because the helper
 * keeps it private; the `Answer` type it is written against is the helper's
 * own, so a new arm there is a type error here rather than a silent divergence.
 */
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
/* The geocode route                                                          */
/* -------------------------------------------------------------------------- */

/** Every census fixture `docs/BRIEF.md` B10 names an outcome for. */
export const CENSUS = {
	match: "census/match-9311-e-ave-p.json",
	ambiguous: "census/ambiguous-100-main-st.json",
	noMatch: "census/no-match-9400-clinton.json",
};

/**
 * The geocode route's own answer for one recorded Census reply.
 *
 * The address is the one the reader typed and reaches only this handler, which
 * is the privacy boundary `app/api/geocode/handler.ts` describes; the fixture
 * decides the outcome, so the address a spec types is a label and not a lookup.
 */
export async function geocodeBody(fixture: string, address: string): Promise<Body> {
	const handler = createGeocodeHandler(ioOf(() => ({ fixture })));
	return bodyOf(
		await handler(
			new Request("http://localhost/api/geocode", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ address }),
			}),
		),
	);
}

/* -------------------------------------------------------------------------- */
/* The report route                                                           */
/* -------------------------------------------------------------------------- */

/** The three variables the two air adapters read, and the values this suite decides them with. */
const AIR_ENV: readonly (readonly [string, string])[] = [
	["AQS_EMAIL", "e2e@example.test"],
	["AQS_KEY", "e2e-aqs-key"],
	["AIRNOW_KEY", "e2e-airnow-key"],
];

async function withEnv<T>(values: readonly (readonly [string, string | undefined])[], run: () => Promise<T>): Promise<T> {
	const before = values.map(([name]): readonly [string, string | undefined] => [name, process.env[name]]);
	const set = (pairs: readonly (readonly [string, string | undefined])[]): void => {
		for (const [name, value] of pairs) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	};
	set(values);
	try {
		return await run();
	} finally {
		set(before);
	}
}

/** A report built with no air credentials in scope: both air sources fail before the network, whatever the machine holds. */
function withoutAir<T>(run: () => Promise<T>): Promise<T> {
	return withEnv(
		AIR_ENV.map(([name]): readonly [string, undefined] => [name, undefined]),
		run,
	);
}

/** A report built with this suite's own air credentials in scope, so both air sources are asked and `airIo` answers them. */
function withAir<T>(run: () => Promise<T>): Promise<T> {
	return withEnv(AIR_ENV, run);
}

/** The unit helper's plan, plus the two sources it predates. */
export type AirPlan = Plan & {
	readonly aqs: Answer;
	readonly airnow: Answer;
};

/** `DEMO`, with both air sources answering from their committed fixtures. */
export const AIR_ANSWERED: AirPlan = {
	...DEMO,
	aqs: { fixture: "aqs/derived-annual-summary-houston.json" },
	airnow: { fixture: "airnow/derived-current-observations.json" },
};

function epaIdOf(url: URL): string {
	const segments = url.pathname.split("/");
	return segments[segments.length - 2] ?? "";
}

function registryIdOf(url: URL): string {
	return /REGISTRY_ID='([^']*)'/.exec(url.searchParams.get("where") ?? "")?.[1] ?? "";
}

/** The unit helper's routing with the two air hosts added. Every other line of it is the same table over the same fixtures. */
function airIo(plan: AirPlan): SourceIo {
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
		throw new Error(`the e2e stub io was asked for an unrouted URL: ${url.host}${url.pathname}`);
	});
}

/**
 * The confirmed point, read off the match the geocode route returns rather than
 * typed in: it is the coordinate the browser itself posts, so the report this
 * builds is the report that point asks for.
 */
async function houstonPoint(): Promise<{ readonly latitude: number; readonly longitude: number }> {
	const { latitude, longitude } = await houstonMatch();
	return { latitude, longitude };
}

function reportRequest(point: { readonly latitude: number; readonly longitude: number }): Request {
	return new Request("http://localhost/api/report", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(point),
	});
}

/**
 * A report body fails here rather than on screen if it is not the stream.
 * `app/lib/report-stream.ts` refuses anything but `application/x-ndjson`, and a
 * route that answered with JSON instead would reach every report test as the
 * same unreadable screen with no hint of why.
 */
function stream(body: Body): Body {
	if (!body.contentType.startsWith(NDJSON_CONTENT_TYPE)) {
		throw new Error(`the report route answered ${body.status} with content type "${body.contentType}"`);
	}
	return body;
}

/** One plan's stream, as the browser receives it: the real NDJSON, under the content type `requestReport` insists on. */
export async function reportBody(plan: Plan): Promise<Body> {
	return withoutAir(async () => stream(await bodyOf(await reportResponse(plan))));
}

/** The same, for a plan that includes the two air sources, with this suite's credentials in scope while it is built. */
export async function airReportBody(plan: AirPlan): Promise<Body> {
	return withAir(async () => {
		const handler = createReportHandler(airIo(plan));
		return stream(await bodyOf(await handler(reportRequest(await houstonPoint()))));
	});
}
