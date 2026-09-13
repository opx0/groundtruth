/**
 * The SEMS site templates against the committed fixture bytes.
 *
 * The cross product is the point of this file. Every exported template is
 * rendered against every record these fixtures build, in all three `statusRow`
 * states, and every one of the sixty-eight pairs asserts the exact whole
 * sentence or null. The nulls are the finding: a template renders over the
 * records it speaks about and stays silent over the rest, and the silence is
 * asserted rather than assumed.
 *
 * Four templates, not five. `sems-site/disagreement@1` is gone: its premise was
 * that the two agencies contradict each other, and on these fifteen recorded
 * sites `ACTIVE_STATUS` is `npl_status_name` upper-cased on every one of them,
 * because it is the Superfund interest's own status and not a second opinion.
 * `describe("the template that was deleted")` below holds that as a property of
 * the fixture bytes, so the day a recorded record actually disagrees, this file
 * fails and the template comes back.
 *
 * Two other things moved since the last pass and are witnessed here.
 * `sems-site/npl@1` required only that SEMS returned some status, which thirteen
 * of fifteen non-final-NPL sites satisfied, so B7's final-NPL sentence rendered
 * over sites the matching count excludes; it now requires the string it prints.
 * And both clauses that print `frsActiveStatus` now name the environmental
 * interest the status belongs to, which the layer's own field description says
 * it does — that description is asserted here, out of the fixture, so the
 * wording is pinned to the agency's words and not to ours.
 *
 * The last describe is the one that was missing. Every record above has an FRS
 * coordinate, so every sentence above has its lead clause, so nothing above
 * could ever see what the clause after it reads like without one. `LATITUDE83`
 * and `LONGITUDE83` are `z.number().nullable()` in the adapter's own
 * `FrsAttrs`; the layer is allowed to send a row without them, and the lead
 * clause is the one clause in this file that a null takes whole. That block
 * builds the layer's own row for `TXN000607155` with those two columns null
 * through the real `semsSite`, and asserts the whole surviving sentence in each
 * of the three `statusRow` states. It is what caught `records its …` standing
 * with no site named before it.
 *
 * Records are built by running the real adapter through a `SourceIo` that
 * serves the committed bytes, exactly as `tests/unit/adapters/sems.test.ts`
 * does — including the failure, which is a rejected status request and not a
 * hand-written `statusRow`. Nothing here fetches and nothing here hand-builds
 * a record.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type {
	EvidenceStore,
	PayloadRef,
	Placement,
	Sealed,
	SemsSiteRecord,
	Sentence,
	SourceIo,
	Template,
	Trace,
} from "@/lib/evidence";
import { complete, render, runSource, SourceFailure, storeOf, trace, unavailableOf, verify } from "@/lib/evidence";
import type { FrsAttrs, StatusAnswer } from "@/lib/adapters/sems";
import { semsAdapter, semsSite } from "@/lib/adapters/sems";
import {
	semsSiteNpl,
	semsSiteRegistryOnly,
	semsSiteStatusUnavailable,
	semsSiteSummary,
	semsTemplates,
} from "@/lib/templates/sems";
import {
	envirofactsFor,
	frsRowFor,
	houstonLocus,
	RETRIEVED_AT,
	frsLayer,
} from "@/tests/unit/evidence/helpers/sems-fixtures";

const fixturesDir = fileURLToPath(new URL("../../fixtures/", import.meta.url));
const LAYER_5MI = "sems/arcgis-5mi-houston.json";

/** Envirofacts' own answer for an EPA ID it holds no row for: a bare `[]`. */
const NO_ROWS = readFileSync(`${fixturesDir}sems/envirofacts-no-row.json`);

/**
 * The site the two constructed states are built for. All fifteen sites in the
 * layer have an inventory row — that was checked against the live endpoint —
 * so `no-row` and `unavailable` are reached by changing what the inventory is
 * served, never by claiming this site lacks a row.
 */
const SITE = "TXN000607155";

/** The one `npl_status_name` B7's own sentence is about, and the one `npl@1` requires. */
const FINAL_NPL = "Currently on the Final NPL";

const EPA_IDS: readonly string[] = frsLayer().raw.features.map((feature) => feature.attributes.PGM_SYS_ID);

/** Every EPA ID in the layer whose Envirofacts row is committed, which is all fifteen. */
const JOINED: Readonly<Record<string, string>> = Object.fromEntries(
	EPA_IDS.filter((epaId) => existsSync(`${fixturesDir}sems/envirofacts-${epaId}.json`)).map((epaId) => [
		epaId,
		`sems/envirofacts-${epaId}.json`,
	]),
);

const WITHOUT_ROW: Readonly<Record<string, string>> = Object.fromEntries(
	Object.entries(JOINED).filter(([epaId]) => epaId !== SITE),
);

function payloadFor(url: string, bytes: Buffer): PayloadRef {
	return { url, sha256: createHash("sha256").update(bytes).digest("hex"), retrievedAt: RETRIEVED_AT };
}

/** The EPA ID out of `.../efservice/envirofacts_site/epa_id/<EPA_ID>/JSON`. */
function epaIdOf(url: URL): string | null {
	const segments = url.pathname.split("/");
	const id = segments[segments.length - 2];
	return url.host === "data.epa.gov" && id !== undefined ? id : null;
}

/**
 * A `SourceIo` that answers the radius query from the layer fixture and each
 * status join from `status[epaId]`, with the recorded empty response for an ID
 * that has no entry, and a `SourceFailure` for an ID named in `failing`.
 */
function serving(status: Readonly<Record<string, string>>, failing: readonly string[] = []): SourceIo {
	return {
		get(url, schema) {
			const epaId = epaIdOf(url);
			if (epaId !== null && failing.includes(epaId)) {
				return Promise.reject(new SourceFailure("rate-limited", "429", "60"));
			}
			const relative = epaId === null ? LAYER_5MI : status[epaId];
			const bytes = relative === undefined ? NO_ROWS : readFileSync(`${fixturesDir}${relative}`);
			const payload = payloadFor(relative === undefined ? url.toString() : `fixture:${relative}`, bytes);
			return Promise.resolve({ raw: schema.parse(JSON.parse(bytes.toString("utf8"))), payload });
		},
		query(parameter, value, adapterVersion, payload) {
			return { kind: "query", parameter, value, adapterVersion, payload };
		},
		now: () => RETRIEVED_AT,
	};
}

type SemsRecord = Sealed<SemsSiteRecord>;

async function recordsFrom(io: SourceIo): Promise<readonly SemsRecord[]> {
	const outcome = await runSource(houstonLocus(), semsAdapter, io, { timeoutMs: 5000 });
	if (outcome.status !== "ok") throw new Error(`expected ok, got ${outcome.status}`);
	return outcome.records;
}

async function siteFrom(io: SourceIo): Promise<SemsRecord> {
	const found = (await recordsFrom(io)).find((record) => record.id.sourceRecordId === SITE);
	if (found === undefined) throw new Error(`${SITE} is not in the outcome`);
	return found;
}

function text(sentence: Sentence): string {
	return sentence.spans.map((span) => span.text).join("");
}

function storeWith(record: SemsRecord): EvidenceStore {
	return storeOf([record]);
}

function mustRender(store: EvidenceStore, placement: Placement): Sentence {
	const sentence = render(store, placement);
	if (sentence === null) throw new Error(`expected a sentence for ${placement.template.id}`);
	return sentence;
}

/** The fifteen joined records, and the same site in the two states the inventory's other answers produce. */
const joinedRecords = await recordsFrom(serving(JOINED));
const rowlessRecord = await siteFrom(serving(WITHOUT_ROW));
const unavailableRecord = await siteFrom(serving(JOINED, [SITE]));

const RECORDS: readonly { readonly name: string; readonly record: SemsRecord }[] = [
	...joinedRecords.map((record) => ({ name: `${record.id.sourceRecordId} (joined)`, record })),
	{ name: `${SITE} (no-row)`, record: rowlessRecord },
	{ name: `${SITE} (unavailable)`, record: unavailableRecord },
];

/**
 * The exact sentence each (template, record) pair renders, and null where the
 * template does not speak about the record. Every one of the sixty-eight pairs
 * is here; none is implied.
 *
 * Read the `summary@1` column down and the two splits of finding 3 are visible:
 * both statuses carry the column's own name, and the date is a clause of its
 * own, so PRSI FIRE's null date says "Date unavailable." where the whole
 * sentence used to say "as of Date unavailable." US OIL RECOVERY, GENEVA and
 * MCC RECYCLING show the other half of the split — a `non_npl_status_date`
 * with a null `non_npl_status_name` beside it — which used to take the date
 * down with the status and now prints alone.
 */
const EXPECTED: Readonly<Record<string, string | null>> = {
	"sems-site/summary@1 | TXN000607443 (joined)":
		"SUPPLY PRO FIRE, 6.74 km from the mapped point. NPL status: Not on the NPL." +
		" Non-NPL status: Removal Only Site (No Site Assessment Work Needed). Non-NPL status date: 2012-06-26.",
	"sems-site/registry-only@1 | TXN000607443 (joined)": null,
	"sems-site/status-unavailable@1 | TXN000607443 (joined)": null,
	"sems-site/npl@1 | TXN000607443 (joined)": null,

	"sems-site/summary@1 | TXN000607093 (joined)":
		"US OIL RECOVERY, 3.92 km from the mapped point. NPL status: Currently on the Final NPL." +
		" Non-NPL status date: 2010-07-05.",
	"sems-site/registry-only@1 | TXN000607093 (joined)": null,
	"sems-site/status-unavailable@1 | TXN000607093 (joined)": null,
	"sems-site/npl@1 | TXN000607093 (joined)":
		"US OIL RECOVERY is listed by SEMS as Currently on the Final NPL, 3.92 km from the mapped point.",

	"sems-site/summary@1 | TXN000622432 (joined)":
		"KELLOGG TIRE FIRE, 2.37 km from the mapped point. NPL status: Not on the NPL." +
		" Non-NPL status: Removal Only Site (No Site Assessment Work Needed). Non-NPL status date: 2026-06-22.",
	"sems-site/registry-only@1 | TXN000622432 (joined)": null,
	"sems-site/status-unavailable@1 | TXN000622432 (joined)": null,
	"sems-site/npl@1 | TXN000622432 (joined)": null,

	"sems-site/summary@1 | TXD981157522 (joined)":
		"LYONDELLBASELL FIRE, 2.69 km from the mapped point. NPL status: Not on the NPL." +
		" Non-NPL status: Removal Only Site (No Site Assessment Work Needed). Non-NPL status date: 2010-05-19.",
	"sems-site/registry-only@1 | TXD981157522 (joined)": null,
	"sems-site/status-unavailable@1 | TXD981157522 (joined)": null,
	"sems-site/npl@1 | TXD981157522 (joined)": null,

	"sems-site/summary@1 | TXN000607355 (joined)":
		"PASADENA REFINING FIRE, 5.14 km from the mapped point. NPL status: Not on the NPL." +
		" Non-NPL status: Removal Only Site (No Site Assessment Work Needed). Non-NPL status date: 2012-01-30.",
	"sems-site/registry-only@1 | TXN000607355 (joined)": null,
	"sems-site/status-unavailable@1 | TXN000607355 (joined)": null,
	"sems-site/npl@1 | TXN000607355 (joined)": null,

	"sems-site/summary@1 | TXN000622182 (joined)":
		"VALERO PLUME, 0.76 km from the mapped point. NPL status: Not on the NPL." +
		" Non-NPL status: Removal Only Site (No Site Assessment Work Needed). Non-NPL status date: 2022-02-08.",
	"sems-site/registry-only@1 | TXN000622182 (joined)": null,
	"sems-site/status-unavailable@1 | TXN000622182 (joined)": null,
	"sems-site/npl@1 | TXN000622182 (joined)": null,

	"sems-site/summary@1 | TXN000606604 (joined)":
		"SUPERIOR PACKAGING AND DISTRIBUTING, 7.91 km from the mapped point. NPL status: Not on the NPL." +
		" Non-NPL status: Removal Only Site (No Site Assessment Work Needed). Non-NPL status date: 2005-04-17.",
	"sems-site/registry-only@1 | TXN000606604 (joined)": null,
	"sems-site/status-unavailable@1 | TXN000606604 (joined)": null,
	"sems-site/npl@1 | TXN000606604 (joined)": null,

	"sems-site/summary@1 | TXN000606785 (joined)":
		"TYSON FOODS AMMONIA RELEASE, 7.22 km from the mapped point. NPL status: Not on the NPL." +
		" Non-NPL status: Removal Only Site (No Site Assessment Work Needed). Non-NPL status date: 2007-05-24.",
	"sems-site/registry-only@1 | TXN000606785 (joined)": null,
	"sems-site/status-unavailable@1 | TXN000606785 (joined)": null,
	"sems-site/npl@1 | TXN000606785 (joined)": null,

	"sems-site/summary@1 | TXN000607438 (joined)":
		"RHODIA INC., ACID RELEASE, 0.71 km from the mapped point. NPL status: Not on the NPL." +
		" Non-NPL status: Removal Only Site (No Site Assessment Work Needed). Non-NPL status date: 2012-06-12.",
	"sems-site/registry-only@1 | TXN000607438 (joined)": null,
	"sems-site/status-unavailable@1 | TXN000607438 (joined)": null,
	"sems-site/npl@1 | TXN000607438 (joined)": null,

	"sems-site/summary@1 | TXN000605303 (joined)":
		"PRSI FIRE, 5.14 km from the mapped point. NPL status: Not on the NPL." +
		" Non-NPL status: Removal Only Site (No Site Assessment Work Needed). Non-NPL status date: Date unavailable.",
	"sems-site/registry-only@1 | TXN000605303 (joined)": null,
	"sems-site/status-unavailable@1 | TXN000605303 (joined)": null,
	"sems-site/npl@1 | TXN000605303 (joined)": null,

	"sems-site/summary@1 | TXN000622257 (joined)":
		"UPRR TRAIN DERAILMENT ZINDLER ST. HOUSTON, 7.16 km from the mapped point. NPL status: Not on the NPL." +
		" Non-NPL status: Removal Only Site (No Site Assessment Work Needed). Non-NPL status date: 2022-10-20.",
	"sems-site/registry-only@1 | TXN000622257 (joined)": null,
	"sems-site/status-unavailable@1 | TXN000622257 (joined)": null,
	"sems-site/npl@1 | TXN000622257 (joined)": null,

	"sems-site/summary@1 | TXN000606967 (joined)":
		"SHARP PERFORMANCE CHEMICAL, 6.50 km from the mapped point. NPL status: Not on the NPL." +
		" Non-NPL status: Removal Only Site (No Site Assessment Work Needed). Non-NPL status date: 2009-02-03.",
	"sems-site/registry-only@1 | TXN000606967 (joined)": null,
	"sems-site/status-unavailable@1 | TXN000606967 (joined)": null,
	"sems-site/npl@1 | TXN000606967 (joined)": null,

	"sems-site/summary@1 | TXN000607377 (joined)":
		"DELTA SPECIALITY FIRE, 6.61 km from the mapped point. NPL status: Not on the NPL." +
		" Non-NPL status: Removal Only Site (No Site Assessment Work Needed). Non-NPL status date: 2012-03-12.",
	"sems-site/registry-only@1 | TXN000607377 (joined)": null,
	"sems-site/status-unavailable@1 | TXN000607377 (joined)": null,
	"sems-site/npl@1 | TXN000607377 (joined)": null,

	"sems-site/summary@1 | TXD980748453 (joined)":
		"GENEVA INDUSTRIES/FUHRMANN ENERGY, 6.84 km from the mapped point. NPL status: Currently on the Final NPL." +
		" Non-NPL status date: Date unavailable.",
	"sems-site/registry-only@1 | TXD980748453 (joined)": null,
	"sems-site/status-unavailable@1 | TXD980748453 (joined)": null,
	"sems-site/npl@1 | TXD980748453 (joined)":
		"GENEVA INDUSTRIES/FUHRMANN ENERGY is listed by SEMS as Currently on the Final NPL, 6.84 km from the mapped point.",

	"sems-site/summary@1 | TXN000607155 (joined)":
		"MCC RECYCLING, 5.50 km from the mapped point. NPL status: Site is Part of NPL Site." +
		" Non-NPL status date: 2017-05-11.",
	"sems-site/registry-only@1 | TXN000607155 (joined)": null,
	"sems-site/status-unavailable@1 | TXN000607155 (joined)": null,
	"sems-site/npl@1 | TXN000607155 (joined)": null,

	"sems-site/summary@1 | TXN000607155 (no-row)": null,
	"sems-site/registry-only@1 | TXN000607155 (no-row)":
		"MCC RECYCLING, 5.50 km from the mapped point." +
		" EPA's facility registry records the SUPERFUND (NON-NPL) interest at MCC RECYCLING as SITE IS PART OF NPL SITE." +
		" The Superfund inventory returned no status row for TXN000607155.",
	"sems-site/status-unavailable@1 | TXN000607155 (no-row)": null,
	"sems-site/npl@1 | TXN000607155 (no-row)": null,

	"sems-site/summary@1 | TXN000607155 (unavailable)": null,
	"sems-site/registry-only@1 | TXN000607155 (unavailable)": null,
	"sems-site/status-unavailable@1 | TXN000607155 (unavailable)":
		"MCC RECYCLING, 5.50 km from the mapped point." +
		" EPA's facility registry records the SUPERFUND (NON-NPL) interest at MCC RECYCLING as SITE IS PART OF NPL SITE." +
		" The Superfund inventory's status for TXN000607155 could not be retrieved.",
	"sems-site/npl@1 | TXN000607155 (unavailable)": null,
};

function keyOf(template: Template<"sems-site">, name: string): string {
	return `${template.id} | ${name}`;
}

/** The table's entry for a pair, or a failure: a pair the table forgot must never pass as a null. */
function expectedFor(key: string): string | null {
	const value = EXPECTED[key];
	if (value === undefined) throw new Error(`${key} is not in the table`);
	return value;
}

function rendered(record: SemsRecord, template: Template<"sems-site">): string | null {
	const sentence = render(storeWith(record), { scope: "record", recordId: record.id, template });
	return sentence === null ? null : text(sentence);
}

describe("every template against every record the fixtures build", () => {
	it("builds fifteen joined records and the same site in the other two states", () => {
		expect(joinedRecords).toHaveLength(15);
		expect(joinedRecords.map((record) => record.statusRow.status)).toEqual(EPA_IDS.map(() => "joined"));
		expect(rowlessRecord.statusRow).toEqual({ status: "no-row" });
		expect(unavailableRecord.statusRow).toEqual({
			status: "unavailable",
			cause: "rate-limited",
			rawCode: "429",
			retryAfter: "60",
		});
	});

	it("covers the whole cross product, with no pair left unasserted and none invented", () => {
		const pairs = RECORDS.flatMap(({ name }) => semsTemplates.map((template) => keyOf(template, name)));

		expect(semsTemplates).toHaveLength(4);
		expect(pairs).toHaveLength(68);
		expect(Object.keys(EXPECTED).sort()).toEqual([...pairs].sort());
	});

	it("renders null on forty-nine of the sixty-eight pairs, and says which", () => {
		const silent = Object.entries(EXPECTED)
			.filter(([, sentence]) => sentence === null)
			.map(([key]) => key);

		expect(silent).toHaveLength(49);
		// Counted by template: summary speaks in one of three states, the two
		// gap templates in one state each, and npl@1 over two of seventeen.
		expect(semsTemplates.map((template) => silent.filter((key) => key.startsWith(template.id)).length)).toEqual([
			2, 16, 16, 15,
		]);
	});

	for (const template of semsTemplates) {
		for (const { name, record } of RECORDS) {
			const key = keyOf(template, name);

			it(`renders the exact sentence, or null, for ${key}`, () => {
				expect(rendered(record, template)).toBe(expectedFor(key));
			});
		}
	}
});

/**
 * The state templates each speak about one `statusRow` state and must render
 * null in the other two. The describe below this one is the witness for how
 * much of that the requirement is doing.
 */
describe("a template that asserts a state renders in that state and no other", () => {
	const speaksFor: readonly { readonly template: Template<"sems-site">; readonly state: string }[] = [
		{ template: semsSiteSummary, state: "joined" },
		{ template: semsSiteRegistryOnly, state: "no-row" },
		{ template: semsSiteStatusUnavailable, state: "unavailable" },
	];

	for (const { template, state } of speaksFor) {
		it(`${template.id} renders only over a ${state} record`, () => {
			for (const { record } of RECORDS) {
				const sentence = rendered(record, template);

				expect(sentence === null).toBe(record.statusRow.status !== state);
			}
		});
	}

	it("declares the requirement each template's own sentences depend on", () => {
		expect(semsTemplates.map((template) => [template.id, template.requires])).toEqual([
			["sems-site/summary@1", [{ state: "statusRow", is: "joined" }]],
			["sems-site/registry-only@1", [{ state: "statusRow", is: "no-row" }]],
			["sems-site/status-unavailable@1", [{ state: "statusRow", is: "unavailable" }]],
			["sems-site/npl@1", [{ slot: "semsNplStatus", equals: FINAL_NPL }]],
		]);
	});
});

/**
 * Finding 1. `npl@1` is B7's separate sentence for a site on the final National
 * Priorities List, and its requirement was `{ slot: "semsNplStatus", present:
 * true }` — satisfied by every string the inventory sends. The recorded bytes
 * hold three of them, and thirteen of the fifteen sites were getting a sentence
 * that the matching count excludes them from.
 */
describe("the final-NPL sentence names only the sites on the final NPL", () => {
	function nplStatusOf(record: SemsRecord): string | null {
		return record.semsNplStatus?.value ?? null;
	}

	it("is three different strings across the fifteen joined records, not one", () => {
		const counted = new Map<string | null, number>();
		for (const record of joinedRecords) {
			const status = nplStatusOf(record);
			counted.set(status, (counted.get(status) ?? 0) + 1);
		}

		expect([...counted.entries()].sort()).toEqual([
			["Currently on the Final NPL", 2],
			["Not on the NPL", 12],
			["Site is Part of NPL Site", 1],
		]);
	});

	it("renders over exactly the two records whose status is the string it prints", () => {
		for (const { record } of RECORDS) {
			expect(rendered(record, semsSiteNpl) === null).toBe(nplStatusOf(record) !== FINAL_NPL);
		}

		const named = RECORDS.filter(({ record }) => rendered(record, semsSiteNpl) !== null);
		expect(named.map(({ record }) => record.id.sourceRecordId)).toEqual(["TXN000607093", "TXD980748453"]);
	});

	/** The wording that `present: true` used to allow, on the site the recheck quoted. */
	it("no longer says a site not on the NPL is listed by SEMS in the final-NPL sentence", () => {
		const valero = joinedRecords.find((record) => record.id.sourceRecordId === "TXN000622182");
		if (valero === undefined) throw new Error("VALERO PLUME is not in the outcome");

		expect(valero.semsNplStatus?.value).toBe("Not on the NPL");
		expect(rendered(valero, semsSiteNpl)).toBeNull();
		expect(rendered(valero, { ...semsSiteNpl, requires: [{ slot: "semsNplStatus", present: true }] })).toBe(
			"VALERO PLUME is listed by SEMS as Not on the NPL, 0.76 km from the mapped point.",
		);
	});

	/**
	 * What `equals` cannot see, stated as a test rather than left to the module
	 * comment. The failed-join record carries the registry's `CURRENTLY ON THE
	 * FINAL NPL` for MCC RECYCLING's interest and still gets no NPL sentence,
	 * because the Superfund inventory did not say so and the interest's status is
	 * not the site's. `equals` on a plain-null slot is refused before it compares.
	 */
	it("stays silent where the inventory could not be asked, whatever the registry carries", () => {
		expect(unavailableRecord.semsNplStatus).toBeNull();
		expect(rendered(unavailableRecord, semsSiteNpl)).toBeNull();
		expect(rowlessRecord.semsNplStatus).toBeNull();
		expect(rendered(rowlessRecord, semsSiteNpl)).toBeNull();
	});
});

/**
 * Finding 2, held as the property that justified the deletion. `disagreement@1`
 * printed both statuses attributed because the agencies contradicted each
 * other. They do not: `ACTIVE_STATUS` is the Superfund interest's own status,
 * and on these fifteen sites it is `npl_status_name` upper-cased, differing on
 * none. If a recorded record ever does disagree, this fails and the template is
 * owed a requirement that can express it.
 */
describe("the template that was deleted, and the fixture fact that deleted it", () => {
	it("exports four templates and no disagreement template", () => {
		expect(semsTemplates.map((template) => template.id)).toEqual([
			"sems-site/summary@1",
			"sems-site/registry-only@1",
			"sems-site/status-unavailable@1",
			"sems-site/npl@1",
		]);
	});

	it("finds no site where the two fields disagree on anything but capitalisation", () => {
		const differing = joinedRecords.filter(
			(record) => record.frsActiveStatus.value !== (record.semsNplStatus?.value ?? "").toUpperCase(),
		);

		expect(differing.map((record) => record.id.sourceRecordId)).toEqual([]);
		expect(joinedRecords).toHaveLength(15);
	});

	/** And an exact comparison would have fired on all fifteen, which is the hazard, not the feature. */
	it("would have fired on every site had the comparison been the exact one a requirement can express", () => {
		const exactlyEqual = joinedRecords.filter((record) => record.frsActiveStatus.value === record.semsNplStatus?.value);

		expect(exactlyEqual).toHaveLength(0);
	});
});

/**
 * Finding 6. `ACTIVE_STATUS` belongs to an environmental interest, not to the
 * site, and the layer says so itself. The two clauses that print it name the
 * interest, and `interestType` reaches the screen for the first time.
 */
describe("the registry's status is the interest's status, and says so", () => {
	const layerBytes = readFileSync(`${fixturesDir}${LAYER_5MI}`, "utf8");

	it("is the layer's own description of its own two columns", () => {
		expect(layerBytes).toContain("The status of the environmental interest at the facility or site");
		expect(layerBytes).toContain("The environmental permit or regulatory program that applies to the facility site");
	});

	it("names the interest in both clauses that print the registry's status", () => {
		expect(rowlessRecord.interestType.value).toBe("SUPERFUND (NON-NPL)");
		expect(rowlessRecord.frsActiveStatus.value).toBe("SITE IS PART OF NPL SITE");

		const pairs: readonly { readonly record: SemsRecord; readonly template: Template<"sems-site"> }[] = [
			{ record: rowlessRecord, template: semsSiteRegistryOnly },
			{ record: unavailableRecord, template: semsSiteStatusUnavailable },
		];

		for (const { record, template } of pairs) {
			const sentence = rendered(record, template);

			expect(sentence).toContain(
				"EPA's facility registry records the SUPERFUND (NON-NPL) interest at MCC RECYCLING as SITE IS PART OF NPL SITE.",
			);
			expect(sentence).not.toContain("lists it as");
		}
	});

	/**
	 * The registry-only reading the finding asked to check. The clause before the
	 * gap hands the reader NPL vocabulary, which under the old wording was the
	 * inventory's own vocabulary under the registry's name, one sentence before
	 * being told the inventory answered with nothing. Attributed to the interest
	 * it is the registry's fact, and the sentence after it is about a different
	 * system.
	 */
	it("reads as the registry's fact, then the inventory's silence, in that order", () => {
		expect(rendered(rowlessRecord, semsSiteRegistryOnly)).toBe(
			"MCC RECYCLING, 5.50 km from the mapped point." +
				" EPA's facility registry records the SUPERFUND (NON-NPL) interest at MCC RECYCLING as SITE IS PART OF NPL SITE." +
				" The Superfund inventory returned no status row for TXN000607155.",
		);
	});
});

/**
 * Findings 3 and 4, as properties over every pair that renders: a distance
 * always says what it is measured from, a status always carries the column's
 * own name, and B10's "Date unavailable." is never inlined behind "as of".
 */
describe("what every rendered sentence does and does not say", () => {
	function everySentence(): readonly string[] {
		return RECORDS.flatMap(({ record }) =>
			semsTemplates.map((template) => rendered(record, template)).filter((s): s is string => s !== null),
		);
	}

	it("renders nineteen sentences across the matrix", () => {
		expect(everySentence()).toHaveLength(19);
	});

	it("says what every distance is measured from", () => {
		for (const sentence of everySentence()) {
			expect(sentence).toContain(" km from the mapped point");
			expect(sentence).not.toMatch(/ km(?! from the mapped point)/);
		}
	});

	it("labels both statuses with the column each one is, and labels neither 'Status:'", () => {
		for (const sentence of everySentence()) {
			expect(sentence).not.toContain("Status: ");
		}
		expect(rendered(joinedRecords[0] ?? rowlessRecord, semsSiteSummary)).toContain("NPL status: Not on the NPL.");
		expect(rendered(joinedRecords[0] ?? rowlessRecord, semsSiteSummary)).toContain(
			"Non-NPL status: Removal Only Site (No Site Assessment Work Needed).",
		);
	});

	it("never inlines B10's standalone wording behind 'as of'", () => {
		for (const sentence of everySentence()) {
			expect(sentence).not.toContain("as of");
			expect(sentence).not.toContain("as of Date unavailable");
		}
	});

	/** B8's boolean rule: `archived` decides nothing here, and no sentence may print one. */
	it("prints no boolean", () => {
		for (const sentence of everySentence()) {
			expect(sentence).not.toMatch(/\b(true|false)\b/);
		}
	});
});

/**
 * The witness for what the requirements are holding back: the same templates
 * with their requirements taken off and nothing else changed, rendered over the
 * records they must not speak for. It isolates the requirement as the thing
 * that stops them — the clauses cannot, because every field they name is on the
 * record in all three states.
 */
describe("what the requirements are holding back", () => {
	function unrequired(template: Template<"sems-site">): Template<"sems-site"> {
		return { ...template, requires: [] };
	}

	it("would report an inventory answer of none over a site whose status request failed", () => {
		expect(rendered(unavailableRecord, unrequired(semsSiteRegistryOnly))).toBe(
			"MCC RECYCLING, 5.50 km from the mapped point." +
				" EPA's facility registry records the SUPERFUND (NON-NPL) interest at MCC RECYCLING as SITE IS PART OF NPL SITE." +
				" The Superfund inventory returned no status row for TXN000607155.",
		);
	});

	it("would report a failed status request over a site the inventory answered about", () => {
		expect(rendered(rowlessRecord, unrequired(semsSiteStatusUnavailable))).toBe(
			"MCC RECYCLING, 5.50 km from the mapped point." +
				" EPA's facility registry records the SUPERFUND (NON-NPL) interest at MCC RECYCLING as SITE IS PART OF NPL SITE." +
				" The Superfund inventory's status for TXN000607155 could not be retrieved.",
		);
	});

	it("would report the inventory's own answer over all fifteen sites it was never asked about", () => {
		for (const record of joinedRecords) {
			expect(rendered(record, unrequired(semsSiteStatusUnavailable))).toContain("could not be retrieved");
			expect(rendered(record, unrequired(semsSiteRegistryOnly))).toContain("returned no status row");
		}
	});

	/**
	 * Forty-seven of the forty-nine null cells are a requirement refusing to
	 * render. The two that were already silent are `npl@1`'s over the two records
	 * with no inventory row: its one clause names the status, so it drops when
	 * the status is missing. The thirteen joined records where `npl@1` is now
	 * null are the finding — every one of them was a sentence before this pass.
	 */
	it("accounts for every null cell in the table", () => {
		const stopped: string[] = [];
		const alreadySilent: string[] = [];
		for (const template of semsTemplates) {
			for (const { name, record } of RECORDS) {
				const key = keyOf(template, name);
				if (expectedFor(key) !== null) continue;
				(rendered(record, unrequired(template)) === null ? alreadySilent : stopped).push(key);
			}
		}

		expect(stopped).toHaveLength(47);
		expect(stopped.filter((key) => key.startsWith("sems-site/npl@1"))).toHaveLength(13);
		expect(alreadySilent).toEqual([
			"sems-site/npl@1 | TXN000607155 (no-row)",
			"sems-site/npl@1 | TXN000607155 (unavailable)",
		]);
	});
});

/**
 * The registry-only and status-unavailable sentences differ in their last
 * clause alone. What would not be fine is the registry-only wording rendering
 * where the inventory never answered, because "returned no status row" is a
 * claim about the answer given.
 */
describe("the one site, and the three answers the inventory can give about it", () => {
	const joinedSite = joinedRecords.find((record) => record.id.sourceRecordId === SITE);
	if (joinedSite === undefined) throw new Error(`${SITE} is not in the outcome`);
	const states: readonly SemsRecord[] = [joinedSite, rowlessRecord, unavailableRecord];

	it("is the same site, the same registry status and the same distance in all three", () => {
		expect(states.map((record) => record.statusRow.status)).toEqual(["joined", "no-row", "unavailable"]);
		for (const record of states) {
			expect(record.id.sourceRecordId).toBe(SITE);
			expect(record.frsActiveStatus.value).toBe("SITE IS PART OF NPL SITE");
			expect(record.interestType.value).toBe("SUPERFUND (NON-NPL)");
			expect(record.distanceMeters?.value).toBe(joinedSite.distanceMeters?.value);
		}
	});

	it("states an inventory answer of none only where the inventory answered", () => {
		expect(rendered(rowlessRecord, semsSiteRegistryOnly)).toContain("returned no status row");
		expect(rendered(unavailableRecord, semsSiteRegistryOnly)).toBeNull();
		expect(rendered(joinedSite, semsSiteRegistryOnly)).toBeNull();
	});

	it("states that the status could not be retrieved only where the request failed", () => {
		expect(rendered(unavailableRecord, semsSiteStatusUnavailable)).toContain("could not be retrieved");
		expect(rendered(rowlessRecord, semsSiteStatusUnavailable)).toBeNull();
		expect(rendered(joinedSite, semsSiteStatusUnavailable)).toBeNull();
	});

	/** The failure is the record's, carried verbatim from the rejected request, and no sentence prints it. */
	it("keeps the cause of the failure on the record, out of the sentence", () => {
		const sentence = mustRender(storeWith(unavailableRecord), {
			scope: "record",
			recordId: unavailableRecord.id,
			template: semsSiteStatusUnavailable,
		});

		expect(text(sentence)).not.toContain("429");
		expect(text(sentence)).not.toContain("rate-limited");
	});
});

/**
 * Two real nulls on two real rows, and the two things B8 does with them. The
 * status date is missing from PRSI FIRE's inventory row, so the date clause
 * stands on its fallback; the non-NPL status is missing from US OIL RECOVERY's,
 * and that clause has no fallback, so it drops — and since finding 3 split the
 * date out of it, US OIL RECOVERY's date now survives its status.
 */
describe("a null on a real row", () => {
	function joinedSite(epaId: string): SemsRecord {
		const found = joinedRecords.find((record) => record.id.sourceRecordId === epaId);
		if (found === undefined) throw new Error(`${epaId} is not in the outcome`);
		return found;
	}

	const prsi = joinedSite("TXN000605303");
	const usOil = joinedSite("TXN000607093");

	it("is the fixtures' own nulls, not hand-made ones", () => {
		expect(prsi.statusDate?.value).toBeNull();
		expect(usOil.nonNplStatus?.value).toBeNull();
		expect(usOil.statusDate?.value).toBe("2010-07-05");
	});

	it("keeps the date clause alive on its fallback, as its own sentence, when a date is null", () => {
		expect(rendered(prsi, semsSiteSummary)).toBe(
			"PRSI FIRE, 5.14 km from the mapped point. NPL status: Not on the NPL." +
				" Non-NPL status: Removal Only Site (No Site Assessment Work Needed). Non-NPL status date: Date unavailable.",
		);
	});

	it("drops the status clause and leaves the date and the rest standing when a status is null", () => {
		const sentence = mustRender(storeWith(usOil), {
			scope: "record",
			recordId: usOil.id,
			template: semsSiteSummary,
		});

		expect(text(sentence)).toBe(
			"US OIL RECOVERY, 3.92 km from the mapped point. NPL status: Currently on the Final NPL." +
				" Non-NPL status date: 2010-07-05.",
		);
		expect(sentence.spans.some((span) => span.slot?.field === "nonNplStatus")).toBe(false);
		expect(sentence.spans.some((span) => span.slot?.field === "statusDate")).toBe(true);
	});

	it("still carries the null date and its provenance in the trace", () => {
		const sentence = mustRender(storeWith(prsi), {
			scope: "record",
			recordId: prsi.id,
			template: semsSiteSummary,
		});
		const index = sentence.spans.findIndex((span) => span.slot?.field === "statusDate");
		const t = trace(storeWith(prsi), sentence, index);
		if (t === null || t.scope !== "record") throw new Error("expected a record-scoped trace");

		// B10's wording is on screen, whole and standalone; the trace behind it says
		// there was no value and names the column the null came from.
		expect(t.clicked.displayed).toBe("Date unavailable");
		expect(t.clicked.normalized).toBeNull();
		expect(t.clicked.provenance[0]).toMatchObject({
			sourceField: "non_npl_status_date",
			rawValue: null,
			transform: "normalize-date",
		});
	});
});

describe("the trace behind one span", () => {
	const record = rowlessRecord;
	const store = storeWith(record);
	const sentence = mustRender(store, { scope: "record", recordId: record.id, template: semsSiteRegistryOnly });

	function traceOfField(field: string): Extract<Trace, { scope: "record" }> {
		const index = sentence.spans.findIndex((span) => span.slot?.field === field);
		const t = trace(store, sentence, index);
		if (t === null || t.scope !== "record") throw new Error(`expected a record-scoped trace for ${field}`);
		return t;
	}

	it("names the field and the raw value behind the registry's status on screen", () => {
		const t = traceOfField("frsActiveStatus");

		expect(t.clicked.field).toBe("frsActiveStatus");
		expect(t.clicked.displayed).toBe("SITE IS PART OF NPL SITE");
		expect(t.clicked.provenance[0]).toMatchObject({
			kind: "field",
			dataset: "frs_program_facility",
			sourceField: "ACTIVE_STATUS",
			rawValue: "SITE IS PART OF NPL SITE",
			transform: "identity",
		});
	});

	/** The interest the status belongs to is a traced value like any other, read from the column it names. */
	it("names the column behind the interest the status is attributed to", () => {
		const t = traceOfField("interestType");

		expect(t.clicked.displayed).toBe("SUPERFUND (NON-NPL)");
		expect(t.clicked.provenance[0]).toMatchObject({
			kind: "field",
			dataset: "frs_program_facility",
			sourceField: "INTEREST_TYPE",
			rawValue: "SUPERFUND (NON-NPL)",
			transform: "identity",
		});
	});

	/** The name is a coalesce, so its trace carries the registry's name and the Superfund one that was not there to take. */
	it("names both inputs behind the subject", () => {
		const t = traceOfField("subject");
		const [computation] = t.clicked.provenance;
		if (computation?.kind !== "computation") throw new Error("subject is not a coalesce");

		expect(t.clicked.displayed).toBe("MCC RECYCLING");
		expect(computation.formula).toBe("coalesce");
		expect(computation.inputs.map((input) => input.value)).toEqual([null, "MCC RECYCLING"]);
	});
});

describe("a record removed from the store", () => {
	it("renders null, and a sentence rendered before it went no longer verifies", () => {
		const record = rowlessRecord;
		const store = storeWith(record);
		const placement: Placement = { scope: "record", recordId: record.id, template: semsSiteRegistryOnly };
		const before = mustRender(store, placement);
		const after = store.without(record.id);

		expect(render(after, placement)).toBeNull();
		for (const template of semsTemplates) {
			expect(render(after, { scope: "record", recordId: record.id, template })).toBeNull();
		}
		expect(verify(store, before, semsTemplates)).toBe(true);
		expect(verify(after, before, semsTemplates)).toBe(false);
	});
});

/**
 * The null the fixtures cannot reach, and the clause that used to lean on it.
 *
 * All fifteen recorded rows carry a coordinate, so the lead clause —
 * `${subject}, ${km(distanceMeters)} from the mapped point.` — renders on every
 * pair above, and the clause after it could say "its" for eighteen months
 * without a test ever seeing what that reads like alone. `LATITUDE83` and
 * `LONGITUDE83` are `z.number().nullable()` in `FrsAttrs`, `point()` returns
 * null when either is, `complete` then leaves `distanceMeters` null, and the
 * whole lead clause goes. Under the old wording what was left began "EPA's
 * facility registry records its …" with no site named anywhere before it.
 *
 * The record is the layer's own row for this site with those two columns set to
 * null and nothing else touched, put through the real `semsSite` and the real
 * `complete`. It is a constructed coordinate-less row, not a claim that this
 * site has no coordinate, and not a hand-written record: every other field,
 * every payload and every provenance is the fixture's.
 */
describe("a row the layer sent with no coordinate", () => {
	function joinedAnswer(epaId: string): StatusAnswer {
		const row = envirofactsFor(epaId);
		if (row === null) throw new Error(`no committed Envirofacts row for ${epaId}`);
		return { status: "joined", row };
	}

	function uncoordinated(epaId: string, answer: StatusAnswer): SemsRecord {
		const fetched = frsRowFor(epaId);
		const raw: FrsAttrs = { ...fetched.raw, LATITUDE83: null, LONGITUDE83: null };
		return complete(houstonLocus(), semsSite({ raw, payload: fetched.payload }, answer));
	}

	const states: readonly {
		readonly state: string;
		readonly record: SemsRecord;
		readonly template: Template<"sems-site">;
	}[] = [
		{ state: "joined", record: uncoordinated(SITE, joinedAnswer(SITE)), template: semsSiteSummary },
		{ state: "no-row", record: uncoordinated(SITE, { status: "no-row" }), template: semsSiteRegistryOnly },
		{
			state: "unavailable",
			record: uncoordinated(SITE, unavailableOf(new SourceFailure("rate-limited", "429", "60"))),
			template: semsSiteStatusUnavailable,
		},
	];

	it("is the fixture's own row with two columns nulled, and the fixture's row is not", () => {
		expect(frsRowFor(SITE).raw.LATITUDE83).not.toBeNull();
		expect(frsRowFor(SITE).raw.LONGITUDE83).not.toBeNull();

		for (const { state, record } of states) {
			expect(record.statusRow.status).toBe(state);
			expect(record.id.sourceRecordId).toBe(SITE);
			expect(record.location).toBeNull();
			expect(record.distanceMeters).toBeNull();
			expect(record.frsName.value).toBe("MCC RECYCLING");
			expect(record.interestType.value).toBe("SUPERFUND (NON-NPL)");
			expect(record.frsActiveStatus.value).toBe("SITE IS PART OF NPL SITE");
		}
	});

	it("drops the lead clause, and only the lead clause, in all three states", () => {
		for (const { record, template } of states) {
			const sentence = mustRender(storeWith(record), { scope: "record", recordId: record.id, template });

			expect(sentence.spans.some((span) => span.slot?.field === "distanceMeters")).toBe(false);
			expect(text(sentence)).not.toContain("from the mapped point");
			expect(sentence.templateId).toBe(template.id);
		}
	});

	it("renders the whole sentence the joined state is left with", () => {
		expect(rendered(states[0]?.record ?? rowlessRecord, semsSiteSummary)).toBe(
			"NPL status: Site is Part of NPL Site. Non-NPL status date: 2017-05-11.",
		);
	});

	it("renders the whole sentence the no-row state is left with, with the site named", () => {
		expect(rendered(states[1]?.record ?? rowlessRecord, semsSiteRegistryOnly)).toBe(
			"EPA's facility registry records the SUPERFUND (NON-NPL) interest at MCC RECYCLING as SITE IS PART OF NPL SITE." +
				" The Superfund inventory returned no status row for TXN000607155.",
		);
	});

	it("renders the whole sentence the unavailable state is left with, with the site named", () => {
		expect(rendered(states[2]?.record ?? rowlessRecord, semsSiteStatusUnavailable)).toBe(
			"EPA's facility registry records the SUPERFUND (NON-NPL) interest at MCC RECYCLING as SITE IS PART OF NPL SITE." +
				" The Superfund inventory's status for TXN000607155 could not be retrieved.",
		);
	});

	/**
	 * The defect stated as the property, not as three strings: with the lead
	 * clause gone, nothing that renders may point at a site it has not named.
	 */
	it("leaves no clause pointing at a site no clause names", () => {
		for (const { record } of states) {
			for (const template of semsTemplates) {
				const sentence = rendered(record, template);
				if (sentence === null) continue;

				expect(sentence).not.toContain("records its");
				expect(sentence).not.toContain(" it ");
				expect(sentence).not.toContain(" its ");
			}
		}
	});

	/**
	 * What `npl@1` does with the same null, which is the other half of the check
	 * this pass was asked for. It is a single clause and it names its own
	 * subject, so a null distance takes B7's whole sentence rather than its
	 * antecedent: US OIL RECOVERY is on the final NPL and gets no NPL sentence at
	 * all without a coordinate. A silence, not a false claim — and the summary
	 * still prints the status, so the fact is not lost, only its own sentence.
	 * Splitting the distance into a second clause would keep it; this pass was
	 * not asked to, and this test is here so the next one decides it knowingly.
	 */
	it("costs the final-NPL sentence entirely, rather than its subject", () => {
		const usOil = uncoordinated("TXN000607093", joinedAnswer("TXN000607093"));

		expect(usOil.semsNplStatus?.value).toBe(FINAL_NPL);
		expect(rendered(usOil, semsSiteNpl)).toBeNull();
		expect(rendered(usOil, semsSiteSummary)).toBe(
			"NPL status: Currently on the Final NPL. Non-NPL status date: 2010-07-05.",
		);
	});
});
