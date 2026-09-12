/**
 * The SEMS site templates. docs/BRIEF.md B8:
 *
 *   {name}, {distance}. {nplStatus}. Status: {nonNplStatus}, as of {statusDate}.
 *
 * The name slot is `subject`, the kernel's coalesce of the Envirofacts name
 * over the FRS name, so its trace carries both names and the clause survives
 * when Envirofacts has no row for the site.
 *
 * On which status a sentence prints. Envirofacts' `npl_status_name` and the FRS
 * layer's `ACTIVE_STATUS` are different agencies' fields with different
 * vocabularies, and the adapter keeps them apart so neither can stand in for
 * the other. Printing both in one summary states the same fact twice in two
 * capitalizations, which reads as a defect rather than as rigour, so the
 * summary prints the Superfund inventory's own answer and the trace panel
 * carries every other field including the registry's.
 *
 * Which of these a record gets is the selection policy's decision, not a
 * branch inside a template, and that keeps the choice visible and testable.
 * The record's `statusRow` is the input to that decision: `joined` may print
 * the summary, `no-row` the registry-only wording, `unavailable` only the
 * status-unavailable wording, since the other two would each state something
 * about the inventory's answer that is not known.
 */

import { defineTemplate, fallback, km, sentence } from "@/lib/evidence/templates";

/** The site joined to an Envirofacts row, and the two agencies agree. */
export const semsSiteSummary = defineTemplate("sems-site", "sems-site/summary@1", (field) => [
	sentence`${field("subject")}, ${km(field("distanceMeters"))}.`,
	sentence`${field("semsNplStatus")}.`,
	sentence`Status: ${field("nonNplStatus")}, as of ${fallback(field("statusDate"), "Date unavailable")}.`,
]);

/**
 * No Envirofacts row joined. The registry's status is printed under the
 * registry's name, and the gap is stated rather than papered over with it.
 */
export const semsSiteRegistryOnly = defineTemplate("sems-site", "sems-site/registry-only@1", (field) => [
	sentence`${field("subject")}, ${km(field("distanceMeters"))}.`,
	sentence`EPA's facility registry lists it as ${field("frsActiveStatus")}.`,
	sentence`The Superfund inventory returned no status row for ${field("epaSiteId")}.`,
]);

/**
 * The Envirofacts request for this site failed. Nothing about the inventory's
 * answer is known, so the sentence says so and stops: it must not print the
 * registry-only wording, which claims the inventory answered with no row.
 * The record's `statusRow` is what tells the selection policy this is the one.
 */
export const semsSiteStatusUnavailable = defineTemplate("sems-site", "sems-site/status-unavailable@1", (field) => [
	sentence`${field("subject")}, ${km(field("distanceMeters"))}.`,
	sentence`EPA's facility registry lists it as ${field("frsActiveStatus")}.`,
	sentence`The Superfund inventory's status for ${field("epaSiteId")} could not be retrieved.`,
]);

/**
 * The two agencies disagree. Both are printed, attributed, because a
 * disagreement between government systems is the fact worth showing.
 */
export const semsSiteDisagreement = defineTemplate("sems-site", "sems-site/disagreement@1", (field) => [
	sentence`${field("subject")}, ${km(field("distanceMeters"))}.`,
	sentence`The Superfund inventory lists it as ${field("semsNplStatus")}.`,
	sentence`EPA's facility registry lists it as ${field("frsActiveStatus")}.`,
]);

/** B7: an NPL site is also named in its own sentence. */
export const semsSiteNpl = defineTemplate("sems-site", "sems-site/npl@1", (field) => [
	sentence`${field("subject")} is listed by SEMS as ${field("semsNplStatus")}, ${km(field("distanceMeters"))} from the mapped point.`,
]);

export const semsTemplates = [
	semsSiteSummary,
	semsSiteRegistryOnly,
	semsSiteStatusUnavailable,
	semsSiteDisagreement,
	semsSiteNpl,
];
