/**
 * Deterministic inclusion and ordering — docs/BRIEF.md B7.
 *
 * This is the judgement tier of the report. It decides which records appear, in
 * what order, and which template each one gets. Templates cannot branch and the
 * report route must not, so every such decision lives here, as a named function
 * with a test on it.
 *
 * THE PLAN HOLDS NO COUNTS. Not a total, not a "showing N of M", not a length
 * cached anywhere. A plan carries `SectionSpec`s and `Placement`s and nothing
 * else. A count on screen is the length of a section's ordering, recomputed
 * from the store at render time, which is what makes "15 sites" drop to "14
 * sites" when a record is removed with nothing else touched; a count copied
 * into a plan is a number that can drift away from the records behind it. The
 * module comment of `lib/evidence/sentence.ts` is the argument in full. The
 * route reads a total with `sectionOrdering(store, listing.section).length`,
 * right next to where it renders the count, and reads what the card carries
 * with `carriedCount(store, listing.section)`. Both are recomputed from the
 * live store; neither is stored.
 *
 * `listing.shown.length + listing.rest.length` was not the second number, and
 * this comment used to say it was. The one number a plan does hold is
 * `SectionSpec.carried`, and it is a bound the policy chose rather than a
 * length of anything — it is the same 50 whatever the store holds, which is
 * what makes it safe to write down.
 *
 * AND THE PLAN HOLDS NO LIST EITHER. The argument above reaches one step
 * further than this comment used to take it. `shown` and `rest` were orderings
 * frozen at plan time, and a frozen list drifts away from the records behind it
 * exactly as a cached count does. Delete a record from inside the bound of a
 * fifteen-site section shown two and carrying three, and the card said: count
 * 14, four record sentences, "did not carry: 9", "View all" 5. Four and nine
 * are thirteen. Nothing promoted the record at ordering position five into the
 * frozen head, because nothing recomputed the head. The mixture is the defect
 * and neither half can be adjusted into agreement with the other: freezing the
 * count is the one thing this file may not do, so the list is what gives way.
 * A `Listing` carries what it takes to rebuild its entries — the section, the
 * ordering, the bound, and how a record of that kind becomes placements — and
 * `listing.entries(store)` produces them against the live store, in B7's order,
 * with the shown and carried split intact for the route to hang "View all" on.
 * Rendered entries plus not-shown is then the count by construction rather than
 * by care, because all three are reads of one ordering.
 *
 * A FUNCTION ON A LISTING IS NOT WHAT `SectionFilter` FORBIDS. That rule — the
 * rule that selects an ordering is "data, visible in the trace, not a closure"
 * — is about what has to appear in a trace. A section filter is evidence: a
 * reader clicks a count, and the panel has to be able to say which records were
 * counted and by what rule, so the rule is a `{field, equals}` it can print.
 * `describe` and `entries` are not evidence and reach no trace. They produce
 * `Placement`s, which are data, and every sentence those placements render
 * carries its own record-scoped trace with the record's own provenance. There
 * is nothing about them for a reader to be shown. The section, the ordering
 * name and the bound beside them stay data for the same reason the filter does:
 * a card has to be able to state what order it is in and what it left out.
 *
 * EVERY PLACEMENT THIS POLICY PRODUCES RENDERS. `defineTemplate` now takes
 * requirements and `assemble` refuses a template whose subject does not satisfy
 * them, so choosing wrong produces silence rather than a false sentence. That
 * is better and it is still a defect: a record the report holds and cannot
 * describe is a record the reader does not see. So the policy never places a
 * template it has not already established will print — it picks on the field
 * the template requires, and where a template has no requirement but can still
 * render null (`section/no-records@1`, whose note exists only on an empty
 * section; `section/not-shown@1`, whose number exists only on a section that
 * left records out) it places it only when the record or the section is in the
 * state that makes it print. What the ECHO card no longer places at all, and
 * why, is beside `echoTemplatesFor`. `tests/unit/report/selection.test.ts` asserts
 * that, per placement, against a real store.
 *
 * A state is not the same thing as a shape, and `section/no-records@1` is where
 * the two came apart: an empty section is a shape the store can be in for a
 * moment while a card is being built, and only the outcome says whether the
 * source answered with nothing. Placements that speak about an answer are
 * chosen on the outcome and confirmed against the store, never on the store
 * alone.
 *
 * That contradiction has a mirror image, and the guards now cover both. A
 * `no-data` outcome over a store holding that source's records rendered "EPA
 * Superfund Enterprise Management System answered with no matching records"
 * above "Superfund sites EPA's inventory lists within 5 miles of the mapped
 * point: 15" and fifteen site sentences: the count headlines and the listings
 * were guarded on neither the outcome nor the store. One of those two halves is
 * wrong and this tier cannot tell which, so `refuseAnsweredWithNone` builds no
 * card at all, exactly as `refuseUndescribed` refuses a status-only card built
 * over records it would silently drop.
 *
 * WHICH TEMPLATE A RECORD GETS NEVER DEPENDS ON WHETHER ANOTHER PLACEMENT
 * RENDERED. `frs-facility/cross-reference@1` states one narrower fact than
 * `identity@1` and drops the registry's update date, and its whole
 * justification is that `identity@1` "would restate the group sentence directly
 * above it". But a group *placement* is not a group *sentence*. The confirmed
 * registry group is led by a SEMS record, so its placement sits on the SEMS
 * card, and rendered against a store those records have not reached yet — the
 * one-event-per-source wiring `.dev/briefs/U3.1-report-route.md` requires — it
 * renders null while the registry record still gets the downgrade. The registry
 * card lost the facility's name and the registry's update date to a sentence
 * nowhere on the page. The policy cannot know what rendered and the route must
 * not be asked to branch on it, so the registry listing places `identity@1`
 * unconditionally, and the cross-reference moves to where it is about
 * something: beside the group placement, on the card of the member that leads
 * it, saying what the bare identifier that group sentence ends on resolves to.
 * Not on the registry's own card, which states that identity in full in its
 * listing. A cross-reference whose group sentence did not render is still true,
 * because it names the ID and not the record above it — which is the property
 * `lib/templates/frs.ts` wrote it for.
 *
 * WHAT `section/not-shown@1` MAY CLAIM. Its number is `ordering.length -
 * section.carried` for one section, so it is the gap in one list. It is not the
 * gap on a card. The SEMS card holds two lists over one boundary and a group
 * sentence besides: under a bound of two shown and three carried it says ten,
 * while two of those ten are named by the final-NPL list and two more by the
 * group sentence, and seven are truly unspoken. "Records ... that this report
 * did not carry" claims the report; the number knows only the list. The wording
 * is what is wrong, and `lib/templates/sections.ts` — which this unit does not
 * own — is where it is fixed:
 *
 *     Records within {boundary} of the mapped point that this list leaves out: {notShown}.
 *
 * What this file can do, it does: the sentence is placed from a `Listing` and
 * never from a bare `SectionSpec`, so it cannot exist except beside the list it
 * is about.
 *
 * WHAT THE FINAL-NPL FILTER CANNOT SEE. The final-NPL section filters on
 * `semsNplStatus`, the Superfund inventory's own `npl_status_name`, and not on
 * the registry's `frsActiveStatus`. Both agree on all fifteen recorded Houston
 * sites, and the Superfund inventory is the system whose answer that sentence
 * is about. The consequence, stated here because a reader deserves to have it
 * stated: a site whose Envirofacts status request failed has a null Superfund
 * status, is therefore not counted as final-NPL and gets no final-NPL sentence,
 * even though `frsActiveStatus` may have survived that failure carrying
 * `CURRENTLY ON THE FINAL NPL`. That is the honest outcome — the inventory did
 * not tell us, so it is not known to be on the list — and the section trace
 * lists the ids counted, so the count and the list can be reconciled by a
 * reader rather than by a claim.
 *
 * WHERE THE NUMBERS BEHIND THE RULES COME FROM. `FINAL_NPL_STATUS` and
 * `NONCOMPLIANCE_QUARTERS` are read off the templates' own `requires`, not
 * typed in again here. A section filter and the template that speaks for the
 * records it selects can then never name different strings or different
 * thresholds, which is the failure mode `lib/templates/echo.ts` and
 * `lib/templates/sems.ts` both spent a revision fixing.
 */

import {
	defineSection,
	sectionOrdering,
	type EvidenceRecord,
	type EvidenceStore,
	type GeocodeMatch,
	type GroupPlacement,
	type Kind,
	type OriginPlacement,
	type Placement,
	type RecordId,
	type RecordOf,
	type Requirement,
	type Sealed,
	type SectionPlacement,
	type SectionSpec,
	type SourceId,
	type SourceOutcome,
	type SourcePlacement,
	type Template,
} from "@/lib/evidence";
import { FEMA_DATASETS, type FloodZoneResult } from "@/lib/adapters/fema";
import type { FacilityGroup, GroupingResult } from "@/lib/report/grouping";
import {
	echoFacilityFormalAction,
	echoFacilityNoFormalAction,
	echoFacilityNoStatus,
	echoFacilityNoncompliance,
	echoFacilitySummary,
} from "@/lib/templates/echo";
import { floodZoneSummary, floodZoneUnmappedFlag } from "@/lib/templates/fema";
import { frsFacilityCrossReference, frsFacilityIdentity } from "@/lib/templates/frs";
import { groupMemberCount, groupSharedIdentifier } from "@/lib/templates/groups";
import { originMatch, originPoint } from "@/lib/templates/origin";
import {
	echoFormalActionCount,
	echoNoncomplianceCount,
	echoSectionCount,
	sectionNoRecords,
	sectionNotShown,
	sectionRetrievedAt,
	semsNplSectionCount,
	semsSectionCount,
} from "@/lib/templates/sections";
import {
	semsSiteNpl,
	semsSiteRegistryOnly,
	semsSiteStatusUnavailable,
	semsSiteSummary,
} from "@/lib/templates/sems";
import { sourceRetrieved, sourceUnavailable } from "@/lib/templates/sources";

/* -------------------------------------------------------------------------- */
/* Shapes                                                                     */
/* -------------------------------------------------------------------------- */

/** Every source that answers about a point. Census is the geocoder and has no card; it is the origin. */
export type ReportSource = Exclude<SourceId, "census">;

/**
 * One record-scoped placement, with its record id and its template pinned to
 * the same kind. `RecordPlacement` in the kernel is the same union; this is the
 * per-kind member of it, so a listing entry can correlate the two.
 */
export type RecordPlacementOf<K extends Kind> = {
	readonly scope: "record";
	readonly recordId: RecordId<K>;
	readonly template: Template<K>;
};

/**
 * One record and the sentences it renders — not one sentence. A FEMA record
 * needs several, an ECHO facility needs several, and B7's "up to five records"
 * counts records, so the entry is what a listing counts. `placements` is a
 * non-empty tuple, so a record with no sentences at all cannot be constructed.
 */
export type ListingEntryOf<K extends Kind> = {
	readonly recordId: RecordId<K>;
	/** The primary first. Placing two primaries would print the facility's name twice, which is the defect `7f2ac98` removed. */
	readonly placements: readonly [RecordPlacementOf<K>, ...RecordPlacementOf<K>[]];
};

export type ListingEntry = { [K in Kind]: ListingEntryOf<K> }[Kind];

/** The named orders B7 gives. Data, not a closure, so a card can say which order it is in. */
export type OrderingName = "distance" | "echo-b7";

/**
 * The records of one listing, in B7's order, split where "View all" sits.
 *
 * Produced from a live store on every call and stored nowhere, so it falls as
 * the records do. `shown.length + rest.length` is `carriedCount(store,
 * section)` by construction, and both fall to 14 with the count beside them.
 */
export type ListingEntries<K extends Kind = Kind> = {
	/** B7: up to five records before "View all". */
	readonly shown: readonly ListingEntryOf<K>[];
	/** The bounded remainder behind "View all". `rest.length > 0` is what puts that control on screen. */
	readonly rest: readonly ListingEntryOf<K>[];
};

/**
 * One section's records, in the order the report shows them — held as the four
 * things it takes to rebuild them, and never as a list.
 *
 * `section` is exposed so both numbers on the chrome are derivable from the
 * store at render time: the true total is `sectionOrdering(store,
 * section).length` and what the card carries is `carriedCount(store, section)`.
 * `entries(store)` rebuilds the records themselves the same way, which is what
 * keeps them from drifting away from those two numbers. Nothing here is a
 * length, and nothing here is a record.
 */
export type Listing<K extends Kind = Kind> = {
	readonly section: SectionSpec<K>;
	readonly ordering: OrderingName;
	/**
	 * The bound this listing applies to its ordering. A choice the policy made
	 * and not a length of anything — the same 5 and 45 whatever the store holds,
	 * which is what makes it safe to write down — and the same bound
	 * `section.carried` states, which `listingOf` refuses to let drift.
	 */
	readonly bounds: Bounds;
	/** How a record of this kind becomes the sentences that speak for it. */
	readonly describe: (record: Sealed<RecordOf<K>>) => ListingEntryOf<K>;
	/** The entries, against a live store. Closes over the four fields above and over no store and no record. */
	readonly entries: (store: EvidenceStore) => ListingEntries<K>;
};

export type AnyListing = { [K in Kind]: Listing<K> }[Kind];

/**
 * One source's card. It always carries a `SourcePlacement`, because B7 requires
 * the status of every source to appear whether or not the source has records.
 */
export type Card = {
	readonly source: ReportSource;
	readonly status: SourcePlacement;
	/**
	 * A source outcome this card owes the reader beside its own status. Today
	 * only FEMA has one: when the authoritative NFHL layer failed and Esri's
	 * copy answered instead, that failure is a fact about the report.
	 */
	readonly priorAttempts: readonly SourcePlacement[];
	/** B7: the section-scoped counts, the not-shown sentence and the no-data notes, in reading order, before any record. */
	readonly headlines: readonly SectionPlacement[];
	readonly listings: readonly AnyListing[];
	/** B6 groups whose lead member is one of this source's records. */
	readonly groups: readonly GroupPlacement[];
	/**
	 * What the identifier a group sentence ends on resolves to: the registry's
	 * name for it, beside the group that was built on it. Empty on the registry
	 * card, which states that identity in full in its own listing.
	 */
	readonly crossReferences: readonly RecordPlacementOf<"frs-facility">[];
};

/** What the B6 groups put on one card. Both lists are empty for a source no group is led by. */
export type CardGroups = {
	readonly placements: readonly GroupPlacement[];
	readonly crossReferences: readonly RecordPlacementOf<"frs-facility">[];
};

export const NO_GROUPS: CardGroups = { placements: [], crossReferences: [] };

export type ReportPlan = {
	/** A2 screen 2 and B7 rule 1: the matched address and how precise it is. */
	readonly origin: readonly [OriginPlacement, ...OriginPlacement[]];
	readonly cards: readonly [Card, ...Card[]];
};

/**
 * The AQS and AirNow templates. Neither exists yet: both adapters are briefed
 * in `.dev/briefs/U1.6-U1.7-air.md` and blocked on a key the operator has to
 * register. The card functions below are written against their record kinds
 * anyway, so wiring an adapter later is a registration and not a redesign, and
 * `null` is how the report says the templates are not there — the air cards are
 * then status-only, which is exactly what B7 requires of a source with nothing
 * to list. No air record can be in the store while this is null, because no
 * adapter exists to put one there.
 */
export type AirTemplates = {
	readonly aqs: Template<"aqs-monitor-summary">;
	readonly airnow: Template<"airnow-observation">;
};

/** Every source outcome except FEMA's, which is a `FloodZoneResult` and not a slot of a shared fan-out. */
export type ReportSources = { readonly [S in Exclude<ReportSource, "fema">]: SourceOutcome };

export type ReportInput = {
	readonly store: EvidenceStore;
	readonly match: GeocodeMatch;
	readonly sources: ReportSources;
	/**
	 * `.dev/PLAN.md` queue item 8: the no-data note has to say which of the two
	 * datasets answered, and a fan-out slot's note cannot. `FloodZoneResult`
	 * carries the dataset beside the outcome.
	 */
	readonly flood: FloodZoneResult;
	readonly grouping: GroupingResult;
	readonly air: AirTemplates | null;
};

export type Bounds = {
	/** How many records a listing shows before "View all". */
	readonly shown: number;
	/** How many more it carries behind that control. */
	readonly carried: number;
};

/* -------------------------------------------------------------------------- */
/* Bounds, and no silent truncation                                           */
/* -------------------------------------------------------------------------- */

/** B7: a section shows up to five records, then offers "View all" for the rest. */
export const SHOWN_RECORDS = 5;

/**
 * How many records a listing carries beyond the five it shows.
 *
 * "The rest" cannot mean all of them. ECHO's five-mile query at the demo point
 * answers 1,686 facilities (docs/BRIEF.md B14), each of which renders up to four
 * sentences with a trace apiece carrying every field's provenance and both
 * payload references — roughly seven thousand sentences, a payload nobody can
 * use and a browser lays out badly.
 *
 * Forty-five beyond the five shown makes a "View all" panel of fifty records.
 * Fifty is three times the largest section the committed fixtures produce (15
 * SEMS sites at 9311 E Ave P, 19 at the Ship Channel point, 7 ECHO facilities
 * at a quarter mile), so no recorded report is ever truncated and the bound
 * bites only on the live five-mile ECHO query, where it must. It is small
 * enough that a whole report renders in one pass, and large enough that a
 * reader who opens the panel is reading a neighbourhood rather than a page.
 *
 * The count sentence states the true total from the store and the section
 * trace lists every id counted, so nothing is hidden from a reader who opens
 * the trace. From one who does not, the records past the bound were hidden —
 * eleven Superfund sites and two ECHO facilities on the recorded Houston store,
 * 1,636 facilities on the live five-mile ECHO query — and a true count beside
 * a shorter list is worse than a contradiction, because the two numbers look
 * consistent and the gap is invisible rather than wrong. `SectionTrace.counted`
 * does not locate it either: it is in `sectionOrdering`'s order while an ECHO
 * listing is in B7 order.
 *
 * So a section a listing reads from carries this bound in `SectionSpec.carried`
 * and its card places `section/not-shown@1` beside the count: a second number,
 * recomputed from the same store by the same rule, that says what the bound
 * cost.
 */
export const CARRIED_RECORDS = 45;

/** B2: the nearest qualified monitor per pollutant, so an AQS listing shows one and carries the rest. */
export const NEAREST_MONITOR = 1;

/** The two pollutants B2 asks for by name. One section, one listing and one count each, because each answer is its own. */
export type Pollutant = "PM2.5" | "Ozone";

export const POLLUTANTS: readonly Pollutant[] = ["PM2.5", "Ozone"];

export const DEFAULT_BOUNDS: Bounds = { shown: SHOWN_RECORDS, carried: CARRIED_RECORDS };

/* -------------------------------------------------------------------------- */
/* Rules read off the templates that speak for the records they select        */
/* -------------------------------------------------------------------------- */

type Declaring = { readonly id: string; readonly requires: readonly Requirement[] };

function requiredEquals(template: Declaring, slot: string): string {
	for (const requirement of template.requires) {
		if ("slot" in requirement && requirement.slot === slot && "equals" in requirement) {
			if (typeof requirement.equals === "string") return requirement.equals;
		}
	}
	throw new Error(`${template.id} no longer requires a string value at ${slot}`);
}

function requiredAtLeast(template: Declaring, slot: string): number {
	for (const requirement of template.requires) {
		if ("slot" in requirement && requirement.slot === slot && "atLeast" in requirement) return requirement.atLeast;
	}
	throw new Error(`${template.id} no longer requires a threshold at ${slot}`);
}

/**
 * The one `npl_status_name` B7's own sentence is about. Read off
 * `sems-site/npl@1`'s requirement, so the final-NPL count and the final-NPL
 * sentence select on the same string by construction. `Site is Part of NPL
 * Site` is a different value and is not this one.
 */
export const FINAL_NPL_STATUS: string = requiredEquals(semsSiteNpl, "semsNplStatus");

/**
 * B7's "in noncompliance", counted on `FacQtrsWithNC` rather than on
 * `FacComplianceStatus` for the reason `echoNoncomplianceCount` gives: a
 * threshold on a count of quarters is exact and needs no status vocabulary.
 * Read off `echo-facility/noncompliance@1`'s own requirement, so the count, the
 * order and the record's sentence apply one threshold.
 */
export const NONCOMPLIANCE_QUARTERS: number = requiredAtLeast(echoFacilityNoncompliance, "quartersInNoncompliance");

/* -------------------------------------------------------------------------- */
/* Boundaries                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * docs/BRIEF.md B2's display boundaries, as they read on screen. A search
 * boundary is a display boundary and never a health threshold.
 */
export const BOUNDARY: { readonly [S in ReportSource]: string } = {
	echo: "5 miles",
	frs: "5 miles",
	sems: "5 miles",
	aqs: "50 km",
	airnow: "the reporting area AirNow names",
	fema: "the mapped point",
};

/**
 * The sources whose boundary is a radius from the mapped point, and so the ones
 * `section/retrieved-at@1` reads correctly for: it renders "Searched within
 * {boundary} of the mapped point". FEMA's boundary is the point itself and
 * AirNow's is an area the source defines, so neither can fill that slot without
 * the sentence saying something false.
 */
const RADIUS_BOUNDARY: ReadonlySet<ReportSource> = new Set(["echo", "frs", "sems", "aqs"]);

/* -------------------------------------------------------------------------- */
/* Outcomes                                                                   */
/* -------------------------------------------------------------------------- */

function statusPlacement(
	source: ReportSource,
	outcome: SourceOutcome,
	/** What this outcome is about, when the source's name is too coarse. FEMA is one source and two layers. */
	agency: string | null = null,
): SourcePlacement {
	return {
		scope: "source",
		source,
		outcome,
		agency,
		// `cause` exists only on an unavailable outcome and `retrievedAt` only on
		// one that answered, so each template can only render over its own.
		template: outcome.status === "unavailable" ? sourceUnavailable : sourceRetrieved,
	};
}

function retrievedAtOf(outcome: SourceOutcome): string | null {
	return outcome.status === "unavailable" ? null : outcome.retrievedAt;
}

/**
 * What a section says when its ordering is empty, read off the outcome and
 * never off the shape of the store.
 *
 * Only a `no-data` outcome is the source saying it has nothing, and it carries
 * its own words for it: an empty answer from Esri's copy is not an empty answer
 * from FEMA's own layer, and neither of them is `NO_DATA_NOTE`. Under an
 * outcome that answered, B10's note contradicts the status sentence one line
 * above it — the card would say the source answered with records and then say
 * there were none — so an answering outcome gets a note that asserts nothing
 * about what the source answered. `noRecordsHeadline` places no template over
 * that note, so it is a string the plan can defend rather than one it prints.
 */
const NONE_CARRIED_NOTE = "None of this source's records are in this report.";

function noteOf(outcome: SourceOutcome): string {
	return outcome.status === "no-data" ? outcome.note : NONE_CARRIED_NOTE;
}

/**
 * B2 asks for the nearest qualified monitor per pollutant, so a pollutant with
 * no monitor is a failure about that pollutant and has to be sayable about that
 * pollutant. No `section` subject carries a pollutant and no section template
 * names one, so the pollutant is named in the section's own note — which is
 * the technique `lib/adapters/fema.ts` already uses to make an empty answer say
 * which of its two datasets answered it.
 */
function pollutantNote(pollutant: Pollutant): string {
	return `EPA's Air Quality System listed no ${pollutant} monitor within ${BOUNDARY.aqs} of the mapped point.`;
}

/* -------------------------------------------------------------------------- */
/* Ordering                                                                   */
/* -------------------------------------------------------------------------- */

export type AnyRecord = Sealed<EvidenceRecord>;

const FARTHEST = Number.POSITIVE_INFINITY;

/**
 * Nearest first; a record with no coordinate has an unknown distance and sorts
 * after every known one.
 *
 * Exported so that what it answers can be asserted and not only what it causes.
 * Both orderings read it through `||`, where a NaN is falsy and the next key
 * silently covers for it, so through them a broken answer here is invisible.
 */
export function byDistance(a: AnyRecord, b: AnyRecord): number {
	const x = a.distanceMeters === null ? FARTHEST : a.distanceMeters.value;
	const y = b.distanceMeters === null ? FARTHEST : b.distanceMeters.value;
	// Two records with no coordinate are both `FARTHEST`, and `Infinity -
	// Infinity` is NaN. Every caller reads this through `||`, where NaN is
	// falsy and the next key quietly covers for it, so the bug has never shown
	// — but a comparator that answers NaN has ordered nothing and said it did.
	if (x === y) return 0;
	return x - y;
}

/**
 * B7's "ties by newest first". The record's `effectiveAt`, which the ECHO
 * adapter set to the last formal action date falling back to the last
 * inspection date. Null is unknown and sorts last.
 */
function byNewest(a: AnyRecord, b: AnyRecord): number {
	const x = a.effectiveAt.value;
	const y = b.effectiveAt.value;
	if (x === null) return y === null ? 0 : 1;
	if (y === null) return -1;
	return y.localeCompare(x);
}

/**
 * B7's first ECHO key, on the field `section/echo-formal-actions@1` counts:
 * `lastFormalActionDate` is non-null. Not `formalActionCount`, which is ECHO's
 * Clean Air Act column only and would undercount. A null date is ECHO's summary
 * column being empty, which the adapter and `echo-facility/no-formal-action@1`
 * both treat as a stated absence rather than as unknown, so there are two ranks
 * here and not three.
 */
function formalActionRank(record: AnyRecord): number {
	return record.kind === "echo-facility" && record.lastFormalActionDate.value !== null ? 0 : 1;
}

/**
 * B7's second ECHO key, on the column `section/echo-noncompliance@1` counts, at
 * the threshold that section and `echo-facility/noncompliance@1` share. Three
 * ranks, because `FacQtrsWithNC` is genuinely null on a real row (WESTWAY FEED
 * PRODUCTS LLC) and a facility whose quarters ECHO did not send is neither in
 * noncompliance nor known to be out of it: B7's last line puts unknown values
 * after known ones, and they stay visible.
 */
function noncomplianceRank(record: AnyRecord): number {
	if (record.kind !== "echo-facility") return 1;
	const quarters = record.quartersInNoncompliance.value;
	if (quarters === null) return 2;
	return quarters >= NONCOMPLIANCE_QUARTERS ? 0 : 1;
}

/** The source's own identifier, unique within a kind, which is what makes every order below total. */
function byId(a: AnyRecord, b: AnyRecord): number {
	return a.sourceRecordId.localeCompare(b.sourceRecordId);
}

/**
 * The two orders B7 states. Each ends on `byId`, so the same store always
 * produces the same order whatever order the records arrived in.
 *
 * `distance` is the same comparison `sectionOrdering` applies in the kernel, so
 * a SEMS listing and the ids its section trace lists are in one order.
 *
 * Exported because a comparator is only tested where it is reachable. Through
 * `orderedRecords` alone, two records that tie on every key before the id, and
 * two whose distances are both unknown, are pairs no store here produces in the
 * wrong order to begin with; called directly they are one line each.
 */
export const ORDERINGS: { readonly [N in OrderingName]: (a: AnyRecord, b: AnyRecord) => number } = {
	distance: (a, b) => byDistance(a, b) || byId(a, b),
	"echo-b7": (a, b) =>
		formalActionRank(a) - formalActionRank(b) ||
		noncomplianceRank(a) - noncomplianceRank(b) ||
		byDistance(a, b) ||
		byNewest(a, b) ||
		byId(a, b),
};

/**
 * The records of a section, in the named order.
 *
 * Membership comes from `sectionOrdering`, which applies the kernel's own
 * filter, so a listing can never describe a different set from the count beside
 * it. The kind-typed records come from the store, which is what keeps the
 * record and its template correlated without a type assertion.
 */
export function orderedRecords<K extends Kind>(
	store: EvidenceStore,
	section: SectionSpec<K>,
	ordering: OrderingName,
): readonly Sealed<RecordOf<K>>[] {
	// Membership from the kernel, order from the comparator and from nothing
	// else. Sorting `sectionOrdering`'s own return — which is what this did --
	// handed the comparator an array already in (distance, id) order, and
	// `Array.prototype.sort` is stable, so the `distance` ordering agreed with
	// its input whatever it did, including nothing at all. The records come from
	// the store's map for this kind, which is what keeps the record and its
	// template correlated without a type assertion.
	const counted = new Set(sectionOrdering(store, section).map((record) => record.sourceRecordId));
	// `Kind` and not `K`: a comparator over the union of every record is the one
	// thing a listing of any kind can be sorted by, and `RecordOf<Kind>` is
	// `EvidenceRecord`, so this needs no assertion. The kind-typed records come
	// back out of the store's own map for `section.kind`, which is what keeps a
	// record and its template correlated without one either.
	const kind: Kind = section.kind;
	const ofKind = new Map(store.ofKind(section.kind).map((record) => [record.sourceRecordId, record]));
	const inStoreOrder = store.ofKind(kind).filter((record) => counted.has(record.sourceRecordId));
	const out: Sealed<RecordOf<K>>[] = [];
	for (const record of [...inStoreOrder].sort(ORDERINGS[ordering])) {
		const typed = ofKind.get(record.sourceRecordId);
		if (typed !== undefined) out.push(typed);
	}
	return out;
}

/**
 * How many of a section's ordering this report carries, recomputed from the
 * live store exactly as the count beside it is.
 *
 * This is the number the route puts on "View all", and the reason it is a
 * function and not `listing.shown.length + listing.rest.length`: those two are
 * frozen at plan time and do not fall when a record is deleted, so the chrome
 * said 15 while the count said 14 and fourteen sentences rendered.
 */
export function carriedCount(store: EvidenceStore, section: SectionSpec): number {
	const total = sectionOrdering(store, section).length;
	return section.carried === null ? total : Math.min(total, section.carried);
}

/** What a listing under these bounds carries: the records it shows, and the rest behind "View all". */
function carriedBound(bounds: Bounds): number {
	return bounds.shown + bounds.carried;
}

/* -------------------------------------------------------------------------- */
/* Entries and listings                                                       */
/* -------------------------------------------------------------------------- */

function entryOf<K extends Kind>(
	recordId: RecordId<K>,
	templates: readonly [Template<K>, ...Template<K>[]],
): ListingEntryOf<K> {
	const place = (template: Template<K>): RecordPlacementOf<K> => ({ scope: "record", recordId, template });
	const [primary, ...secondaries] = templates;
	return { recordId, placements: [place(primary), ...secondaries.map(place)] };
}

/**
 * A listing, which takes no store: what it holds is how to rebuild its entries,
 * never the entries themselves.
 *
 * `shown` and `rest` used to be built here, out of the ordering as it stood at
 * plan time, and the card went on recomputing its count from the store beside
 * them. Delete a record inside the bound and the two disagreed: the count
 * sentence fell to 14, the frozen head still held the five entries it was built
 * with, one of them rendered nothing, and the not-shown sentence subtracted a
 * bound from a live ordering. Four sentences, nine not shown, a count of 14. A
 * live number and a frozen list cannot be reconciled by arithmetic, and the
 * live number is the guarantee this whole kernel is built on — so the list is
 * what gives way.
 */
function listingOf<K extends Kind>(
	section: SectionSpec<K>,
	ordering: OrderingName,
	bounds: Bounds,
	describe: (record: Sealed<RecordOf<K>>) => ListingEntryOf<K>,
): Listing<K> {
	// A section a listing reads from must carry that listing's bound. The
	// not-shown sentence is `ordering.length - section.carried`, so a section
	// with the wrong bound states the wrong gap and one with no bound states
	// none while the listing quietly drops the tail. The type cannot say this;
	// this can.
	if (section.carried !== carriedBound(bounds)) {
		throw new Error(
			`${section.kind} listing is bounded at ${carriedBound(bounds)} and its section carries ${String(section.carried)}`,
		);
	}
	return {
		section,
		ordering,
		bounds,
		describe,
		entries: (store) => {
			const records = orderedRecords(store, section, ordering);
			return {
				shown: records.slice(0, bounds.shown).map(describe),
				rest: records.slice(bounds.shown, carriedBound(bounds)).map(describe),
			};
		},
	};
}

/**
 * B10's "No matching records within the stated boundary", which is a claim
 * about a source that answered with nothing — so it is placed only for an
 * outcome that answered with nothing.
 *
 * Reading emptiness off the store alone was wrong twice over.
 * `lib/evidence/source.ts` gives an `ok` outcome at least one record, so an
 * empty section under `ok` is not a state the world can be in; it is a state
 * the wiring can be in, and `.dev/briefs/U3.1-report-route.md` asks for exactly
 * that wiring — one event per source card as that source settles. Every card
 * built before its records arrived said the source answered with nothing while
 * the status sentence above it said the source answered with records, and B10's
 * three states collapsed into one. The store is still consulted, because
 * `section/no-records@1` renders its note only over an empty section and a
 * placement that cannot print is a placement the report cannot explain.
 */
function noRecordsHeadline(
	store: EvidenceStore,
	outcome: SourceOutcome,
	section: SectionSpec,
): readonly SectionPlacement[] {
	if (outcome.status !== "no-data") return [];
	if (sectionOrdering(store, section).length > 0) return [];
	return [{ scope: "section", section, template: sectionNoRecords }];
}

/**
 * What the bound cost, beside the count that does not show it.
 *
 * Placed only for a section that is bounded and whose ordering is longer than
 * the bound, because `notShown` is null otherwise and the sentence would not
 * print. The number itself is nowhere in the plan: `section.carried` is the
 * bound, and the kernel subtracts it from the live ordering at render time, so
 * the gap falls as the records do.
 *
 * It takes a `Listing` and not a `SectionSpec`, because the gap it states is a
 * gap in one list — see the module comment on what that sentence may claim.
 * A section with a bound and no list is a section nothing dropped anything
 * from, and this shape is what stops one being given this sentence.
 */
function notShownHeadline(store: EvidenceStore, listing: AnyListing): readonly SectionPlacement[] {
	const section: SectionSpec = listing.section;
	const bound = section.carried;
	if (bound === null || sectionOrdering(store, section).length <= bound) return [];
	return [{ scope: "section", section, template: sectionNotShown }];
}

/**
 * A pollutant AQS returned no monitor for, on a card whose source did return
 * monitors. B2 asks for the nearest qualified monitor per pollutant, so the
 * failure belongs to the pollutant: headlines read off the unfiltered section
 * and listings off the per-pollutant ones, so an answer carrying ozone monitors
 * only left PM2.5 with no count, no note and no sentence anywhere on the card.
 *
 * When the source returned nothing at all, the unfiltered section says so once
 * in the source's own words and this says nothing: the same fact printed three
 * times is the duplication `7f2ac98` was written to remove.
 */
function pollutantHeadline(
	store: EvidenceStore,
	all: SectionSpec<"aqs-monitor-summary">,
	section: SectionSpec<"aqs-monitor-summary">,
): readonly SectionPlacement[] {
	if (sectionOrdering(store, all).length === 0) return [];
	if (sectionOrdering(store, section).length > 0) return [];
	return [{ scope: "section", section, template: sectionNoRecords }];
}

/**
 * A status-only card describes no record, so it must be holding none.
 *
 * A record the report holds and cannot describe is the one thing this tier
 * refuses to do quietly, and every status-only return below was doing it: the
 * card carries no listing, so a record of that kind in the store reaches no
 * placement at all and simply is not on the page. `air === null` is the live
 * case — `AirTemplates` says no air record can be in the store because no
 * adapter exists to put one there, which is a statement about the caller and
 * not a check. This is the check, for that case and for the four unavailable
 * ones beside it, and it fires the day an adapter lands before its template
 * does or a card is built against a store from another answer.
 */
function refuseUndescribed(store: EvidenceStore, kind: Kind): void {
	const held = store.ofKind(kind).length;
	if (held > 0) throw new Error(`the report holds ${held} ${kind} records and has no template to describe them`);
}

/**
 * The mirror image of `refuseUndescribed`, on the path where the outcome says
 * nothing and the store says otherwise.
 *
 * `noRecordsHeadline` is guarded on both the outcome and the store, and the
 * count headlines and the listings are guarded on neither — so a `no-data`
 * outcome over a store holding that source's records rendered "answered with no
 * matching records" above "Superfund sites EPA's inventory lists within 5 miles
 * of the mapped point: 15" and fifteen site sentences. One of the two halves is
 * wrong and this tier cannot tell which, so it builds no card rather than
 * printing both. The message names the contradiction, never a record.
 */
function refuseAnsweredWithNone(store: EvidenceStore, outcome: SourceOutcome, kind: Kind): void {
	if (outcome.status !== "no-data") return;
	const held = store.ofKind(kind).length;
	if (held > 0) {
		throw new Error(`the report holds ${held} ${kind} records under a source that answered with no records`);
	}
}

function countHeadline(section: SectionSpec, template: Template<"section">): SectionPlacement {
	return { scope: "section", section, template };
}

/**
 * The boundary and the retrieval time of a section, for a card whose source has
 * no count sentence to carry them. ECHO and SEMS have one — "within 5 miles of
 * the mapped point" — and repeating the boundary phrase beside it is the
 * duplication `7f2ac98` was written to remove.
 */
function retrievedAtHeadline(source: ReportSource, section: SectionSpec): readonly SectionPlacement[] {
	if (!RADIUS_BOUNDARY.has(source) || section.retrievedAt === null) return [];
	return [{ scope: "section", section, template: sectionRetrievedAt }];
}

/* -------------------------------------------------------------------------- */
/* Which template a record gets                                               */
/* -------------------------------------------------------------------------- */

/**
 * One of the three state templates, chosen on the state the adapter recorded.
 * `unavailable` gets the status-unavailable wording and only that one: the
 * other three each assert something about what the Superfund inventory
 * answered, and after a failed request nothing about that is known.
 */
function semsPrimary(record: Sealed<RecordOf<"sems-site">>): Template<"sems-site"> {
	switch (record.statusRow.status) {
		case "joined":
			return semsSiteSummary;
		case "no-row":
			return semsSiteRegistryOnly;
		case "unavailable":
			return semsSiteStatusUnavailable;
	}
}

/**
 * The primary first, then the secondaries that have something to say.
 *
 * Exactly one primary: `summary@1` and `no-status@1` are disjoint and
 * exhaustive on `complianceStatus`, and placing both would print the facility's
 * name and its distance twice. The formal-action pair is disjoint and
 * exhaustive on `lastFormalActionDate` the same way, so B7's first group and
 * the stated absence beside it are one choice, not two placements.
 * `noncompliance@1` goes on only above the threshold its count uses.
 *
 * `industry-codes@1` is not placed at all. Every secondary names its facility
 * inside its own clauses — which is what lets a secondary be true wherever it
 * is placed — so four of them printed one facility's name four times in four
 * consecutive sentences. Industry codes are the cheapest of the four to lose:
 * docs/BRIEF.md B2 asks for no industry codes, and NAICS and SIC are bare
 * numbers a reader cannot act on without a lookup this report does not offer.
 * Nothing is hidden by dropping it — `naicsCodes` and `sicCodes` are slots on
 * the record, so the record trace behind every other ECHO sentence carries
 * both, with their provenance.
 */
function echoTemplatesFor(
	record: Sealed<RecordOf<"echo-facility">>,
): readonly [Template<"echo-facility">, ...Template<"echo-facility">[]] {
	const primary = record.complianceStatus.value === null ? echoFacilityNoStatus : echoFacilitySummary;
	const formal =
		record.lastFormalActionDate.value === null ? echoFacilityNoFormalAction : echoFacilityFormalAction;
	const quarters = record.quartersInNoncompliance.value;
	const rest: Template<"echo-facility">[] = [formal];
	if (quarters !== null && quarters >= NONCOMPLIANCE_QUARTERS) rest.push(echoFacilityNoncompliance);
	return [primary, ...rest];
}

/**
 * The two flood templates are disjoint and exhaustive on `sfhaLabel`, so the
 * choice is made here rather than by placing both and letting the kernel drop
 * one. Placing both would put a placement on every flood card that cannot
 * render, and the whole point of this tier is that the choice is visible and
 * testable; picking on the slot the templates declare keeps the guard and the
 * decision naming one field.
 */
function floodTemplateFor(record: Sealed<RecordOf<"fema-flood-zone">>): Template<"fema-flood-zone"> {
	return record.sfhaLabel.value === null ? floodZoneUnmappedFlag : floodZoneSummary;
}

/* -------------------------------------------------------------------------- */
/* Sections                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * `query` is null on every section here. A `QueryProvenance` belongs to the
 * adapter that made the request and no `SourceOutcome` carries one out, so
 * there is nothing honest to put in that slot; minting one from a record's
 * payload would be this tier asserting a request it did not make. The boundary
 * and the retrieval time still reach the screen through the section's own
 * slots, and the trace lists the ids counted.
 *
 * WHICH SECTIONS ARE BOUNDED. A section a listing reads from is: the listing
 * carries a bounded head of its ordering, so that section states the bound and
 * its card places `section/not-shown@1`. A section that only backs a count is
 * not, and carries null: `section/echo-formal-actions@1`,
 * `section/echo-noncompliance@1` and the unfiltered AQS section count the whole
 * ordering and drop nothing, so a not-shown sentence over one of them would be
 * a gap that does not exist. `listingOf` refuses a section whose bound is not
 * its own, so the two cannot drift apart.
 */
function semsSection(outcome: SourceOutcome, bounds: Bounds): SectionSpec<"sems-site"> {
	return defineSection({
		kind: "sems-site",
		source: "sems",
		boundary: BOUNDARY.sems,
		query: null,
		retrievedAt: retrievedAtOf(outcome),
		filter: null,
		note: noteOf(outcome),
		carried: carriedBound(bounds),
	});
}

function semsNplSection(outcome: SourceOutcome, bounds: Bounds): SectionSpec<"sems-site"> {
	return defineSection({
		kind: "sems-site",
		source: "sems",
		boundary: BOUNDARY.sems,
		query: null,
		retrievedAt: retrievedAtOf(outcome),
		filter: { field: "semsNplStatus", equals: FINAL_NPL_STATUS },
		note: noteOf(outcome),
		carried: carriedBound(bounds),
	});
}

function echoSection(outcome: SourceOutcome, bounds: Bounds): SectionSpec<"echo-facility"> {
	return defineSection({
		kind: "echo-facility",
		source: "echo",
		boundary: BOUNDARY.echo,
		query: null,
		retrievedAt: retrievedAtOf(outcome),
		filter: null,
		note: noteOf(outcome),
		carried: carriedBound(bounds),
	});
}

/** A count and no listing, so nothing is dropped and there is no bound to state. */
function echoFormalActionSection(outcome: SourceOutcome): SectionSpec<"echo-facility"> {
	return defineSection({
		kind: "echo-facility",
		source: "echo",
		boundary: BOUNDARY.echo,
		query: null,
		retrievedAt: retrievedAtOf(outcome),
		filter: { field: "lastFormalActionDate", present: true },
		note: noteOf(outcome),
		carried: null,
	});
}

/** A count and no listing; see above. */
function echoNoncomplianceSection(outcome: SourceOutcome): SectionSpec<"echo-facility"> {
	return defineSection({
		kind: "echo-facility",
		source: "echo",
		boundary: BOUNDARY.echo,
		query: null,
		retrievedAt: retrievedAtOf(outcome),
		filter: { field: "quartersInNoncompliance", atLeast: NONCOMPLIANCE_QUARTERS },
		note: noteOf(outcome),
		carried: null,
	});
}

function frsSection(outcome: SourceOutcome, bounds: Bounds): SectionSpec<"frs-facility"> {
	return defineSection({
		kind: "frs-facility",
		source: "frs",
		boundary: BOUNDARY.frs,
		query: null,
		retrievedAt: retrievedAtOf(outcome),
		filter: null,
		note: noteOf(outcome),
		carried: carriedBound(bounds),
	});
}

function floodSection(result: FloodZoneResult, bounds: Bounds): SectionSpec<"fema-flood-zone"> {
	return defineSection({
		kind: "fema-flood-zone",
		source: "fema",
		boundary: BOUNDARY.fema,
		query: null,
		retrievedAt: retrievedAtOf(result.outcome),
		filter: null,
		// A no-data flood outcome carries the `noDataNote` of the adapter that
		// answered, so the note already says which of the two datasets answered
		// empty and FEMA's wording can never appear over an Esri result. There
		// used to be a second branch here, taking the dataset's own no-polygon
		// wording for an outcome that answered, against the case where a reader
		// removes the last flood record: it put "no polygon intersects this
		// point" on a card about a point that is in zone AE. An answer with a
		// polygon is not an answer with none, whatever the store is asked later.
		note: noteOf(result.outcome),
		carried: carriedBound(bounds),
	});
}

/** The retrieval time and the source's own no-data note. The listings are per pollutant, so this counts and never drops. */
function aqsSection(outcome: SourceOutcome): SectionSpec<"aqs-monitor-summary"> {
	return defineSection({
		kind: "aqs-monitor-summary",
		source: "aqs",
		boundary: BOUNDARY.aqs,
		query: null,
		retrievedAt: retrievedAtOf(outcome),
		filter: null,
		note: noteOf(outcome),
		carried: null,
	});
}

/** B2: the nearest qualified monitor for one pollutant. One section per pollutant, because each answer is its own. */
function aqsPollutantSection(
	outcome: SourceOutcome,
	pollutant: Pollutant,
	bounds: Bounds,
): SectionSpec<"aqs-monitor-summary"> {
	return defineSection({
		kind: "aqs-monitor-summary",
		source: "aqs",
		boundary: BOUNDARY.aqs,
		query: null,
		retrievedAt: retrievedAtOf(outcome),
		filter: { field: "pollutant", equals: pollutant },
		// Named here rather than left to `noteOf`, because this section's
		// emptiness is a fact about one pollutant and no section template can
		// name one.
		note: pollutantNote(pollutant),
		carried: carriedBound(bounds),
	});
}

function airnowSection(outcome: SourceOutcome, bounds: Bounds): SectionSpec<"airnow-observation"> {
	return defineSection({
		kind: "airnow-observation",
		source: "airnow",
		boundary: BOUNDARY.airnow,
		query: null,
		retrievedAt: retrievedAtOf(outcome),
		filter: null,
		note: noteOf(outcome),
		carried: carriedBound(bounds),
	});
}

/* -------------------------------------------------------------------------- */
/* Groups                                                                     */
/* -------------------------------------------------------------------------- */

export function idKey(id: RecordId): string {
	// The separator is written as an escape, not as a literal NUL byte. A raw
	// NUL in the source makes the whole file binary to grep, diff and every
	// review tool -- `file` reports "data" and `grep` finds nothing in it.
	// The runtime value is identical, and NUL is still the separator because
	// neither a kind nor an agency identifier can contain one.
	return `${id.kind}\u0000${id.sourceRecordId}`;
}

/**
 * The slot on this member that holds the ID the group was confirmed on, or null
 * when the member does not carry it in a slot. An FRS facility's programme IDs
 * live inside `programInterests`, which is an array of containers and not a
 * slot, so an FRS record can never lead a programme-ID group.
 */
function groupedBySlot(member: AnyRecord, matchedId: string): string | null {
	switch (member.kind) {
		case "frs-facility":
			return member.registryId.value === matchedId ? "registryId" : null;
		case "echo-facility":
			return member.registryId.value === matchedId ? "registryId" : null;
		case "sems-site":
			if (member.frsRegistryId.value === matchedId) return "frsRegistryId";
			if (member.epaSiteId.value === matchedId) return "epaSiteId";
			if (member.semsSiteId !== null && member.semsSiteId.value === matchedId) return "semsSiteId";
			return null;
		case "aqs-monitor-summary":
		case "airnow-observation":
		case "fema-flood-zone":
			return null;
	}
}

/**
 * What one B6 group puts on a card, and which card that is: the card of the
 * member that leads it.
 *
 * `crossReferences` is the registry identity the group's shared identifier
 * resolves to. `group/shared-identifier@1` ends on a bare registry ID and names
 * only two of the members, so on a Superfund card the reader is left holding a
 * number; `frs-facility/cross-reference@1` says what that number is, beside the
 * group built on it. It is empty when the lead is itself a registry record,
 * because that card states the identity in full in its own listing and a card
 * must not say one thing twice.
 */
export type LeadGroup = {
	readonly source: ReportSource;
	/** `group/shared-identifier@1`, and `group/member-count@1` above two members. */
	readonly placements: readonly [GroupPlacement, ...GroupPlacement[]];
	readonly crossReferences: readonly RecordPlacementOf<"frs-facility">[];
};

/**
 * The registry members of a group, as cross-reference placements.
 *
 * The kind is narrowed off the record and not off its id, so the placement and
 * its template are correlated by the compiler rather than by an assertion.
 */
function registryIdentities(members: readonly AnyRecord[]): readonly RecordPlacementOf<"frs-facility">[] {
	const out: RecordPlacementOf<"frs-facility">[] = [];
	for (const member of members) {
		if (member.kind !== "frs-facility") continue;
		out.push({ scope: "record", recordId: member.id, template: frsFacilityCrossReference });
	}
	return out;
}

/**
 * `group/shared-identifier@1` reads `groupedBy` off the group's lead member, so
 * the member that carries the confirmed ID in a slot is put first; the others
 * keep their order behind it. A group whose ID no member carries in a slot gets
 * no placement, and neither does a suggested group — `group/shared-identifier@1`
 * would claim a shared identifier that rule 3 never established, and no
 * template states B6's "Possible match" label. The records themselves are
 * untouched either way: every one of them is still in its own card's listing.
 *
 * `group/member-count@1` goes on only above two members, where the shared
 * identifier sentence names two of more than two and the reader would otherwise
 * not learn the group is larger.
 */
function leadGroupOf(group: FacilityGroup): LeadGroup | null {
	if (group.confidence !== "confirmed") return null;
	const lead = group.members.find((member) => groupedBySlot(member, group.matchedId) !== null);
	if (lead === undefined) return null;
	const slot = groupedBySlot(lead, group.matchedId);
	if (slot === null) return null;
	const others = group.members.filter((member) => member !== lead);
	const shared: GroupPlacement = {
		scope: "group",
		members: [lead.id, ...others.map((member) => member.id)],
		groupedBy: slot,
		template: groupSharedIdentifier,
	};
	return {
		source: lead.source,
		placements: group.members.length > 2 ? [shared, { ...shared, template: groupMemberCount }] : [shared],
		crossReferences: lead.source === "frs" ? [] : registryIdentities(group.members),
	};
}

export function groupPlacements(result: GroupingResult): readonly LeadGroup[] {
	const out: LeadGroup[] = [];
	for (const group of result.groups) {
		const lead = leadGroupOf(group);
		if (lead !== null) out.push(lead);
	}
	return out;
}

/**
 * Everything the groups put on one card.
 *
 * A record may lead more than one group on one card, so the cross-references
 * are deduplicated by identity — `idKey` is what makes an id comparable — and a
 * card never states one registry identity twice.
 */
export function groupsFor(groups: readonly LeadGroup[], source: ReportSource): CardGroups {
	const mine = groups.filter((group) => group.source === source);
	const seen = new Set<string>();
	const crossReferences: RecordPlacementOf<"frs-facility">[] = [];
	for (const group of mine) {
		for (const one of group.crossReferences) {
			const key = idKey(one.recordId);
			if (seen.has(key)) continue;
			seen.add(key);
			crossReferences.push(one);
		}
	}
	return { placements: mine.flatMap((group) => group.placements), crossReferences };
}

/* -------------------------------------------------------------------------- */
/* Cards                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A source that could not be asked gets its status and nothing else. Every
 * section sentence — a count, a retrieval time, B10's "No matching records
 * within the stated boundary" — asserts something about what the source
 * answered, and an unavailable source answered nothing. Keeping the two apart
 * on screen is B10's own requirement, and this is where that is decided.
 *
 * `agency` names what the outcome is about when the source's own name is too
 * coarse: FEMA is one `SourceId` and two layers, and both of its outcomes read
 * "FEMA National Flood Hazard Layer" without it. Null uses `AGENCY`.
 */
export function sourceCard(source: ReportSource, outcome: SourceOutcome, agency: string | null = null): Card {
	return {
		source,
		status: statusPlacement(source, outcome, agency),
		priorAttempts: [],
		headlines: [],
		listings: [],
		groups: [],
		crossReferences: [],
	};
}

export function semsCard(
	store: EvidenceStore,
	outcome: SourceOutcome,
	groups: CardGroups,
	bounds: Bounds = DEFAULT_BOUNDS,
): Card {
	const base = sourceCard("sems", outcome);
	if (outcome.status === "unavailable") {
		refuseUndescribed(store, "sems-site");
		return base;
	}
	refuseAnsweredWithNone(store, outcome, "sems-site");
	const section = semsSection(outcome, bounds);
	const npl = semsNplSection(outcome, bounds);
	// B7: SEMS records are ordered by distance, and NPL sites are also named in
	// their own sentence. Both, not either -- the second listing adds a placement
	// for records the first already holds and removes nothing. `npl@1`'s
	// requirement is this section's filter, so the kernel can never refuse the
	// template for a record the filter selected.
	const listings = [
		listingOf(section, "distance", bounds, (record) => entryOf(record.id, [semsPrimary(record)])),
		listingOf(npl, "distance", bounds, (record) => entryOf(record.id, [semsSiteNpl])),
	];
	return {
		...base,
		headlines: [
			countHeadline(section, semsSectionCount),
			countHeadline(npl, semsNplSectionCount),
			...listings.flatMap((listing) => notShownHeadline(store, listing)),
			...noRecordsHeadline(store, outcome, section),
		],
		listings,
		groups: groups.placements,
		crossReferences: groups.crossReferences,
	};
}

export function echoCard(
	store: EvidenceStore,
	outcome: SourceOutcome,
	groups: CardGroups,
	bounds: Bounds = DEFAULT_BOUNDS,
): Card {
	const base = sourceCard("echo", outcome);
	if (outcome.status === "unavailable") {
		refuseUndescribed(store, "echo-facility");
		return base;
	}
	refuseAnsweredWithNone(store, outcome, "echo-facility");
	const section = echoSection(outcome, bounds);
	const listing = listingOf(section, "echo-b7", bounds, (record) => entryOf(record.id, echoTemplatesFor(record)));
	return {
		...base,
		headlines: [
			countHeadline(section, echoSectionCount),
			countHeadline(echoFormalActionSection(outcome), echoFormalActionCount),
			countHeadline(echoNoncomplianceSection(outcome), echoNoncomplianceCount),
			...notShownHeadline(store, listing),
			...noRecordsHeadline(store, outcome, section),
		],
		listings: [listing],
		groups: groups.placements,
		crossReferences: groups.crossReferences,
	};
}

/**
 * The registry card. Every record on it gets `identity@1`, whatever the store
 * holds and whatever the groups did — see the module comment for why the
 * cross-reference moved beside the group instead.
 */
export function frsCard(
	store: EvidenceStore,
	outcome: SourceOutcome,
	groups: CardGroups,
	bounds: Bounds = DEFAULT_BOUNDS,
): Card {
	const base = sourceCard("frs", outcome);
	if (outcome.status === "unavailable") {
		refuseUndescribed(store, "frs-facility");
		return base;
	}
	refuseAnsweredWithNone(store, outcome, "frs-facility");
	const section = frsSection(outcome, bounds);
	const listing = listingOf(section, "distance", bounds, (record) => entryOf(record.id, [frsFacilityIdentity]));
	return {
		...base,
		// B2: FRS is an identity lookup, not a list, and no section template
		// counts registry rows. The boundary and the retrieval time reach the card
		// through `retrieved-at@1` instead.
		headlines: [
			...retrievedAtHeadline("frs", section),
			...notShownHeadline(store, listing),
			...noRecordsHeadline(store, outcome, section),
		],
		listings: [listing],
		groups: groups.placements,
		crossReferences: groups.crossReferences,
	};
}

/**
 * The flood card, from `FloodZoneResult` rather than from a slot of a shared
 * fan-out, because the no-data note has to be able to say which of the two
 * datasets answered and the fan-out's note cannot.
 *
 * `result.nfhl` is non-null when FEMA's own layer failed and Esri's copy
 * answered instead. That failure is a fact about the report and the reader is
 * entitled to it, so it gets a source placement of its own rather than being
 * folded into the status line or dropped: the card then says that the
 * authoritative layer could not be reached, and every record on it says in its
 * own sentence that it was read from Esri's reduced-set copy. Silently showing
 * an Esri answer under FEMA's name is the one thing docs/BRIEF.md B2 and B10
 * spend their FEMA rows preventing.
 */
export function floodCard(store: EvidenceStore, result: FloodZoneResult, bounds: Bounds = DEFAULT_BOUNDS): Card {
	// One `SourceId`, two layers, and under `AGENCY.fema` both outcomes read
	// "FEMA National Flood Hazard Layer": the card said one named source both
	// answered and could not be reached, in consecutive sentences, with no
	// record between them to tell the reader which was which. Each outcome is
	// named for the layer it is about, and the labels differ because the
	// datasets do.
	const base = sourceCard("fema", result.outcome, FEMA_DATASETS[result.dataset].label);
	const priorAttempts: readonly SourcePlacement[] =
		result.nfhl === null ? [] : [statusPlacement("fema", result.nfhl, FEMA_DATASETS.NFHL.label)];
	if (result.outcome.status === "unavailable") {
		refuseUndescribed(store, "fema-flood-zone");
		return { ...base, priorAttempts };
	}
	refuseAnsweredWithNone(store, result.outcome, "fema-flood-zone");
	const section = floodSection(result, bounds);
	const listing = listingOf(section, "distance", bounds, (record) => entryOf(record.id, [floodTemplateFor(record)]));
	return {
		...base,
		priorAttempts,
		headlines: [...notShownHeadline(store, listing), ...noRecordsHeadline(store, result.outcome, section)],
		listings: [listing],
	};
}

/**
 * B7: the nearest qualified AQS monitor per pollutant. One listing each, one
 * record shown, the rest carried. No `aqs-monitor-summary` template exists yet,
 * so the caller passes one in; with none the card is status-only and no AQS
 * record can exist to be undescribed.
 */
export function aqsCard(
	store: EvidenceStore,
	outcome: SourceOutcome,
	air: AirTemplates | null,
	bounds: Bounds = DEFAULT_BOUNDS,
): Card {
	const base = sourceCard("aqs", outcome);
	if (outcome.status === "unavailable" || air === null) {
		refuseUndescribed(store, "aqs-monitor-summary");
		return base;
	}
	refuseAnsweredWithNone(store, outcome, "aqs-monitor-summary");
	const section = aqsSection(outcome);
	const nearest: Bounds = { shown: NEAREST_MONITOR, carried: bounds.carried };
	const perPollutant = POLLUTANTS.map((pollutant) => aqsPollutantSection(outcome, pollutant, nearest));
	const listings = perPollutant.map((one) =>
		listingOf(one, "distance", nearest, (record) => entryOf(record.id, [air.aqs])),
	);
	return {
		...base,
		headlines: [
			...retrievedAtHeadline("aqs", section),
			...perPollutant.flatMap((one) => pollutantHeadline(store, section, one)),
			...listings.flatMap((listing) => notShownHeadline(store, listing)),
			...noRecordsHeadline(store, outcome, section),
		],
		listings,
	};
}

/**
 * B7: the AirNow result or its no-data state. AirNow's boundary is a reporting
 * area the source defines rather than a radius from the mapped point, so no
 * boundary sentence is placed: `section/retrieved-at@1` would read "Searched
 * within the reporting area AirNow names of the mapped point", which is not
 * English and not true.
 */
export function airnowCard(
	store: EvidenceStore,
	outcome: SourceOutcome,
	air: AirTemplates | null,
	bounds: Bounds = DEFAULT_BOUNDS,
): Card {
	const base = sourceCard("airnow", outcome);
	if (outcome.status === "unavailable" || air === null) {
		refuseUndescribed(store, "airnow-observation");
		return base;
	}
	refuseAnsweredWithNone(store, outcome, "airnow-observation");
	const section = airnowSection(outcome, bounds);
	const listing = listingOf(section, "distance", bounds, (record) => entryOf(record.id, [air.airnow]));
	return {
		...base,
		headlines: [...notShownHeadline(store, listing), ...noRecordsHeadline(store, outcome, section)],
		listings: [listing],
	};
}

/* -------------------------------------------------------------------------- */
/* The plan                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The whole report, in reading order: the origin, then one card per source in
 * the order docs/BRIEF.md A2 screen 3 introduces them — cleanup, flood, air,
 * facility — with the registry last, because it answers what the records on the
 * cards above it are rather than listing anything of its own.
 */
export function selectReport(input: ReportInput, bounds: Bounds = DEFAULT_BOUNDS): ReportPlan {
	const groups = groupPlacements(input.grouping);
	return {
		origin: [
			{ scope: "origin", match: input.match, template: originMatch },
			{ scope: "origin", match: input.match, template: originPoint },
		],
		cards: [
			semsCard(input.store, input.sources.sems, groupsFor(groups, "sems"), bounds),
			floodCard(input.store, input.flood, bounds),
			aqsCard(input.store, input.sources.aqs, input.air, bounds),
			airnowCard(input.store, input.sources.airnow, input.air, bounds),
			echoCard(input.store, input.sources.echo, groupsFor(groups, "echo"), bounds),
			frsCard(input.store, input.sources.frs, groupsFor(groups, "frs"), bounds),
		],
	};
}

/**
 * Every placement in a listing, in reading order, against a live store.
 *
 * The store is the argument that used to be missing. A listing holds no records
 * now, so there is no other honest way to ask it what it says — which is the
 * point: the records these placements speak for are the records the count
 * beside them counted, at the moment both were asked.
 */
export function listingPlacements(store: EvidenceStore, listing: AnyListing): readonly Placement[] {
	const entries = listing.entries(store);
	const out: Placement[] = [];
	for (const entry of [...entries.shown, ...entries.rest]) out.push(...entry.placements);
	return out;
}

/** Every placement on a card, in reading order: status, then headlines, then groups, then records. */
export function cardPlacements(store: EvidenceStore, card: Card): readonly Placement[] {
	return [
		card.status,
		...card.priorAttempts,
		...card.headlines,
		...card.groups,
		...card.crossReferences,
		...card.listings.flatMap((listing) => listingPlacements(store, listing)),
	];
}

/** Every placement in the plan, in reading order. What the route renders, and what the tests assert over. */
export function planPlacements(store: EvidenceStore, plan: ReportPlan): readonly Placement[] {
	return [...plan.origin, ...plan.cards.flatMap((card) => cardPlacements(store, card))];
}
