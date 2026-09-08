/**
 * The SEMS site templates. docs/BRIEF.md B8:
 *
 *   {name}, {distance}. {nplStatus}. Status: {nonNplStatus}, as of {statusDate}.
 *
 * The name slot is `subject`, the kernel's coalesce of the Envirofacts name
 * over the FRS name, so its trace carries both names and the clause survives
 * when Envirofacts has no row for the site.
 */

import { defineTemplate, fallback, km, sentence } from "@/lib/evidence/templates";

export const semsSiteSummary = defineTemplate("sems-site", "sems-site/summary@1", (field) => [
	sentence`${field("subject")}, ${km(field("distanceMeters"))}.`,
	sentence`${field("nplStatus")}.`,
	sentence`Status: ${field("nonNplStatus")}, as of ${fallback(field("statusDate"), "Date unavailable")}.`,
]);

/** B7: an NPL site is also named in its own sentence. */
export const semsSiteNpl = defineTemplate("sems-site", "sems-site/npl@1", (field) => [
	sentence`${field("subject")} is listed as ${field("nplStatus")}, ${km(field("distanceMeters"))} from the mapped point.`,
]);

export const semsTemplates = [semsSiteSummary, semsSiteNpl];
