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
 * The seven `docs/BRIEF.md` B12 cases appear in this order: success, no
 * records, missing optional fields, unknown status, malformed response, rate
 * limit, timeout. The rate limit and the timeout are raised by the io double
 * rather than by bytes — B2 says AirNow's rate limits are documented behind a
 * login and no 429 from it has been seen — so those two prove the adapter hands
 * the kernel's own failures through unchanged, and are named for that.
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
	AirNowResponse,
	AirNowWebServiceError,
	airnowAdapter,
	KEY_ENV,
	NO_KEY,
	observationQueryUrl,
} from "@/lib/adapters/airnow";
import { houstonLocus } from "../evidence/helpers/sems-fixtures";

const fixturesDir = fileURLToPath(new URL("../../fixtures/airnow/", import.meta.url));

const NOW = "2026-09-16T02:00:00Z";

/** A value no real key looks like, so a leak is unmistakable wherever it surfaces. */
const SENTINEL = "SENTINEL-AIRNOW-KEY-b3d1f0";

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
SHA.current = hashOf("derived-current-observations.json");
SHA.none = hashOf("derived-no-observations.json");
SHA.nullAqi = hashOf("derived-null-aqi.json");
SHA.unmapped = hashOf("derived-unmapped-parameter.json");

const CAVEATS: readonly string[] = [
	"No response from this service has been recorded yet. The parse is unverified against real bytes, and"
		+ " AirNow's own per-service documentation is behind a login, so its field names are not backed by a"
		+ " published field list either.",
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
		const { io, urls } = stubIo({ fixture: "derived-current-observations.json" });
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
		const { io } = stubIo({ fixture: "derived-current-observations.json" });
		const built = await airnowAdapter.run(locus(), io);
		expect(built).toHaveLength(2);

		const [ozone, pm] = built.map((b) => complete(locus(), b));
		if (ozone === undefined || pm === undefined) throw new Error("expected two records");

		expect(ozone.kind).toBe("airnow-observation");
		expect(ozone.source).toBe("airnow");
		expect(ozone.sourceRecordId).toBe("Houston/O3");
		expect(ozone.id).toEqual({ kind: "airnow-observation", sourceRecordId: "Houston/O3" });
		expect(ozone.subject.value).toBe("Houston O3");
		expect(ozone.reportingArea.value).toBe("Houston");
		expect(ozone.pollutant.value).toBe("Ozone");
		expect(ozone.observedAt.value).toBe("2026-09-16");
		expect(ozone.aqi.value).toBe(41);
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

		expect(pm.sourceRecordId).toBe("Houston/PM2.5");
		expect(pm.subject.value).toBe("Houston PM2.5");
		expect(pm.pollutant.value).toBe("PM2.5");
		expect(pm.aqi.value).toBe(58);
		expect(pm.payloads).toEqual([payloadOf(SHA.current)]);
	});

	it("traces every value to the column it was read from, and our two words to the request", async () => {
		const { io } = stubIo({ fixture: "derived-current-observations.json" });
		const [first] = await airnowAdapter.run(locus(), io);
		if (first === undefined) throw new Error("expected a row");
		const record = complete(locus(), first);
		const payload = payloadOf(SHA.current);

		expect(record.aqi.provenance).toEqual([
			{
				kind: "field",
				dataset: "airnow_current_observations",
				sourceField: "AQI",
				rawValue: 41,
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
		const { io } = stubIo({ fixture: "derived-no-observations.json" });
		await expect(airnowAdapter.run(locus(), io)).resolves.toEqual([]);

		const outcome = await runSource(locus(), airnowAdapter, io, DEFAULT_POLICY);
		expect(outcome).toEqual({
			status: "no-data",
			note: "No matching records within the stated boundary.",
			retrievedAt: NOW,
		});
		expect(SHA.none).toBe(createHash("sha256").update("[]\n").digest("hex"));
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

describe("B12 case 4, unknown status: vocabulary this codebase has never seen", () => {
	it("parses a parameter outside the two, keeps the row beside it, and never enumerates the agency", async () => {
		const { io } = stubIo({ fixture: "derived-unmapped-parameter.json" });
		const built = await airnowAdapter.run(locus(), io);

		// The unfamiliar row cost the report nothing except itself.
		expect(built.map((b) => b.sourceRecordId)).toEqual(["Houston/PM2.5"]);
		expect(AIRNOW_PARAMETERS["PM10"]).toBeUndefined();
		const [kept] = built;
		if (kept === undefined) throw new Error("expected the PM2.5 row to survive");
		const record = complete(locus(), kept);
		expect(record.pollutant.value).toBe("PM2.5");
		expect(record.payloads).toEqual([payloadOf(SHA.unmapped)]);
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
	// AirNow's rate limits are documented behind a login (docs/BRIEF.md B2) and
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
		const { io, urls } = stubIo({ fixture: "derived-current-observations.json" });
		const unasked = await runSource(locus(), airnowAdapter, io, DEFAULT_POLICY);

		// Nothing was fetched: the adapter fails before it reaches the network.
		expect(urls).toEqual([]);
		expect(unasked).toEqual({ status: "unavailable", cause: "unknown", rawCode: NO_KEY, retryAfter: null });

		process.env[KEY_ENV] = SENTINEL;
		const { io: emptyIo } = stubIo({ fixture: "derived-no-observations.json" });
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
		const { io, urls } = stubIo({ fixture: "derived-current-observations.json" });
		const outcome = await runSource(locus(), airnowAdapter, io, DEFAULT_POLICY);
		expect(urls).toEqual([]);
		expect(outcome).toEqual({ status: "unavailable", cause: "unknown", rawCode: NO_KEY, retryAfter: null });
	});

	it("names no key and no fragment of one in the marker it reports", () => {
		expect(NO_KEY).toBe("no-api-key");
		expect(NO_KEY).not.toContain(SENTINEL);
	});
});

describe("the key never leaves the one line that fetches with it", () => {
	it("appears in no returned value, no payload URL, no provenance and no thrown error", async () => {
		const { io, urls } = stubIo({ fixture: "derived-current-observations.json" });
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
		const { io } = stubIo({ fixture: "derived-current-observations.json" });
		const outcome = await runSource(locus(), airnowAdapter, io, DEFAULT_POLICY);
		const found: string[] = [];
		strings(outcome, found);
		for (const s of found) expect(s).not.toContain(SENTINEL);
	});
});
