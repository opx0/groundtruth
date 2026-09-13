/**
 * Section templates: one source's records within its stated boundary.
 *
 * Every number in here is `field("count")`, which renders the length of the
 * section's ordering as recomputed from the store. None of these sentences can
 * hold a number of its own, because a template holds no values at all. That is
 * the point: remove a Superfund site from the store and "lists 15 sites"
 * becomes "lists 14 sites" with nothing else touched.
 *
 * A section template is not bound to a record kind, so the same
 * `Template<"section">` renders for SEMS, ECHO or any other source. What
 * differs between sections is the `SectionSpec` behind them: the kind, the
 * boundary, the query, and the filter that selects the ordering.
 *
 * docs/BRIEF.md A2 screen 3 and B7.
 */

import { defineTemplate, sentence } from "@/lib/evidence/templates";

/** A2 screen 3: "EPA's Superfund inventory (SEMS) lists 15 sites within 5 miles of the mapped point." */
export const semsSectionCount = defineTemplate("section", "section/sems-count@1", (field) => [
	sentence`EPA's Superfund inventory lists ${field("count")} sites within ${field("boundary")} of the mapped point.`,
]);

/** A2 screen 3, B7: the final-NPL sites get their own sentence, counted the same way. */
export const semsNplSectionCount = defineTemplate("section", "section/sems-npl-count@1", (field) => [
	sentence`${field("count")} sites on the final National Priorities List within ${field("boundary")} of the mapped point.`,
]);

/** A2 screen 3: "EPA ECHO lists {n} regulated facilities within 5 miles." */
export const echoSectionCount = defineTemplate("section", "section/echo-count@1", (field) => [
	sentence`EPA ECHO lists ${field("count")} regulated facilities within ${field("boundary")} of the mapped point.`,
]);

/** A2 screen 3: "{n} have a formal enforcement action on record." */
export const echoFormalActionCount = defineTemplate("section", "section/echo-formal-actions@1", (field) => [
	sentence`${field("count")} of them have a formal enforcement action on record.`,
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
	sentence`${field("count")} of them have at least one quarter of noncompliance in ECHO's twelve-quarter history.`,
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
	sectionRetrievedAt,
];
