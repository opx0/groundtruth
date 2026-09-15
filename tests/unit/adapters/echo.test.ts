/**
 * ECHO adapter, against the committed ECHO fixtures.
 *
 * Every payload here is a real ECHO response. The one exception is the unknown
 * status case, which is the real page fixture with a single status string
 * replaced, because ECHO has never sent a status we do not already have a
 * fixture for and the point of that test is that the adapter has no vocabulary
 * to fail on.
 *
 * The rate-limit case carries no payload at all, and none is invented: ECHO has
 * never rate-limited this repository, so there are no recorded bytes, and a 429
 * body would never reach the adapter in any case. `lib/io/fetch-source-io.ts`
 * raises `SourceFailure("rate-limited", 429, <Retry-After>)` from the status
 * line before it parses anything, so the failure is driven through the io in
 * exactly that shape, and what is asserted is what the reader is left holding.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fieldsOf, runSource, SourceFailure } from "@/lib/evidence";
import type {
	Fetched,
	FieldProvenance,
	JsonValue,
	Locus,
	PayloadRef,
	Provenance,
	QueryProvenance,
	RecordOf,
	Sealed,
	SourceIo,
	SourceOutcome,
	Sourced,
} from "@/lib/evidence";
import { createEchoAdapter, ECHO_POLICY, ECHO_VERSION, echoAdapter, QCOLUMNS } from "@/lib/adapters/echo";

const fixturesDir = fileURLToPath(new URL("../../fixtures/", import.meta.url));
const RETRIEVED_AT = "2026-09-16T09:00:00Z";
const TEST_POLICY = { timeoutMs: 10_000 };

type EchoRecord = Sealed<RecordOf<"echo-facility">>;

/* -------------------------------------------------------------------------- */
/* Locus: the demo address, from the real Census fixture                      */
/* -------------------------------------------------------------------------- */

const CensusMatch = z.object({
	result: z.object({ addressMatches: z.array(z.object({ coordinates: z.object({ x: z.number(), y: z.number() }) })) }),
});

function bytesOf(relative: string): Buffer {
	return readFileSync(`${fixturesDir}${relative}`);
}

/**
 * The QueryID a recorded summary carried, read out of the bytes rather than
 * written down. ECHO mints a fresh one per call, so every recapture changes it.
 */
function summaryQueryId(relative: string): string {
	const parsed: unknown = JSON.parse(bytesOf(relative).toString("utf8"));
	return z.object({ Results: z.object({ QueryID: z.string() }) }).parse(parsed).Results.QueryID;
}

function payloadOf(url: string, bytes: Buffer): PayloadRef {
	return { url, sha256: createHash("sha256").update(bytes).digest("hex"), retrievedAt: RETRIEVED_AT };
}

/** 9311 E AVE P, HOUSTON, TX — the point the ECHO fixtures were captured around. */
function houstonLocus(radiusMeters: number): Locus {
	const bytes = bytesOf("census/match-9311-e-ave-p.json");
	const parsed = CensusMatch.parse(JSON.parse(bytes.toString("utf8")));
	const match = parsed.result.addressMatches[0];
	if (match === undefined) throw new Error("census fixture has no match");
	const point = fieldsOf(
		{ raw: match.coordinates, payload: payloadOf("fixture:census/match-9311-e-ave-p.json", bytes) },
		"census_geocoder",
		"census@1",
	).point("y", "x", {});
	if (point === null) throw new Error("census fixture coordinate is null");
	return { point, radiusMeters };
}

const QUARTER_MILE = 402.336;

/* -------------------------------------------------------------------------- */
/* A stub SourceIo that serves fixture bytes                                  */
/* -------------------------------------------------------------------------- */

type Step = { readonly fixture: string } | { readonly body: unknown } | { readonly fail: SourceFailure };

/** Serves `steps` in order; once they run out the last one repeats, which is how the paging test gets the same page twice. */
function stubIo(steps: readonly Step[]): { readonly io: SourceIo; readonly calls: URL[] } {
	const calls: URL[] = [];
	let index = 0;
	const io: SourceIo = {
		get<Raw extends JsonValue>(url: URL, schema: z.ZodType<Raw>): Promise<Fetched<Raw>> {
			calls.push(url);
			const step = steps[Math.min(index, steps.length - 1)];
			index += 1;
			if (step === undefined) return Promise.reject(new SourceFailure("unknown"));
			if ("fail" in step) return Promise.reject(step.fail);
			const bytes = "fixture" in step ? bytesOf(`echo/${step.fixture}`) : Buffer.from(JSON.stringify(step.body));
			const payload = payloadOf(url.toString(), bytes);
			return Promise.resolve({ raw: schema.parse(JSON.parse(bytes.toString("utf8"))), payload });
		},
		query(parameter, value, adapterVersion, payload): QueryProvenance {
			return { kind: "query", parameter, value, adapterVersion, payload };
		},
		now(): string {
			return RETRIEVED_AT;
		},
	};
	return { io, calls };
}

async function outcomeOf(
	steps: readonly Step[],
	radiusMeters = QUARTER_MILE,
): Promise<{ readonly outcome: SourceOutcome<"echo-facility">; readonly calls: URL[] }> {
	const { io, calls } = stubIo(steps);
	const outcome = await runSource(houstonLocus(radiusMeters), createEchoAdapter({ retryDelayMs: 0 }), io, TEST_POLICY);
	return { outcome, calls };
}

const QUARTER_MILE_STEPS: readonly Step[] = [
	{ fixture: "facilities-quarter-mi.json" },
	{ fixture: "facilities-page-quarter-mi.json" },
];

async function quarterMileRecords(): Promise<{ readonly records: readonly EchoRecord[]; readonly calls: URL[] }> {
	const { outcome, calls } = await outcomeOf(QUARTER_MILE_STEPS);
	if (outcome.status !== "ok") throw new Error(`expected ok, got ${outcome.status}`);
	return { records: outcome.records, calls };
}

function byId(records: readonly EchoRecord[], registryId: string): EchoRecord {
	const found = records.find((record) => record.sourceRecordId === registryId);
	if (found === undefined) throw new Error(`no record ${registryId}`);
	return found;
}

function firstProvenance(sourced: Sourced<unknown>): Provenance {
	const [head] = sourced.provenance;
	return head;
}

function fieldProvenance(sourced: Sourced<unknown>): FieldProvenance {
	const head = firstProvenance(sourced);
	if (head.kind !== "field") throw new Error(`expected field provenance, got ${head.kind}`);
	return head;
}

/* -------------------------------------------------------------------------- */

describe("echo adapter", () => {
	it("parses the seven real facilities in the quarter-mile fixture", async () => {
		const { records } = await quarterMileRecords();
		expect(records).toHaveLength(7);
		expect(records.map((record) => record.sourceRecordId)).toEqual([
			"110005085898",
			"110070365452",
			"110009747514",
			"110064116987",
			"110016765277",
			"110070369610",
			"110035313844",
		]);

		const cargill = byId(records, "110005085898");
		expect(cargill.kind).toBe("echo-facility");
		expect(cargill.source).toBe("echo");
		expect(cargill.subject.value).toBe("CARGILL INCORPORATED");
		expect(cargill.sourceUrl.value).toBe("https://echo.epa.gov/detailed-facility-report?fid=110005085898");
		expect(cargill.registryId.value).toBe("110005085898");
		expect(cargill.complianceStatus.value).toBe("No Violation Identified");
		expect(cargill.significantNoncomplianceFlag.value).toBe("N");
		expect(cargill.activeFlag.value).toBe("Y");
		expect(cargill.naicsCodes.value).toBe("311119");
		expect(cargill.sicCodes.value).toBe("2048 5171");
		expect(cargill.location?.latitude.value).toBe(29.72263);
		expect(cargill.location?.longitude.value).toBe(-95.261971);
		expect(cargill.distanceMeters?.value).toBe(219);
	});

	it("parses every string ECHO sends in place of a number", async () => {
		const { records } = await quarterMileRecords();

		// FacQtrsWithNC arrives as "6": a number in the record, the string in the trace.
		const portTerminal = byId(records, "110009747514");
		expect(portTerminal.quartersInNoncompliance.value).toBe(6);
		expect(fieldProvenance(portTerminal.quartersInNoncompliance)).toMatchObject({
			sourceField: "FacQtrsWithNC",
			rawValue: "6",
			transform: "parse-number",
		});

		// FacLat/FacLong arrive as strings too, which is why point() can read them.
		const where = portTerminal.location;
		if (where === null) throw new Error("PORT TERMINAL FACILITY lost its coordinate");
		expect(fieldProvenance(where.latitude)).toMatchObject({ sourceField: "FacLat", rawValue: "29.72302" });
		expect(fieldProvenance(where.longitude)).toMatchObject({ sourceField: "FacLong", rawValue: "-95.262456" });
		expect(portTerminal.distanceMeters?.value).toBe(266);
	});

	it("reads the penalty as a number and reports the exact bytes ECHO sent, dollar sign included, in the trace", async () => {
		const { records } = await quarterMileRecords();
		const southCoast = byId(records, "110064116987");

		expect(southCoast.penaltyCount.value).toBe(1);
		expect(southCoast.lastPenaltyAmountUsd.value).toBe(0);
		// The trace panel's whole job is to report what the agency sent. EPA sent
		// "$0", not "0", and the transform that removed the symbol is named.
		expect(fieldProvenance(southCoast.lastPenaltyAmountUsd)).toEqual({
			kind: "field",
			dataset: "echo_get_qid",
			sourceField: "FacLastPenaltyAmt",
			rawValue: "$0",
			transform: "parse-currency",
			adapterVersion: ECHO_VERSION,
			payload: fieldProvenance(southCoast.registryId).payload,
		});
		expect(southCoast.caveats.some((caveat) => caveat.includes("currency symbol is removed"))).toBe(false);
	});

	it("reorders month/day/year dates into ISO by a named transform, keeping ECHO's string in the trace", async () => {
		const { records } = await quarterMileRecords();
		const southCoast = byId(records, "110064116987");

		// 08/12/2024 is August 2024. The record holds the ISO date so it sorts
		// with every other source's; the trace shows the reordering happened.
		expect(southCoast.lastFormalActionDate.value).toBe("2024-08-12");
		expect(southCoast.lastPenaltyDate.value).toBe("2024-08-12");
		expect(southCoast.lastInspectionDate.value).toBe("2023-11-17");
		expect(fieldProvenance(southCoast.lastFormalActionDate)).toMatchObject({
			sourceField: "FacDateLastFormalAction",
			rawValue: "08/12/2024",
			transform: "parse-us-date",
		});
		expect(southCoast.effectiveAt.value).toBe("2024-08-12");
		expect(southCoast.caveats).toContain(
			"ECHO sends dates as month/day/year. They are shown as year-month-day, and the trace keeps the string ECHO sent.",
		);
	});

	it("reads every programme column in ECHO's own words, null where ECHO left it empty", async () => {
		const { records } = await quarterMileRecords();

		const cargill = byId(records, "110005085898").programStatuses;
		expect(cargill.CAA.value).toBe("No Violation Identified");
		expect(cargill.CWA.value).toBeNull();
		expect(cargill.RCRA.value).toBe("No Violation Identified");
		expect(cargill.SDWA.value).toBeNull();

		const portTerminal = byId(records, "110009747514").programStatuses;
		expect(portTerminal.CWA.value).toBe("Violation Identified");
		expect(portTerminal.CAA.value).toBeNull();

		const westway = byId(records, "110035313844").programStatuses;
		expect(Object.values(westway).map((status) => status.value)).toEqual([null, null, null, null]);
	});

	it("traces a single programme's status to its own column, not to a request parameter", async () => {
		const { records } = await quarterMileRecords();
		const portTerminal = byId(records, "110009747514");

		expect(fieldProvenance(portTerminal.programStatuses.CWA)).toEqual({
			kind: "field",
			dataset: "echo_get_qid",
			sourceField: "CWAComplianceStatus",
			rawValue: "Violation Identified",
			transform: "identity",
			adapterVersion: ECHO_VERSION,
			payload: fieldProvenance(portTerminal.registryId).payload,
		});
		// A null status still names its column; nothing about it came from the request.
		expect(fieldProvenance(portTerminal.programStatuses.SDWA)).toMatchObject({
			sourceField: "SDWAComplianceStatus",
			rawValue: null,
		});
		for (const status of Object.values(portTerminal.programStatuses)) {
			expect(status.provenance.every((p) => p.kind === "field")).toBe(true);
		}
	});

	it("reads a column that is null on a real row as null, with its origin recorded", async () => {
		const { records } = await quarterMileRecords();
		// WESTWAY FEED PRODUCTS LLC reports no compliance status at all.
		const westway = byId(records, "110035313844");

		expect(westway.subject.value).toBe("WESTWAY FEED PRODUCTS LLC");
		expect(westway.complianceStatus.value).toBeNull();
		expect(westway.quartersInNoncompliance.value).toBeNull();
		expect(westway.activeFlag.value).toBeNull();
		expect(westway.lastInspectionDate.value).toBeNull();
		expect(fieldProvenance(westway.lastInspectionDate)).toMatchObject({ rawValue: null, transform: "parse-us-date" });
		expect(westway.lastPenaltyAmountUsd.value).toBe(0);
		expect(fieldProvenance(westway.complianceStatus)).toMatchObject({
			dataset: "echo_get_qid",
			sourceField: "FacComplianceStatus",
			rawValue: null,
		});
		// Null is not absent: the column exists and ECHO left it empty.
		expect(firstProvenance(westway.complianceStatus).kind).toBe("field");
	});

	it("passes through a status string it has never seen", async () => {
		const bytes = bytesOf("echo/facilities-page-quarter-mi.json");
		// The real page, with the first status replaced by one no ECHO response
		// has ever carried. A z.enum() or a lookup table would drop or rename it.
		const invented = "Provisionally Unclassified - Region 6 review pending";
		const mutated: unknown = JSON.parse(
			bytes.toString("utf8").replace('"No Violation Identified"', JSON.stringify(invented)),
		);

		const { outcome } = await outcomeOf([{ fixture: "facilities-quarter-mi.json" }, { body: mutated }]);
		if (outcome.status !== "ok") throw new Error(`expected ok, got ${outcome.status}`);

		const cargill = byId(outcome.records, "110005085898");
		expect(cargill.complianceStatus.value).toBe(invented);
		expect(cargill.programStatuses.CAA.value).toBe("No Violation Identified");
		expect(cargill.programStatuses.RCRA.value).toBe("No Violation Identified");
	});

	it("carries both calls' payloads and both datasets into the record", async () => {
		const { records } = await quarterMileRecords();
		const cargill = byId(records, "110005085898");

		expect(cargill.payloads).toHaveLength(2);
		expect(cargill.payloads.map((payload) => new URL(payload.url).pathname)).toEqual([
			"/echo/echo_rest_services.get_facilities",
			"/echo/echo_rest_services.get_qid",
		]);
		// ECHO's data-version stamp only exists on the first call.
		expect(cargill.sourceUpdatedAt.value).toBe("ALL DATA v2017-06-16 0923");
		expect(fieldProvenance(cargill.sourceUpdatedAt)).toMatchObject({
			dataset: "echo_get_facilities",
			sourceField: "Version",
		});
		expect(fieldProvenance(cargill.registryId).dataset).toBe("echo_get_qid");
	});

	it("always asks for the longitude column, so no facility loses its distance", async () => {
		const { calls, records } = await quarterMileRecords();
		const [first, second] = calls;
		if (first === undefined || second === undefined) throw new Error("expected two calls");

		expect(first.pathname).toBe("/echo/echo_rest_services.get_facilities");
		expect(first.searchParams.get("output")).toBe("JSON");
		expect(first.searchParams.get("p_lat")).toBe("29.720658823001");
		expect(first.searchParams.get("p_long")).toBe("-95.261995884462");
		expect(first.searchParams.get("p_radius")).toBe("0.25");
		expect(first.searchParams.get("qcolumns")).toBe(QCOLUMNS);

		expect(second.pathname).toBe("/echo/echo_rest_services.get_qid");
		expect(second.searchParams.get("qid")).toBe("77");
		expect(second.searchParams.get("pageno")).toBe("1");
		expect(second.searchParams.get("qcolumns")).toBe(QCOLUMNS);

		for (const record of records) {
			expect(record.location).not.toBeNull();
			expect(record.distanceMeters?.value).toBeTypeOf("number");
		}
	});

	it("requests column 18, which ECHO's own metadata calls FAC_LONG", () => {
		const Metadata = z.object({
			Results: z.object({
				ResultColumns: z.array(z.object({ ColumnID: z.string(), ColumnName: z.string(), ObjectName: z.string() })),
			}),
		});
		const metadata = Metadata.parse(JSON.parse(bytesOf("echo/metadata.json").toString("utf8")));
		const byColumnId = new Map(metadata.Results.ResultColumns.map((column) => [column.ColumnID, column]));

		const requested = QCOLUMNS.split(",").map((id) => {
			const column = byColumnId.get(id);
			if (column === undefined) throw new Error(`column ${id} is not in ECHO's metadata`);
			return column;
		});

		expect(byColumnId.get("18")?.ColumnName).toBe("FAC_LONG");
		expect(requested.map((column) => column.ObjectName)).toContain("FacLong");
		expect(requested.map((column) => column.ObjectName)).toContain("FacLat");

		// Every requested column is a column the adapter declares, and the page
		// fixture carries exactly those keys and no others.
		const Page = z.object({ Results: z.object({ Facilities: z.array(z.record(z.string(), z.unknown())) }) });
		const page = Page.parse(JSON.parse(bytesOf("echo/facilities-page-quarter-mi.json").toString("utf8")));
		const row = page.Results.Facilities[0];
		if (row === undefined) throw new Error("page fixture has no rows");
		expect(Object.keys(row).sort()).toEqual(requested.map((column) => column.ObjectName).sort());

		// ECHO calls the penalty column a NUMBER and then sends "$0".
		expect(byColumnId.get("63")?.ColumnName).toBe("FAC_LAST_PENALTY_AMT");
		expect(row["FacLastPenaltyAmt"]).toBe("$0");
	});

	it("treats QueryRows 0 with Message Success as no-data and never pages", async () => {
		const { outcome, calls } = await outcomeOf([{ fixture: "facilities-none-nevada.json" }], 1609.344);

		expect(outcome.status).toBe("no-data");
		if (outcome.status !== "no-data") throw new Error("expected no-data");
		expect(outcome.note).toBe("No matching records within the stated boundary.");
		expect(calls).toHaveLength(1);
	});

	it("reads an error body delivered with HTTP 200 as unavailable", async () => {
		const { outcome } = await outcomeOf([
			{ fixture: "facilities-quarter-mi.json" },
			{ fixture: "error-unknown-queryid.json" },
		]);

		expect(outcome.status).toBe("unavailable");
		if (outcome.status !== "unavailable") throw new Error("expected unavailable");
		expect(outcome.cause).toBe("http");
		// ECHO's own words, unmapped.
		expect(outcome.rawCode).toBe("QueryID 200897 not found in ECHO.");
	});

	it("reads an error body on the first call as unavailable too", async () => {
		const { outcome, calls } = await outcomeOf([{ fixture: "error-unknown-queryid.json" }]);

		expect(outcome.status).toBe("unavailable");
		expect(calls).toHaveLength(1);
	});

	it("surfaces a timeout as unavailable, never as an empty result", async () => {
		const { io, calls } = stubIo([{ fail: new SourceFailure("timeout") }]);
		const outcome = await runSource(
			houstonLocus(QUARTER_MILE),
			createEchoAdapter({ attempts: 3, retryDelayMs: 0 }),
			io,
			TEST_POLICY,
		);

		expect(outcome.status).toBe("unavailable");
		expect(outcome.status).not.toBe("no-data");
		if (outcome.status !== "unavailable") throw new Error("expected unavailable");
		expect(outcome.cause).toBe("timeout");
		// Three attempts, not one, and not a silent empty list.
		expect(calls).toHaveLength(3);
	});

	it("retries a reset connection and then succeeds", async () => {
		const { io, calls } = stubIo([
			{ fail: new SourceFailure("refused") },
			{ fixture: "facilities-quarter-mi.json" },
			{ fixture: "facilities-page-quarter-mi.json" },
		]);
		const outcome = await runSource(
			houstonLocus(QUARTER_MILE),
			createEchoAdapter({ attempts: 3, retryDelayMs: 0 }),
			io,
			TEST_POLICY,
		);

		expect(outcome.status).toBe("ok");
		expect(calls).toHaveLength(3);
	});

	it("hands the reader ECHO's own 429 and its retry hint after the retries are spent", async () => {
		// Three attempts because `retryable()` lists rate-limited, and then the
		// source's own code and hint, unmapped. "unknown" here would tell the
		// reader nothing; "no-data" would tell them something false.
		const { outcome, calls } = await outcomeOf([{ fail: new SourceFailure("rate-limited", 429, "60") }]);

		expect(outcome).toEqual({ status: "unavailable", cause: "rate-limited", rawCode: 429, retryAfter: "60" });
		expect(outcome.status).not.toBe("no-data");
		expect(calls).toHaveLength(3);
		for (const call of calls) expect(call.pathname).toBe("/echo/echo_rest_services.get_facilities");
	});

	it("retries a 429 on the page call against the same QueryID and page, and still reports the hint", async () => {
		// Retry-After is a delta in seconds or an HTTP date; EPA's gateway may
		// send either, so the hint is carried through as the string it sent.
		const httpDate = "Wed, 16 Sep 2026 10:00:00 GMT";
		const { outcome, calls } = await outcomeOf([
			{ fixture: "facilities-quarter-mi.json" },
			{ fail: new SourceFailure("rate-limited", 429, httpDate) },
		]);

		expect(outcome).toEqual({ status: "unavailable", cause: "rate-limited", rawCode: 429, retryAfter: httpDate });
		// The spatial query ran once; only the page request was retried, and a
		// retry never re-runs the query or advances the page.
		expect(calls).toHaveLength(4);
		expect(calls[0]?.pathname).toBe("/echo/echo_rest_services.get_facilities");
		for (const call of calls.slice(1)) {
			expect(call.pathname).toBe("/echo/echo_rest_services.get_qid");
			expect(call.searchParams.get("qid")).toBe("77");
			expect(call.searchParams.get("pageno")).toBe("1");
		}
	});

	it("reports a 429 that arrives without a Retry-After header as rate-limited with no hint", async () => {
		// `response.headers.get("retry-after")` is null when EPA sends none. The
		// hint going missing must not cost the reader the cause as well.
		const { outcome } = await outcomeOf([{ fail: new SourceFailure("rate-limited", 429, null) }]);

		expect(outcome).toEqual({ status: "unavailable", cause: "rate-limited", rawCode: 429, retryAfter: null });
	});

	it("does not retry a 429 when the deployment is configured for one attempt", async () => {
		const { io, calls } = stubIo([{ fail: new SourceFailure("rate-limited", 429, "60") }]);
		const outcome = await runSource(
			houstonLocus(QUARTER_MILE),
			createEchoAdapter({ attempts: 1, retryDelayMs: 0 }),
			io,
			TEST_POLICY,
		);

		expect(outcome).toEqual({ status: "unavailable", cause: "rate-limited", rawCode: 429, retryAfter: "60" });
		expect(calls).toHaveLength(1);
	});

	it("loses nothing from the record when a 429 clears on the next attempt", async () => {
		const { outcome, calls } = await outcomeOf([
			{ fail: new SourceFailure("rate-limited", 429, "1") },
			...QUARTER_MILE_STEPS,
		]);

		if (outcome.status !== "ok") throw new Error(`expected ok, got ${outcome.status}`);
		expect(calls).toHaveLength(3);
		expect(outcome.retrievedAt).toBe(RETRIEVED_AT);
		expect(outcome.records).toHaveLength(7);

		// The same literal record the un-throttled run produces: a retried
		// request is the same request, and the trace still names the page it
		// came from rather than the attempt that failed.
		const cargill = byId(outcome.records, "110005085898");
		expect(cargill.subject.value).toBe("CARGILL INCORPORATED");
		expect(cargill.complianceStatus.value).toBe("No Violation Identified");
		expect(cargill.lastPenaltyAmountUsd.value).toBe(0);
		expect(cargill.location?.latitude.value).toBe(29.72263);
		expect(cargill.distanceMeters?.value).toBe(219);
		expect(fieldProvenance(cargill.registryId)).toMatchObject({
			dataset: "echo_get_qid",
			sourceField: "RegistryID",
			rawValue: "110005085898",
			adapterVersion: ECHO_VERSION,
			payload: {
				sha256: createHash("sha256").update(bytesOf("echo/facilities-page-quarter-mi.json")).digest("hex"),
				retrievedAt: RETRIEVED_AT,
			},
		});
		expect(new URL(fieldProvenance(cargill.registryId).payload.url).pathname).toBe(
			"/echo/echo_rest_services.get_qid",
		);
	});

	it("does not retry a malformed body", async () => {
		const { io, calls } = stubIo([{ fail: new SourceFailure("malformed") }]);
		const outcome = await runSource(
			houstonLocus(QUARTER_MILE),
			createEchoAdapter({ attempts: 3, retryDelayMs: 0 }),
			io,
			TEST_POLICY,
		);

		expect(outcome.status).toBe("unavailable");
		expect(calls).toHaveLength(1);
	});

	it("pages a large result set and stops when a page adds nothing new", async () => {
		// The real 5-mile summary says 1686 rows. The stub then repeats one page,
		// which is how a paging loop with no progress check would spin forever.
		const { outcome, calls } = await outcomeOf(
			[{ fixture: "facilities-5mi-houston.json" }, { fixture: "facilities-page-quarter-mi.json" }],
			8046.72,
		);

		if (outcome.status !== "ok") throw new Error(`expected ok, got ${outcome.status}`);
		expect(outcome.records).toHaveLength(7);
		expect(calls).toHaveLength(3);
		expect(calls[0]?.searchParams.get("p_radius")).toBe("5");
		expect(calls[1]?.searchParams.get("pageno")).toBe("1");
		expect(calls[2]?.searchParams.get("pageno")).toBe("2");
		// Read from the fixture, never written down. ECHO mints a fresh QueryID on
		// every call, so the recorded summary carried 613 when it was first
		// captured and 223 when `scripts/capture-us-fixtures.sh` recaptured it on
		// 2026-09-16. What the test is about is that the second page is fetched
		// against the id the FIRST call returned, which is the thing a paging bug
		// gets wrong; pinning the digits made a recapture break a passing test for
		// no reason.
		expect(calls[2]?.searchParams.get("qid")).toBe(summaryQueryId("echo/facilities-5mi-houston.json"));
	});

	it("calls a counted result set that returns no rows a failure, not an empty neighbourhood", async () => {
		const emptyPage = {
			Results: { Message: "Working", QueryRows: "7", QueryID: "77", PageNo: "1", Facilities: [] },
		};
		const { outcome } = await outcomeOf([{ fixture: "facilities-quarter-mi.json" }, { body: emptyPage }]);

		expect(outcome.status).toBe("unavailable");
		if (outcome.status !== "unavailable") throw new Error("expected unavailable");
		expect(outcome.cause).toBe("malformed");
	});

	it("exports an adapter identity and a timeout ECHO can actually meet", () => {
		expect(echoAdapter.kind).toBe("echo-facility");
		expect(echoAdapter.source).toBe("echo");
		expect(echoAdapter.version).toBe(ECHO_VERSION);
		expect(ECHO_POLICY.timeoutMs).toBeGreaterThanOrEqual(30_000);
	});
});

/* -------------------------------------------------------------------------- */
/* Live call, skipped unless ECHO_LIVE=1                                      */
/* -------------------------------------------------------------------------- */

describe.skipIf(process.env["ECHO_LIVE"] !== "1")("echo adapter, live", () => {
	it("answers the demo address from the real endpoint", async () => {
		const io: SourceIo = {
			async get<Raw extends JsonValue>(url: URL, schema: z.ZodType<Raw>): Promise<Fetched<Raw>> {
				const response = await fetch(url, { signal: AbortSignal.timeout(ECHO_POLICY.timeoutMs) });
				if (!response.ok) throw new SourceFailure("http", response.status);
				const text = await response.text();
				return {
					raw: schema.parse(JSON.parse(text)),
					payload: payloadOf(url.toString(), Buffer.from(text, "utf8")),
				};
			},
			query(parameter, value, adapterVersion, payload): QueryProvenance {
				return { kind: "query", parameter, value, adapterVersion, payload };
			},
			now(): string {
				return new Date().toISOString();
			},
		};

		const outcome = await runSource(houstonLocus(QUARTER_MILE), echoAdapter, io, ECHO_POLICY);
		expect(outcome.status).toBe("ok");
	}, 120_000);
});
