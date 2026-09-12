/**
 * Group templates: several records the B6 grouping rules tied together.
 *
 * Which records form a group is `lib/report/grouping.ts`'s decision and is
 * wired in a later unit. This file only proves the scope renders: a group
 * placement names its members and the slot they were grouped on, and rendering
 * reads each member from the live store. A deleted member leaves the group
 * smaller rather than leaving stale text behind, and a group whose last member
 * is gone renders nothing at all.
 *
 * docs/BRIEF.md B6 rules 1 and 4.
 *
 * On the wording. B6 says grouping must not claim that matched records are one
 * legal or physical facility, and the real data shows why. Registry
 * 110000462703 carries two Superfund records named PASADENA REFINING FIRE and
 * PRSI FIRE. Those are two incidents at a facility, not two names for a
 * facility, so a sentence calling them "one facility" would state something
 * the records do not support. The template states the fact instead: these
 * records share an identifier. What that implies is the reader's to judge.
 */

import { defineTemplate, sentence } from "@/lib/evidence/templates";

/** B6 rule 1: two EPA site IDs under one FRS registry ID. */
export const groupSharedIdentifier = defineTemplate("group", "group/shared-identifier@1", (field) => [
	sentence`${field("subject")} and ${field("otherSubject")} share one EPA facility registry ID, ${field("groupedBy")}.`,
]);

/** The size of a group, which is the number of members still in the store. */
export const groupMemberCount = defineTemplate("group", "group/member-count@1", (field) => [
	sentence`${field("members")} records grouped under ${field("groupedBy")}.`,
]);

export const groupTemplates = [groupSharedIdentifier, groupMemberCount];
