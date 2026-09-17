/**
 * The AirNow adapter.
 *
 * What the committed bytes can and cannot prove, said once here so no test
 * below has to keep saying it.
 *
 * `tests/fixtures/airnow/unauthenticated.json` is real: HTTP 401 captured live
 * on 2026-09-16. Every assertion about the `WebServiceError` envelope is an
 * assertion about recorded bytes.
 *
 * Every `derived-` file is authored, and its sibling `.source.md` says so and
 * says what it was authored from. A test over one of those proves that *this
 * adapter reads that shape the way it says it does*. It proves nothing at all
 * about what AirNow sends, and none of the names below claims otherwise.
 *
 * The `.dev/BRIEF.md` B12 cases appear in this order: success, no records,
 * missing optional fields, unknown vocabulary, malformed response, rate limit,
 * timeout. Two of them are not what B12 names, and each says so where it sits:
 *
 *   - B12's fourth case is an unknown *status*, and AirNow has no status field
 *     to hold one. Its modelled success shape carries four keys and none of
 *     them is a status, and the recorded 401 is a `WebServiceError` message
 *     with none either — so the case is unreachable for this source rather
 *     than untested. What is tested in its place is the unknown vocabulary
 *     AirNow can actually send: a parameter outside the two, and an area name
 *     and date format this file has never seen.
 *   - The rate limit and the timeout are raised by the io double rather than by
 *     bytes — B2 says AirNow's rate limits are documented behind a login and no
 *     429 from it has been seen — so those two prove the adapter hands the
 *     kernel's own failures through unchanged, and are named for that.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Locus, PayloadRef, Sourced, SourceIo, SourceOutcome } from "@/lib/evidence";
import { complete, DEFAULT_POLICY, runSource, SourceFailure } from "@/lib/evidence";
import {
	AIRNOW_PARAMETERS,
	AIRNOW_VERSION,
	AirNowObservation,
	AirNowResponse,
	AirNowWebServiceError,
	airnowAdapter,
	KEY_ENV,
	NO_KEY,
	observationQueryUrl,
	pollutantOf,
	REDACTED_ECHO,
} from "@/lib/adapters/airnow";
import { houstonLocus } from "../evidence/helpers/sems-fixtures";

const fixturesDir = fileURLToPath(new URL("../../fixtures/airnow/", import.meta.url));

const NOW = "2026-09-16T02:00:00Z";

/** A value no real key looks like, so a leak is unmistakable wherever it surfaces. */
const SENTINEL = "SENTINEL-AIRNOW-KEY-b3d1f0";

/**
 * The host the adapter cites. `.dev/BRIEF.md` B2 names `airnowapi.org`, and
 * checked from this machine on 2026-09-16 that host answers `HTTP/2 301`,
 * `location: https://www.airnowapi.org:443/aq/observation/latLong/current?...`,
 * while `www.` answers the recorded 401 with the bytes
 * `unauthenticated.json` holds. The card cites what answers.
 */
const ENDPOINT = "https://www.airnowapi.org/aq/observation/latLong/current/";
/** The citable query: everything the request carries except the key. */
const QUERY_TAIL = "format=application%2Fjson&latitude=29.720658823001&longitude=-95.261995884462";
const CITABLE = `${ENDPOINT}?${QUERY_TAIL}`;

const SHA = {
	unauthenticated: "",
	current: "",
	none: "",
	nullAqi: "",
	unmapped: "",
};

function hashOf(file: string): string {
	return createHash("sha256").update(readFileSync(`${fixturesDir}${file}`)).digest("hex");
}

SHA.unauthenticated = hashOf("unauthenticated.json");
SHA.current = hashOf("current-observations-houston.json");
SHA.none = hashOf("no-observations.json");
SHA.nullAqi = hashOf("derived-null-aqi.json");

const CAVEATS: readonly string[] = [
	"AirNow reports preliminary current conditions and updates them hourly.",
	"The values describe AirNow's own reporting area, which covers more than the mapped point.",
];

/** What the stubbed host answers: fixture bytes, an inline body, or a transport failure. */
type Route = { readonly fixture: string } | { readonly body: string } | { readonly fail: SourceFailure };

function stubIo(route: Route): { readonly io: SourceIo; readonly urls: string[] } {
	const urls: string[] = [];
	const io: SourceIo = {
		async get(url, schema) {
			urls.push(url.toString());
			if ("fail" in route) throw route.fail;
			const bytes =
				"fixture" in route ? readFileSync(`${fixturesDir}${route.fixture}`) : Buffer.from(route.body, "utf8");
			const parsed = schema.safeParse(JSON.parse(bytes.toString("utf8")));
			// What lib/io/fetch-source-io.ts does with a body its schema rejects.
			if (!parsed.success) throw new SourceFailure("malformed", null);
			return {
				raw: parsed.data,
				// The URL SourceIo actually fetched, key and all. The adapter must
				// never carry this into a returned value.
				payload: { url: url.toString(), sha256: createHash("sha256").update(bytes).digest("hex"), retrievedAt: NOW },
			};
		},
		query(parameter, value, adapterVersion, payload) {
			return { kind: "query", parameter, value, adapterVersion, payload };
		},
		now: () => NOW,
	};
	return { io, urls };
}

function locus(): Locus {
	return houstonLocus();
}

function payloadOf(sha256: string): PayloadRef {
	return { url: CITABLE, sha256, retrievedAt: NOW };
}

/** Every string anywhere in a value, however deep. Used to hunt the sentinel. */
function strings(value: unknown, into: string[]): void {
	if (typeof value === "string") {
		into.push(value);
		return;
	}
	if (typeof value !== "object" || value === null) return;
	for (const key of Object.keys(value)) {
		into.push(key);
		strings(Reflect.get(value, key), into);
	}
}

beforeEach(() => {
	process.env[KEY_ENV] = SENTINEL;
});

afterEach(() => {
	delete process.env[KEY_ENV];
});

describe("the request", () => {
	it("cites a URL that carries the coordinate and no key", () => {
		expect(observationQueryUrl(locus()).toString()).toBe(CITABLE);
		expect(CITABLE).not.toContain("API_KEY");
	});

	it("sends the key, and cites the same URL without it", async () => {
		const { io, urls } = stubIo({ fixture: "current-observations-houston.json" });
		const built = await airnowAdapter.run(locus(), io);

		expect(urls).toEqual([`${CITABLE}&${encodeURIComponent("API_KEY")}=${SENTINEL}`]);
		expect(built[0]?.caveats).toEqual(CAVEATS);
	});

	it("declares one adapter for the kind and source, with no special no-data wording", () => {
		expect(airnowAdapter).toMatchObject({ kind: "airnow-observation", source: "airnow", version: "airnow@1" });
		expect(airnowAdapter.noDataNote).toBeUndefined();
		expect(AIRNOW_VERSION).toBe("airnow@1");
	});

	it("maps AirNow's two parameter strings onto this report's vocabulary and nothing else", () => {
		expect(AIRNOW_PARAMETERS).toEqual({ "PM2.5": "PM2.5", O3: "Ozone" });
	});
});

describe("B12 case 1, success: the derived success shape, read field by field", () => {
	it("builds one record per covered pollutant, with literal normalized values", async () => {
		const { io } = stubIo({ fixture: "current-observations-houston.json" });
		const built = await airnowAdapter.run(locus(), io);
		expect(built).toHaveLength(2);

		const [ozone, pm] = built.map((b) => complete(locus(), b));
		if (ozone === undefined || pm === undefined) throw new Error("expected two records");

		expect(ozone.kind).toBe("airnow-observation");
		expect(ozone.source).toBe("airnow");
		expect(ozone.sourceRecordId).toBe("Houston-Galveston-Brazoria/O3");
		expect(ozone.id).toEqual({ kind: "airnow-observation", sourceRecordId: "Houston-Galveston-Brazoria/O3" });
		expect(ozone.subject.value).toBe("Houston-Galveston-Brazoria O3");
		expect(ozone.reportingArea.value).toBe("Houston-Galveston-Brazoria");
		expect(ozone.pollutant.value).toBe("Ozone");
		expect(ozone.observedAt.value).toBe("2026-09-16");
		expect(ozone.aqi.value).toBe(20);
		expect(ozone.category.value).toBeNull();
		expect(ozone.concentration.value).toBeNull();
		expect(ozone.unit.value).toBeNull();
		expect(ozone.effectiveAt.value).toBe("2026-09-16");
		expect(ozone.sourceUpdatedAt.value).toBeNull();
		expect(ozone.location).toBeNull();
		expect(ozone.distanceMeters).toBeNull();
		expect(ozone.sourceUrl.value).toBe(CITABLE);
		expect(ozone.caveats).toEqual(CAVEATS);
		expect(ozone.payloads).toEqual([payloadOf(SHA.current)]);

		expect(pm.sourceRecordId).toBe("Houston-Galveston-Brazoria/PM2.5");
		expect(pm.subject.value).toBe("Houston-Galveston-Brazoria PM2.5");
		expect(pm.pollutant.value).toBe("PM2.5");
		expect(pm.aqi.value).toBe(62);
		expect(pm.payloads).toEqual([payloadOf(SHA.current)]);
	});

	it("traces every value to the column it was read from, and our two words to the request", async () => {
		const { io } = stubIo({ fixture: "current-observations-houston.json" });
		const [first] = await airnowAdapter.run(locus(), io);
		if (first === undefined) throw new Error("expected a row");
		const record = complete(locus(), first);
		const payload = payloadOf(SHA.current);

		expect(record.aqi.provenance).toEqual([
			{
				kind: "field",
				dataset: "airnow_current_observations",
				sourceField: "AQI",
				rawValue: 20,
				transform: "identity",
				adapterVersion: "airnow@1",
				payload,
			},
		]);
		expect(record.observedAt.provenance).toEqual([
			{
				kind: "field",
				dataset: "airnow_current_observations",
				sourceField: "DateObserved",
				rawValue: "2026-09-16",
				transform: "normalize-date",
				adapterVersion: "airnow@1",
				payload,
			},
		]);
		// Our vocabulary, so its provenance is the request and not a column.
		expect(record.pollutant.provenance).toEqual([
			{ kind: "query", parameter: "pollutant", value: "Ozone", adapterVersion: "airnow@1", payload },
		]);
		expect(record.sourceUrl.provenance).toEqual([
			{ kind: "query", parameter: "request", value: CITABLE, adapterVersion: "airnow@1", payload },
		]);
		// AirNow's own parameter string reaches the trace through `subject`.
		expect(record.subject.provenance[0]).toMatchObject({
			kind: "computation",
			formula: "coalesce",
		});
		// Four fields the documentation never named: absent, not null-with-no-origin.
		const unread: readonly { readonly field: Sourced<unknown>; readonly name: string }[] = [
			{ field: record.category, name: "Category" },
			{ field: record.concentration, name: "Concentration" },
			{ field: record.unit, name: "Unit" },
			{ field: record.sourceUpdatedAt, name: "SourceUpdatedAt" },
		];
		for (const { field, name } of unread) {
			expect(field.provenance).toEqual([
				{ kind: "absent", dataset: "airnow_current_observations", sourceField: name, adapterVersion: "airnow@1", payload },
			]);
		}
	});
});

describe("B12 case 2, no records: an answer, not a failure", () => {
	it("returns nothing, which the kernel reports as no-data with B10's wording", async () => {
		const { io, urls } = stubIo({ fixture: "no-observations.json" });
		await expect(airnowAdapter.run(locus(), io)).resolves.toEqual([]);

		const outcome = await runSource(locus(), airnowAdapter, io, DEFAULT_POLICY);
		const asked = urls[urls.length - 1] ?? "";
		expect(outcome).toEqual({
			status: "no-data",
			note: "No matching records within the stated boundary.",
			retrievedAt: NOW,
			// An empty answer still names what was asked. The key in that URL is
			// the kernel's to hold and `app/lib/report-contract.ts`'s to redact.
			query: {
				kind: "query",
				parameter: "request",
				value: asked,
				adapterVersion: AIRNOW_VERSION,
				payload: { url: asked, sha256: SHA.none, retrievedAt: NOW },
			},
		});
		expect(SHA.none).toBe(createHash("sha256").update("[]").digest("hex"));
	});
});

describe("B12 case 3, missing optional fields: a row with no index", () => {
	it("keeps the row, reads the null through the AQI column, and leaves every other field standing", async () => {
		const { io } = stubIo({ fixture: "derived-null-aqi.json" });
		const [first] = await airnowAdapter.run(locus(), io);
		if (first === undefined) throw new Error("expected a row");
		const record = complete(locus(), first);

		expect(record.sourceRecordId).toBe("Houston/PM2.5");
		expect(record.aqi.value).toBeNull();
		expect(record.aqi.provenance).toEqual([
			{
				kind: "field",
				dataset: "airnow_current_observations",
				sourceField: "AQI",
				rawValue: null,
				transform: "parse-number",
				adapterVersion: "airnow@1",
				payload: payloadOf(SHA.nullAqi),
			},
		]);
		expect(record.reportingArea.value).toBe("Houston");
		expect(record.pollutant.value).toBe("PM2.5");
		expect(record.observedAt.value).toBe("2026-09-16");
	});
});

describe("B12 case 4 has no status to be unknown: vocabulary this codebase has never seen instead", () => {
	it("has no status field to carry an unknown status, on either shape this source can send", () => {
		// The point of the rename. AirNow's success shape is four keys and the
		// recorded error envelope is a message; neither holds a status, so B12's
		// unknown-status case cannot be reached from this source at all.
		expect(Object.keys(AirNowObservation.shape)).toEqual(["ReportingArea", "ParameterName", "DateObserved", "AQI"]);
		expect(Object.keys(AirNowWebServiceError.shape)).toEqual(["WebServiceError"]);
		const recorded: unknown = JSON.parse(readFileSync(`${fixturesDir}unauthenticated.json`).toString("utf8"));
		expect(JSON.stringify(recorded)).not.toContain("tatus");
	});

	/**
	 * This was an authored two-row body until 2026-09-16, and its note said
	 * `PM10` was the obvious third criteria pollutant rather than something
	 * anything reachable confirmed AirNow spells that way. The recording made
	 * that a fact: AirNow answered the demonstration coordinate with three rows,
	 * and the third is `PM10`. The authored body was deleted rather than kept
	 * beside a response that says the same thing with real bytes.
	 */
	it("parses a parameter outside the two, keeps the rows beside it, and never enumerates the agency", async () => {
		const { io } = stubIo({ fixture: "current-observations-houston.json" });
		const built = await airnowAdapter.run(locus(), io);
		const rows: unknown = JSON.parse(readFileSync(`${fixturesDir}current-observations-houston.json`).toString("utf8"));

		// AirNow sent three rows and one of them is outside this report's
		// vocabulary, so the unfamiliar row cost the report nothing except itself.
		expect(JSON.stringify(rows)).toContain('"ParameterName":"PM10"');
		expect(built.map((b) => b.sourceRecordId)).toEqual([
			"Houston-Galveston-Brazoria/O3",
			"Houston-Galveston-Brazoria/PM2.5",
		]);
		expect(AIRNOW_PARAMETERS["PM10"]).toBeUndefined();
		const [, kept] = built;
		if (kept === undefined) throw new Error("expected the PM2.5 row to survive");
		const record = complete(locus(), kept);
		expect(record.pollutant.value).toBe("PM2.5");
		expect(record.payloads).toEqual([payloadOf(SHA.current)]);
	});

	/*
	 * And the two strings in that vocabulary that were not dropped until
	 * 2026-09-16. The table is an object literal, so an index into it reaches
	 * `Object.prototype`, and the guard beside it was `!== undefined`:
	 *
	 *   AIRNOW_PARAMETERS["NO2"]         -> undefined         (dropped)
	 *   AIRNOW_PARAMETERS["constructor"] -> [Function Object]  (kept)
	 *   AIRNOW_PARAMETERS["__proto__"]   -> {}                 (kept)
	 *
	 * A kept row built a record with a function or an object in `pollutant.value`,
	 * which the kind types as one of two words; `app/lib/report-contract.ts`
	 * then refused the record at the wire and the whole AirNow card was lost —
	 * no `card:airnow` event at all, "Sources settled: 5 of 6" and a Retry, with
	 * nothing on screen naming the missing source. One string in one row.
	 */
	it("drops a parameter named for a key of Object.prototype, which an index alone does not", async () => {
		// The hole itself, shown rather than described. Both stay true after the
		// fix: the table is still an object literal and it is the read that changed.
		expect(AIRNOW_PARAMETERS["NO2"]).toBeUndefined();
		expect(AIRNOW_PARAMETERS["constructor"]).toBeDefined();
		expect(AIRNOW_PARAMETERS["__proto__"]).toBeDefined();

		// Inline, not a fixture: nothing here is a claim about what AirNow sends.
		const body = JSON.stringify([
			{ ReportingArea: "Houston", ParameterName: "NO2", DateObserved: "2026-09-16", AQI: 12 },
			{ ReportingArea: "Houston", ParameterName: "constructor", DateObserved: "2026-09-16", AQI: 13 },
			{ ReportingArea: "Houston", ParameterName: "__proto__", DateObserved: "2026-09-16", AQI: 14 },
			{ ReportingArea: "Houston", ParameterName: "PM2.5", DateObserved: "2026-09-16", AQI: 58 },
		]);
		const { io } = stubIo({ body });
		const built = await airnowAdapter.run(locus(), io);

		// Three rows this report has no field for, and the one beside them that
		// survives all three.
		expect(built.map((b) => b.sourceRecordId)).toEqual(["Houston/PM2.5"]);
		for (const record of built) expect(["PM2.5", "Ozone"]).toContain(record.pollutant.value);

		// And the card is a card: the kernel reports it ok rather than losing it.
		const outcome = await runSource(locus(), airnowAdapter, stubIo({ body }).io, DEFAULT_POLICY);
		expect(outcome.status).toBe("ok");

		// The read that decides all of the above, on its own. `pollutantOf` is
		// the only way this table is consulted; `lib/adapters/aqs.ts` exports the
		// same function over its own table for the same reason.
		expect(pollutantOf("NO2")).toBeNull();
		expect(pollutantOf("constructor")).toBeNull();
		expect(pollutantOf("__proto__")).toBeNull();
		expect(pollutantOf("PM2.5")).toBe("PM2.5");
		expect(pollutantOf("O3")).toBe("Ozone");
	});

	it("passes an area name and a date shape it has never seen through verbatim", async () => {
		// Inline, not a fixture: nothing here is a claim about what AirNow sends.
		const body = JSON.stringify([
			{
				ReportingArea: "Metropolitan Houston-Galveston-Brazoria",
				ParameterName: "PM2.5",
				DateObserved: "16-SEP-2026 11:00 CDT",
				AQI: 58,
				SomeColumnThisAdapterDoesNotRead: 1,
			},
		]);
		const { io } = stubIo({ body });
		const [first] = await airnowAdapter.run(locus(), io);
		if (first === undefined) throw new Error("expected a row");
		const record = complete(locus(), first);

		expect(record.reportingArea.value).toBe("Metropolitan Houston-Galveston-Brazoria");
		// normalize-date leaves anything that is not an ISO date alone. The raw
		// string is what the trace shows either way.
		expect(record.observedAt.value).toBe("16-SEP-2026 11:00 CDT");
		expect(record.observedAt.provenance[0]).toMatchObject({
			sourceField: "DateObserved",
			rawValue: "16-SEP-2026 11:00 CDT",
			transform: "normalize-date",
		});
	});
});

describe("B12 case 5, malformed response", () => {
	it("is unavailable when the body is JSON of the wrong shape, never a record with a guessed value", async () => {
		const { io } = stubIo({ body: '{"observations":[]}' });
		const outcome = await runSource(locus(), airnowAdapter, io, DEFAULT_POLICY);
		expect(outcome).toEqual({ status: "unavailable", cause: "malformed", rawCode: null, retryAfter: null });
	});
});

describe("B12 case 6, rate limit: the kernel's failure, handed through unchanged", () => {
	// AirNow's rate limits are documented behind a login (.dev/BRIEF.md B2) and
	// no 429 from it has been recorded, so the io raises this rather than bytes.
	it("keeps the source's own code and retry time", async () => {
		const { io } = stubIo({ fail: new SourceFailure("rate-limited", 429, "3600") });
		const outcome = await runSource(locus(), airnowAdapter, io, DEFAULT_POLICY);
		expect(outcome).toEqual({ status: "unavailable", cause: "rate-limited", rawCode: 429, retryAfter: "3600" });
	});
});

describe("B12 case 7, timeout", () => {
	it("is unavailable with cause timeout, and the adapter never resolves past it", async () => {
		const io: SourceIo = {
			get: () => new Promise(() => undefined),
			query(parameter, value, adapterVersion, payload) {
				return { kind: "query", parameter, value, adapterVersion, payload };
			},
			now: () => NOW,
		};
		const outcome = await runSource(locus(), airnowAdapter, io, { timeoutMs: 10 });
		expect(outcome).toEqual({ status: "unavailable", cause: "timeout", rawCode: null, retryAfter: null });
	});
});

describe("the one recorded fact: AirNow without a key, 2026-09-16", () => {
	it("is the committed bytes, and its envelope parses as WebServiceError", () => {
		const bytes = readFileSync(`${fixturesDir}unauthenticated.json`);
		expect(bytes.toString("utf8")).toBe('{"WebServiceError":[{"Message":"Request not authenticated."}]}');
		const parsed = AirNowWebServiceError.parse(JSON.parse(bytes.toString("utf8")));
		expect(parsed.WebServiceError).toEqual([{ Message: "Request not authenticated." }]);
		expect(SHA.unauthenticated).toBe(createHash("sha256").update(bytes).digest("hex"));
	});

	it("is not read as a list of observations when it reaches the response schema", () => {
		const parsed = AirNowResponse.parse(JSON.parse(readFileSync(`${fixturesDir}unauthenticated.json`).toString("utf8")));
		expect(Array.isArray(parsed)).toBe(false);
	});

	it("becomes an unavailable outcome carrying AirNow's own message, never a record and never no-data", async () => {
		// The recorded envelope arrived with HTTP 401, which
		// lib/io/fetch-source-io.ts turns into a failure before parsing. This
		// covers the other case: the same envelope delivered at HTTP 200, the way
		// ECHO and ArcGIS deliver theirs.
		const { io } = stubIo({ fixture: "unauthenticated.json" });
		const outcome = await runSource(locus(), airnowAdapter, io, DEFAULT_POLICY);
		expect(outcome).toEqual({
			status: "unavailable",
			cause: "http",
			rawCode: "Request not authenticated.",
			retryAfter: null,
		});
	});

	it("is unavailable, not no-data, when the io reports the real 401 status", async () => {
		const { io } = stubIo({ fail: new SourceFailure("http", 401) });
		const outcome = await runSource(locus(), airnowAdapter, io, DEFAULT_POLICY);
		expect(outcome).toEqual({ status: "unavailable", cause: "http", rawCode: 401, retryAfter: null });
	});
});

describe("an absent key is a source that could not be asked", () => {
	it("is unavailable with a marker of ours, and is distinguishable from a source that answered with nothing", async () => {
		delete process.env[KEY_ENV];
		const { io, urls } = stubIo({ fixture: "current-observations-houston.json" });
		const unasked = await runSource(locus(), airnowAdapter, io, DEFAULT_POLICY);

		// Nothing was fetched: the adapter fails before it reaches the network.
		expect(urls).toEqual([]);
		expect(unasked).toEqual({ status: "unavailable", cause: "not-configured", rawCode: NO_KEY, retryAfter: null });

		process.env[KEY_ENV] = SENTINEL;
		const { io: emptyIo } = stubIo({ fixture: "no-observations.json" });
		const answered = await runSource(locus(), airnowAdapter, emptyIo, DEFAULT_POLICY);

		// The two outcomes a reader must never confuse.
		expect(answered.status).toBe("no-data");
		expect(unasked.status).toBe("unavailable");
		expect(unasked).not.toEqual(answered);
		const distinct: readonly SourceOutcome[] = [unasked, answered];
		expect(new Set(distinct.map((o) => o.status)).size).toBe(2);
	});

	it("treats an empty key the same as an unset one", async () => {
		process.env[KEY_ENV] = "";
		const { io, urls } = stubIo({ fixture: "current-observations-houston.json" });
		const outcome = await runSource(locus(), airnowAdapter, io, DEFAULT_POLICY);
		expect(urls).toEqual([]);
		expect(outcome).toEqual({ status: "unavailable", cause: "not-configured", rawCode: NO_KEY, retryAfter: null });
	});

	it("names no key and no fragment of one in the marker it reports", () => {
		expect(NO_KEY).toBe("no-api-key");
		expect(NO_KEY).not.toContain(SENTINEL);
	});
});

describe("the key never leaves the one line that fetches with it", () => {
	it("appears in no returned value, no payload URL, no provenance and no thrown error", async () => {
		const { io, urls } = stubIo({ fixture: "current-observations-houston.json" });
		const built = await airnowAdapter.run(locus(), io);
		const records = built.map((b) => complete(locus(), b));

		// The sentinel is genuinely in play: the request carried it.
		expect(urls.some((u) => u.includes(SENTINEL))).toBe(true);

		const found: string[] = [];
		strings(records, found);
		expect(found.length).toBeGreaterThan(20);
		for (const s of found) expect(s).not.toContain(SENTINEL);

		// And every payload URL is the citable one, not the URL SourceIo fetched.
		for (const record of records) {
			for (const payload of record.payloads) expect(payload.url).toBe(CITABLE);
			expect(record.sourceUrl.value).toBe(CITABLE);
		}
	});

	it("keeps it out of the error a failing response produces", async () => {
		const { io } = stubIo({ fixture: "unauthenticated.json" });
		const thrown = await airnowAdapter.run(locus(), io).then(
			() => null,
			(error: unknown) => error,
		);
		expect(thrown).toBeInstanceOf(SourceFailure);
		const found: string[] = [];
		strings(thrown, found);
		if (thrown instanceof Error) {
			found.push(thrown.message, thrown.name, thrown.stack ?? "");
		}
		for (const s of found) expect(s).not.toContain(SENTINEL);
	});

	it("keeps it out of the outcome an unconfigured deployment produces", async () => {
		delete process.env[KEY_ENV];
		const { io } = stubIo({ fixture: "current-observations-houston.json" });
		const outcome = await runSource(locus(), airnowAdapter, io, DEFAULT_POLICY);
		const found: string[] = [];
		strings(outcome, found);
		for (const s of found) expect(s).not.toContain(SENTINEL);
	});
});

describe("a key the source itself hands back", () => {
	/*
	 * Every test above proves this adapter does not *construct* a leak. That is a
	 * different claim from proving it *filters* one, and only the second is worth
	 * anything against a host that quotes the request it rejected: the recorded
	 * 401 is a message, `run` forwards it into `SourceFailure.rawCode`, and
	 * `lib/templates/sources.ts` prints that on the card as
	 * "It answered {rawCode}.". `app/lib/report-contract.ts`'s
	 * `withoutSecretValues` is a backstop at the wire; this is the adapter doing
	 * it while it still holds the key.
	 *
	 * Both bodies below are written inline. Neither is a claim about what AirNow
	 * sends, and neither is filed as a fixture.
	 */
	it("keeps it out of the rawCode the card prints, in either of the forms it can arrive in", async () => {
		const leaky = JSON.stringify({
			WebServiceError: [{ Message: `Request not authenticated for ${CITABLE}&API_KEY=${SENTINEL}` }],
		});
		const outcome = await runSource(locus(), airnowAdapter, stubIo({ body: leaky }).io, DEFAULT_POLICY);
		expect(outcome).toEqual({ status: "unavailable", cause: "http", rawCode: REDACTED_ECHO, retryAfter: null });

		// The same key percent-encoded, which is how a host echoing a URL back
		// inside a message carries one. This key has characters that encode, so
		// the encoded form does not contain the raw one and only the second pass
		// of the scrub can catch it.
		const ENCODABLE = "SENTINEL AIRNOW+KEY/b3d1f0";
		expect(encodeURIComponent(ENCODABLE)).not.toContain(ENCODABLE);
		process.env[KEY_ENV] = ENCODABLE;
		const encoded = JSON.stringify({
			WebServiceError: [{ Message: `Bad key: ${CITABLE}&API_KEY=${encodeURIComponent(ENCODABLE)}` }],
		});
		const second = await runSource(locus(), airnowAdapter, stubIo({ body: encoded }).io, DEFAULT_POLICY);
		expect(second).toEqual({ status: "unavailable", cause: "http", rawCode: REDACTED_ECHO, retryAfter: null });
		expect(JSON.stringify(second)).not.toContain(encodeURIComponent(ENCODABLE));

		for (const one of [outcome, second]) {
			const found: string[] = [];
			strings(one, found);
			for (const text of found) expect(text).not.toContain(SENTINEL);
		}
	});

	it("leaves AirNow's own words alone when they carry no key", async () => {
		const { io } = stubIo({ fixture: "unauthenticated.json" });
		const outcome = await runSource(locus(), airnowAdapter, io, DEFAULT_POLICY);
		// The recorded message, byte for byte: the scrub redacts a credential, not
		// a sentence.
		expect(outcome).toEqual({
			status: "unavailable",
			cause: "http",
			rawCode: "Request not authenticated.",
			retryAfter: null,
		});
	});

	it("keeps it out of the record when a data column carries it, including the id and the trace", async () => {
		const leaky = JSON.stringify([
			{
				// The column `sourceRecordId` and `subject` are joined from.
				ReportingArea: `Houston (key ${SENTINEL})`,
				ParameterName: "PM2.5",
				DateObserved: "2026-09-16",
				AQI: 58,
			},
		]);
		const { io } = stubIo({ body: leaky });
		const [first] = await airnowAdapter.run(locus(), io);
		if (first === undefined) throw new Error("expected a row");
		const record = complete(locus(), first);

		expect(record.sourceRecordId).toBe(`${REDACTED_ECHO}/PM2.5`);
		expect(record.reportingArea.value).toBe(REDACTED_ECHO);
		// The raw value reaches the trace panel too, so the scrub is upstream of
		// the reader rather than in the template.
		expect(record.reportingArea.provenance[0]).toMatchObject({
			sourceField: "ReportingArea",
			rawValue: REDACTED_ECHO,
		});
		// The columns that carried no key are untouched.
		expect(record.aqi.value).toBe(58);
		expect(record.observedAt.value).toBe("2026-09-16");

		const found: string[] = [];
		strings(record, found);
		for (const text of found) expect(text).not.toContain(SENTINEL);
	});

	it("says what happened in words that are ours, and carries no fragment of the key", () => {
		expect(REDACTED_ECHO).toBe("[redacted: the source's answer carried this deployment's key]");
		expect(REDACTED_ECHO).not.toContain(SENTINEL);
	});
});
