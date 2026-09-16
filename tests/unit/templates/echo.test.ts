/**
 * The ECHO facility templates, against the committed ECHO fixtures.
 *
 * Every record here is built by the real adapter from
 * `echo/facilities-quarter-mi.json` and `echo/facilities-page-quarter-mi.json`
 * served through a stub `SourceIo`, exactly as `tests/unit/adapters/echo.test.ts`
 * does, and then completed by the kernel. So every sentence asserted below is
 * a sentence seven real EPA rows can fill, and the nulls the clause-dropping
 * tests rely on are ECHO's own empty columns.
 *
 * The first describe block is the cross product: every exported template
 * against every one of the seven records, each cell either the exact rendered
 * string or null. Nothing here is hand-picked, so a template that renders over
 * a record it must not speak for shows up as a string where the table says
 * null. That is the test the earlier hand-picked pairs did not make: a
 * per-pair assertion cannot notice the pairs it was never given, which is how
 * `no-status@1` came to state that ECHO reported no compliance status over a
 * row whose status is "Violation Identified".
 *
 * The second block reads that same cross product the other way: the list of
 * templates that speak for each row, asserted per row. A requirement that
 * narrows a template can leave a record with nothing to render, and the matrix
 * on its own does not say so out loud — `noncompliance@1` moved from six rows
 * to one when its `present` requirement became `atLeast: 1`, and that table is
 * what shows the other five rows still have a sentence. It now also asserts
 * that each row gets exactly one PRIMARY, the template that carries its name
 * and its distance.
 *
 * The block after it is the one this file was missing. Five of the six
 * templates opened with the byte-identical clause "{subject}, {distance} from
 * the mapped point.", and the per-template assertions above could never notice:
 * each one reads a single cell, and the defect is between two cells of the same
 * row. `no clause is printed twice on one card` reads a whole row at once and
 * is what holds the primary/secondary split in place.
 *
 * The last block builds a record the recorded bytes do not contain — the
 * Cargill row with `FacLat` and `FacLong` nulled, through the same adapter —
 * because `distanceMeters` is the one slot a primary leads with that can be
 * null, and nothing committed reaches it.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { complete, fieldsOf, recordId, render, storeOf, trace } from "@/lib/evidence";
import type {
	EvidenceStore,
	Fetched,
	JsonValue,
	Locus,
	PayloadRef,
	Placement,
	QueryProvenance,
	RecordId,
	RecordOf,
	Sealed,
	Sentence,
	SourceIo,
	Template,
	Trace,
	ValueTrace,
} from "@/lib/evidence";
import { createEchoAdapter } from "@/lib/adapters/echo";
import {
	echoFacilityFormalAction,
	echoFacilityIndustryCodes,
	echoFacilityNoFormalAction,
	echoFacilityNoncompliance,
	echoFacilityNoStatus,
	echoFacilitySummary,
	echoTemplates,
} from "@/lib/templates/echo";

const fixturesDir = fileURLToPath(new URL("../../fixtures/", import.meta.url));
const RETRIEVED_AT = "2026-09-16T09:00:00Z";
/** The ECHO fixtures were captured at a quarter mile around 9311 E AVE P, HOUSTON, TX. */
const QUARTER_MILE = 402.336;

const CARGILL = "110005085898";
const GRIZZLY = "110070365452";
const PORT_TERMINAL = "110009747514";
const SOUTH_COAST = "110064116987";
const SOUTH_PORT = "110016765277";
const WESTWAY_HOUSTON = "110070369610";
const WESTWAY_LLC = "110035313844";

type EchoRecord = Sealed<RecordOf<"echo-facility">>;

/* -------------------------------------------------------------------------- */
/* Fixture bytes, the real adapter, the kernel                                */
/* -------------------------------------------------------------------------- */

const CensusMatch = z.object({
	result: z.object({ addressMatches: z.array(z.object({ coordinates: z.object({ x: z.number(), y: z.number() }) })) }),
});

function bytesOf(relative: string): Buffer {
	return readFileSync(`${fixturesDir}${relative}`);
}

function payloadOf(url: string, bytes: Buffer): PayloadRef {
	return { url, sha256: createHash("sha256").update(bytes).digest("hex"), retrievedAt: RETRIEVED_AT };
}

/** The mapped point the fixtures were captured around, read from the Census fixture. */
function houstonLocus(): Locus {
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
	return { point, radiusMeters: QUARTER_MILE };
}

/** Serves the two fixtures in call order: the summary call, then the page call. */
function stubIo(fixtures: readonly string[]): SourceIo {
	let index = 0;
	return {
		get<Raw extends JsonValue>(url: URL, schema: z.ZodType<Raw>): Promise<Fetched<Raw>> {
			const name = fixtures[Math.min(index, fixtures.length - 1)];
			index += 1;
			if (name === undefined) return Promise.reject(new Error("no fixture for this call"));
			const bytes = bytesOf(`echo/${name}`);
			return Promise.resolve({
				raw: schema.parse(JSON.parse(bytes.toString("utf8"))),
				payload: payloadOf(url.toString(), bytes),
			});
		},
		query(parameter, value, adapterVersion, payload): QueryProvenance {
			return { kind: "query", parameter, value, adapterVersion, payload };
		},
		now(): string {
			return RETRIEVED_AT;
		},
	};
}

const locus = houstonLocus();

async function echoRecords(): Promise<readonly EchoRecord[]> {
	const io = stubIo(["facilities-quarter-mi.json", "facilities-page-quarter-mi.json"]);
	const built = await createEchoAdapter({ retryDelayMs: 0 }).run(locus, io);
	return built.map((b) => complete(locus, b));
}

const records = await echoRecords();
const store: EvidenceStore = storeOf(records);

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function echoId(registryId: string): RecordId<"echo-facility"> {
	return recordId("echo-facility", registryId);
}

function placement(registryId: string, template: Template<"echo-facility">): Placement {
	return { scope: "record", recordId: echoId(registryId), template };
}

function text(sentence: Sentence): string {
	return sentence.spans.map((span) => span.text).join("");
}

function mustRender(registryId: string, template: Template<"echo-facility">, from: EvidenceStore = store): Sentence {
	const sentence = render(from, placement(registryId, template));
	if (sentence === null) throw new Error(`expected a sentence for ${registryId} from ${template.id}`);
	return sentence;
}

function rendered(registryId: string, template: Template<"echo-facility">): string {
	return text(mustRender(registryId, template));
}

/** The whole rendered string, or null, for one (record, template) pair. */
function cell(registryId: string, template: Template<"echo-facility">, from: EvidenceStore = store): string | null {
	const sentence = render(from, placement(registryId, template));
	return sentence === null ? null : text(sentence);
}

type Row = Readonly<Record<string, string | null>>;

/** Every exported template against one record: the cross product, one row of it. */
function rowFor(registryId: string, from: EvidenceStore = store): Row {
	const row: Record<string, string | null> = {};
	for (const template of echoTemplates) row[template.id] = cell(registryId, template, from);
	return row;
}

function mustTrace(sentence: Sentence, spanIndex: number): Extract<Trace, { scope: "record" }> {
	const t = trace(store, sentence, spanIndex);
	if (t === null) throw new Error(`expected a trace for span ${spanIndex}`);
	if (t.scope !== "record") throw new Error(`expected a record-scoped trace, got ${t.scope}`);
	return t;
}

function valueOf(t: Extract<Trace, { scope: "record" }>, field: string): ValueTrace {
	const found = t.values.find((value) => value.field === field);
	if (found === undefined) throw new Error(`no traced value for ${field}`);
	return found;
}

type RawField = { readonly dataset: string; readonly sourceField: string; readonly rawValue: JsonValue };

function rawOf(value: ValueTrace): RawField {
	const [head] = value.provenance;
	if (head === undefined || head.kind !== "field") throw new Error(`${value.field} has no field provenance`);
	return { dataset: head.dataset, sourceField: head.sourceField, rawValue: head.rawValue };
}

/**
 * The two templates that carry a card's lead: the facility's name and its
 * distance from the mapped point. They are disjoint on `complianceStatus`, so
 * a record has exactly one of them.
 */
const PRIMARY = [echoFacilitySummary, echoFacilityNoStatus];

/** Everything else: no name-and-distance clause, the facility named inside its own clauses. */
const SECONDARY = [
	echoFacilityFormalAction,
	echoFacilityNoFormalAction,
	echoFacilityNoncompliance,
	echoFacilityIndustryCodes,
];

/** The clauses of a rendered sentence. No clause here contains ". " inside itself. */
function clausesOf(sentence: string): readonly string[] {
	return sentence.split(". ").map((clause, index, all) => (index === all.length - 1 ? clause : `${clause}.`));
}

/** Every clause printed on one card: every template that renders over the row, in registry order. */
function cardClauses(registryId: string): readonly string[] {
	const out: string[] = [];
	for (const [, sentence] of Object.entries(rowFor(registryId))) {
		if (sentence === null) continue;
		out.push(...clausesOf(sentence));
	}
	return out;
}

/* -------------------------------------------------------------------------- */
/* The cross product                                                          */
/* -------------------------------------------------------------------------- */

describe("echo templates: every template against every fixture row", () => {
	it("builds the seven real facilities the templates are written for", () => {
		expect(records.map((record) => record.sourceRecordId)).toEqual([
			CARGILL,
			GRIZZLY,
			PORT_TERMINAL,
			SOUTH_COAST,
			SOUTH_PORT,
			WESTWAY_HOUSTON,
			WESTWAY_LLC,
		]);
		expect(store.size).toBe(7);
	});

	it("exports every template in echoTemplates, all of them bound to echo-facility", () => {
		expect(echoTemplates).toEqual([
			echoFacilitySummary,
			echoFacilityFormalAction,
			echoFacilityNoFormalAction,
			echoFacilityNoncompliance,
			echoFacilityNoStatus,
			echoFacilityIndustryCodes,
		]);
		expect(echoTemplates.map((template) => template.id)).toEqual([
			"echo-facility/summary@1",
			"echo-facility/formal-action@1",
			"echo-facility/no-formal-action@1",
			"echo-facility/noncompliance@1",
			"echo-facility/no-status@1",
			"echo-facility/industry-codes@1",
		]);
		for (const template of echoTemplates) expect(template.kind).toBe("echo-facility");
	});

	it("declares, on each template, the state it is allowed to speak about", () => {
		expect(echoTemplates.map((template) => [template.id, template.requires])).toEqual([
			["echo-facility/summary@1", [{ slot: "complianceStatus", present: true }]],
			["echo-facility/formal-action@1", [{ slot: "lastFormalActionDate", present: true }]],
			["echo-facility/no-formal-action@1", [{ slot: "lastFormalActionDate", present: false }]],
			["echo-facility/noncompliance@1", [{ slot: "quartersInNoncompliance", atLeast: 1 }]],
			["echo-facility/no-status@1", [{ slot: "complianceStatus", present: false }]],
			["echo-facility/industry-codes@1", []],
		]);
	});

	it("renders exactly these strings, and null where the record is in no state to be spoken for", () => {
		const matrix: Record<string, Row> = {};
		for (const record of records) matrix[record.sourceRecordId] = rowFor(record.sourceRecordId);

		expect(matrix).toEqual({
			[CARGILL]: {
				"echo-facility/summary@1":
					"CARGILL INCORPORATED, registry ID 110005085898." +
					" 0.22 km from the mapped point." +
					" Compliance status in ECHO's twelve-quarter history: No Violation Identified.",
				"echo-facility/formal-action@1": null,
				"echo-facility/no-formal-action@1":
					"For CARGILL INCORPORATED, ECHO's facility summary carries no formal enforcement action date.",
				// FacQtrsWithNC is "0": the template named for noncompliance stays off it.
				"echo-facility/noncompliance@1": null,
				"echo-facility/no-status@1": null,
				"echo-facility/industry-codes@1":
					"NAICS codes ECHO lists for CARGILL INCORPORATED: 311119." +
					" SIC codes ECHO lists for CARGILL INCORPORATED: 2048 5171.",
			},
			[GRIZZLY]: {
				"echo-facility/summary@1":
					"GRIZZLY VAEVSERVICES, registry ID 110070365452." +
					" 0.29 km from the mapped point." +
					" Compliance status in ECHO's twelve-quarter history: No Violation Identified.",
				"echo-facility/formal-action@1": null,
				"echo-facility/no-formal-action@1":
					"For GRIZZLY VAEVSERVICES, ECHO's facility summary carries no formal enforcement action date.",
				// FacQtrsWithNC is "0": the template named for noncompliance stays off it.
				"echo-facility/noncompliance@1": null,
				"echo-facility/no-status@1": null,
				"echo-facility/industry-codes@1": "SIC codes ECHO lists for GRIZZLY VAEVSERVICES: 3599.",
			},
			[PORT_TERMINAL]: {
				"echo-facility/summary@1":
					"PORT TERMINAL FACILITY, registry ID 110009747514." +
					" 0.27 km from the mapped point." +
					" Compliance status in ECHO's twelve-quarter history: Violation Identified.",
				"echo-facility/formal-action@1": null,
				"echo-facility/no-formal-action@1":
					"For PORT TERMINAL FACILITY, ECHO's facility summary carries no formal enforcement action date.",
				// The status clause is summary@1's, which renders over this same row.
				"echo-facility/noncompliance@1":
					"Quarters of noncompliance in ECHO's twelve-quarter history for PORT TERMINAL FACILITY: 6." +
					" ECHO's significant noncompliance flag: N.",
				// The row the old no-status@1 stated a falsehood over.
				"echo-facility/no-status@1": null,
				"echo-facility/industry-codes@1": "SIC codes ECHO lists for PORT TERMINAL FACILITY: 4226 5171.",
			},
			[SOUTH_COAST]: {
				// The formal-action date is formal-action@1's clause and only its:
				// both templates render over this row.
				"echo-facility/summary@1":
					"SOUTH COAST TERMINALS PTF, registry ID 110064116987." +
					" 0.23 km from the mapped point." +
					" Compliance status in ECHO's twelve-quarter history: No Violation Identified.",
				"echo-facility/formal-action@1":
					"Most recent formal enforcement action in ECHO's facility summary for SOUTH COAST TERMINALS PTF: 2024-08-12." +
					" Penalties counted in ECHO's facility summary: 1." +
					" Most recent penalty date in ECHO's facility summary: 2024-08-12." +
					" Amount of the most recent penalty in ECHO's facility summary: $0.",
				"echo-facility/no-formal-action@1": null,
				// FacQtrsWithNC is "0": the template named for noncompliance stays off it.
				"echo-facility/noncompliance@1": null,
				"echo-facility/no-status@1": null,
				"echo-facility/industry-codes@1": "NAICS codes ECHO lists for SOUTH COAST TERMINALS PTF: 424710.",
			},
			[SOUTH_PORT]: {
				// An abbreviation's period kept before a comma. Standard English, not a defect.
				"echo-facility/summary@1":
					"SOUTH-PORT SYSTEMS, INC., registry ID 110016765277." +
					" 0.30 km from the mapped point." +
					" Compliance status in ECHO's twelve-quarter history: No Violation Identified.",
				"echo-facility/formal-action@1": null,
				// The one row whose name ends in a period, and no clause ends on it.
				"echo-facility/no-formal-action@1":
					"For SOUTH-PORT SYSTEMS, INC., ECHO's facility summary carries no formal enforcement action date.",
				// FacQtrsWithNC is "0": the template named for noncompliance stays off it.
				"echo-facility/noncompliance@1": null,
				"echo-facility/no-status@1": null,
				// Both code columns null, and a secondary has no lead clause to fall back on.
				"echo-facility/industry-codes@1": null,
			},
			[WESTWAY_HOUSTON]: {
				"echo-facility/summary@1":
					"WESTWAY FEED PRODUCTS HOUSTON, registry ID 110070369610." +
					" 0.22 km from the mapped point." +
					" Compliance status in ECHO's twelve-quarter history: No Violation Identified.",
				"echo-facility/formal-action@1": null,
				"echo-facility/no-formal-action@1":
					"For WESTWAY FEED PRODUCTS HOUSTON, ECHO's facility summary carries no formal enforcement action date.",
				// FacQtrsWithNC is "0": the template named for noncompliance stays off it.
				"echo-facility/noncompliance@1": null,
				"echo-facility/no-status@1": null,
				"echo-facility/industry-codes@1": "SIC codes ECHO lists for WESTWAY FEED PRODUCTS HOUSTON: 2048.",
			},
			[WESTWAY_LLC]: {
				// FacComplianceStatus and FacQtrsWithNC are both null on this row.
				"echo-facility/summary@1": null,
				"echo-facility/formal-action@1": null,
				"echo-facility/no-formal-action@1":
					"For WESTWAY FEED PRODUCTS LLC, ECHO's facility summary carries no formal enforcement action date.",
				"echo-facility/noncompliance@1": null,
				// The one row whose primary is no-status@1: it carries the name and the distance.
				"echo-facility/no-status@1":
					"WESTWAY FEED PRODUCTS LLC, registry ID 110035313844:" +
					" EPA ECHO's facility summary carries no compliance status." +
					" 0.22 km from the mapped point.",
				"echo-facility/industry-codes@1": "NAICS codes ECHO lists for WESTWAY FEED PRODUCTS LLC: 311119.",
			},
		});
	});

	it("never prints true or false, over the whole cross product", () => {
		// A boolean slot decides which template renders; it is never a word on
		// screen. Asserted over every pair, not over hand-picked ones.
		for (const record of records) {
			for (const [id, sentence] of Object.entries(rowFor(record.sourceRecordId))) {
				if (sentence === null) continue;
				expect(`${record.sourceRecordId} ${id}: ${sentence}`).not.toMatch(/\b(true|false)\b/);
			}
		}
	});
});

/* -------------------------------------------------------------------------- */
/* The partition                                                              */
/* -------------------------------------------------------------------------- */

describe("echo templates: the requirements partition the seven rows", () => {
	it("gives every row exactly one primary, the template that names it and places it", () => {
		// A secondary renders null when every clause drops, which is correct and
		// wanted — so the thing that must never be empty is the primary. Six rows
		// get summary@1 and the seventh, whose FacComplianceStatus is null, gets
		// no-status@1.
		const primaryOf: Record<string, readonly string[]> = {};
		for (const record of records) {
			const row = rowFor(record.sourceRecordId);
			primaryOf[record.sourceRecordId] = PRIMARY.filter((template) => row[template.id] !== null).map(
				(template) => template.id,
			);
		}
		expect(primaryOf).toEqual({
			[CARGILL]: ["echo-facility/summary@1"],
			[GRIZZLY]: ["echo-facility/summary@1"],
			[PORT_TERMINAL]: ["echo-facility/summary@1"],
			[SOUTH_COAST]: ["echo-facility/summary@1"],
			[SOUTH_PORT]: ["echo-facility/summary@1"],
			[WESTWAY_HOUSTON]: ["echo-facility/summary@1"],
			[WESTWAY_LLC]: ["echo-facility/no-status@1"],
		});
	});

	it("names, per row, exactly which templates speak for it", () => {
		// Narrowing noncompliance@1 to at least one quarter takes it off five of
		// the seven rows, so this is the table that proves none of them was left
		// with nothing to render. Every row keeps one status template and one
		// formal-action template whatever its quarters count is.
		const spoken: Record<string, readonly string[]> = {};
		for (const record of records) {
			spoken[record.sourceRecordId] = Object.entries(rowFor(record.sourceRecordId))
				.filter(([, sentence]) => sentence !== null)
				.map(([id]) => id);
		}
		expect(spoken).toEqual({
			[CARGILL]: [
				"echo-facility/summary@1",
				"echo-facility/no-formal-action@1",
				"echo-facility/industry-codes@1",
			],
			[GRIZZLY]: [
				"echo-facility/summary@1",
				"echo-facility/no-formal-action@1",
				"echo-facility/industry-codes@1",
			],
			[PORT_TERMINAL]: [
				"echo-facility/summary@1",
				"echo-facility/no-formal-action@1",
				"echo-facility/noncompliance@1",
				"echo-facility/industry-codes@1",
			],
			[SOUTH_COAST]: [
				"echo-facility/summary@1",
				"echo-facility/formal-action@1",
				"echo-facility/industry-codes@1",
			],
			// Both industry columns null, so the one template with no requirement
			// still renders nothing: this row is spoken for by the other two.
			[SOUTH_PORT]: ["echo-facility/summary@1", "echo-facility/no-formal-action@1"],
			[WESTWAY_HOUSTON]: [
				"echo-facility/summary@1",
				"echo-facility/no-formal-action@1",
				"echo-facility/industry-codes@1",
			],
			[WESTWAY_LLC]: [
				"echo-facility/no-formal-action@1",
				"echo-facility/no-status@1",
				"echo-facility/industry-codes@1",
			],
		});
	});

	it("never lets the stated-absence wording meet the value it denies", () => {
		for (const record of records) {
			const row = rowFor(record.sourceRecordId);
			// A status is either printed or reported missing, never both and never neither.
			const hasStatus = record.complianceStatus.value !== null;
			expect(row["echo-facility/summary@1"] !== null).toBe(hasStatus);
			expect(row["echo-facility/no-status@1"] !== null).toBe(!hasStatus);
			// The same for the formal-action date, one column over.
			const hasAction = record.lastFormalActionDate.value !== null;
			expect(row["echo-facility/formal-action@1"] !== null).toBe(hasAction);
			expect(row["echo-facility/no-formal-action@1"] !== null).toBe(!hasAction);
		}
	});

	it("renders noncompliance@1 over a quarter of noncompliance and over nothing else", () => {
		// `present` was satisfied by the value 0 and put "Quarters of
		// noncompliance ...: 0." on five facilities that have none. The threshold
		// is the one lib/templates/sections.ts counts with, so the count and the
		// list describe one set.
		expect(records.map((record) => record.quartersInNoncompliance.value)).toEqual([0, 0, 6, 0, 0, 0, null]);
		for (const record of records) {
			const quarters = record.quartersInNoncompliance.value;
			const noncompliance = cell(record.sourceRecordId, echoFacilityNoncompliance);
			expect(noncompliance !== null).toBe(quarters !== null && quarters >= 1);
		}
		expect(records.filter((record) => (record.quartersInNoncompliance.value ?? 0) >= 1)).toHaveLength(1);
		expect(rendered(PORT_TERMINAL, echoFacilityNoncompliance)).toBe(
			"Quarters of noncompliance in ECHO's twelve-quarter history for PORT TERMINAL FACILITY: 6." +
				" ECHO's significant noncompliance flag: N.",
		);
	});

	it("says what every distance is measured from", () => {
		for (const record of records) {
			for (const [, sentence] of Object.entries(rowFor(record.sourceRecordId))) {
				if (sentence === null) continue;
				const kilometres = /\d+\.\d{2} km/.exec(sentence);
				if (kilometres === null) continue;
				expect(sentence).toContain(`${kilometres[0]} from the mapped point`);
			}
		}
	});
});

/* -------------------------------------------------------------------------- */
/* One card, no clause twice                                                  */
/* -------------------------------------------------------------------------- */

describe("echo templates: primary and secondary", () => {
	it("prints no clause twice on one card", () => {
		// The defect this split exists to fix. Five of the six templates opened
		// with the byte-identical clause "{subject}, {distance} from the mapped
		// point.", and on five of the seven rows both summary@1 and
		// no-formal-action@1 render, so the name and the distance printed twice.
		// Two more clauses were shared: the formal-action date between summary@1
		// and formal-action@1 (both render over SOUTH COAST TERMINALS PTF) and the
		// compliance status between summary@1 and noncompliance@1 (both render
		// over PORT TERMINAL FACILITY).
		for (const record of records) {
			const clauses = cardClauses(record.sourceRecordId);
			expect(clauses).toEqual([...new Set(clauses)]);
		}
	});

	it("prints the distance from exactly one template per card, and that one is the primary", () => {
		for (const record of records) {
			const placing: string[] = [];
			for (const [id, sentence] of Object.entries(rowFor(record.sourceRecordId))) {
				if (sentence !== null && sentence.includes(" km from the mapped point")) placing.push(id);
			}
			expect(placing).toHaveLength(1);
			expect(PRIMARY.map((template) => template.id)).toContain(placing[0]);
		}
		for (const template of SECONDARY) {
			for (const record of records) {
				const sentence = cell(record.sourceRecordId, template);
				if (sentence === null) continue;
				expect(sentence).not.toContain("from the mapped point");
			}
		}
	});

	it("names the facility in every secondary clause that can be the only one left", () => {
		// A secondary reads correctly wherever a card places it because the clause
		// its requirement guarantees names the facility. industry-codes@1
		// guarantees none — either column can be null — so both of its clauses do.
		for (const record of records) {
			const subject = record.subject.value;
			for (const template of SECONDARY) {
				const sentence = cell(record.sourceRecordId, template);
				if (sentence === null) continue;
				expect(sentence).toContain(subject);
				const [lead] = clausesOf(sentence);
				expect(lead).toContain(subject);
			}
			const codes = cell(record.sourceRecordId, echoFacilityIndustryCodes);
			if (codes === null) continue;
			for (const clause of clausesOf(codes)) expect(clause).toContain(subject);
		}
	});

	it("lets a secondary render null and still leaves the row a primary", () => {
		// SOUTH-PORT SYSTEMS, INC. has both industry columns null, so
		// industry-codes@1 renders nothing at all. That is correct and wanted.
		expect(cell(SOUTH_PORT, echoFacilityIndustryCodes)).toBeNull();
		expect(cell(SOUTH_PORT, echoFacilitySummary)).not.toBeNull();
	});
});

/* -------------------------------------------------------------------------- */
/* Wording                                                                    */
/* -------------------------------------------------------------------------- */

describe("echo templates: what each sentence is allowed to claim", () => {
	it("bounds every compliance status by the twelve quarters the column covers", () => {
		// The record's own caveat says so and reaches only the trace; C2 forbids
		// "Real-time environmental history"; sections.ts uses this same phrase.
		expect(records[0]?.caveats).toContain(
			"Compliance status covers the last twelve quarters of federally reported data and is not a statement about conditions today.",
		);
		for (const record of records) {
			for (const [, sentence] of Object.entries(rowFor(record.sourceRecordId))) {
				if (sentence === null || !sentence.includes("Compliance status")) continue;
				expect(sentence).toContain("Compliance status in ECHO's twelve-quarter history: ");
			}
		}
	});

	it("bounds every enforcement and penalty column by the summary it was read from", () => {
		// ECHO's metadata returns Description: null for FAC_PENALTY_COUNT, so
		// nothing retrieved supports "on record", which reads as all-time.
		const formalAction = rendered(SOUTH_COAST, echoFacilityFormalAction);
		expect(formalAction).toContain("Penalties counted in ECHO's facility summary: 1.");
		expect(formalAction).not.toContain("on record");
		for (const record of records) {
			for (const [, sentence] of Object.entries(rowFor(record.sourceRecordId))) {
				if (sentence === null) continue;
				for (const clause of sentence.split(". ")) {
					if (!/penalt|enforcement action/i.test(clause)) continue;
					expect(clause).toContain("ECHO's facility summary");
				}
			}
		}
	});

	it("names the penalty-amount column rather than asserting an amount was assessed", () => {
		// FacLastPenaltyAmt is the string "$0" on all seven rows, six of which
		// have FacPenaltyCount and FacDateLastPenalty null: facilities with no
		// penalty at all. The date is a clause of its own for the same reason.
		expect(records.map((record) => record.lastPenaltyAmountUsd.value)).toEqual([0, 0, 0, 0, 0, 0, 0]);
		expect(records.filter((record) => record.penaltyCount.value === null)).toHaveLength(6);
		expect(rendered(SOUTH_COAST, echoFacilityFormalAction)).toContain(
			"Most recent penalty date in ECHO's facility summary: 2024-08-12." +
				" Amount of the most recent penalty in ECHO's facility summary: $0.",
		);
	});

	it("prints each industry column as the list of codes it is", () => {
		// FacSICCodes is "2048 5171" in the real bytes: two codes in one string.
		expect(records[0]?.sicCodes.value).toBe("2048 5171");
		expect(rendered(CARGILL, echoFacilityIndustryCodes)).toBe(
			"NAICS codes ECHO lists for CARGILL INCORPORATED: 311119." +
				" SIC codes ECHO lists for CARGILL INCORPORATED: 2048 5171.",
		);
	});

	it("prints every status verbatim, in ECHO's capitalization and ECHO's words", () => {
		// One assertion per record, against that record's own status: the earlier
		// version of this test looped over the seven statuses while re-rendering
		// one facility, so six of its seven iterations asserted nothing new.
		const statuses = records.map((record) => record.complianceStatus.value);
		expect(statuses).toEqual([
			"No Violation Identified",
			"No Violation Identified",
			"Violation Identified",
			"No Violation Identified",
			"No Violation Identified",
			"No Violation Identified",
			null,
		]);
		for (const record of records) {
			const status = record.complianceStatus.value;
			const summary = cell(record.sourceRecordId, echoFacilitySummary);
			if (status === null) {
				expect(summary).toBeNull();
				expect(cell(record.sourceRecordId, echoFacilityNoStatus)).toContain(
					"EPA ECHO's facility summary carries no compliance status",
				);
				continue;
			}
			expect(summary).toContain(`Compliance status in ECHO's twelve-quarter history: ${status}.`);
			expect(summary).not.toContain(status.toLowerCase());
		}
	});
});

/* -------------------------------------------------------------------------- */
/* Clause dropping                                                            */
/* -------------------------------------------------------------------------- */

describe("echo templates: a missing field takes its clause and nothing else", () => {
	it("keeps the formal-action date in the one template named for it", () => {
		// FacDateLastFormalAction is null on six of the seven rows, and the clause
		// used to stand in summary@1 as well. On SOUTH COAST TERMINALS PTF both
		// templates render, so the same date printed twice on one card.
		expect(records.filter((record) => record.lastFormalActionDate.value === null)).toHaveLength(6);
		expect(rendered(SOUTH_COAST, echoFacilitySummary)).not.toContain("formal enforcement action");
		expect(rendered(SOUTH_COAST, echoFacilityFormalAction)).toContain(
			"Most recent formal enforcement action in ECHO's facility summary for SOUTH COAST TERMINALS PTF: 2024-08-12.",
		);
		// And the row with no date has the absence stated once, by one template.
		expect(rendered(CARGILL, echoFacilityNoFormalAction)).toBe(
			"For CARGILL INCORPORATED, ECHO's facility summary carries no formal enforcement action date.",
		);
	});

	it("drops the significant-noncompliance clause and leaves the quarters count standing", () => {
		// FacSNCFlg is "N" on the one row noncompliance@1 speaks for, so the
		// clause-dropping proof for this template is the industry one below and
		// the coordinate one at the end of the file; what is asserted here is that
		// the count clause carries the name, so a drop can never unname the row.
		expect(rendered(PORT_TERMINAL, echoFacilityNoncompliance)).toBe(
			"Quarters of noncompliance in ECHO's twelve-quarter history for PORT TERMINAL FACILITY: 6." +
				" ECHO's significant noncompliance flag: N.",
		);
	});

	it("drops one industry system's clause and keeps the other", () => {
		// FacSICCodes is null for SOUTH COAST TERMINALS PTF and FacNAICSCodes is
		// null for PORT TERMINAL FACILITY.
		expect(rendered(SOUTH_COAST, echoFacilityIndustryCodes)).toBe(
			"NAICS codes ECHO lists for SOUTH COAST TERMINALS PTF: 424710.",
		);
		expect(rendered(PORT_TERMINAL, echoFacilityIndustryCodes)).toBe(
			"SIC codes ECHO lists for PORT TERMINAL FACILITY: 4226 5171.",
		);
		// Both columns null: with no lead clause to fall back on, the whole
		// template renders null instead of a facility name that says nothing.
		expect(cell(SOUTH_PORT, echoFacilityIndustryCodes)).toBeNull();
	});
});

/* -------------------------------------------------------------------------- */
/* The record is the only thing holding the sentence up                       */
/* -------------------------------------------------------------------------- */

describe("echo templates: the record is the only thing holding the sentence up", () => {
	it("renders null for every template of every record once that record leaves the store", () => {
		// Every row, not one row seven times: the earlier version removed a single
		// facility and looped over the templates.
		for (const record of records) {
			const id = record.sourceRecordId;
			const without = store.without(echoId(id));
			expect(without.size).toBe(6);
			for (const template of echoTemplates) {
				expect(render(without, placement(id, template))).toBeNull();
			}
			// Every other record in that store is untouched.
			for (const other of records) {
				if (other.sourceRecordId === id) continue;
				expect(rowFor(other.sourceRecordId, without)).toEqual(rowFor(other.sourceRecordId));
			}
		}
	});

	it("renders null for a registry ID no ECHO row carried", () => {
		expect(render(store, placement("110000000000", echoFacilitySummary))).toBeNull();
	});
});

/* -------------------------------------------------------------------------- */
/* The trace behind a span                                                    */
/* -------------------------------------------------------------------------- */

describe("echo templates: the trace behind a span", () => {
	it("traces the quarters count to FacQtrsWithNC and the string ECHO sent", () => {
		const sentence = mustRender(PORT_TERMINAL, echoFacilityNoncompliance);
		const index = sentence.spans.findIndex((span) => span.slot?.field === "quartersInNoncompliance");
		expect(sentence.spans[index]?.text).toBe("6");

		const t = mustTrace(sentence, index);
		expect(t.clicked.field).toBe("quartersInNoncompliance");
		expect(t.clicked.displayed).toBe("6");
		expect(t.clicked.normalized).toBe(6);
		expect(rawOf(t.clicked)).toEqual({
			dataset: "echo_get_qid",
			sourceField: "FacQtrsWithNC",
			// ECHO sends no JSON numbers. The record holds 6; the trace holds "6".
			rawValue: "6",
		});
		expect(t.record.agency).toBe("EPA Enforcement and Compliance History Online");
		expect(t.record.sourceRecordId).toBe(PORT_TERMINAL);
	});

	it("prints ECHO's dollar sign on screen and keeps the raw string in the trace", () => {
		// formatValue's currency-dollar format restores the $ that ECHO's own
		// column carries and that parse-currency strips to make the number; the
		// raw string in the trace is unaffected by how the span is displayed.
		// See the "a real penalty amount" block below for the grouping this
		// format adds once the amount is not zero.
		const sentence = mustRender(SOUTH_COAST, echoFacilityFormalAction);
		const index = sentence.spans.findIndex((span) => span.slot?.field === "lastPenaltyAmountUsd");
		expect(sentence.spans[index]?.text).toBe("$0");

		const t = mustTrace(sentence, index);
		expect(t.clicked.displayed).toBe("$0");
		expect(rawOf(t.clicked)).toEqual({
			dataset: "echo_get_qid",
			sourceField: "FacLastPenaltyAmt",
			rawValue: "$0",
		});
	});

	it("reaches the four statute columns from the trace although no clause can name them", () => {
		// programStatuses is a container of Sourced leaves, not a slot: the
		// sentence cannot print a programme, and the trace panel still shows all four.
		const sentence = mustRender(PORT_TERMINAL, echoFacilityNoncompliance);
		// The clause now opens with connective text, so the subject span is not
		// span 0 and a trace is taken from the span that has a slot.
		const index = sentence.spans.findIndex((span) => span.slot?.field === "subject");
		const t = mustTrace(sentence, index);
		expect(rawOf(valueOf(t, "programStatuses.CWA"))).toEqual({
			dataset: "echo_get_qid",
			sourceField: "CWAComplianceStatus",
			rawValue: "Violation Identified",
		});
		expect(rawOf(valueOf(t, "programStatuses.SDWA")).rawValue).toBeNull();
		for (const programme of ["CAA", "CWA", "RCRA", "SDWA"]) {
			expect(valueOf(t, `programStatuses.${programme}`).displayed).toBeNull();
		}
	});
});

/* -------------------------------------------------------------------------- */
/* The one null a primary's lead can hit                                      */
/* -------------------------------------------------------------------------- */

/** Any non-null, non-array object, read by string key. */
function isBag(x: unknown): x is Record<string, unknown> {
	return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isList(x: unknown): x is readonly unknown[] {
	return Array.isArray(x);
}

/**
 * The committed page bytes with `FacLat` and `FacLong` emptied on the named
 * rows. Both are `z.string().nullable()` in `lib/adapters/echo.ts`, so this is
 * a response ECHO's own schema accepts; it goes through the same adapter and
 * the same `complete`, and nothing about the record is written by hand.
 */
function pageBytesWithoutCoordinates(registryIds: readonly string[]): Buffer {
	const parsed: unknown = JSON.parse(bytesOf("echo/facilities-page-quarter-mi.json").toString("utf8"));
	if (!isBag(parsed)) throw new Error("page fixture is not an object");
	const results = parsed["Results"];
	if (!isBag(results)) throw new Error("page fixture carries no Results");
	const facilities = results["Facilities"];
	if (!isList(facilities)) throw new Error("page fixture carries no Facilities");
	const rows = facilities.map((row: unknown) => {
		if (!isBag(row)) throw new Error("page fixture row is not an object");
		const id = row["RegistryID"];
		if (typeof id !== "string" || !registryIds.includes(id)) return row;
		return { ...row, FacLat: null, FacLong: null };
	});
	return Buffer.from(JSON.stringify({ ...parsed, Results: { ...results, Facilities: rows } }), "utf8");
}

/** The same stub as `stubIo`, over bytes held here rather than read from a path. */
function stubIoOver(calls: readonly Buffer[]): SourceIo {
	let index = 0;
	return {
		get<Raw extends JsonValue>(url: URL, schema: z.ZodType<Raw>): Promise<Fetched<Raw>> {
			const bytes = calls[Math.min(index, calls.length - 1)];
			index += 1;
			if (bytes === undefined) return Promise.reject(new Error("no bytes for this call"));
			return Promise.resolve({
				raw: schema.parse(JSON.parse(bytes.toString("utf8"))),
				payload: payloadOf(url.toString(), bytes),
			});
		},
		query(parameter, value, adapterVersion, payload): QueryProvenance {
			return { kind: "query", parameter, value, adapterVersion, payload };
		},
		now(): string {
			return RETRIEVED_AT;
		},
	};
}

async function storeWithoutCoordinates(registryIds: readonly string[]): Promise<EvidenceStore> {
	const io = stubIoOver([bytesOf("echo/facilities-quarter-mi.json"), pageBytesWithoutCoordinates(registryIds)]);
	const built = await createEchoAdapter({ retryDelayMs: 0 }).run(locus, io);
	return storeOf(built.map((b) => complete(locus, b)));
}

describe("echo templates: a facility ECHO sent no coordinate for", () => {
	it("keeps the facility named when the distance clause drops", async () => {
		// distanceMeters is the only slot either primary leads with that can be
		// null: no FacLat and no FacLong means no location, and `complete` then
		// leaves distanceMeters null. While the name and the distance shared one
		// clause, that null took the clause and summary@1 collapsed to a
		// compliance status with no facility named at all.
		const without = await storeWithoutCoordinates([CARGILL, WESTWAY_LLC]);
		expect(without.size).toBe(7);
		expect(without.get(echoId(CARGILL))?.distanceMeters).toBeNull();
		expect(without.get(echoId(WESTWAY_LLC))?.distanceMeters).toBeNull();

		expect(cell(CARGILL, echoFacilitySummary, without)).toBe(
			"CARGILL INCORPORATED, registry ID 110005085898." +
				" Compliance status in ECHO's twelve-quarter history: No Violation Identified.",
		);
		expect(cell(WESTWAY_LLC, echoFacilityNoStatus, without)).toBe(
			"WESTWAY FEED PRODUCTS LLC, registry ID 110035313844:" +
				" EPA ECHO's facility summary carries no compliance status.",
		);
	});

	it("takes the distance off only the rows ECHO sent no coordinate for", async () => {
		const without = await storeWithoutCoordinates([CARGILL]);
		expect(without.get(echoId(GRIZZLY))?.distanceMeters?.value).toBeGreaterThan(0);
		expect(rowFor(GRIZZLY, without)).toEqual(rowFor(GRIZZLY));
		// And the coordinate-less row keeps every clause that is not the distance.
		expect(rowFor(CARGILL, without)).toEqual({
			"echo-facility/summary@1":
				"CARGILL INCORPORATED, registry ID 110005085898." +
				" Compliance status in ECHO's twelve-quarter history: No Violation Identified.",
			"echo-facility/formal-action@1": null,
			"echo-facility/no-formal-action@1":
				"For CARGILL INCORPORATED, ECHO's facility summary carries no formal enforcement action date.",
			"echo-facility/noncompliance@1": null,
			"echo-facility/no-status@1": null,
			"echo-facility/industry-codes@1":
				"NAICS codes ECHO lists for CARGILL INCORPORATED: 311119." +
				" SIC codes ECHO lists for CARGILL INCORPORATED: 2048 5171.",
		});
	});
});

/* -------------------------------------------------------------------------- */
/* A real penalty amount                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The committed page bytes with `FacLastPenaltyAmt` replaced on one row.
 * `FacLastPenaltyAmt` is `"$0"` on all seven recorded facilities, so no
 * committed row can prove the currency display groups a non-zero amount --
 * this is that claim about the template, never a claim about what ECHO
 * sends, which is why it is one field of the real bytes altered here rather
 * than a new fixture (the same reasoning `tests/fixtures/README.md` gives for
 * every `derived-` file, and the same technique `withoutObservationCount` in
 * `tests/unit/templates/aqs.test.ts` uses for its own single-column claim).
 */
function pageBytesWithPenaltyAmount(registryId: string, amount: string): Buffer {
	const parsed: unknown = JSON.parse(bytesOf("echo/facilities-page-quarter-mi.json").toString("utf8"));
	if (!isBag(parsed)) throw new Error("page fixture is not an object");
	const results = parsed["Results"];
	if (!isBag(results)) throw new Error("page fixture carries no Results");
	const facilities = results["Facilities"];
	if (!isList(facilities)) throw new Error("page fixture carries no Facilities");
	const rows = facilities.map((row: unknown) => {
		if (!isBag(row)) throw new Error("page fixture row is not an object");
		const id = row["RegistryID"];
		if (typeof id !== "string" || id !== registryId) return row;
		return { ...row, FacLastPenaltyAmt: amount };
	});
	return Buffer.from(JSON.stringify({ ...parsed, Results: { ...results, Facilities: rows } }), "utf8");
}

async function storeWithPenaltyAmount(registryId: string, amount: string): Promise<EvidenceStore> {
	const io = stubIoOver([bytesOf("echo/facilities-quarter-mi.json"), pageBytesWithPenaltyAmount(registryId, amount)]);
	const built = await createEchoAdapter({ retryDelayMs: 0 }).run(locus, io);
	return storeOf(built.map((b) => complete(locus, b)));
}

describe("echo templates: a real penalty amount, not the recorded zero", () => {
	it("renders with ECHO's thousands grouping restored, a claim about the template rather than ECHO's bytes", async () => {
		// SOUTH COAST TERMINALS PTF is the one row with a formal-action date, so
		// it is the one row echoFacilityFormalAction renders over. Its own
		// FacLastPenaltyAmt is "$0"; "20254146" here is the module comment's own
		// example of what the un-grouped defect looked like, restated as the
		// fix's target: $20,254,146.
		const withAmount = await storeWithPenaltyAmount(SOUTH_COAST, "$20254146");
		expect(withAmount.get(echoId(SOUTH_COAST))?.lastPenaltyAmountUsd.value).toBe(20254146);
		expect(cell(SOUTH_COAST, echoFacilityFormalAction, withAmount)).toBe(
			"Most recent formal enforcement action in ECHO's facility summary for SOUTH COAST TERMINALS PTF: 2024-08-12." +
				" Penalties counted in ECHO's facility summary: 1." +
				" Most recent penalty date in ECHO's facility summary: 2024-08-12." +
				" Amount of the most recent penalty in ECHO's facility summary: $20,254,146.",
		);
	});

	it("still renders the recorded $0 literally, unchanged", () => {
		// The same clause, over the real committed bytes rather than the altered
		// ones above: no decimal is invented for a whole-dollar value, so the
		// zero every recorded row carries still prints as "$0", not "$0.00".
		expect(rendered(SOUTH_COAST, echoFacilityFormalAction)).toBe(
			"Most recent formal enforcement action in ECHO's facility summary for SOUTH COAST TERMINALS PTF: 2024-08-12." +
				" Penalties counted in ECHO's facility summary: 1." +
				" Most recent penalty date in ECHO's facility summary: 2024-08-12." +
				" Amount of the most recent penalty in ECHO's facility summary: $0.",
		);
	});
});
