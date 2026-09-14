/**
 * Section templates: one source's records within its stated boundary.
 *
 * Every sentence here is label-then-value, and that is forced rather than
 * chosen. A template cannot branch, so one carrying a count has to read
 * correctly at nought, at one and at 1,686. "lists {count} sites" becomes
 * "lists 1 sites" the moment a section holds one record, and the ECHO
 * formal-action count is exactly 1 on the recorded facilities, so this is not
 * a hypothetical. A2 writes these sentences the other way round; the count
 * being a live read of the store is what makes the register non-negotiable.
 *
 * Every number in here is `field("count")`, which renders the length of the
 * section's ordering as recomputed from the store. None of these sentences can
 * hold a number of its own, because a template holds no values at all. That is
 * the point: remove a Superfund site from the store and "lists 15 sites"
 * becomes "lists 14 sites" with nothing else touched.
 *
 * A section template is not bound to a record kind, so the same
 * `Template<"section">` renders for SEMS, ECHO or any other source. What
 * differs between sections is the `SectionSpec` behind them: the kind and the
 * source it comes from, the boundary, the query, the filter that selects the
 * ordering, and the three fields the last three templates in this file exist
 * to print -- `retrievedAt` for `retrieved-at@1`, `note` for `no-records@1`,
 * and `carried`, which `sectionSubject` subtracts from the ordering's length
 * to get the `notShown` that `not-shown@1` reads.
 *
 * docs/BRIEF.md A2 screen 3 and B7.
 */

import { defineTemplate, sentence } from "@/lib/evidence/templates";

/** A2 screen 3: "EPA's Superfund inventory (SEMS) lists 15 sites within 5 miles of the mapped point." */
export const semsSectionCount = defineTemplate("section", "section/sems-count@1", (field) => [
	sentence`Superfund sites EPA's inventory lists within ${field("boundary")} of the mapped point: ${field("count")}.`,
]);

/** A2 screen 3, B7: the final-NPL sites get their own sentence, counted the same way. */
export const semsNplSectionCount = defineTemplate("section", "section/sems-npl-count@1", (field) => [
	sentence`Sites on the final National Priorities List within ${field("boundary")} of the mapped point: ${field("count")}.`,
]);

/** A2 screen 3: "EPA ECHO lists {n} regulated facilities within 5 miles." */
export const echoSectionCount = defineTemplate("section", "section/echo-count@1", (field) => [
	sentence`Regulated facilities EPA ECHO lists within ${field("boundary")} of the mapped point: ${field("count")}.`,
]);

/** A2 screen 3: "{n} have a formal enforcement action on record." */
export const echoFormalActionCount = defineTemplate("section", "section/echo-formal-actions@1", (field) => [
	sentence`Facilities within ${field("boundary")} with a formal enforcement action in ECHO's facility summary: ${field("count")}.`,
]);

/**
 * A2 screen 3 asks for "{n} are listed in current noncompliance." The sentence
 * states the narrower fact the records actually support.
 *
 * ECHO carries two candidates for "in noncompliance". `FacComplianceStatus` is
 * a status vocabulary ("No Violation Identified", "Violation Identified", and
 * whatever else ECHO has not sent us yet), and counting one of its values would
 * mean asserting that every other value means compliance -- a guess at the
 * meaning of a status, which docs/BRIEF.md B2 forbids. `FacQtrsWithNC` is a
 * count of quarters, so a threshold on it is exact and needs no vocabulary at
 * all. The selection policy counts and orders on that column, and this sentence
 * says what that column is: a twelve-quarter history, not a statement about
 * today. ECHO_CAVEATS says the same thing on every record.
 */
export const echoNoncomplianceCount = defineTemplate("section", "section/echo-noncompliance@1", (field) => [
	sentence`Facilities within ${field("boundary")} with at least one quarter of noncompliance in ECHO's twelve-quarter history: ${field("count")}.`,
]);

/**
 * B10: a source that answered with nothing. `note` exists only on an empty
 * section, so this cannot render over a section that holds records, and the
 * counting templates above still render "0 sites" for the same subject if the
 * report asks them to. Distinct from "source unavailable", which is a `source`
 * claim and says why it could not be asked at all.
 */
export const sectionNoRecords = defineTemplate("section", "section/no-records@1", (field) => [
	sentence`${field("note")}`,
]);

/**
 * B7 offers "View all" for the records beyond the first five, and B2 says the
 * same. Neither anticipated that ECHO answers 1,686 facilities within five
 * miles of the demo point, which is more sentences and traces than a page can
 * carry, so the report carries a bounded head of the ordering and this sentence
 * states what that cost. `notShown` exists only on a section that left records
 * out, so it cannot render "0 not shown" over one that showed everything, and
 * it is recomputed from the store so it drops as records do.
 *
 * The register is label-then-value on purpose: a template cannot branch, so a
 * sentence carrying a count has to read correctly at one and at a thousand.
 *
 * It says "this list", not "this report". The number is one section's gap, and
 * a card can hold more than one list: the Superfund card counts ten left out of
 * its main list while three of those ten are on the card anyway, one through
 * the final-NPL list and two through a group sentence. "This report did not
 * carry" was false about exactly those three.
 */
export const sectionNotShown = defineTemplate("section", "section/not-shown@1", (field) => [
	sentence`Records within ${field("boundary")} of the mapped point that this list leaves out: ${field("notShown")}.`,
]);

/** The retrieval time of a section, for the section header. */
export const sectionRetrievedAt = defineTemplate("section", "section/retrieved-at@1", (field) => [
	sentence`Searched within ${field("boundary")} of the mapped point, retrieved ${field("retrievedAt")}.`,
]);

export const sectionTemplates = [
	semsSectionCount,
	semsNplSectionCount,
	echoSectionCount,
	echoFormalActionCount,
	echoNoncomplianceCount,
	sectionNoRecords,
	sectionNotShown,
	sectionRetrievedAt,
];
