/**
 * The FEMA flood-zone templates against the committed Esri fixture bytes.
 *
 * Records are built through `floodZoneBuilt` and `complete`, the adapter's own
 * path, so every sentence asserted here is a sentence the real fields fill.
 *
 * Three SFHA_TF states have no recorded bytes — a letter the map does not hold,
 * a JSON null, and the empty string that this row's own V_DATUM, VEL_UNIT and
 * DUAL_ZONE carry — and neither recorded row is missing its DFIRM_ID. Those
 * cases are derived from the Pasadena row, one altered field each, and a
 * derived row never carries the committed payload's hash: `derivedRow` says
 * exactly what it hashes.
 *
 * Two templates and six records is twelve pairs, and the cross product asserts
 * all twelve: the exact sentence where the template speaks about the record,
 * and null where it does not. Null is what a requirement is for, so a pair that
 * renders null is an assertion and not an absence of one.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type {
	EvidenceStore,
	FemaFloodZoneRecord,
	Fetched,
	PayloadRef,
	Placement,
	QueryProvenance,
	Sealed,
	Template,
	Trace,
} from "@/lib/evidence";
import { complete, render, storeOf, trace, verify } from "@/lib/evidence";
import type { FemaDataset } from "@/lib/adapters/fema";
import { FEMA_DATASETS, FEMA_VERSION, FloodAreaAttrs, floodZoneBuilt } from "@/lib/adapters/fema";
import { femaTemplates, floodZoneSummary, floodZoneUnmappedFlag } from "@/lib/templates/fema";
import { houstonLocus } from "../evidence/helpers/sems-fixtures";

const fixturesDir = fileURLToPath(new URL("../../fixtures/fema/", import.meta.url));
const RETRIEVED_AT = "2026-09-16T02:00:00Z";
const DATASET: FemaDataset = "ESRI_REDUCED_SET";

const locus = houstonLocus();

const ZoneBody = z.object({ features: z.array(z.object({ attributes: FloodAreaAttrs })) });

function fixtureRow(file: string): Fetched<FloodAreaAttrs> {
	const bytes = readFileSync(`${fixturesDir}${file}`);
	const [feature] = ZoneBody.parse(JSON.parse(bytes.toString("utf8"))).features;
	if (feature === undefined) throw new Error(`${file} holds no feature`);
	const payload: PayloadRef = {
		url: `fixture:fema/${file}`,
		sha256: createHash("sha256").update(bytes).digest("hex"),
		retrievedAt: RETRIEVED_AT,
	};
	return { raw: feature.attributes, payload };
}

/**
 * A row this codebase altered. The hash is not the recorded file's bytes with a
 * field changed: `fixtureRow` has already put the payload through
 * `FloodAreaAttrs`, so what is hashed here is a re-serialisation of that
 * seven-key parsed subset with the override applied — its own bytes, which is
 * why they get their own hash and a `derived:` URL naming the altered field.
 * One field per derived row, so no test ever asserts over a value that two
 * changes made up between them.
 */
function derivedRow(file: string, overrides: Partial<FloodAreaAttrs>): Fetched<FloodAreaAttrs> {
	const row = fixtureRow(file);
	const raw = { ...row.raw, ...overrides };
	const bytes = Buffer.from(JSON.stringify({ features: [{ attributes: raw }] }), "utf8");
	const payload: PayloadRef = {
		url: `derived:fema/${file}, the parsed fields re-serialised with ${Object.keys(overrides).join(", ")} altered`,
		sha256: createHash("sha256").update(bytes).digest("hex"),
		retrievedAt: RETRIEVED_AT,
	};
	return { raw, payload };
}

function service(dataset: FemaDataset, payload: PayloadRef): QueryProvenance {
	return {
		kind: "query",
		parameter: "service",
		value: `${FEMA_DATASETS[dataset].layer}/query`,
		adapterVersion: FEMA_VERSION,
		payload,
	};
}

function recordOf(row: Fetched<FloodAreaAttrs>, dataset: FemaDataset = DATASET): Sealed<FemaFloodZoneRecord> {
	return complete(locus, floodZoneBuilt(row, dataset, service(dataset, row.payload)));
}

function mustRender(store: EvidenceStore, placement: Placement) {
	const sentence = render(store, placement);
	if (sentence === null) throw new Error(`expected a sentence for ${placement.template.id}`);
	return sentence;
}

function textOf(spans: readonly { readonly text: string }[]): string {
	return spans.map((s) => s.text).join("");
}

function mustTraceRecord(store: EvidenceStore, placement: Placement, field: string): Extract<Trace, { scope: "record" }> {
	const sentence = mustRender(store, placement);
	const index = sentence.spans.findIndex((s) => s.slot?.field === field);
	const found = trace(store, sentence, index);
	if (found === null) throw new Error(`expected a trace for ${field}`);
	if (found.scope !== "record") throw new Error(`expected a record-scoped trace, got ${found.scope}`);
	return found;
}

const pasadena = recordOf(fixtureRow("esri-zone-ae-pasadena.json"));
const newOrleans = recordOf(fixtureRow("esri-zone-x-levee-neworleans.json"));
// Derived: no recorded payload carries an SFHA letter outside {T, F}.
const unmappedFlag = recordOf(derivedRow("esri-zone-ae-pasadena.json", { SFHA_TF: "U" }));
// Derived: the empty string three sibling columns of this very row carry, which
// `map` also reads as null. The verbatim clause has to be true for this too.
const emptyFlag = recordOf(derivedRow("esri-zone-ae-pasadena.json", { SFHA_TF: "" }));
// Derived: both recorded rows carry a DFIRM_ID, and ArcGIS declares it nullable.
const noStudyId = recordOf(derivedRow("esri-zone-ae-pasadena.json", { DFIRM_ID: null }));
// No NFHL response has ever been recorded — the host refuses connections from
// here, docs/BRIEF.md B14 — and both layers carry the same field names. This
// pairs the recorded Esri row with the NFHL dataset choice, and fixes which
// label the clause prints for that choice. It says nothing about what NFHL sent.
const nfhlDataset = recordOf(fixtureRow("esri-zone-ae-pasadena.json"), "NFHL");

const ESRI_TAIL =
	" Read from Esri's reduced-set copy of FEMA's National Flood Hazard Layer.";
const PASADENA_IDS =
	" FEMA's FIRM study identifier for this area is 48201C." +
	" The flood area ID recorded for this area is 48201C_8563." +
	" The source-citation lookup key recorded for this area is 48201C_FIRM1.";
/** A5 on the card, not in a footer: the zone clause qualifies the point it designates. */
const LEAD = "The mapped point, a street-segment interpolation rather than a parcel boundary, is in zone";
/** B10: verbatim, and "Meaning not mapped." The quotes are what make an empty column visible. */
function unmapped(flag: string): string {
	return ` FEMA's Special Flood Hazard Area flag recorded for this area is "${flag}". Meaning not mapped.`;
}
const CAVEAT = "The mapped point is a street-segment interpolation, not the parcel boundary.";

type Case = {
	readonly what: string;
	readonly record: Sealed<FemaFloodZoneRecord>;
	readonly store: EvidenceStore;
	/** The exact sentence `summary@1` must render over this record, or null where it must refuse. */
	readonly summary: string | null;
	/** The same for `unmapped-flag@1`. Exactly one of the two is a string. */
	readonly unmappedFlag: string | null;
};

function caseOf(what: string, record: Sealed<FemaFloodZoneRecord>, expected: Omit<Case, "what" | "record" | "store">): Case {
	return { what, record, store: storeOf([record]), ...expected };
}

/** What each template must render over each record the committed fixtures build. */
const cases: readonly Case[] = [
	caseOf("Pasadena, inside the SFHA, A2's flood card", pasadena, {
		summary: `${LEAD} AE, inside the Special Flood Hazard Area.` + PASADENA_IDS + ESRI_TAIL,
		unmappedFlag: null,
	}),
	caseOf("New Orleans, outside it, with FEMA's subtype verbatim, A6 row 3", newOrleans, {
		summary:
			`${LEAD} X, outside the Special Flood Hazard Area.` +
			" The zone subtype recorded for this area is Area With Reduced Flood Risk Due To Levee." +
			" FEMA's FIRM study identifier for this area is 22071C." +
			" The flood area ID recorded for this area is 22071C_10770." +
			" The source-citation lookup key recorded for this area is 22071C_STUDY13." +
			ESRI_TAIL,
		unmappedFlag: null,
	}),
	caseOf("an SFHA letter the adapter does not map", unmappedFlag, {
		summary: null,
		unmappedFlag: `${LEAD} AE.` + unmapped("U") + PASADENA_IDS + ESRI_TAIL,
	}),
	caseOf("an empty SFHA column, which this row's siblings prove is a real shape", emptyFlag, {
		summary: null,
		unmappedFlag: `${LEAD} AE.` + unmapped("") + PASADENA_IDS + ESRI_TAIL,
	}),
	caseOf("no DFIRM_ID: the study-identifier clause drops and the zone stands", noStudyId, {
		summary:
			`${LEAD} AE, inside the Special Flood Hazard Area.` +
			" The flood area ID recorded for this area is 48201C_8563." +
			" The source-citation lookup key recorded for this area is 48201C_FIRM1." +
			ESRI_TAIL,
		unmappedFlag: null,
	}),
	caseOf("the NFHL dataset choice, whose label is FEMA's own service", nfhlDataset, {
		summary:
			`${LEAD} AE, inside the Special Flood Hazard Area.` +
			PASADENA_IDS +
			" Read from FEMA's National Flood Hazard Layer.",
		unmappedFlag: null,
	}),
];

/** Which column of the table a template is asserted against, by id and never by position. */
function expectedFor(one: Case, template: Template<"fema-flood-zone">): string | null {
	if (template.id === floodZoneSummary.id) return one.summary;
	if (template.id === floodZoneUnmappedFlag.id) return one.unmappedFlag;
	throw new Error(`no expectation recorded for ${template.id}`);
}

describe("every template against every record the fixtures build", () => {
	it("is two templates, each declaring the SFHA_TF state it speaks about", () => {
		expect(femaTemplates.map((t) => t.id)).toEqual([
			"fema-flood-zone/summary@1",
			"fema-flood-zone/unmapped-flag@1",
		]);
		expect(femaTemplates.every((t) => t.kind === "fema-flood-zone")).toBe(true);
		// A requirement stops the wrong template of a kind rendering the right
		// record, which is a live risk the moment a kind has two: the kind gate
		// passes both, and one of these denies the phrase the other prints.
		expect(floodZoneSummary.requires).toEqual([{ slot: "sfhaLabel", present: true }]);
		expect(floodZoneUnmappedFlag.requires).toEqual([{ slot: "sfhaLabel", present: false }]);
	});

	it("renders the whole cross product: the exact sentence where a template speaks, null where it does not", () => {
		expect(femaTemplates).toHaveLength(2);
		expect(cases).toHaveLength(6);
		for (const template of femaTemplates) {
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
			const rendering = femaTemplates.filter(
				(template) => render(one.store, { scope: "record", recordId: one.record.id, template }) !== null,
			);
			expect(rendering.map((t) => t.id), one.what).toEqual(
				one.summary === null ? [floodZoneUnmappedFlag.id] : [floodZoneSummary.id],
			);
			// And the table itself never expects two sentences for one card.
			expect([one.summary, one.unmappedFlag].filter((s) => s !== null), one.what).toHaveLength(1);
		}
	});

	it("never prints a boolean, a distance, our dataset enum or a panel, and always carries the caveat", () => {
		// The old no-boolean test ran three hand-picked pairs and passed while
		// both SFHA templates rendered over the same row. This one runs them all.
		expect(pasadena.specialFloodHazardArea.value).toBe(true);
		expect(newOrleans.specialFloodHazardArea.value).toBe(false);
		expect(unmappedFlag.specialFloodHazardArea.value).toBeNull();
		expect(emptyFlag.specialFloodHazardArea.value).toBeNull();
		expect(pasadena.distanceMeters).toBeNull();
		for (const template of femaTemplates) {
			for (const one of cases) {
				if (expectedFor(one, template) === null) continue;
				const placement: Placement = { scope: "record", recordId: one.record.id, template };
				const sentence = mustRender(one.store, placement);
				const rendered = textOf(sentence.spans);
				expect(rendered, one.what).not.toMatch(/\b(true|false)\b/i);
				expect(rendered, one.what).not.toContain(" km");
				expect(rendered, one.what).not.toContain("ESRI_REDUCED_SET");
				expect(rendered, one.what).not.toContain("NFHL");
				expect(rendered, one.what).not.toMatch(/\bpanels?\b/i);
				// A5 on the card. C2's forbidden phrase is the claim, not the word.
				expect(rendered, one.what).toContain(LEAD);
				expect(rendered, one.what).not.toMatch(/parcel-level/i);
				expect(verify(one.store, sentence, femaTemplates)).toBe(true);
			}
		}
	});

	it("keeps the record caveat as well, on every record, where the trace can reach it", () => {
		for (const { what, record } of cases) {
			expect(record.caveats, what).toContain(CAVEAT);
		}
	});
});

describe("a null optional field drops its own clause and nothing else", () => {
	it("drops the subtype clause for Pasadena, whose ZONE_SUBTY is null, and keeps the zone", () => {
		expect(pasadena.zoneSubtype.value).toBeNull();
		const placement: Placement = { scope: "record", recordId: pasadena.id, template: floodZoneSummary };
		const spans = mustRender(storeOf([pasadena]), placement).spans;
		expect(spans.flatMap((s) => (s.slot === null ? [] : [s.slot.field]))).toEqual([
			"zoneCode",
			"sfhaLabel",
			"firmStudyId",
			"floodAreaId",
			"sourceCitation",
			"datasetLabel",
		]);
		expect(textOf(spans)).toContain("in zone AE, inside the Special Flood Hazard Area");
		expect(textOf(spans)).not.toContain("subtype");
	});
});

describe("the trace behind a rendered span", () => {
	const pasadenaStore = storeOf([pasadena]);
	const inside: Placement = { scope: "record", recordId: pasadena.id, template: floodZoneSummary };
	const newOrleansStore = storeOf([newOrleans]);
	const outside: Placement = { scope: "record", recordId: newOrleans.id, template: floodZoneSummary };

	it("takes the inside-the-SFHA phrase to SFHA_TF and the letter FEMA sent, not to the zone", () => {
		const t = mustTraceRecord(pasadenaStore, inside, "sfhaLabel");
		expect(t.clicked.field).toBe("sfhaLabel");
		expect(t.clicked.displayed).toBe("inside the Special Flood Hazard Area");
		expect(t.clicked.normalized).toBe("inside the Special Flood Hazard Area");
		expect(t.clicked.provenance[0]).toMatchObject({
			kind: "field",
			dataset: "esri_usa_flood_hazard_reduced_set",
			sourceField: "SFHA_TF",
			rawValue: "T",
			transform: "map-code",
			adapterVersion: "fema@1",
		});
	});

	it("prints the unmapped letter itself, read verbatim from the column it is quoted from", () => {
		const store = storeOf([unmappedFlag]);
		const placement: Placement = { scope: "record", recordId: unmappedFlag.id, template: floodZoneUnmappedFlag };
		const t = mustTraceRecord(store, placement, "sfhaFlag");
		expect(t.clicked.field).toBe("sfhaFlag");
		expect(t.clicked.displayed).toBe("U");
		expect(t.clicked.normalized).toBe("U");
		expect(t.clicked.provenance[0]).toMatchObject({
			kind: "field",
			dataset: "esri_usa_flood_hazard_reduced_set",
			sourceField: "SFHA_TF",
			rawValue: "U",
			transform: "identity",
			adapterVersion: "fema@1",
		});
	});

	it("shows an empty column as an empty pair of quotes, and separates it from a null in the trace", () => {
		const store = storeOf([emptyFlag]);
		const placement: Placement = { scope: "record", recordId: emptyFlag.id, template: floodZoneUnmappedFlag };
		const t = mustTraceRecord(store, placement, "sfhaFlag");
		expect(t.clicked.displayed).toBe("");
		expect(t.clicked.normalized).toBe("");
		expect(t.clicked.provenance[0]).toMatchObject({ sourceField: "SFHA_TF", rawValue: "", transform: "identity" });
		// The same two quotes, and the trace is where the two absences differ.
		expect(textOf(mustRender(store, placement).spans)).toContain('flag recorded for this area is "". Meaning not mapped.');
	});

	it("takes the study identifier to DFIRM_ID, the value FEMA's own description calls a study identifier", () => {
		const t = mustTraceRecord(pasadenaStore, inside, "firmStudyId");
		expect(t.clicked.displayed).toBe("48201C");
		expect(t.clicked.provenance[0]).toMatchObject({
			kind: "field",
			sourceField: "DFIRM_ID",
			rawValue: "48201C",
			transform: "identity",
		});
	});

	it("takes the subtype span to ZONE_SUBTY and the raw string the layer sent", () => {
		const t = mustTraceRecord(newOrleansStore, outside, "zoneSubtype");
		expect(t.clicked.field).toBe("zoneSubtype");
		expect(t.clicked.displayed).toBe("Area With Reduced Flood Risk Due To Levee");
		expect(t.clicked.normalized).toBe("Area With Reduced Flood Risk Due To Levee");
		expect(t.clicked.provenance[0]).toMatchObject({
			kind: "field",
			dataset: "esri_usa_flood_hazard_reduced_set",
			sourceField: "ZONE_SUBTY",
			rawValue: "Area With Reduced Flood Risk Due To Levee",
			adapterVersion: "fema@1",
		});
		expect(t.record.caveats).toContain(CAVEAT);
	});

	it("takes the printed dataset label to the layer that answered, not to a value anyone typed", () => {
		const t = mustTraceRecord(newOrleansStore, outside, "datasetLabel");
		expect(t.clicked.displayed).toBe(
			"Esri's reduced-set copy of FEMA's National Flood Hazard Layer",
		);
		expect(t.clicked.provenance).toEqual([
			{
				kind: "query",
				parameter: "service",
				value: `${FEMA_DATASETS.ESRI_REDUCED_SET.layer}/query`,
				adapterVersion: "fema@1",
				payload: newOrleans.payloads[0],
			},
		]);
	});
});

describe("a record removed from the store leaves no text", () => {
	it("renders null once the flood area is gone, and will not verify the sentence rendered before", () => {
		const store = storeOf([pasadena]);
		const inside: Placement = { scope: "record", recordId: pasadena.id, template: floodZoneSummary };
		const before = mustRender(store, inside);
		const after = store.without(pasadena.id);
		expect(after.get(pasadena.id)).toBeUndefined();
		expect(render(after, inside)).toBeNull();
		expect(verify(after, before, femaTemplates)).toBe(false);
	});
});

