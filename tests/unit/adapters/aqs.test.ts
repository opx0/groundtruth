/**
 * The AQS adapter against the committed AQS fixture bytes.
 *
 * One of those fixtures is a recording and the rest are not, and the difference
 * is the point of this file. `aqs/rate-limited.json` is real bytes: HTTP 429
 * with `Retry-After: 86400` from EPA's exhausted shared test account, captured
 * live on 2026-09-16. Every other fixture here is authored from EPA's published
 * documentation, carries a `derived-` prefix and a sibling `.source.md`, and
 * proves what this codebase does with a shape it has never seen rather than
 * what EPA sends.
 *
 * `stubIo` deliberately mirrors `lib/io/fetch-source-io.ts`: status before
 * parse, `safeParse` rather than `parse`, and a `SourceFailure` that carries no
 * URL. A test double that parsed more forgivingly than the real `SourceIo`
 * would prove nothing about the malformed case.
 *
 * The credentials are sentinels, and one of them is asserted to be in the URL
 * that was fetched. A privacy test that only looks at what came out cannot tell
 * a redaction from a request that never carried the secret in the first place.
 * The last describe goes the other way and puts a sentinel in what EPA sends
 * back — in an error string and in a data column — because that is the leak the
 * adapter is the only code positioned to stop.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Built, Locus, PayloadRef, Sealed, SourceIo, SourceOutcome } from "@/lib/evidence";
import { complete, DEFAULT_POLICY, runSource, SourceFailure } from "@/lib/evidence";
import type { RecordOf } from "@/lib/evidence";
import {
	AnnualSummaryRow,
	AQS_PARAMETERS,
	AQS_RADIUS_METERS,
	AQS_VERSION,
	annualSummaryQueryUrl,
	aqsAdapter,
	boundingBox,
	EMAIL_ENV,
	ENDPOINT,
	KEY_ENV,
	latestLikelySummaryYear,
	NO_KEY,
	noMonitorsNote,
	pollutantOf,
	REDACTED_ECHO,
	STATISTIC,
} from "@/lib/adapters/aqs";
import { houstonLocus } from "../evidence/helpers/sems-fixtures";

const fixturesDir = fileURLToPath(new URL("../../fixtures/aqs/", import.meta.url));

const NOW = "2026-09-16T12:00:00Z";
const YEAR = 2025;

/** Recognisable, and nothing like a real AQS credential. Both are asserted absent from everything returned. */
const EMAIL = "sentinel-operator@example.invalid";
const KEY = "SENTINEL-KEY-0123456789";

/** The two the derived fixtures carry in the header `url` EPA echoes back. */
const ECHOED_EMAIL = "operator@example.test";
const ECHOED_KEY = "REDACT-ME-NOT-A-REAL-KEY";

const CITABLE =
	"https://aqs.epa.gov/data/api/annualData/byBox?param=88101%2C44201&bdate=20250101&edate=20251231"
	+ "&minlat=29.270999&maxlat=30.170319&minlon=-95.779767&maxlon=-94.744224";

const SHA = {
	houston: "8d1ce9cd4b636dfcef652345ceff5a857ff38e69378b63af126c3bb2a9b80e8b",
	noRows: "1ab55b0e21aa476ffd5af38e5a52a1e3de020ce58ef4e1b3b59aaac75e93019b",
	unknownStatus: "db74a8c03cf487f71ab7f09f8c456e8aec6906d2f71a1d13ec28455990cc1b1e",
	failed: "04ac6b27795cb31d49affa2752a96930ab8cca08811f082bb756c7abb90817c4",
	dataEnvelope: "42a36a52943c121b1e4e883e0d6b43b8e9303fac53528d3254dda90398e492c2",
	rateLimited: "96a9c5dce851b9db368a5153efe44737aab55e611aa9f269ef441e66be70352e",
};

const CAVEATS: readonly string[] = [
	"No response from this service has been recorded yet. The parse follows field names EPA publishes for a different"
		+ " service of the same API, and is unverified against real bytes.",
	"EPA publishes no column list for the annual summary service, so the mean, the observation count and the unit are"
		+ " read from column names this report derived: arithmetic_mean, observation_count and unit_of_measure.",
	"AQS data lags collection by six months or more.",
	"The monitor measures its own location, not this address.",
	"AQS returns more than one annual summary row for a monitor and year, and the columns that tell those rows apart"
		+ " are not published. This is the first row the service returned for this site and parameter.",
];

const PAYLOAD: PayloadRef = { url: CITABLE, sha256: SHA.houston, retrievedAt: NOW };

type Route =
	| { readonly fixture: string }
	| { readonly fixture: string; readonly status: number }
	| { readonly fixture: string; readonly status: number; readonly retryAfter: string }
	/** Bytes written inline by a test. Never a claim about what EPA sends, and never filed as a fixture. */
	| { readonly body: string }
	| { readonly hang: true };

/** Mirrors `lib/io/fetch-source-io.ts`: hash the bytes, check the status, then `safeParse`. */
function stubIo(route: Route): { readonly io: SourceIo; readonly calls: string[] } {
	const calls: string[] = [];
	const io: SourceIo = {
		async get(url, schema) {
			calls.push(url.toString());
			if ("hang" in route) return new Promise<never>(() => undefined);
			const bytes = "body" in route ? Buffer.from(route.body, "utf8") : readFileSync(`${fixturesDir}${route.fixture}`);
			const payload: PayloadRef = {
				url: url.toString(),
				sha256: createHash("sha256").update(bytes).digest("hex"),
				retrievedAt: NOW,
			};
			const status = "status" in route ? route.status : 200;
			if (status === 429) {
				throw new SourceFailure("rate-limited", status, "retryAfter" in route ? route.retryAfter : null);
			}
			if (status !== 200) throw new SourceFailure("http", status);
			const parsed = schema.safeParse(JSON.parse(bytes.toString("utf8")));
			if (!parsed.success) throw new SourceFailure("malformed", null);
			return { raw: parsed.data, payload };
		},
		query(parameter, value, adapterVersion, payload) {
			return { kind: "query", parameter, value, adapterVersion, payload };
		},
		now: () => NOW,
	};
	return { io, calls };
}

function locus(): Locus {
	return houstonLocus();
}

const adapter = aqsAdapter(YEAR);

async function outcomeFor(route: Route): Promise<{
	readonly outcome: SourceOutcome<"aqs-monitor-summary">;
	readonly calls: readonly string[];
}> {
	const { io, calls } = stubIo(route);
	const outcome = await runSource(locus(), adapter, io, DEFAULT_POLICY);
	return { outcome, calls };
}

function recordsOf(outcome: SourceOutcome<"aqs-monitor-summary">): readonly Sealed<RecordOf<"aqs-monitor-summary">>[] {
	if (outcome.status !== "ok") throw new Error(`expected ok, got ${outcome.status}`);
	return outcome.records;
}

function byId(
	records: readonly Sealed<RecordOf<"aqs-monitor-summary">>[],
	id: string,
): Sealed<RecordOf<"aqs-monitor-summary">> {
	const found = records.find((record) => record.sourceRecordId === id);
	if (found === undefined) throw new Error(`no record for ${id}`);
	return found;
}

async function builtFor(route: Route): Promise<readonly Built<"aqs-monitor-summary">[]> {
	const { io } = stubIo(route);
	return adapter.run(locus(), io);
}

beforeEach(() => {
	process.env[EMAIL_ENV] = EMAIL;
	process.env[KEY_ENV] = KEY;
});

afterEach(() => {
	delete process.env[EMAIL_ENV];
	delete process.env[KEY_ENV];
});

describe("the request", () => {
	it("carries the box, the year and the two parameter codes, and neither credential", () => {
		const url = annualSummaryQueryUrl(locus(), YEAR);
		expect(url.toString()).toBe(CITABLE);
		expect(url.searchParams.get("email")).toBeNull();
		expect(url.searchParams.get("key")).toBeNull();
		expect(url.searchParams.get("param")).toBe("88101,44201");
	});

	it("boxes the 50 km circle, so the box is a superset and the haversine is the boundary", () => {
		expect(boundingBox(locus())).toEqual({
			minlat: "29.270999",
			maxlat: "30.170319",
			minlon: "-95.779767",
			maxlon: "-94.744224",
		});
		expect(AQS_RADIUS_METERS).toBe(50_000);
	});

	it("asks for the previous whole year, because AQS lags collection by six months or more", () => {
		expect(latestLikelySummaryYear(NOW)).toBe(2025);
		expect(latestLikelySummaryYear("2026-01-02T00:00:00Z")).toBe(2025);
		expect(adapter.summaryYear).toBe(YEAR);
	});

	it("declares thirteen columns: ten of EPA's own spelling and three this report derived", () => {
		// The module comment and the fixture's `.source.md` both count these, and
		// an earlier version of both counted `unit_of_measure` twice.
		const keys = Object.keys(AnnualSummaryRow.shape);
		expect(keys).toHaveLength(13);
		const derived = ["arithmetic_mean", "observation_count", "unit_of_measure"];
		for (const key of derived) expect(keys).toContain(key);
		expect(keys.filter((key) => !derived.includes(key))).toHaveLength(10);
	});

	it("declares its kind, source, version and the no-data note that names the year it asked for", () => {
		expect(adapter).toMatchObject({ kind: "aqs-monitor-summary", source: "aqs", version: "aqs@1" });
		expect(AQS_VERSION).toBe("aqs@1");
		expect(adapter.noDataNote).toBe(
			"EPA's Air Quality System returned no 2025 annual summary for a PM2.5 or ozone monitor within 50 km of the"
			+ " mapped point. AQS lags collection by six months or more, so a recent year may not be loaded yet.",
		);
		expect(AQS_PARAMETERS).toEqual({ "88101": "PM2.5", "44201": "Ozone" });
	});
});

describe("success: the derived Houston body", () => {
	it("builds one record per monitor within 50 km, and the PM2.5 record whole", async () => {
		const { outcome, calls } = await outcomeFor({ fixture: "derived-annual-summary-houston.json" });
		const records = recordsOf(outcome);

		expect(calls).toHaveLength(1);
		expect(outcome.status === "ok" && outcome.retrievedAt).toBe(NOW);
		expect(records.map((record) => record.sourceRecordId)).toEqual([
			"48-201-1039-88101",
			"48-201-0024-44201",
			"48-201-0416-88101",
		]);

		const record = byId(records, "48-201-1039-88101");
		expect(record.kind).toBe("aqs-monitor-summary");
		expect(record.source).toBe("aqs");
		expect(record.id).toEqual({ kind: "aqs-monitor-summary", sourceRecordId: "48-201-1039-88101" });
		expect(record.subject.value).toBe("48-201-1039-88101");
		expect(record.monitorId.value).toBe("48-201-1039-88101");
		expect(record.pollutant.value).toBe("PM2.5");
		expect(record.period.value).toBe("2025");
		expect(record.statistic.value).toBe(STATISTIC);
		expect(record.statistic.value).toBe("annual arithmetic mean");
		expect(record.value.value).toBe(9.8);
		expect(record.unit.value).toBe("Micrograms/cubic meter (LC)");
		expect(record.observationCount.value).toBe(121);
		expect(record.location?.latitude.value).toBe(29.733726);
		expect(record.location?.longitude.value).toBe(-95.257593);
		expect(record.distanceMeters?.value).toBe(1514);
		expect(record.effectiveAt.value).toBe("2025");
		expect(record.sourceUpdatedAt.value).toBe("2026-04-22");
		expect(record.sourceUrl.value).toBe("https://aqs.epa.gov/aqsweb/airdata/annual_conc_by_monitor_2025.zip");
		expect(record.caveats).toEqual(CAVEATS);
		expect(record.payloads).toEqual([PAYLOAD]);
	});

	it("reads the ozone monitor with its own unit, unmapped and verbatim", async () => {
		const records = recordsOf((await outcomeFor({ fixture: "derived-annual-summary-houston.json" })).outcome);
		const record = byId(records, "48-201-0024-44201");

		expect(record.pollutant.value).toBe("Ozone");
		expect(record.value.value).toBe(0.0421);
		expect(record.unit.value).toBe("Parts per million");
		expect(record.observationCount.value).toBe(214);
		expect(record.distanceMeters?.value).toBe(15755);
		expect(record.sourceUpdatedAt.value).toBe("2026-05-14");
	});

	it("keeps the first row of the several AQS returns for one monitor, and drops the rest", async () => {
		const records = recordsOf((await outcomeFor({ fixture: "derived-annual-summary-houston.json" })).outcome);
		const pm25 = records.filter((record) => record.sourceRecordId === "48-201-1039-88101");

		expect(pm25).toHaveLength(1);
		// The second row for this monitor carries 10.4 under a different sample
		// duration and standard. Those columns are not published, so the adapter
		// cannot choose between them and keeps the first.
		expect(pm25[0]?.value.value).toBe(9.8);
	});

	it("drops a monitor inside the request box but outside B2's 50 km boundary", async () => {
		const records = recordsOf((await outcomeFor({ fixture: "derived-annual-summary-houston.json" })).outcome);
		expect(records.map((record) => record.sourceRecordId)).not.toContain("48-473-0002-88101");
		// 55.90 km from the mapped point, and inside the box: minlat 29.270999 to maxlat 30.170319.
		expect(30.05).toBeLessThan(30.170319);
	});

	it("traces every value to the column or the query parameter behind it", async () => {
		const records = recordsOf((await outcomeFor({ fixture: "derived-annual-summary-houston.json" })).outcome);
		const record = byId(records, "48-201-1039-88101");

		expect(record.value.provenance).toEqual([
			{
				kind: "field",
				dataset: "aqs_annual_summary",
				sourceField: "arithmetic_mean",
				rawValue: 9.8,
				transform: "identity",
				adapterVersion: "aqs@1",
				payload: PAYLOAD,
			},
		]);
		expect(record.unit.provenance).toEqual([
			{
				kind: "field",
				dataset: "aqs_annual_summary",
				sourceField: "unit_of_measure",
				rawValue: "Micrograms/cubic meter (LC)",
				transform: "identity",
				adapterVersion: "aqs@1",
				payload: PAYLOAD,
			},
		]);
		expect(record.sourceUpdatedAt.provenance).toEqual([
			{
				kind: "field",
				dataset: "aqs_annual_summary",
				sourceField: "date_of_last_change",
				rawValue: "2026-04-22",
				transform: "normalize-date",
				adapterVersion: "aqs@1",
				payload: PAYLOAD,
			},
		]);
		// Our vocabulary, our year, our column choice: three query provenances,
		// none of them a value EPA sent.
		expect(record.pollutant.provenance).toEqual([
			{ kind: "query", parameter: "param", value: "88101", adapterVersion: "aqs@1", payload: PAYLOAD },
		]);
		expect(record.period.provenance).toEqual([
			{ kind: "query", parameter: "bdate", value: "20250101", adapterVersion: "aqs@1", payload: PAYLOAD },
		]);
		expect(record.statistic.provenance).toEqual([
			{ kind: "query", parameter: "service", value: ENDPOINT, adapterVersion: "aqs@1", payload: PAYLOAD },
		]);
		// The id is a join of four columns, kept non-null by a coalesce, so the
		// trace carries both the join and the fallback it did not need.
		const [identity] = record.monitorId.provenance;
		expect(identity).toMatchObject({ kind: "computation", formula: "coalesce" });
		expect(identity?.kind === "computation" && identity.inputs[0].provenance).toEqual([
			{
				kind: "field",
				dataset: "aqs_annual_summary",
				sourceField: "state_code",
				rawValue: "48",
				transform: "join-fields",
				adapterVersion: "aqs@1",
				payload: PAYLOAD,
			},
			{
				kind: "field",
				dataset: "aqs_annual_summary",
				sourceField: "county_code",
				rawValue: "201",
				transform: "join-fields",
				adapterVersion: "aqs@1",
				payload: PAYLOAD,
			},
			{
				kind: "field",
				dataset: "aqs_annual_summary",
				sourceField: "site_number",
				rawValue: "1039",
				transform: "join-fields",
				adapterVersion: "aqs@1",
				payload: PAYLOAD,
			},
			{
				kind: "field",
				dataset: "aqs_annual_summary",
				sourceField: "parameter_code",
				rawValue: "88101",
				transform: "join-fields",
				adapterVersion: "aqs@1",
				payload: PAYLOAD,
			},
		]);
		expect(record.sourceUrl.provenance[0].kind).toBe("computation");
	});

	it("ignores the columns it does not declare, including the header url that echoes the request", async () => {
		const records = recordsOf((await outcomeFor({ fixture: "derived-annual-summary-houston.json" })).outcome);
		const record = byId(records, "48-201-1039-88101");
		const serialized = JSON.stringify(record);

		// Row 1 of the fixture carries ten columns this adapter does not read.
		for (const column of ["sample_duration", "pollutant_standard", "metric_used", "event_type", "local_site_name"]) {
			expect(serialized).not.toContain(column);
		}
		expect(serialized).not.toContain("CLINTON");
	});
});

describe("no records", () => {
	it("is a no-data outcome naming the year, never an unavailable one", async () => {
		const { outcome } = await outcomeFor({ fixture: "derived-annual-summary-no-rows.json" });
		expect(outcome).toEqual({ status: "no-data", note: noMonitorsNote(YEAR), retrievedAt: NOW });
		expect(createHash("sha256").update(readFileSync(`${fixturesDir}derived-annual-summary-no-rows.json`)).digest("hex"))
			.toBe(SHA.noRows);
	});

	it("returns zero rows from the adapter itself, which the kernel is what turns into no-data", async () => {
		await expect(builtFor({ fixture: "derived-annual-summary-no-rows.json" })).resolves.toEqual([]);
	});
});

describe("missing optional fields", () => {
	it("keeps the record and nulls the two nullable slots, with the null's own provenance", async () => {
		const records = recordsOf((await outcomeFor({ fixture: "derived-annual-summary-houston.json" })).outcome);
		const record = byId(records, "48-201-0416-88101");

		expect(record.value.value).toBe(8.4);
		expect(record.observationCount.value).toBeNull();
		expect(record.observationCount.provenance).toEqual([
			{
				kind: "field",
				dataset: "aqs_annual_summary",
				sourceField: "observation_count",
				rawValue: null,
				transform: "parse-number",
				adapterVersion: "aqs@1",
				payload: PAYLOAD,
			},
		]);
		expect(record.sourceUpdatedAt.value).toBeNull();
		expect(record.sourceUpdatedAt.provenance[0]).toMatchObject({
			sourceField: "date_of_last_change",
			rawValue: null,
			transform: "normalize-date",
		});
		expect(record.distanceMeters?.value).toBe(20876);
	});
});

describe("unknown status", () => {
	it("costs the record nothing and is never mapped into our vocabulary", async () => {
		const { outcome } = await outcomeFor({ fixture: "derived-annual-summary-unknown-status.json" });
		const records = recordsOf(outcome);
		const record = byId(records, "48-201-1039-88101");

		expect(records).toHaveLength(1);
		expect(record.value.value).toBe(9.8);
		expect(record.unit.value).toBe("Micrograms/cubic meter (LC)");
		expect(record.pollutant.value).toBe("PM2.5");
		// The status EPA has never sent us reaches no value, no provenance and no
		// caveat: the body decides the outcome, and the status is not vocabulary
		// this codebase owns.
		expect(JSON.stringify(record)).not.toContain("Partial data returned during scheduled maintenance");
		expect(record.payloads[0].sha256).toBe(SHA.unknownStatus);
	});
});

describe("a parameter code named for a key of Object.prototype", () => {
	/*
	 * `AQS_PARAMETERS` is an object literal, so an index into it reaches
	 * `Object.prototype`: `AQS_PARAMETERS["constructor"]` is a function and
	 * `["__proto__"]` is an object, and until 2026-09-16 the guard beside the
	 * index was `!== undefined`. The row was dropped anyway, because the
	 * `selections` map is asked for the same code on the next line and a `Map`
	 * has no prototype keys — a guard by coincidence, not by intent.
	 * `lib/adapters/airnow.ts` had the same index with nothing beside it, and
	 * there the same string cost the whole card. Both read through `pollutantOf`
	 * now, so the drop is the table's decision in both files.
	 */
	it("is not a pollutant, so the drop no longer depends on the selections map beside it", async () => {
		expect(pollutantOf("constructor")).toBeNull();
		expect(pollutantOf("__proto__")).toBeNull();
		expect(pollutantOf("42101")).toBeNull();
		expect(pollutantOf("88101")).toBe("PM2.5");
		expect(pollutantOf("44201")).toBe("Ozone");
		// The hole itself, shown rather than described. Both stay true: the table
		// is still an object literal and it is the read that changed.
		expect(AQS_PARAMETERS["constructor"]).toBeDefined();
		expect(AQS_PARAMETERS["__proto__"]).toBeDefined();

		// Written inline: not a claim about what EPA sends, and not a fixture.
		const body = JSON.stringify({
			Header: [{ status: "Success" }],
			Body: [
				{
					state_code: "48",
					county_code: "201",
					site_number: "1039",
					parameter_code: "constructor",
					poc: 1,
					latitude: 29.733726,
					longitude: -95.257593,
					datum: "WGS84",
					parameter_name: "Not a pollutant this report covers",
					unit_of_measure: "Micrograms/cubic meter (LC)",
					date_of_last_change: "2026-04-22",
					arithmetic_mean: 9.8,
					observation_count: 121,
				},
			],
		});
		const { outcome } = await outcomeFor({ body });
		expect(outcome).toMatchObject({ status: "no-data" });
	});
});

describe("an error header delivered at HTTP 200", () => {
	it("is unavailable carrying EPA's own message array, not a successful empty answer", async () => {
		const { outcome } = await outcomeFor({ fixture: "derived-annual-summary-failed.json" });
		expect(outcome).toEqual({
			status: "unavailable",
			cause: "http",
			rawCode: ["value is missing or the value is empty: param"],
			retryAfter: null,
		});
		expect(createHash("sha256").update(readFileSync(`${fixturesDir}derived-annual-summary-failed.json`)).digest("hex"))
			.toBe(SHA.failed);
	});

	it("throws SourceFailure from the adapter so the kernel is what classifies it", async () => {
		await expect(builtFor({ fixture: "derived-annual-summary-failed.json" })).rejects.toMatchObject({
			name: "SourceFailure",
			reason: "http",
		});
	});
});

describe("malformed response", () => {
	it("rejects the OpenAPI file's Data envelope rather than reading it as no monitors", async () => {
		const { outcome } = await outcomeFor({ fixture: "derived-annual-summary-data-envelope.json" });
		expect(outcome).toEqual({ status: "unavailable", cause: "malformed", rawCode: null, retryAfter: null });
		expect(outcome.status === "unavailable" && outcome.cause).not.toBe("no-data");
		expect(
			createHash("sha256")
				.update(readFileSync(`${fixturesDir}derived-annual-summary-data-envelope.json`))
				.digest("hex"),
		).toBe(SHA.dataEnvelope);
	});
});

describe("rate limit, from the recorded bytes", () => {
	it("is the real 429 body EPA's exhausted shared account answers", () => {
		const bytes = readFileSync(`${fixturesDir}rate-limited.json`);
		expect(createHash("sha256").update(bytes).digest("hex")).toBe(SHA.rateLimited);
		expect(JSON.parse(bytes.toString("utf8"))).toEqual({
			error: "Daily limit for account use exceeded. Retry later.",
		});
	});

	it("becomes unavailable with the source's own status and Retry-After, before any parse", async () => {
		const { outcome, calls } = await outcomeFor({
			fixture: "rate-limited.json",
			status: 429,
			retryAfter: "86400",
		});
		expect(calls).toHaveLength(1);
		expect(outcome).toEqual({ status: "unavailable", cause: "rate-limited", rawCode: 429, retryAfter: "86400" });
	});
});

describe("timeout", () => {
	it("is unavailable, and the source's own policy is what ends it", async () => {
		const { io } = stubIo({ hang: true });
		const outcome = await runSource(locus(), adapter, io, { timeoutMs: 10 });
		expect(outcome).toEqual({ status: "unavailable", cause: "timeout", rawCode: null, retryAfter: null });
	});
});

describe("credentials", () => {
	it("an absent key is unavailable and distinguishable from an answer with no records", async () => {
		delete process.env[KEY_ENV];
		const { outcome, calls } = await outcomeFor({ fixture: "derived-annual-summary-houston.json" });

		expect(outcome).toEqual({ status: "unavailable", cause: "not-configured", rawCode: NO_KEY, retryAfter: null });
		expect(outcome.status).not.toBe("no-data");
		// Nothing was asked. A rate limit that is already exhausted is not spent
		// on a request that cannot be authenticated.
		expect(calls).toEqual([]);
	});

	it("an absent email is the same outcome: AQS authenticates with both", async () => {
		delete process.env[EMAIL_ENV];
		const { outcome, calls } = await outcomeFor({ fixture: "derived-annual-summary-houston.json" });
		expect(outcome).toEqual({ status: "unavailable", cause: "not-configured", rawCode: NO_KEY, retryAfter: null });
		expect(calls).toEqual([]);
	});

	it("an empty key is absent, not a credential", async () => {
		process.env[KEY_ENV] = "";
		const { outcome } = await outcomeFor({ fixture: "derived-annual-summary-houston.json" });
		expect(outcome).toEqual({ status: "unavailable", cause: "not-configured", rawCode: NO_KEY, retryAfter: null });
	});

	it("a source that answered with no records stays a different outcome from one that could not be asked", async () => {
		const asked = (await outcomeFor({ fixture: "derived-annual-summary-no-rows.json" })).outcome;
		delete process.env[KEY_ENV];
		const unasked = (await outcomeFor({ fixture: "derived-annual-summary-no-rows.json" })).outcome;

		expect(asked.status).toBe("no-data");
		expect(unasked.status).toBe("unavailable");
		expect(asked).not.toEqual(unasked);
	});
});

describe("neither credential reaches anything a reader can see", () => {
	it("is in the fetched URL, and in nothing the adapter returns", async () => {
		const { io, calls } = stubIo({ fixture: "derived-annual-summary-houston.json" });
		const outcome = await runSource(locus(), adapter, io, DEFAULT_POLICY);
		const records = recordsOf(outcome);

		// The request had to carry both, or this test proves nothing.
		expect(calls[0]).toContain(encodeURIComponent(EMAIL));
		expect(calls[0]).toContain(KEY);

		const serialized = JSON.stringify(records);
		for (const secret of [EMAIL, KEY, encodeURIComponent(EMAIL), "email=", "key=", ECHOED_EMAIL, ECHOED_KEY]) {
			expect(serialized).not.toContain(secret);
		}
		for (const record of records) {
			expect(record.payloads.map((payload) => payload.url)).toEqual([CITABLE]);
			expect(record.sourceUrl.value).not.toContain("key");
		}
	});

	it("is in no thrown error either", async () => {
		const { io } = stubIo({ fixture: "derived-annual-summary-failed.json" });
		const thrown: unknown = await adapter.run(locus(), io).then(
			() => null,
			(error: unknown) => error,
		);
		const serialized = JSON.stringify({
			message: thrown instanceof Error ? thrown.message : String(thrown),
			raw: thrown instanceof SourceFailure ? thrown.rawCode : null,
		});
		expect(thrown).toBeInstanceOf(SourceFailure);
		for (const secret of [EMAIL, KEY, encodeURIComponent(EMAIL), ECHOED_KEY]) {
			expect(serialized).not.toContain(secret);
		}
	});

	it("is not in a record completed straight from the adapter's own Built values", async () => {
		const built = await builtFor({ fixture: "derived-annual-summary-houston.json" });
		const [first] = built;
		if (first === undefined) throw new Error("expected a row");
		const record = complete(locus(), first);
		expect(JSON.stringify(record)).not.toContain(KEY);
		expect(record.payloads).toEqual([PAYLOAD]);
	});
});

describe("a credential the source itself hands back", () => {
	/*
	 * The three tests above prove this file does not *construct* a leak. That is
	 * a different claim from proving it *filters* one, and only the second is
	 * worth anything against a host that echoes the request it rejected: EPA's
	 * own failed header carries the whole query string in `url`, and
	 * `lib/templates/sources.ts` prints a `rawCode` on the card as
	 * "It answered {rawCode}.". `app/lib/report-contract.ts`'s
	 * `withoutSecretValues` is a backstop at the wire; this is the adapter doing
	 * it while it still holds the two values.
	 *
	 * Both bodies below are written inline. Neither is a claim about what EPA
	 * sends, and neither is filed as a fixture.
	 */
	it("keeps it out of the rawCode the card prints, in either of the forms it can arrive in", async () => {
		const body = JSON.stringify({
			Header: [
				{
					status: "Failed",
					error: [
						`Invalid request: key=${KEY}`,
						`Invalid request: https://aqs.epa.gov/data/api/annualData/byBox?email=${encodeURIComponent(EMAIL)}`,
						"value is missing or the value is empty: param",
					],
				},
			],
			Body: [],
		});
		const { outcome } = await outcomeFor({ body });

		// Each string is judged on its own: the two that quote a credential are
		// replaced whole, and EPA's ordinary message survives byte for byte.
		expect(outcome).toEqual({
			status: "unavailable",
			cause: "http",
			rawCode: [REDACTED_ECHO, REDACTED_ECHO, "value is missing or the value is empty: param"],
			retryAfter: null,
		});
		const serialized = JSON.stringify(outcome);
		expect(serialized).not.toContain(KEY);
		expect(serialized).not.toContain(EMAIL);
		expect(serialized).not.toContain(encodeURIComponent(EMAIL));
	});

	it("keeps it out of the record when a data column carries it, including the id and the trace", async () => {
		const body = JSON.stringify({
			Header: [{ status: "success" }],
			Body: [
				{
					state_code: "48",
					county_code: "201",
					// A column the monitor id is joined from, and one the card prints.
					site_number: KEY,
					parameter_code: "88101",
					poc: 1,
					latitude: 29.733726,
					longitude: -95.257593,
					datum: "WGS84",
					parameter_name: "PM2.5 - Local Conditions",
					unit_of_measure: `Micrograms/cubic meter (LC), reported to ${EMAIL}`,
					date_of_last_change: "2026-04-22",
					arithmetic_mean: 9.8,
					observation_count: 121,
				},
			],
		});
		const [record] = recordsOf((await outcomeFor({ body })).outcome);
		if (record === undefined) throw new Error("expected a record");

		expect(record.sourceRecordId).toBe(`48-201-${REDACTED_ECHO}-88101`);
		expect(record.unit.value).toBe(REDACTED_ECHO);
		// The raw value goes into the trace panel too, so the scrub is upstream of
		// the reader rather than in the template.
		expect(record.unit.provenance[0]).toMatchObject({ sourceField: "unit_of_measure", rawValue: REDACTED_ECHO });
		// The columns that carried no credential are untouched.
		expect(record.value.value).toBe(9.8);
		expect(record.observationCount.value).toBe(121);
		expect(record.sourceUpdatedAt.value).toBe("2026-04-22");

		const serialized = JSON.stringify(record);
		expect(serialized).not.toContain(KEY);
		expect(serialized).not.toContain(EMAIL);
	});

	it("says what happened in words that are ours, and carries no fragment of either credential", () => {
		expect(REDACTED_ECHO).toBe("[redacted: the source's answer carried this deployment's credential]");
		expect(REDACTED_ECHO).not.toContain(KEY);
		expect(REDACTED_ECHO).not.toContain(EMAIL);
	});
});
