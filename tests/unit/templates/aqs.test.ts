/**
 * The AQS monitor summary template against the committed fixture bytes.
 *
 * Records are built through `annualSummaryBuilt` and `complete`, the adapter's
 * own path, so every sentence asserted here is a sentence the real fields fill
 * — as far as anything about AQS can be called real in this repository. The
 * body behind them is `derived-annual-summary-houston.json`, which is authored
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
const FIXTURE = "derived-annual-summary-houston.json";
const RETRIEVED_AT = "2026-09-16T12:00:00Z";
const YEAR = 2025;

const locus = houstonLocus();

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
	const row = body.Body[index];
	if (row === undefined) throw new Error(`${FIXTURE} has no row ${index}`);
	return { raw: row, payload };
}

function pollutantOf(row: AnnualSummaryRow): Pollutant {
	const pollutant = AQS_PARAMETERS[row.parameter_code];
	if (pollutant === undefined) throw new Error(`no pollutant for ${row.parameter_code}`);
	return pollutant;
}

function recordAt(index: number): Sealed<RecordOf<"aqs-monitor-summary">> {
	const row = rowAt(index);
	const pollutant = pollutantOf(row.raw);
	return complete(locus, annualSummaryBuilt(row, pollutant, queryOf("param", row.raw.parameter_code), query));
}

/** Row 0 is the PM2.5 monitor 1.51 km away, row 2 the ozone monitor, row 3 the one with no observation count. */
const pm25 = recordAt(0);
const ozone = recordAt(2);
const noCount = recordAt(3);

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
			"PM2.5 monitor 48-201-1039-88101 is 1.51 km from the mapped point, and measures its own location, not this"
			+ " address. 2025 annual arithmetic mean: 9.8 Micrograms/cubic meter (LC). AQS data lags collection by six"
			+ " months or more. Observations in the summary: 121.",
		);
	});

	it("renders the ozone monitor in the unit AQS sent, unmapped", () => {
		expect(textFor(store, ozone)).toBe(
			"Ozone monitor 48-201-0024-44201 is 15.76 km from the mapped point, and measures its own location, not this"
			+ " address. 2025 annual arithmetic mean: 0.0421 Parts per million. AQS data lags collection by six months"
			+ " or more. Observations in the summary: 214.",
		);
	});

	it("drops the observation clause when the count is null, and leaves the rest standing", () => {
		expect(noCount.observationCount.value).toBeNull();
		expect(textFor(store, noCount)).toBe(
			"PM2.5 monitor 48-201-0416-88101 is 20.88 km from the mapped point, and measures its own location, not this"
			+ " address. 2025 annual arithmetic mean: 8.4 Micrograms/cubic meter (LC). AQS data lags collection by six"
			+ " months or more.",
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
		expect(found.clicked.displayed).toBe("9.8");
		expect(found.clicked.normalized).toBe(9.8);
		expect(found.clicked.provenance).toEqual([
			{
				kind: "field",
				dataset: "aqs_annual_summary",
				sourceField: "arithmetic_mean",
				rawValue: 9.8,
				transform: "identity",
				adapterVersion: "aqs@1",
				payload,
			},
		]);
		expect(found.record.agency).toBe("EPA Air Quality System");
		expect(found.record.sourceRecordId).toBe("48-201-1039-88101");
		expect(found.record.sourceUrl.normalized).toBe(
			"https://aqs.epa.gov/aqsweb/airdata/annual_conc_by_monitor_2025.zip",
		);
		// The card carries A2's two caveats in its clauses; the trace carries all
		// five, including the three that qualify the retrieval rather than a slot.
		expect(found.record.caveats).toContain(
			"No response from this service has been recorded yet. The parse follows EPA's published field names and is"
			+ " unverified against real bytes.",
		);
		expect(found.record.caveats).toHaveLength(5);
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

		expect(found.clicked.displayed).toBe("1.51 km");
		expect(found.clicked.normalized).toBe(1514);
		expect(found.clicked.provenance[0]).toMatchObject({ kind: "computation", formula: "haversine" });
	});
});
