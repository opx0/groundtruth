/**
 * The four subject scopes of SYNTHESIS.md graft 1: section, source, origin,
 * group.
 *
 * The test this unit exists for is the first one below. The report's headline
 * claim is a count, and a count written down as a number is a claim that can
 * drift away from the records behind it. A count that is the length of an
 * ordering cannot: remove one Superfund site from the store, render the same
 * placement again, and the sentence says 14 with nothing else changed. No
 * cache, no recount, no invalidation step -- rendering is a pure read of the
 * store, which is the whole reason this design allows a subject wider than one
 * record.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { GeocodeMatch, Placement, QueryProvenance, SourceIo, SourceOutcome } from "@/lib/evidence";
import { defineSection, emptyStore, NO_DATA_NOTE, render, trace, verify } from "@/lib/evidence";
import { geocode } from "@/lib/adapters/census";
import { originMatch, originTemplates } from "@/lib/templates/origin";
import { groupMemberCount, groupSharedIdentifier, groupTemplates } from "@/lib/templates/groups";
import { sourceRetrieved, sourceTemplates, sourceUnavailable } from "@/lib/templates/sources";
import {
	sectionNoRecords,
	sectionRetrievedAt,
	sectionTemplates,
	semsNplSectionCount,
	semsSectionCount,
} from "@/lib/templates/sections";
import { semsSiteNpl } from "@/lib/templates/sems";
import { RETRIEVED_AT, SEMS_VERSION, frsLayer, houstonLocus, semsId, semsStore } from "./helpers/sems-fixtures";

const locus = houstonLocus();
const store = semsStore(locus);
const layer = frsLayer();

function text(spans: readonly { text: string }[]): string {
	return spans.map((s) => s.text).join("");
}

function mustRender(store_: typeof store, placement: Placement) {
	const sentence = render(store_, placement);
	if (sentence === null) throw new Error(`expected a sentence for the ${placement.scope} placement`);
	return sentence;
}

/* -------------------------------------------------------------------------- */
/* section                                                                    */
/* -------------------------------------------------------------------------- */

/** The request the SEMS layer answered: the endpoint, the boundary, and when. */
const semsQuery: QueryProvenance = {
	kind: "query",
	parameter: "distance",
	value: 8047,
	adapterVersion: SEMS_VERSION,
	payload: layer.payload,
};

const allSites = defineSection({
	kind: "sems-site",
	source: "sems",
	boundary: "5 miles",
	query: semsQuery,
	retrievedAt: RETRIEVED_AT,
	filter: null,
	note: NO_DATA_NOTE,
});

/**
 * The final-NPL ordering. The filter names a slot of the record and a value
 * the agency itself uses, verbatim: "CURRENTLY ON THE FINAL NPL" is the FRS
 * layer's own `ACTIVE_STATUS` string, not a category this codebase invented.
 */
const nplSites = defineSection({
	kind: "sems-site",
	source: "sems",
	boundary: "5 miles",
	query: semsQuery,
	retrievedAt: RETRIEVED_AT,
	filter: { field: "frsActiveStatus", equals: "CURRENTLY ON THE FINAL NPL" },
	note: NO_DATA_NOTE,
});

const siteCount: Placement = { scope: "section", section: allSites, template: semsSectionCount };
const nplCount: Placement = { scope: "section", section: nplSites, template: semsNplSectionCount };

const SITE_COUNT_SENTENCE = "EPA's Superfund inventory lists 15 sites within 5 miles of the mapped point.";

describe("section: a count is the length of an ordering, never a number anyone wrote down", () => {
	it("renders the report's headline sentence from the committed fixture bytes", () => {
		expect(text(mustRender(store, siteCount).spans)).toBe(SITE_COUNT_SENTENCE);
	});

	it("falls from 15 to 14 when one record leaves the store, with nothing else changed", () => {
		const before = mustRender(store, siteCount);
		expect(text(before.spans)).toBe("EPA's Superfund inventory lists 15 sites within 5 miles of the mapped point.");

		const smaller = store.without(semsId("TXN000622182"));
		expect(smaller.size).toBe(store.size - 1);

		const after = mustRender(smaller, siteCount);
		expect(text(after.spans)).toBe("EPA's Superfund inventory lists 14 sites within 5 miles of the mapped point.");

		// Nothing else moved: same template, same spans, same slots, and the only
		// span whose text differs is the one that reads the ordering's length.
		expect(after.templateId).toBe(before.templateId);
		expect(after.spans.map((s) => s.slot?.field ?? null)).toEqual(before.spans.map((s) => s.slot?.field ?? null));
		const changed = after.spans.filter((span, i) => span.text !== before.spans[i]?.text);
		expect(changed.map((s) => [s.slot?.field, s.text])).toEqual([["count", "14"]]);

		// The old sentence is not merely stale, it is no longer derivable.
		expect(verify(smaller, before, sectionTemplates)).toBe(false);
		expect(verify(store, before, sectionTemplates)).toBe(true);
		expect(verify(smaller, after, sectionTemplates)).toBe(true);
	});

	it("traces the count to the boundary, the endpoint and the record ids behind it", () => {
		const sentence = mustRender(store, siteCount);
		const index = sentence.spans.findIndex((s) => s.slot?.field === "count");
		const t = trace(store, sentence, index);
		if (t?.scope !== "section") throw new Error("expected a section-scoped trace");

		expect(t.clicked.field).toBe("count");
		expect(t.clicked.displayed).toBe("15");
		expect(t.clicked.normalized).toBe(15);

		// The boundary, and the request that set it.
		expect(t.section.boundary).toBe("5 miles");
		expect(t.section.agency).toBe("EPA Superfund Enterprise Management System");
		expect(t.section.query?.parameter).toBe("distance");
		expect(t.section.query?.value).toBe(8047);
		expect(t.section.query?.payload.url).toBe("fixture:sems/arcgis-5mi-houston.json");
		expect(t.section.query?.payload.retrievedAt).toBe(RETRIEVED_AT);
		// The same query is on the value itself, not only beside it.
		expect(t.clicked.provenance).toEqual([semsQuery]);

		// The ids counted, nearest first, read from the store at trace time.
		expect(t.section.counted).toHaveLength(15);
		expect(t.section.counted.map((id) => id.sourceRecordId).slice(0, 3)).toEqual([
			"TXN000607438",
			"TXN000622182",
			"TXN000622432",
		]);
		expect(t.section.counted.every((id) => id.kind === "sems-site")).toBe(true);

		// And it is the ordering, not a stored list: removing a record removes its id.
		const smaller = store.without(semsId("TXN000622182"));
		const after = trace(smaller, mustRender(smaller, siteCount), index);
		if (after?.scope !== "section") throw new Error("expected a section-scoped trace");
		expect(after.section.counted).toHaveLength(14);
		expect(after.section.counted.map((id) => id.sourceRecordId)).not.toContain("TXN000622182");
	});

	it("renders the two final-NPL sites within 5 miles as their own sentence", () => {
		const sentence = mustRender(store, nplCount);
		expect(text(sentence.spans)).toBe(
			"2 sites on the final National Priorities List within 5 miles of the mapped point.",
		);

		const index = sentence.spans.findIndex((s) => s.slot?.field === "count");
		const t = trace(store, sentence, index);
		if (t?.scope !== "section") throw new Error("expected a section-scoped trace");
		expect(t.section.counted.map((id) => id.sourceRecordId)).toEqual(["TXN000607093", "TXD980748453"]);

		// The section and the records agree: the site the ordering names first is
		// the one B7 also names in a sentence of its own.
		const named = mustRender(store, {
			scope: "record",
			recordId: semsId("TXN000607093"),
			template: semsSiteNpl,
		});
		expect(text(named.spans)).toBe(
			"US OIL RECOVERY is listed by SEMS as Currently on the Final NPL, 3.92 km from the mapped point.",
		);

		// The NPL count is an ordering too, so it falls the same way.
		const smaller = store.without(semsId("TXD980748453"));
		expect(text(mustRender(smaller, nplCount).spans)).toBe(
			"1 sites on the final National Priorities List within 5 miles of the mapped point.",
		);
	});

	it("says the boundary and the retrieval time of the section itself", () => {
		const placement: Placement = { scope: "section", section: allSites, template: sectionRetrievedAt };
		expect(text(mustRender(store, placement).spans)).toBe(
			`Searched within 5 miles of the mapped point, retrieved ${RETRIEVED_AT}.`,
		);
	});
});

/* -------------------------------------------------------------------------- */
/* source, and the B10 distinction                                            */
/* -------------------------------------------------------------------------- */

const noRecords: Placement = { scope: "section", section: allSites, template: sectionNoRecords };

const unavailableOutcome: SourceOutcome = {
	status: "unavailable",
	cause: "rate-limited",
	rawCode: 429,
	retryAfter: "120",
};

const unavailablePlacement: Placement = {
	scope: "source",
	source: "sems",
	outcome: unavailableOutcome,
	template: sourceUnavailable,
};

describe("source: an unavailable source and an empty section are different facts (B10)", () => {
	it("says nothing matched, only when nothing matched", () => {
		// The fixture store holds 15 sites, so the no-data wording must not render.
		expect(render(store, noRecords)).toBeNull();
		expect(text(mustRender(emptyStore, noRecords).spans)).toBe("No matching records within the stated boundary.");
	});

	it("renders a source-unavailable claim, distinguishable from a section with zero records", () => {
		const unavailable = mustRender(store, unavailablePlacement);
		expect(text(unavailable.spans)).toBe(
			"EPA Superfund Enterprise Management System could not be reached: rate-limited." +
				" It answered 429. Retry after 120.",
		);

		const empty = mustRender(emptyStore, noRecords);
		expect(text(empty.spans)).not.toBe(text(unavailable.spans));

		// Different on screen, and different underneath: one has a cause and no
		// ordering, the other an empty ordering and no cause.
		const unavailableTrace = trace(store, unavailable, unavailable.spans.findIndex((s) => s.slot !== null));
		const emptyTrace = trace(emptyStore, empty, empty.spans.findIndex((s) => s.slot !== null));
		if (unavailableTrace?.scope !== "source") throw new Error("expected a source-scoped trace");
		if (emptyTrace?.scope !== "section") throw new Error("expected a section-scoped trace");
		expect(unavailableTrace.source.status).toBe("unavailable");
		expect(unavailableTrace.source.cause).toBe("rate-limited");
		expect(unavailableTrace.source.rawCode).toBe(429);
		expect(unavailableTrace.source.retryAfter).toBe("120");
		expect(unavailableTrace.source.retrievedAt).toBeNull();
		expect(emptyTrace.section.counted).toEqual([]);
		expect(emptyTrace.section.query?.payload.retrievedAt).toBe(RETRIEVED_AT);
	});

	it("cannot render the unavailable wording over a source that answered, or the reverse", () => {
		const answered: SourceOutcome = { status: "no-data", note: NO_DATA_NOTE, retrievedAt: RETRIEVED_AT };
		expect(render(store, { scope: "source", source: "sems", outcome: answered, template: sourceUnavailable })).toBeNull();
		expect(
			render(store, { scope: "source", source: "sems", outcome: unavailableOutcome, template: sourceRetrieved }),
		).toBeNull();
		expect(
			text(mustRender(store, { scope: "source", source: "sems", outcome: answered, template: sourceRetrieved }).spans),
		).toBe(`EPA Superfund Enterprise Management System answered no-data, retrieved ${RETRIEVED_AT}.`);
	});

	it("round-trips through verify", () => {
		const sentence = mustRender(store, unavailablePlacement);
		expect(verify(store, sentence, sourceTemplates)).toBe(true);
		expect(verify(store, sentence, sectionTemplates)).toBe(false);
	});
});

/* -------------------------------------------------------------------------- */
/* origin                                                                     */
/* -------------------------------------------------------------------------- */

const fixturesDir = fileURLToPath(new URL("../../fixtures/", import.meta.url));

/** The same fake io the census adapter's own tests use, so the match is the one `lib/adapters/census.ts` produces. */
function censusIo(fixture: string): SourceIo {
	const bytes = readFileSync(`${fixturesDir}${fixture}`);
	const json: unknown = JSON.parse(bytes.toString("utf8"));
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	return {
		get(url, schema) {
			return Promise.resolve({
				raw: schema.parse(json),
				payload: { url: url.toString(), sha256, retrievedAt: RETRIEVED_AT },
			});
		},
		query(parameter, value, adapterVersion, payload) {
			return { kind: "query", parameter, value, adapterVersion, payload };
		},
		now: () => RETRIEVED_AT,
	};
}

async function houstonMatch(): Promise<GeocodeMatch> {
	const outcome = await geocode("9311 E Avenue P, Houston, TX 77012", censusIo("census/match-9311-e-ave-p.json"));
	if (outcome.status !== "matched") throw new Error(outcome.status);
	return outcome.match;
}

describe("origin: the geocode match locates a block, not a parcel", () => {
	it("renders the matched address, the block range, the street side, and the block-not-parcel wording", async () => {
		const placement: Placement = { scope: "origin", match: await houstonMatch(), template: originMatch };
		const sentence = mustRender(store, placement);
		expect(text(sentence.spans)).toBe(
			"Matched: 9311 E AVE P, HOUSTON, TX, 77012." +
				" The point sits on the 9301 to 9399 block, street side L," +
				" interpolated by the Census Geocoder along TIGER line 96085986." +
				" It marks the block, not the parcel.",
		);
		expect(text(sentence.spans)).toContain("It marks the block, not the parcel.");
	});

	it("traces each end of the block range to the Census field it came from", async () => {
		const match = await houstonMatch();
		const placement: Placement = { scope: "origin", match, template: originMatch };
		const sentence = mustRender(store, placement);
		const index = sentence.spans.findIndex((s) => s.slot?.field === "blockFrom");
		const t = trace(store, sentence, index);
		if (t?.scope !== "origin") throw new Error("expected an origin-scoped trace");

		expect(t.clicked.displayed).toBe("9301");
		const [p] = t.clicked.provenance;
		expect(p?.kind === "field" ? [p.dataset, p.sourceField, p.rawValue] : null).toEqual([
			"census_geocoder",
			"fromAddress",
			"9301",
		]);
		expect(t.origin.matchedAddress).toBe("9311 E AVE P, HOUSTON, TX, 77012");
		// The privacy boundary holds: the citable payload carries no address.
		expect(t.origin.payload.url).not.toContain("9311");
		expect(verify(store, sentence, originTemplates)).toBe(true);
	});
});

/* -------------------------------------------------------------------------- */
/* group                                                                      */
/* -------------------------------------------------------------------------- */

/** B6 rule 1: two SEMS EPA IDs under one FRS registry ID, straight out of the 5-mile fixture. */
const sharedRegistry: Placement = {
	scope: "group",
	members: [semsId("TXN000607355"), semsId("TXN000605303")],
	groupedBy: "frsRegistryId",
	template: groupSharedIdentifier,
};

const groupSize: Placement = { ...sharedRegistry, template: groupMemberCount };

describe("group: several records the grouping rules tied together", () => {
	it("renders two records as one subject", () => {
		expect(text(mustRender(store, sharedRegistry).spans)).toBe(
			"PASADENA REFINING FIRE and PRSI FIRE" +
				" share one EPA facility registry ID, 110000462703.",
		);
		expect(text(mustRender(store, groupSize).spans)).toBe("2 records grouped under 110000462703.");
	});

	it("shrinks when a member leaves the store, and disappears when the last one does", () => {
		const smaller = store.without(semsId("TXN000605303"));
		// The pair clause needs a second member, so it drops entirely.
		expect(render(smaller, sharedRegistry)).toBeNull();
		// The size is the number of members still there, not a number written down.
		expect(text(mustRender(smaller, groupSize).spans)).toBe("1 records grouped under 110000462703.");

		const gone = smaller.without(semsId("TXN000607355"));
		expect(render(gone, groupSize)).toBeNull();
		expect(trace(gone, mustRender(store, groupSize), 0)).toBeNull();
	});

	it("traces to the members still in the store", () => {
		const sentence = mustRender(store, groupSize);
		const t = trace(store, sentence, sentence.spans.findIndex((s) => s.slot?.field === "members"));
		if (t?.scope !== "group") throw new Error("expected a group-scoped trace");
		expect(t.group.members.map((id) => id.sourceRecordId)).toEqual(["TXN000607355", "TXN000605303"]);
		expect(t.group.groupedBy).toBe("frsRegistryId");
		expect(verify(store, sentence, groupTemplates)).toBe(true);
	});
});
