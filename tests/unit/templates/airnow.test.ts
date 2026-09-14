/**
 * The AirNow observation templates.
 *
 * Every record here is built through `airnowObservationBuilt` and `complete`,
 * the adapter's own path, so each sentence asserted below is a sentence the
 * fields as this adapter reads them actually fill.
 *
 * What they are filled from is authored, not recorded. `tests/fixtures/airnow/`
 * holds exactly one real response — the HTTP 401 of 2026-09-16 — and every
 * `derived-` file beside it was constructed, with a sibling `.source.md` saying
 * so. An exact sentence asserted here is therefore a fact about this codebase's
 * rendering and not a fact about AirNow, and the names below say so.
 *
 * Two templates and three records is six pairs, and the cross product asserts
 * all six: the exact sentence where a template speaks about a record, and null
 * where it must refuse. A pair that renders null is an assertion, which is what
 * a requirement is for.
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
	Template,
	Trace,
} from "@/lib/evidence";
import { complete, render, storeOf, trace, verify } from "@/lib/evidence";
import type { Pollutant } from "@/lib/adapters/airnow";
import { AIRNOW_VERSION, AirNowObservation, AirNowResponse, airnowObservationBuilt } from "@/lib/adapters/airnow";
import { airnowObservationNoIndex, airnowObservationSummary, airnowTemplates } from "@/lib/templates/airnow";
import { houstonLocus } from "../evidence/helpers/sems-fixtures";

const fixturesDir = fileURLToPath(new URL("../../fixtures/airnow/", import.meta.url));
const RETRIEVED_AT = "2026-09-16T02:00:00Z";
/** The key-free URL the adapter cites. No test in this file ever sees a key. */
const CITABLE =
	"https://www.airnowapi.org/aq/observation/latLong/current/" +
	"?format=application%2Fjson&latitude=29.720658823001&longitude=-95.261995884462";

const locus = houstonLocus();

type AirNowRecord = Sealed<RecordOf<"airnow-observation">>;

/** One authored row, read from the file, with the file's own bytes behind its payload. */
function derivedRow(file: string, index: number): Fetched<AirNowObservation> {
	const bytes = readFileSync(`${fixturesDir}${file}`);
	const parsed = AirNowResponse.parse(JSON.parse(bytes.toString("utf8")));
	if (!Array.isArray(parsed)) throw new Error(`${file} is an error envelope, not a list`);
	const row = parsed[index];
	if (row === undefined) throw new Error(`${file} holds no row ${index}`);
	const payload: PayloadRef = {
		// `derived:` and not `fixture:`, because these bytes were authored.
		url: `derived:airnow/${file}`,
		sha256: createHash("sha256").update(bytes).digest("hex"),
		retrievedAt: RETRIEVED_AT,
	};
	return { raw: row, payload };
}

function query(parameter: string, value: string, payload: PayloadRef): QueryProvenance {
	return { kind: "query", parameter, value, adapterVersion: AIRNOW_VERSION, payload };
}

function recordOf(row: Fetched<AirNowObservation>, pollutant: Pollutant): AirNowRecord {
	return complete(
		locus,
		airnowObservationBuilt(
			row,
			pollutant,
			query("pollutant", pollutant, row.payload),
			query("request", CITABLE, row.payload),
		),
	);
}

const ozone = recordOf(derivedRow("derived-current-observations.json", 0), "Ozone");
const pm25 = recordOf(derivedRow("derived-current-observations.json", 1), "PM2.5");
const noIndex = recordOf(derivedRow("derived-null-aqi.json", 0), "PM2.5");

/** The first clause both templates end on. It names the area again rather than saying "it". */
const QUALIFICATION = " AirNow's observations describe the Houston reporting area, not the mapped point.";

/**
 * The second, and `.dev/briefs/U1.6-U1.7-air.md` rule 3's whole point: the
 * reader meets the unverified shape on the card, not only in the trace panel.
 * It names the pollutant, so it is a function of the row rather than a
 * constant.
 */
function derivation(pollutant: Pollutant): string {
	return (
		` No response from this service has been recorded, so this ${pollutant} row is read through field names this` +
		" report derived and is unverified against real bytes."
	);
}

function textOf(spans: readonly { readonly text: string }[]): string {
	return spans.map((s) => s.text).join("");
}

function mustRender(store: EvidenceStore, placement: Placement) {
	const sentence = render(store, placement);
	if (sentence === null) throw new Error(`expected a sentence for ${placement.template.id}`);
	return sentence;
}

function mustTraceRecord(store: EvidenceStore, placement: Placement, field: string): Extract<Trace, { scope: "record" }> {
	const sentence = mustRender(store, placement);
	const index = sentence.spans.findIndex((s) => s.slot?.field === field);
	const found = trace(store, sentence, index);
	if (found === null) throw new Error(`expected a trace for ${field}`);
	if (found.scope !== "record") throw new Error(`expected a record-scoped trace, got ${found.scope}`);
	return found;
}

type Case = {
	readonly what: string;
	readonly record: AirNowRecord;
	readonly store: EvidenceStore;
	/** The exact sentence `summary@1` must render over this record, or null where it must refuse. */
	readonly summary: string | null;
	/** The same for `no-index@1`. Exactly one of the two is a string. */
	readonly noIndex: string | null;
};

function caseOf(what: string, record: AirNowRecord, expected: Omit<Case, "what" | "record" | "store">): Case {
	return { what, record, store: storeOf([record]), ...expected };
}

const cases: readonly Case[] = [
	caseOf("an ozone index", ozone, {
		summary:
			"AirNow reports an air quality index of 41 for Ozone in the Houston reporting area, observed 2026-09-16." +
			QUALIFICATION +
			derivation("Ozone"),
		noIndex: null,
	}),
	caseOf("a PM2.5 index", pm25, {
		summary:
			"AirNow reports an air quality index of 58 for PM2.5 in the Houston reporting area, observed 2026-09-16." +
			QUALIFICATION +
			derivation("PM2.5"),
		noIndex: null,
	}),
	caseOf("a row carrying no index", noIndex, {
		summary: null,
		noIndex:
			"AirNow's PM2.5 observation for the Houston reporting area, observed 2026-09-16," +
			" carries no air quality index." +
			QUALIFICATION +
			derivation("PM2.5"),
	}),
];

function expectedFor(one: Case, template: Template<"airnow-observation">): string | null {
	if (template.id === airnowObservationSummary.id) return one.summary;
	if (template.id === airnowObservationNoIndex.id) return one.noIndex;
	throw new Error(`no expectation recorded for ${template.id}`);
}

describe("every template against every record", () => {
	it("is two templates, each declaring the AQI state it speaks about", () => {
		expect(airnowTemplates.map((t) => t.id)).toEqual([
			"airnow-observation/summary@1",
			"airnow-observation/no-index@1",
		]);
		expect(airnowTemplates.every((t) => t.kind === "airnow-observation")).toBe(true);
		expect(airnowObservationSummary.requires).toEqual([{ slot: "aqi", present: true }]);
		expect(airnowObservationNoIndex.requires).toEqual([{ slot: "aqi", present: false }]);
	});

	it("renders the whole cross product: the exact sentence where a template speaks, null where it does not", () => {
		expect(airnowTemplates).toHaveLength(2);
		expect(cases).toHaveLength(3);
		for (const template of airnowTemplates) {
			for (const one of cases) {
				const placement: Placement = { scope: "record", recordId: one.record.id, template };
				const sentence = render(one.store, placement);
				const rendered = sentence === null ? null : textOf(sentence.spans);
				expect(rendered, `${template.id} over ${one.what}`).toBe(expectedFor(one, template));
			}
		}
	});

	it("gives every record exactly one sentence: the two requirements partition the kind", () => {
		for (const one of cases) {
			const rendering = airnowTemplates.filter(
				(template) => render(one.store, { scope: "record", recordId: one.record.id, template }) !== null,
			);
			expect(
				rendering.map((t) => t.id),
				one.what,
			).toEqual(one.summary === null ? [airnowObservationNoIndex.id] : [airnowObservationSummary.id]);
			expect([one.summary, one.noIndex].filter((s) => s !== null), one.what).toHaveLength(1);
		}
	});

	it("prints no boolean, no distance, no verdict, and re-derives from the store", () => {
		for (const template of airnowTemplates) {
			for (const one of cases) {
				if (expectedFor(one, template) === null) continue;
				const placement: Placement = { scope: "record", recordId: one.record.id, template };
				const sentence = mustRender(one.store, placement);
				const rendered = textOf(sentence.spans);
				expect(rendered, one.what).not.toMatch(/\b(true|false)\b/i);
				expect(rendered, one.what).not.toContain(" km");
				// docs/BRIEF.md C2: no verdict, no severity, no cumulative judgement.
				expect(rendered, one.what).not.toMatch(/\b(safe|unsafe|risk|healthy|unhealthy|polluter)\b/i);
				// A5 on the card, qualifying the value rather than sitting in a footer.
				expect(rendered, one.what).toContain("not the mapped point");
				// Rule 3 on the card, for the same reason and by the same mechanism.
				expect(rendered, one.what).toContain("unverified against real bytes");
				expect(verify(one.store, sentence, airnowTemplates)).toBe(true);
			}
		}
	});

	it("says the shape is unverified on the card, in a clause that dies with the record", () => {
		// `caveats` is a field of `RecordTrace`, so a record caveat alone reaches
		// the trace panel and never the card. `.dev/briefs/U1.6-U1.7-air.md` rule 3
		// wants it where the reader reads the value, and a clause is the only
		// thing on the wire that cannot outlive the values it qualifies.
		for (const one of cases) {
			const template = one.summary === null ? airnowObservationNoIndex : airnowObservationSummary;
			const placement: Placement = { scope: "record", recordId: one.record.id, template };
			expect(textOf(mustRender(one.store, placement).spans), one.what).toContain(
				"is read through field names this report derived and is unverified against real bytes",
			);
			// And it goes when the record goes, which is the whole reason it is a
			// clause hung on `pollutant` rather than a sentence of its own.
			expect(render(one.store.without(one.record.id), placement), one.what).toBeNull();
		}
	});

	it("keeps the caveats that are about the source, not about a value, on the record", () => {
		for (const { what, record } of cases) {
			expect(record.caveats, what).toContain("AirNow reports preliminary current conditions and updates them hourly.");
			expect(record.caveats, what).toContain(
				"No response from this service has been recorded yet. The parse is unverified against real bytes, and"
					+ " AirNow's own per-service documentation is behind a login, so its field names are not backed by a"
					+ " published field list either.",
			);
			// No caveat is in the sentence *verbatim*. The derived-shape caveat is
			// said on the card, but as a clause hung on `pollutant` and in that
			// clause's own words; the other two have no field behind them and stay
			// disclosures the trace panel carries.
			for (const caveat of record.caveats) {
				const summary = render(storeOf([record]), {
					scope: "record",
					recordId: record.id,
					template: airnowObservationSummary,
				});
				if (summary !== null) expect(textOf(summary.spans), what).not.toContain(caveat);
			}
		}
	});
});

describe("a null optional field drops its own clause and nothing else", () => {
	it("drops the category clause, which is null on every record this adapter can build today", () => {
		expect(ozone.category.value).toBeNull();
		const placement: Placement = { scope: "record", recordId: ozone.id, template: airnowObservationSummary };
		const spans = mustRender(storeOf([ozone]), placement).spans;

		// The clause is in the template and references `category`...
		expect(airnowObservationSummary.clauses.some((c) => c.refs.some((r) => r.field === "category"))).toBe(true);
		// ...and it is not in the sentence, while every other clause stands.
		expect(spans.flatMap((s) => (s.slot === null ? [] : [s.slot.field]))).toEqual([
			"aqi",
			"pollutant",
			"reportingArea",
			"observedAt",
			"reportingArea",
			"pollutant",
		]);
		expect(textOf(spans)).not.toContain("category");
		expect(textOf(spans)).toContain("air quality index of 41 for Ozone");
		expect(textOf(spans)).toContain("not the mapped point");
	});

	it("renders the category clause the moment the column is known, without touching this file", () => {
		// Not a claim about AirNow: it proves the clause is live rather than dead,
		// by handing the same builder a record whose category slot holds a value.
		const row = derivedRow("derived-current-observations.json", 1);
		const built = airnowObservationBuilt(
			row,
			"PM2.5",
			query("pollutant", "PM2.5", row.payload),
			query("request", CITABLE, row.payload),
		);
		const category = query("category", "Moderate", row.payload);
		const withCategory = complete(locus, {
			...built,
			category: { ...built.pollutant, value: "Moderate", provenance: [category] },
		});
		const spans = mustRender(storeOf([withCategory]), {
			scope: "record",
			recordId: withCategory.id,
			template: airnowObservationSummary,
		}).spans;
		expect(textOf(spans)).toBe(
			"AirNow reports an air quality index of 58 for PM2.5 in the Houston reporting area, observed 2026-09-16." +
				" AirNow's category for that index is Moderate." +
				QUALIFICATION +
				derivation("PM2.5"),
		);
	});
});

describe("the trace behind a rendered span", () => {
	const store = storeOf([pm25]);
	const placement: Placement = { scope: "record", recordId: pm25.id, template: airnowObservationSummary };

	it("takes the index to AirNow's AQI column and the raw number it sent", () => {
		const t = mustTraceRecord(store, placement, "aqi");
		expect(t.clicked.field).toBe("aqi");
		expect(t.clicked.displayed).toBe("58");
		expect(t.clicked.normalized).toBe(58);
		expect(t.clicked.provenance).toEqual([
			{
				kind: "field",
				dataset: "airnow_current_observations",
				sourceField: "AQI",
				rawValue: 58,
				transform: "identity",
				adapterVersion: "airnow@1",
				payload: pm25.payloads[0],
			},
		]);
		expect(t.record.source).toBe("airnow");
		expect(t.record.agency).toBe("EPA AirNow");
		expect(t.record.sourceRecordId).toBe("Houston/PM2.5");
	});

	it("takes the pollutant word to the request, because AirNow never sent that vocabulary", () => {
		const t = mustTraceRecord(store, placement, "pollutant");
		expect(t.clicked.displayed).toBe("PM2.5");
		expect(t.clicked.provenance).toEqual([
			{ kind: "query", parameter: "pollutant", value: "PM2.5", adapterVersion: "airnow@1", payload: pm25.payloads[0] },
		]);
	});

	it("takes the reporting area to the column, and the sentence links to a URL carrying no key", () => {
		const t = mustTraceRecord(store, placement, "reportingArea");
		expect(t.clicked.displayed).toBe("Houston");
		expect(t.clicked.provenance[0]).toMatchObject({
			sourceField: "ReportingArea",
			rawValue: "Houston",
			transform: "identity",
		});
		expect(t.record.sourceUrl.normalized).toBe(CITABLE);
		expect(t.record.sourceUrl.normalized).not.toContain("API_KEY");
	});
});

describe("a record removed from the store leaves no text", () => {
	it("renders null once the observation is gone, and will not verify the sentence rendered before", () => {
		const store = storeOf([pm25]);
		const placement: Placement = { scope: "record", recordId: pm25.id, template: airnowObservationSummary };
		const before = mustRender(store, placement);
		const after = store.without(pm25.id);

		expect(after.get(pm25.id)).toBeUndefined();
		expect(render(after, placement)).toBeNull();
		expect(verify(after, before, airnowTemplates)).toBe(false);
	});

	it("takes the reporting-area qualification down with the value it qualifies", () => {
		const store = storeOf([noIndex]);
		const placement: Placement = { scope: "record", recordId: noIndex.id, template: airnowObservationNoIndex };
		expect(textOf(mustRender(store, placement).spans)).toContain("not the mapped point");
		expect(render(store.without(noIndex.id), placement)).toBeNull();
	});
});
