/**
 * The AQS monitor summary template against the committed fixture bytes.
 *
 * Records are built through `annualSummaryBuilt` and `complete`, the adapter's
 * own path, so every sentence asserted here is a sentence the real fields fill
 * — as far as anything about AQS can be called real in this repository. The
 * body behind them is `annual-summary-houston.json`, which is authored
 * from EPA's published documentation and has never been checked against a
 * response; its `.source.md` says which three column names are this repository's
 * spelling. What these assertions pin is the wording and the clause structure,
 * not that AQS sends these bytes.
 *
 * Three rows of that body are rendered: a PM2.5 monitor with an observation
 * count, the ozone monitor with a unit in a different vocabulary, and the row
 * whose count is null. The third is the clause-dropping case, and it is the
 * only one this kind can have: every other slot the template prints is non-null
 * by construction, and a row with no coordinate cannot exist under
 * `AnnualSummaryRow`, which types `latitude` and `longitude` as required
 * numbers.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type {
	EvidenceStore,
	Fetched,
	PayloadRef,
	Placement,
	QueryProvenance,
	RecordOf,
	Sealed,
	Trace,
} from "@/lib/evidence";
import { complete, render, storeOf, trace, verify } from "@/lib/evidence";
import type { AnnualSummaryRow, AqsQuery, Pollutant } from "@/lib/adapters/aqs";
import {
	AQS_PARAMETERS,
	AQS_VERSION,
	AqsResponse,
	ENDPOINT,
	annualSummaryBuilt,
} from "@/lib/adapters/aqs";
import { aqsMonitorSummary, aqsTemplates } from "@/lib/templates/aqs";
import { houstonLocus } from "../evidence/helpers/sems-fixtures";

const fixturesDir = fileURLToPath(new URL("../../fixtures/aqs/", import.meta.url));
const FIXTURE = "annual-summary-houston.json";
const RETRIEVED_AT = "2026-09-16T12:00:00Z";
const YEAR = 2025;

const locus = houstonLocus();

/**
 * There is no fourth clause any more. Until 2026-09-16 every AQS card ended on
 * a sentence saying no response from the service had been recorded and the
 * column names were derived -- rule 3's whole point, that the reader meets an
 * unverified shape on the card rather than only in the trace. A response was
 * recorded that day and settled every column, so the clause went. This constant
 * is kept empty rather than deleted, so a reader diffing these strings sees
 * that a sentence was removed rather than that one never existed.
 */
const DERIVATION = "";

const bytes = readFileSync(`${fixturesDir}${FIXTURE}`);
const payload: PayloadRef = {
	url: `fixture:aqs/${FIXTURE}`,
	sha256: createHash("sha256").update(bytes).digest("hex"),
	retrievedAt: RETRIEVED_AT,
};
const body = AqsResponse.parse(JSON.parse(bytes.toString("utf8")));

function queryOf(parameter: string, value: string): QueryProvenance {
	return { kind: "query", parameter, value, adapterVersion: AQS_VERSION, payload };
}

const query: AqsQuery = {
	service: queryOf("service", ENDPOINT),
	period: queryOf("bdate", `${YEAR}0101`),
	year: YEAR,
};

function rowAt(index: number): Fetched<AnnualSummaryRow> {
	const row = body.Data[index];
	if (row === undefined) throw new Error(`${FIXTURE} has no row ${index}`);
	return { raw: row, payload };
}

/** The first row for a monitor, by the id the adapter builds. Rows are EPA's order, not ours. */
function rowFor(monitor: string): Fetched<AnnualSummaryRow> {
	const index = body.Data.findIndex(
		(row) => `${row.state_code}-${row.county_code}-${row.site_number}-${row.parameter_code}` === monitor,
	);
	if (index === -1) throw new Error(`${FIXTURE} has no row for ${monitor}`);
	return rowAt(index);
}

/**
 * One real row with its observation count emptied.
 *
 * `observation_count` is null in none of the 212 rows EPA returned for this
 * box, so the template's null branch has nothing in the recording to exercise
 * it. This is that row with the one column cleared -- a claim about the
 * template, never about what AQS sends, which is why it is built here rather
 * than filed as a fixture.
 */
function withoutObservationCount(fetched: Fetched<AnnualSummaryRow>): Fetched<AnnualSummaryRow> {
	return { raw: { ...fetched.raw, observation_count: null }, payload: fetched.payload };
}

function pollutantOf(row: AnnualSummaryRow): Pollutant {
	const pollutant = AQS_PARAMETERS[row.parameter_code];
	if (pollutant === undefined) throw new Error(`no pollutant for ${row.parameter_code}`);
	return pollutant;
}

/** The station 1.5 km from the mapped point, both its monitors, out of the recorded response. */
const PM25_MONITOR = "48-201-1035-88101";
const OZONE_MONITOR = "48-201-1035-44201";

function recordFor(monitor: string): Sealed<RecordOf<"aqs-monitor-summary">> {
	const row = rowFor(monitor);
	return complete(locus, annualSummaryBuilt(row, pollutantOf(row.raw), queryOf("param", row.raw.parameter_code), query));
}

const pm25 = recordFor(PM25_MONITOR);
const ozone = recordFor(OZONE_MONITOR);
/** A different station, so it does not collide with `ozone` in the store: one id, one record. */
const NO_COUNT_MONITOR = "48-201-0046-44201";
const noCount = ((): Sealed<RecordOf<"aqs-monitor-summary">> => {
	const row = withoutObservationCount(rowFor(NO_COUNT_MONITOR));
	return complete(locus, annualSummaryBuilt(row, pollutantOf(row.raw), queryOf("param", row.raw.parameter_code), query));
})();

const store: EvidenceStore = storeOf([pm25, ozone, noCount]);

function placementFor(record: Sealed<RecordOf<"aqs-monitor-summary">>): Placement {
	return { scope: "record", recordId: record.id, template: aqsMonitorSummary };
}

function textFor(where: EvidenceStore, record: Sealed<RecordOf<"aqs-monitor-summary">>): string | null {
	const sentence = render(where, placementFor(record));
	return sentence === null ? null : sentence.spans.map((span) => span.text).join("");
}

function mustTrace(record: Sealed<RecordOf<"aqs-monitor-summary">>, field: string): Extract<Trace, { scope: "record" }> {
	const sentence = render(store, placementFor(record));
	if (sentence === null) throw new Error("expected a sentence");
	const index = sentence.spans.findIndex((span) => span.slot?.field === field);
	const found = trace(store, sentence, index);
	if (found === null) throw new Error(`expected a trace for ${field}`);
	if (found.scope !== "record") throw new Error(`expected a record trace, got ${found.scope}`);
	return found;
}

describe("the registry entry", () => {
	it("exports every template of this kind, all bound to it", () => {
		expect(aqsTemplates).toEqual([aqsMonitorSummary]);
		expect(aqsMonitorSummary.id).toBe("aqs-monitor-summary/summary@1");
		expect(aqsMonitorSummary.kind).toBe("aqs-monitor-summary");
		// Nothing on this kind is a state, and there is no second template to be
		// told apart from, so the template asserts no condition about its subject.
		expect(aqsMonitorSummary.requires).toEqual([]);
	});
});

describe("aqs-monitor-summary/summary@1", () => {
	it("renders the PM2.5 monitor whole", () => {
		expect(textFor(store, pm25)).toBe(
			"PM2.5 monitor 48-201-1035-88101 is 1.52 km from the mapped point, and measures its own location, not this"
			+ " address. 2025 annual arithmetic mean: 10.385577 Micrograms/cubic meter (LC). AQS data lags collection by six"
			+ " months or more. Observations in the summary: 104."
			+ DERIVATION,
		);
	});

	it("renders the ozone monitor in the unit AQS sent, unmapped", () => {
		expect(textFor(store, ozone)).toBe(
			"Ozone monitor 48-201-1035-44201 is 1.52 km from the mapped point, and measures its own location, not this"
			+ " address. 2025 annual arithmetic mean: 0.042165 Parts per million. AQS data lags collection by six months"
			+ " or more. Observations in the summary: 8508."
			+ DERIVATION,
		);
	});

	it("drops the observation clause when the count is null, and leaves the rest standing", () => {
		expect(noCount.observationCount.value).toBeNull();
		expect(textFor(store, noCount)).toBe(
			"Ozone monitor 48-201-0046-44201 is 12.18 km from the mapped point, and measures its own location, not this"
			+ " address. 2025 annual arithmetic mean: 0.038705 Parts per million. AQS data lags collection by six"
			+ " months or more."
			+ DERIVATION,
		);
	});

	it("never prints a boolean, a code this report mapped, or a judgement about the value", () => {
		const text = textFor(store, pm25) ?? "";
		for (const forbidden of ["true", "false", "safe", "unsafe", "risk", "healthy", "exceeds", "above the standard"]) {
			expect(text.toLowerCase()).not.toContain(forbidden);
		}
		// "Nearest" is A2's word and no field on this record supports it, so the
		// sentence does not claim it. See the module comment.
		expect(text).not.toContain("Nearest");
	});

	/**
	 * Inverted on 2026-09-16, and the inversion is the point.
	 *
	 * This asserted that every card said its shape was unverified, in a clause
	 * rather than a caveat, because `caveats` is a field of `RecordTrace` and so
	 * reaches the trace panel and never the card. That was right while it was
	 * true. Then a real `annualData/byBox` response was recorded, every column
	 * the adapter reads was in it, and two of the three names it had derived
	 * turned out wrong -- so the claim stopped being true and the clause went.
	 *
	 * Kept, inverted, so the silence reads as a decision rather than an
	 * omission: the card says nothing about an unverified shape because there is
	 * no longer an unverified shape to say anything about.
	 */
	it("no longer says the shape is unverified, because a response was recorded", () => {
		for (const record of [pm25, ozone, noCount]) {
			expect(textFor(store, record)).not.toContain("unverified");
			expect(textFor(store, record)).not.toContain("column names this report derived");
			expect(textFor(store.without(record.id), record)).toBeNull();
		}
	});
});

describe("the deletion guarantee", () => {
	it("renders null once the record is out of the store, and the old sentence stops verifying", () => {
		const sentence = render(store, placementFor(pm25));
		if (sentence === null) throw new Error("expected a sentence");
		const without = store.without(pm25.id);

		expect(textFor(without, pm25)).toBeNull();
		expect(verify(store, sentence, aqsTemplates)).toBe(true);
		expect(verify(without, sentence, aqsTemplates)).toBe(false);
		// The other two are untouched: deleting one record rewrites nothing else.
		expect(textFor(without, ozone)).toBe(textFor(store, ozone));
	});
});

describe("the trace behind one span", () => {
	it("names the column the mean was read from and the raw value in it", () => {
		const found = mustTrace(pm25, "value");

		expect(found.clicked.field).toBe("value");
		expect(found.clicked.displayed).toBe("10.385577");
		expect(found.clicked.normalized).toBe(10.385577);
		expect(found.clicked.provenance).toEqual([
			{
				kind: "field",
				dataset: "aqs_annual_summary",
				sourceField: "arithmetic_mean",
				rawValue: 10.385577,
				transform: "identity",
				adapterVersion: "aqs@1",
				payload,
			},
		]);
		expect(found.record.agency).toBe("EPA Air Quality System");
		expect(found.record.sourceRecordId).toBe("48-201-1035-88101");
		expect(found.record.sourceUrl.normalized).toBe(
			"https://aqs.epa.gov/aqsweb/airdata/annual_conc_by_monitor_2025.zip",
		);
		// Three now, not five. The two that said the parse was unverified and the
		// column names derived went with the recording that settled them.
		expect(found.record.caveats).not.toContain(
			expect.stringContaining("unverified against real bytes"),
		);
		expect(found.record.caveats).toHaveLength(3);
	});

	it("shows the year as a value of our own request, not a column AQS sent", () => {
		const found = mustTrace(pm25, "period");

		expect(found.clicked.displayed).toBe("2025");
		expect(found.clicked.normalized).toBe("2025");
		expect(found.clicked.provenance).toEqual([
			{ kind: "query", parameter: "bdate", value: "20250101", adapterVersion: "aqs@1", payload },
		]);
	});

	it("shows the distance as the kernel's own computation over both coordinates", () => {
		const found = mustTrace(pm25, "distanceMeters");

		expect(found.clicked.displayed).toBe("1.52 km");
		expect(found.clicked.normalized).toBe(1515);
		expect(found.clicked.provenance[0]).toMatchObject({ kind: "computation", formula: "haversine" });
	});
});
