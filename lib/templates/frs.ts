/**
 * The FRS facility templates. docs/BRIEF.md B2: FRS is an identity lookup, not
 * a list. A five-mile query answers 6,915 programme-interest rows, so nothing
 * here renders a list, a count, or a distance; the registry answers what a
 * facility *is* for facilities ECHO and SEMS already found. A2 promises no
 * sentence for this source, which makes the pressure on this file to say more
 * than the record holds, so what follows is the short list of things the slots
 * actually support.
 *
 * On which template prints when. `identity@1` is the facility as its own
 * subject: the registry's name, the registry's ID, and the latest date the
 * registry carries for it. `cross-reference@1` is the identity printed beneath
 * a record from another source that this registry ID resolved. It states one
 * fact the registry itself holds — this ID is carried under this name — and
 * it does not say "this facility". B6 rule 3 groups on a *possible* match, so
 * a deixis onto whatever the selection policy placed above would quietly turn
 * a suggested group into an identity claim; naming the ID leaves the join to
 * the reader, and the ID is the evidence the group was built on anyway. Which
 * placement it is, is the selection policy's decision, not a branch here.
 *
 * On the name. The registry's name for a facility and another EPA system's
 * name for the same facility are routinely different — registry 110000460885
 * is HOUSTON REFINERY here and VALERO PLUME in Envirofacts. Both sentences
 * therefore attribute: the registry *lists* the facility *under the name* X,
 * or *carries the name* X *for* an ID. Neither says the facility is named X,
 * because the record holds no field that would make that true, and the trace
 * panel carries the other agency's name where it exists.
 *
 * On where the name sits. No clause ends on `subject`. Registry names end in
 * their own period often enough — PASADENA REFINING SYSTEM, INC. is one of the
 * two committed fixtures — that a name in final position renders "INC..". The
 * registry ID never carries a period, so it takes the end of both clauses that
 * name it and the name sits inside them. A period mid-clause, "INC. under
 * registry ID …", is ordinary English and stays.
 *
 * On the update date. `sourceUpdatedAt` is the largest UPDATE_DATE across this
 * facility's rows. It is not an edit stamp on the facility, and it does not
 * identify a row: UPDATE_DATE is null on 25 of registry 110000460885's 38
 * rows, so which row was most recently updated is not a thing the layer
 * answers, and the clause no longer says it is. What a maximum over the dates
 * present does support is the latest update date carried on any row, so that
 * is what the clause states.
 *
 * It prints through `day()`. `parse-epoch-ms` widens FRS's date into an
 * instant, 2024-03-14T10:51:51Z, and a clause printing that whole string
 * claims a clock time and a UTC offset FRS never stated; A3's own trace row
 * shows the field as 2024-03-14. The instant stays in the trace as the
 * normalized value, so nothing is hidden by showing less.
 *
 * It is its own clause: UPDATE_DATE is null on real rows — on the first of
 * this facility's 38 — and a null must take one clause with it, not the name.
 * There is no `fallback` on it, unlike `sems-site/summary@1`'s status date: a
 * record trace always carries `sourceUpdatedAt` and its provenance whether or
 * not a span shows it, so the null is on screen in the trace either way, and
 * B10's "Date unavailable" would spend a whole sentence restating it.
 *
 * On requirements. Neither template declares one. Both print only values they
 * reference and neither asserts a state the record could fail to be in, so
 * there is no right record a wrong template here could render over: the kind
 * gate is the whole gate. A null `sourceUpdatedAt` is not such a state — the
 * clause that references it drops itself.
 *
 * What is not here, and why. There is no sentence counting programme
 * interests: `programInterests` is an array of objects, so `SlotKeys` does not
 * hold it, no slot holds 38 or 15, and the kernel has no way to mint either
 * number. The rows are reachable in the trace panel by path
 * ("programInterests.7.activeStatus"), which is where a 38-row identity
 * listing belongs. There is no sentence about the coordinate: its quality
 * fields live on the record's `location`, which is a container of leaves and
 * not a slot, and ACCURACY_VALUE and COLLECT_MTH_DESC are null on the real
 * rows anyway. `distanceMeters` is a slot and is deliberately unused — an
 * identity record's distance from the mapped point is not a fact the reader is
 * shown, B2 gives FRS no list to be near the top of, and the SEMS and ECHO
 * records this one resolves print their own distances. `effectiveAt` is never
 * referenced: FRS has no as-of concept, the adapter records it absent, and a
 * clause on it could never print. `sourceUrl` stays in the trace panel, where
 * every other record's link is.
 *
 * Neither `registryId` nor `subject` can be null, so the first clause of
 * either template always renders, and `identity@1`'s "its" never loses the
 * antecedent it leans on.
 */

import { day, defineTemplate, sentence } from "@/lib/evidence/templates";

/** The facility as its own subject: what the registry calls it, and the latest date it carries for it. */
export const frsFacilityIdentity = defineTemplate("frs-facility", "frs-facility/identity@1", (field) => [
	sentence`EPA's facility registry lists ${field("subject")} under registry ID ${field("registryId")}.`,
	sentence`The latest update date on any of its programme-interest rows is ${day(field("sourceUpdatedAt"))}.`,
]);

/**
 * The identity printed under a record from another source that this registry
 * ID resolved. It names the ID, not the record above it, so a B6 rule-3
 * "Possible match" stays a possible match: the sentence is true of the
 * registry whether or not the grouping above it is right.
 */
export const frsFacilityCrossReference = defineTemplate("frs-facility", "frs-facility/cross-reference@1", (field) => [
	sentence`EPA's facility registry carries the name ${field("subject")} for registry ID ${field("registryId")}.`,
]);

export const frsTemplates = [frsFacilityIdentity, frsFacilityCrossReference];
