/**
 * The FRS facility templates against the committed ArcGIS bytes.
 *
 * Records are built the way the adapter builds them — `frsFacility` over the
 * fixture's own features, sealed by `complete` against the Houston locus — so
 * every asserted sentence is a sentence the real rows can fill. Nothing here
 * fetches and nothing here hand-writes a record.
 *
 * The property tests run the whole cross product, every exported template
 * against every record built from this source's fixtures, and assert the exact
 * string or null for each pair. A loop over templates against one record, or
 * over records with one template, is what let U2.0's defects live: it proves a
 * template right on the record it was written for and says nothing about the
 * others.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type {
	EvidenceStore,
	PayloadRef,
	Placement,
	RecordOf,
	Sealed,
	Sentence,
	SlotKeys,
	Trace,
} from "@/lib/evidence";
import { complete, render, storeOf, trace, verify } from "@/lib/evidence";
import type { FrsAttrs } from "@/lib/adapters/frs";
import { ArcgisResponse, frsFacility } from "@/lib/adapters/frs";
import { frsFacilityCrossReference, frsFacilityIdentity, frsTemplates } from "@/lib/templates/frs";
import { houstonLocus } from "@/tests/unit/evidence/helpers/sems-fixtures";

const fixturesRoot = fileURLToPath(new URL("../../fixtures/", import.meta.url));
const RETRIEVED_AT = "2026-09-16T12:00:00Z";

const HOUSTON_REFINERY = "frs/arcgis-registry-110000460885.json";
const TWO_IDS = "frs/arcgis-registry-110000462703-two-ids.json";

type FrsRecord = Sealed<RecordOf<"frs-facility">>;
type FrsFeature = { readonly attributes: FrsAttrs };

/** The layer's parsed features and the payload they were read from. */
function loadLayer(relative: string): { readonly features: readonly [FrsFeature, ...FrsFeature[]]; readonly payload: PayloadRef } {
	const bytes = readFileSync(`${fixturesRoot}${relative}`);
	const parsed = ArcgisResponse.parse(JSON.parse(bytes.toString("utf8")));
	if (!("features" in parsed)) throw new Error(`${relative} is an error body, not a layer`);
	const [first, ...rest] = parsed.features;
	if (first === undefined) throw new Error(`${relative} has no features`);
	const payload: PayloadRef = {
		url: `fixture:${relative}`,
		sha256: createHash("sha256").update(bytes).digest("hex"),
		retrievedAt: RETRIEVED_AT,
	};
	return { features: [first, ...rest], payload };
}

/** Every row of the fixture, collapsed into one record, exactly as `lookupFrsFacility` does. */
function facilityFrom(relative: string): FrsRecord {
	const layer = loadLayer(relative);
	return complete(houstonLocus(), frsFacility(layer.features, layer.payload));
}

/** The Houston facility built from its own first row alone, the row FRS dates with null. */
function firstRowOnly(relative: string): FrsRecord {
	const layer = loadLayer(relative);
	const [first] = layer.features;
	return complete(houstonLocus(), frsFacility([first], layer.payload));
}

function storeWith(record: FrsRecord): EvidenceStore {
	return storeOf([record]);
}

function text(sentence: Sentence): string {
	return sentence.spans.map((span) => span.text).join("");
}

function mustRender(store: EvidenceStore, placement: Placement): Sentence {
	const sentence = render(store, placement);
	if (sentence === null) throw new Error(`expected a sentence for ${placement.template.id}`);
	return sentence;
}

/**
 * Every record this source's fixtures can build, named. The third is derived,
 * not a third fixture: it is the 38-row facility cut down to its own first row,
 * which is the shape of a facility no row carries a date for.
 */
const RECORDS: readonly { readonly name: string; readonly record: FrsRecord }[] = [
	{ name: "houston-refinery (38 rows)", record: facilityFrom(HOUSTON_REFINERY) },
	{ name: "pasadena-refining (2 rows)", record: facilityFrom(TWO_IDS) },
	{ name: "houston-refinery (first row only, null date)", record: firstRowOnly(HOUSTON_REFINERY) },
];

/** The exact sentence each (template, record) pair renders. Every pair is here; none of these templates has a requirement that would make one null. */
const EXPECTED: Readonly<Record<string, string | null>> = {
	"frs-facility/identity@1 | houston-refinery (38 rows)":
		"EPA's facility registry lists HOUSTON REFINERY under registry ID 110000460885." +
		" The latest update date on any of its programme-interest rows is 2024-03-14.",
	"frs-facility/identity@1 | pasadena-refining (2 rows)":
		"EPA's facility registry lists PASADENA REFINING SYSTEM, INC. under registry ID 110000462703." +
		" The latest update date on any of its programme-interest rows is 2021-11-24.",
	"frs-facility/identity@1 | houston-refinery (first row only, null date)":
		"EPA's facility registry lists HOUSTON REFINERY under registry ID 110000460885.",
	"frs-facility/cross-reference@1 | houston-refinery (38 rows)":
		"EPA's facility registry carries the name HOUSTON REFINERY for registry ID 110000460885.",
	"frs-facility/cross-reference@1 | pasadena-refining (2 rows)":
		"EPA's facility registry carries the name PASADENA REFINING SYSTEM, INC. for registry ID 110000462703.",
	"frs-facility/cross-reference@1 | houston-refinery (first row only, null date)":
		"EPA's facility registry carries the name HOUSTON REFINERY for registry ID 110000460885.",
};

describe("every template against every record the fixtures build", () => {
	it("covers the whole cross product, with no pair left unasserted", () => {
		expect(Object.keys(EXPECTED)).toHaveLength(frsTemplates.length * RECORDS.length);
	});

	for (const template of frsTemplates) {
		for (const { name, record } of RECORDS) {
			const key = `${template.id} | ${name}`;

			it(`renders the exact sentence for ${key}`, () => {
				const store = storeWith(record);
				const rendered = render(store, { scope: "record", recordId: record.id, template });

				expect(rendered === null ? null : text(rendered)).toBe(EXPECTED[key]);
			});
		}
	}

	/**
	 * Neither template declares a requirement, and that is a claim about them,
	 * not an oversight: both print only values they reference and neither
	 * asserts a state the record could fail to be in, so every pair above
	 * renders. A template that gained a state claim would have to gain a
	 * requirement, and this assertion is what would notice.
	 */
	it("declares no requirements, so no pair renders null", () => {
		expect(frsTemplates.map((template) => template.requires)).toEqual([[], []]);
		expect(Object.values(EXPECTED).every((expected) => expected !== null)).toBe(true);
	});

	/**
	 * The registry's name for this facility is HOUSTON REFINERY; Envirofacts
	 * calls the same registry ID VALERO PLUME. Every sentence attributes the
	 * name to the registry, so none can be read as the facility's only name.
	 */
	it("attributes the name to the registry rather than asserting it, on every pair", () => {
		for (const template of frsTemplates) {
			for (const { record } of RECORDS) {
				const rendered = text(mustRender(storeWith(record), { scope: "record", recordId: record.id, template }));

				expect(rendered).toContain("EPA's facility registry");
				expect(rendered).toMatch(/^EPA's facility registry (lists|carries the name) .+ (under|for) registry ID \d+\./);
			}
		}
	});

	/**
	 * PASADENA REFINING SYSTEM, INC. ends in its own period. No clause may end
	 * on the name, or the sentence renders "INC..". The registry ID carries no
	 * period, so it holds the end of every clause that names one.
	 */
	it("never puts a name in clause-final position, on every pair", () => {
		for (const template of frsTemplates) {
			for (const { record } of RECORDS) {
				const sentence = mustRender(storeWith(record), { scope: "record", recordId: record.id, template });
				const positions = sentence.spans.flatMap((span, at) => (span.slot?.field === "subject" ? [at] : []));

				expect(text(sentence)).not.toContain("..");
				expect(positions.length).toBeGreaterThan(0);
				for (const at of positions) {
					expect(sentence.spans[at + 1]?.text.startsWith(" ")).toBe(true);
				}
			}
		}
	});

	/**
	 * Finding 17: `parse-epoch-ms` widens FRS's date into an instant, and a
	 * clause printing that instant claims a clock time and a UTC offset FRS
	 * never sent. Nothing on screen may carry one.
	 */
	it("prints no clock time and no UTC offset, on every pair", () => {
		for (const template of frsTemplates) {
			for (const { record } of RECORDS) {
				const rendered = text(mustRender(storeWith(record), { scope: "record", recordId: record.id, template }));

				expect(rendered).not.toMatch(/\d{2}:\d{2}/);
				expect(rendered).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
				expect(rendered).not.toMatch(/\bZ\b/);
			}
		}
	});

	/** A boolean slot renders as "true" or "false", which is never acceptable on screen. */
	it("prints no boolean, on every pair", () => {
		for (const template of frsTemplates) {
			for (const { record } of RECORDS) {
				const rendered = text(mustRender(storeWith(record), { scope: "record", recordId: record.id, template }));

				expect(rendered).not.toMatch(/\b(true|false)\b/);
			}
		}
	});
});

/**
 * Finding 16: UPDATE_DATE is null on 25 of this facility's 38 rows, so "the
 * most recently updated of its programme-interest rows" names a row the layer
 * does not identify. A maximum over the dates that are present supports only
 * the latest date carried, which is what the clause now says.
 */
describe("the update date the registry carries", () => {
	const layer = loadLayer(HOUSTON_REFINERY);

	it("is a maximum over a column two thirds of the rows leave null", () => {
		const dates = layer.features.map((feature) => feature.attributes.UPDATE_DATE);

		expect(dates).toHaveLength(38);
		expect(dates.filter((date) => date === null)).toHaveLength(25);
	});

	it("names no row, and states only the latest date", () => {
		const record = facilityFrom(HOUSTON_REFINERY);
		const rendered = text(
			mustRender(storeWith(record), { scope: "record", recordId: record.id, template: frsFacilityIdentity }),
		);

		expect(rendered).toContain("The latest update date on any of its programme-interest rows is 2024-03-14.");
		expect(rendered).not.toContain("most recently updated");
	});
});

/**
 * Finding 18: `cross-reference@1` prints beneath a record the selection policy
 * chose, and B6 rule 3 groups on a *possible* match. A deixis onto that record
 * would turn a suggestion into an identity claim, so the clause names the
 * registry ID and states only what the registry itself holds.
 */
describe("the cross-reference sentence", () => {
	const record = facilityFrom(HOUSTON_REFINERY);
	const store = storeWith(record);

	it("points at no record above it", () => {
		const rendered = text(
			mustRender(store, { scope: "record", recordId: record.id, template: frsFacilityCrossReference }),
		);

		expect(rendered).toBe("EPA's facility registry carries the name HOUSTON REFINERY for registry ID 110000460885.");
		expect(rendered).not.toContain("this facility");
		expect(rendered).not.toMatch(/\b(this|that|it|its|the same)\b/);
	});

	it("says it with the registry's own two fields and nothing else", () => {
		const referenced = frsFacilityCrossReference.clauses.flatMap((clause) => clause.refs.map((ref) => ref.field));

		expect(referenced).toEqual(["subject", "registryId"]);
	});
});

describe("a null UPDATE_DATE", () => {
	/**
	 * The first of this facility's 38 rows carries `UPDATE_DATE: null`. Built
	 * from that row alone — the real shape of a facility no row dates — the
	 * date clause drops and the identity clause stands.
	 */
	const layer = loadLayer(HOUSTON_REFINERY);
	const [first] = layer.features;
	const record = firstRowOnly(HOUSTON_REFINERY);
	const store = storeWith(record);

	it("is the fixture's own first row, not a hand-made null", () => {
		expect(first.attributes.UPDATE_DATE).toBeNull();
		expect(record.sourceUpdatedAt.value).toBeNull();
	});

	it("drops its clause and leaves the rest of the sentence standing", () => {
		const sentence = mustRender(store, { scope: "record", recordId: record.id, template: frsFacilityIdentity });

		expect(text(sentence)).toBe("EPA's facility registry lists HOUSTON REFINERY under registry ID 110000460885.");
		expect(sentence.spans.some((span) => span.slot?.field === "sourceUpdatedAt")).toBe(false);
	});

	it("still carries the null and its provenance in the record trace", () => {
		const sentence = mustRender(store, { scope: "record", recordId: record.id, template: frsFacilityIdentity });
		const t = trace(store, sentence, 1);
		if (t === null || t.scope !== "record") throw new Error("expected a record-scoped trace");

		expect(t.record.sourceUpdatedAt.displayed).toBeNull();
		expect(t.record.sourceUpdatedAt.normalized).toBeNull();
		expect(t.record.sourceUpdatedAt.provenance[0]).toMatchObject({
			kind: "field",
			sourceField: "UPDATE_DATE",
			rawValue: null,
			transform: "parse-epoch-ms",
		});
	});
});

describe("the trace behind one span", () => {
	const record = facilityFrom(HOUSTON_REFINERY);
	const store = storeWith(record);
	const sentence = mustRender(store, { scope: "record", recordId: record.id, template: frsFacilityIdentity });

	function traceOfField(field: string): Extract<Trace, { scope: "record" }> {
		const index = sentence.spans.findIndex((span) => span.slot?.field === field);
		const t = trace(store, sentence, index);
		if (t === null || t.scope !== "record") throw new Error(`expected a record-scoped trace for ${field}`);
		return t;
	}

	/**
	 * The date on screen is narrowed, not reinterpreted: `day()` shows
	 * 2024-03-14 and the trace keeps the instant `parse-epoch-ms` made, beside
	 * the epoch milliseconds FRS actually sent.
	 */
	it("names the field and the raw value behind the date on screen", () => {
		const t = traceOfField("sourceUpdatedAt");

		expect(t.clicked.field).toBe("sourceUpdatedAt");
		expect(t.clicked.displayed).toBe("2024-03-14");
		expect(t.clicked.normalized).toBe("2024-03-14T10:51:51Z");
		expect(t.clicked.provenance).toEqual([
			{
				kind: "field",
				dataset: "frs_interests",
				sourceField: "UPDATE_DATE",
				rawValue: 1710413511000,
				transform: "parse-epoch-ms",
				adapterVersion: "frs@1",
				payload: record.payloads[0],
			},
		]);
	});

	it("names the field and the raw value behind the registry's name", () => {
		const t = traceOfField("subject");

		expect(t.clicked.field).toBe("subject");
		expect(t.clicked.displayed).toBe("HOUSTON REFINERY");
		expect(t.clicked.provenance[0]).toMatchObject({ sourceField: "PRIMARY_NAME", rawValue: "HOUSTON REFINERY" });
	});

	/**
	 * The 38 programme-interest rows are not sayable and are not lost: every
	 * leaf of every row reaches the trace panel by its own path, with the row
	 * index in it.
	 */
	it("reaches every programme-interest row by path, though no sentence names one", () => {
		const t = traceOfField("subject");
		const paths = t.values.map((value) => value.field);

		expect(paths).toContain("programInterests.0.program");
		expect(paths.filter((path) => /^programInterests\.\d+\.programId$/.test(path))).toHaveLength(38);
		const tsca = t.values.find((value) => value.field === "programInterests.30.activeStatus");
		expect(tsca?.normalized).toBe("***UNCHANGED***");
		expect(tsca?.displayed).toBeNull();
	});
});

describe("what a template may reference", () => {
	/** Compiles only if the kind's slots are exactly these six. `programInterests` is an array of objects, so it is not among them. */
	type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
	const slotsAreExactlyThese: Exact<
		SlotKeys<RecordOf<"frs-facility">>,
		"sourceUrl" | "subject" | "effectiveAt" | "sourceUpdatedAt" | "registryId" | "distanceMeters"
	> = true;

	it("is a fixed set of six slots, and programme interests are not one of them", () => {
		expect(slotsAreExactlyThese).toBe(true);
	});

	it("is honoured by every clause of every template", () => {
		const referenced = frsTemplates.flatMap((template) =>
			template.clauses.flatMap((clause) => clause.refs.map((ref) => ref.field)),
		);

		expect(new Set(referenced)).toEqual(new Set(["registryId", "subject", "sourceUpdatedAt"]));
	});
});

describe("a record removed from the store", () => {
	const record = facilityFrom(HOUSTON_REFINERY);
	const store = storeWith(record);

	it("renders null, and a sentence rendered before it went no longer verifies", () => {
		const placement: Placement = { scope: "record", recordId: record.id, template: frsFacilityIdentity };
		const before = mustRender(store, placement);
		const after = store.without(record.id);

		expect(render(after, placement)).toBeNull();
		expect(render(after, { scope: "record", recordId: record.id, template: frsFacilityCrossReference })).toBeNull();
		expect(verify(store, before, frsTemplates)).toBe(true);
		expect(verify(after, before, frsTemplates)).toBe(false);
	});
});
