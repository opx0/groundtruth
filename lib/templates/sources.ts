/**
 * Source templates: one source's outcome, per docs/BRIEF.md B10.
 *
 * "Source unavailable" and "no matching records within the stated boundary"
 * are different facts and must look different on screen. They are also
 * different subjects: a section with zero records says what the source
 * answered, this says the source could not be asked. The shapes keep them
 * apart without a runtime check. `cause` exists only on an unavailable
 * outcome and `retrievedAt` only on one that answered, so the unavailable
 * template renders nothing for a source that answered, and the retrieved
 * template renders nothing for one that did not.
 *
 * None of these values came from an agency: they are facts about our own
 * request. The trace says so, listing the cause, the raw code the source sent
 * verbatim, and the retry hint, with no source provenance to claim.
 */

import { defineTemplate, sentence } from "@/lib/evidence/templates";

/** B10: the source could not be asked. */
export const sourceUnavailable = defineTemplate("source", "source/unavailable@1", (field) => [
	sentence`${field("agency")} could not be reached: ${field("cause")}.`,
	sentence`It answered ${field("rawCode")}.`,
	sentence`Retry after ${field("retryAfter")}.`,
]);

/** B7 rule 2: a source that answered, and when. */
export const sourceRetrieved = defineTemplate("source", "source/retrieved@1", (field) => [
	sentence`${field("agency")} answered ${field("status")}, retrieved ${field("retrievedAt")}.`,
]);

export const sourceTemplates = [sourceUnavailable, sourceRetrieved];
