/**
 * The SEMS site templates. docs/BRIEF.md B8 sketched the summary as:
 *
 *   {name}, {distance}. {nplStatus}. Status: {nonNplStatus}, as of {statusDate}.
 *
 * Three of those four slots are printed differently now, for reasons recorded
 * below; the sketch is the shape, not the copy.
 *
 * The name slot is `subject`, the kernel's coalesce of the Envirofacts name
 * over the FRS name, so its trace carries both names and the clause survives
 * when Envirofacts has no row for the site.
 *
 * Every lead clause says what the distance is measured from. `5.50 km` alone
 * names no origin, and a reader has no way to know whether it is measured from
 * the mapped point, from the city, or between two sites. `npl@1` has said
 * "from the mapped point" since it was written and `lib/templates/echo.ts`
 * states the rule and applies it to both of the clauses it still prints a
 * distance in; the other three here had never said it and now do.
 *
 * On which status a sentence prints. Envirofacts' `npl_status_name` and the
 * FRS layer's `ACTIVE_STATUS` are not two agencies' answers to one question.
 * The layer's own `fields` entry for `ACTIVE_STATUS`, in
 * `tests/fixtures/sems/arcgis-5mi-houston.json`, reads "The status of the
 * environmental interest at the facility or site", and `INTEREST_TYPE` is "The
 * environmental permit or regulatory program that applies to the facility
 * site". So `ACTIVE_STATUS` belongs to an interest, `SUPERFUND (NON-NPL)` or
 * `SUPERFUND NPL`, and not to the site. A clause that printed it as what the
 * registry "lists it as" attributed an interest-level status to the site, so
 * both clauses that print it now name the interest it is the status of, and
 * `interestType` is on screen for the first time.
 *
 * On the pronoun that clause used to carry, which is the one defect in this
 * file that was latent rather than visible. It read `records its
 * ${interestType} interest as ${frsActiveStatus}`, and "its" leaned on the lead
 * clause, `${subject}, ${km(distanceMeters)} from the mapped point.` — the one
 * clause here that can drop whole. `LATITUDE83` and `LONGITUDE83` are
 * `z.number().nullable()` in the adapter's own `FrsAttrs`, so a row with no
 * coordinate is a shape the layer is allowed to send; `point()` returns null
 * for it, `complete` leaves `distanceMeters` null, and the clause goes. What
 * was left named no site and began with a pronoun for it:
 *
 *   EPA's facility registry records its SUPERFUND (NON-NPL) interest as SITE
 *   IS PART OF NPL SITE. The Superfund inventory returned no status row for
 *   TXN000607155.
 *
 * `lib/templates/frs.ts` closes this hazard by arguing that neither slot in its
 * first clause can be null; `lib/templates/fema.ts` closes it by naming the
 * area again in every clause rather than saying "it". This file had neither
 * argument and now takes fema's: the clause names the facility itself, through
 * `subject`, which is a coalesce over two names and cannot be null.
 *
 * It names it as `the ${interestType} interest at ${subject}` and not as
 * `${subject}'s ${interestType} interest`. Three reasons, in order of weight.
 * The clause after it already prints the EPA site ID, so identifying the site
 * here by ID would put TXN000607155 in two consecutive sentences and tell the
 * reader nothing twice; the name is the identifier they have not been given
 * yet. "at" is the layer's own preposition — its `ACTIVE_STATUS` description
 * is "The status of the environmental interest at the facility or site" — so
 * the attribution is worded the way the agency worded it. And a possessive
 * would set an apostrophe against a name that can end in its own period
 * (`PASADENA REFINING SYSTEM, INC.'s`), which is the hazard
 * `lib/templates/frs.ts` keeps names out of clause-final position for; here the
 * name sits mid-clause and the clause ends on the status, which carries no
 * period of its own.
 *
 * The price is that the name prints twice whenever the lead clause survives,
 * which on the recorded bytes is every time. That is the price `fema.ts` pays
 * in its weaker form — it repeats "this area" rather than a value — and it is
 * worth paying here, because the cheaper wording ("the interest at this site")
 * leaves the site unnamed in exactly the case this is about, the one where the
 * lead clause is gone. A repeated name costs a reader a second; an unattached
 * pronoun costs them the fact.
 *
 * The other two templates were checked for the same lean and neither has one.
 * `summary@1`'s three status clauses are labelled statements of their own
 * column — `NPL status: …` — that point at nothing outside themselves, and its
 * naming clause cannot drop, so the one clause there that can drop is the
 * distance and it takes only itself.
 *
 * WHAT `npl@1` NO LONGER SAYS, 2026-09-17. Its naming clause used to print the
 * status as well as the name — `${subject} is listed by SEMS as
 * ${semsNplStatus}.` — and on the demo card a reader met one site's NPL status
 * twice, back to back. The main SEMS listing is ordered by distance and US OIL
 * RECOVERY ranks fifth of fifteen at 3.92 km, so it is inside the shown five as
 * well as in the final-NPL listing under them:
 *
 *   US OIL RECOVERY, EPA ID TXN000607093. 3.92 km from the mapped point. NPL
 *   status: Currently on the Final NPL. Non-NPL status date: 2010-07-05.
 *   US OIL RECOVERY is listed by SEMS as Currently on the Final NPL. 3.92 km
 *   from the mapped point.
 *
 * `.dev/PLAN.md` item 19 had filed that as impossible on the demo address,
 * reasoning that both final-NPL sites fall outside the nearest five. That holds
 * for `TXD980748453` (twelfth, 6.84 km) and not for `TXN000607093`, and the
 * item now says so.
 *
 * docs/BRIEF.md A2 says what this block is for: "Two sites on the final
 * National Priorities List within 5 miles: U.S. OIL RECOVERY, 3.92 km, and
 * GENEVA INDUSTRIES/FUHRMANN ENERGY, 6.84 km." Name and distance, and no
 * per-site status. Nothing is lost by taking the status out of the sentence:
 * the section headline above the listing states it once for all of them, the
 * section filter is `semsNplStatus equals` that same string so every record in
 * the listing carries it by construction, `summary@1` prints the column for
 * every site that reaches the shown five, and the trace behind this sentence
 * still carries `semsNplStatus` and its provenance the way it carries every
 * other slot of the record.
 *
 * The distance stays, and on the overlap it does print twice. That is A2's
 * choice and not an oversight: this line is the only place GENEVA
 * INDUSTRIES/FUHRMANN ENERGY gets a distance at all, because it ranks twelfth
 * and never reaches the shown five. The same number twice costs a reader a
 * glance; dropping it costs the second site the only number that locates it.
 *
 * The clause that survives has to name the site without the status, and it
 * cannot be the bare name. `lib/templates/frs.ts` keeps names out of
 * clause-final position because names end in their own period often enough that
 * `${subject}.` renders "INC..", and this is not only a registry hazard: the
 * SEMS layer fixture `tests/fixtures/sems/arcgis-5mi-houston.json` carries two
 * rows named PASADENA REFINING SYSTEM, INC., and `subject` coalesces over
 * exactly those names. So the clause keeps its verb and loses its object. "is
 * listed by SEMS" is the kind gate's own guarantee restated — every record this
 * template can render over is a SEMS site — and the section it sits in says
 * what the listing is.
 *
 * `equals` now carries weight it did not carry before, which is the argument
 * for keeping it exactly as it is. While the sentence printed the
 * status, this template placed over the wrong record said something visibly
 * false ("VALERO PLUME is listed by SEMS as Not on the NPL" inside a final-NPL
 * block); now it would say something true about a site that does not belong in
 * the listing, and nothing on screen would give it away. The requirement is the
 * only thing standing there, and it is the same string `FINAL_NPL_STATUS` in
 * `lib/report/selection.ts` filters the section on, so the count, the listing
 * and this sentence still cannot describe different sets. The test that used to
 * assert the false sentence now asserts the true-but-misplaced one, which is
 * what it was always testing for.
 *
 * Nine test files moved with the sentence and none was loosened to a substring
 * to make it pass. Four hold the sentence itself:
 * `tests/unit/templates/sems.test.ts` (the cross-product table and four cases
 * below it), `tests/unit/report/selection.test.ts` (B7's placement and the
 * no-coordinate case), `tests/unit/evidence/scopes.test.ts` (the section and
 * the record agreeing on one site) and `tests/e2e/claims.spec.ts` (the card as
 * a browser reads it). Four pin the demo report's openable spans, which fell
 * from 173 to 171 because the two final-NPL sentences each lost their
 * `semsNplStatus` span: `report-flow`, `report-screen`, `trace-panel` and
 * `trace-view` under `tests/unit/app/`. Those numbers are pinned exactly so
 * that a template quietly losing a slot is a failure, which is what this was,
 * deliberately. And `tests/unit/app/report-route.test.ts` gained the assertion
 * this defect was measured by: the whole card, both listings, with nothing
 * stubbed between the store and the rendered sentences.
 *
 * THE DISTANCE IN `npl@1` IS NOW ITS OWN CLAUSE. It used to be one clause
 * carrying the NPL status and the distance together, and a clause dies whole
 * when any ref has nothing to show, so a final-NPL site with no FRS coordinate
 * got no B7 sentence at all — while `section/npl-count@1` on the same card
 * still counted it. The count said two and one sentence appeared, which is
 * exactly the drift a separate final-NPL section exists to prevent. The
 * previous pass filed this as "a silence rather than a false claim" and
 * deferred it; that reason is spent, because the claim is the count standing
 * beside the silence.
 *
 * Split, the naming clause cannot drop: its one reference is `subject`, a
 * coalesce over two names that is never null, so it renders wherever this
 * template renders at all. B7's sentence names the site whatever the coordinate
 * does, and the distance drops alone. The second clause is byte-identical to
 * `echo-facility/summary@1`'s and `echo-facility/no-status@1`'s, which split
 * the same slot for the same reason, and `fallback` is the wrong instrument
 * there for the reason `lib/templates/echo.ts` argues: `distanceMeters` is
 * `Sourced<number> | null`, so a null leaves no leaf, and a fallback span would
 * put text on screen with a dead trace behind it.
 *
 * The other three were then read for the same shape — one clause carrying a
 * slot that can be null beside one that cannot — and all three had it, in the
 * lead clause `${subject}, ${km(distanceMeters)} from the mapped point.`. Two
 * of them still do. In `registry-only@1` and `status-unavailable@1` the cost is
 * bounded: the clause after it names the facility again, which is the paragraph
 * above, so a null coordinate costs the distance and one repeat of the name and
 * nothing that was asserted. `summary@1` paid more, because its other clauses
 * are labelled column readouts that name no site: a coordinate-less joined row
 * rendered `NPL status: Site is Part of NPL Site. Non-NPL status date:
 * 2017-05-11.` with the site named nowhere on the card — no false sentence, but
 * the reader could not tell whose status it was.
 *
 * It is split too, and the inline comment on the template says so. Its naming
 * clause closes on the EPA site ID rather than the distance: `epaSiteId` is
 * `Sourced<string>` and cannot be null, so the clause cannot drop, and unlike
 * the other two templates `summary@1` prints that ID nowhere else, so nothing
 * is said twice. The same coordinate-less row now renders `MCC RECYCLING, EPA
 * ID TXN000607155. NPL status: Site is Part of NPL Site. Non-NPL status date:
 * 2017-05-11.`, and the distance drops alone.
 *
 * Which of these a record gets is still the selection policy's decision and
 * never a branch inside a template, because a visible choice is a testable
 * one. What is no longer true is that the policy is the only thing between a
 * template and a record it must not speak for. Each template declares the
 * condition it speaks about and `assemble` refuses the others:
 *
 *   summary@1             statusRow joined                         a row came back, and is printed
 *   registry-only@1       statusRow no-row                         the inventory answered with none
 *   status-unavailable@1  statusRow unavailable                    the inventory could not be asked
 *   npl@1                 semsNplStatus = Currently on the Final NPL   SEMS put the site on the final NPL
 *
 * `npl@1` declares the value rather than the state because the status string is
 * the whole of what puts a site in this listing — it was the whole of what the
 * sentence asserted too, until the status came out of it, and the paragraph
 * above is why that makes the requirement matter more rather than less.
 * `present: true` was satisfied by any of the three strings the recorded bytes
 * hold: `Currently on the Final NPL` (2 sites), `Site is Part of NPL Site` (1),
 * `Not on the NPL` (12). B7 gives the final-NPL sites a sentence of their own
 * beside a count of them, and thirteen of the fifteen were getting the sentence
 * while the count excluded them. `equals` is the honest requirement: it names
 * exactly the condition the sentence is placed for, and it is the same string
 * the NPL section filter selects on, so the count and the list cannot describe
 * different sets. It is safe on a record with no Envirofacts row because
 * `semsNplStatus` is then plain null, and `satisfies` in
 * `lib/evidence/sentence.ts` fails an `equals` on a null slot before it ever
 * compares.
 *
 * What `npl@1` cannot see: a site on the final NPL whose Envirofacts request
 * failed has a null Superfund status and gets no NPL sentence, while
 * `frsActiveStatus` survives that failure carrying `CURRENTLY ON THE FINAL
 * NPL`. That is honest rather than a gap to paper over — the Superfund
 * inventory did not tell us, and the interest's status is not the site's — and
 * the section trace lists the ids it counted, so the sentence and the count can
 * be reconciled by a reader rather than by a claim. No second template for it
 * in this unit.
 *
 * There used to be a fifth, `disagreement@1`, printing both statuses attributed
 * when the two agencies contradicted each other. It is deleted. Its premise was
 * never true of the recorded data: on all fifteen Houston sites `ACTIVE_STATUS`
 * is `npl_status_name` upper-cased, differing on none, because it is the
 * Superfund interest's own status and not a second opinion. It also declared
 * only `{ state: "statusRow", is: "joined" }`, which `summary@1` declares too,
 * so the kernel could not tell the two apart and the choice fell back to a
 * case-folding comparison the kernel cannot see — exactly the hazard
 * `Requirement` was added to remove, and an exact `differsFrom` would fire on
 * capitalisation alone. Nothing is lost by its absence: `summary@1` prints the
 * Superfund inventory's own answer and the trace panel carries every other
 * field including the registry's. It comes back, with a requirement that can
 * express it, the day a recorded record actually disagrees.
 *
 * On labelling the two statuses. `Status:` was a third name for
 * `non_npl_status_name`, sitting under an unlabelled `npl_status_name`, so the
 * labelled one read as the site's status and the NPL one read as a remark. Both
 * clauses now carry the column's own name. The date is a clause of its own
 * rather than an `as of` tail, because B10's "Date unavailable." is a
 * standalone sentence and inlining it produced `as of Date unavailable.` — a
 * mid-sentence capital and a phrase that means nothing. Split, a null date
 * costs its own clause and nothing else, and the surviving clause still reads
 * as English. `non_npl_status_date` can outlive its status — US OIL RECOVERY
 * has a date and a null status name — so the date clause prints alone there.
 * That is the field stated and stopped, which is the rule.
 *
 * ON `archived`, WHICH NOTHING PRINTED UNTIL NOW. Envirofacts sends
 * `archived_ind` and `archived_date` beside the two statuses, and
 * `tests/fixtures/sems/envirofacts-archived.json` is what that costs: a
 * `non_npl_status_date` of 1984-09-01, an `archived_ind` of `Y`, and an
 * `archived_date` of 1996-01-25. `summary@1` printed the 1984 status and
 * stopped, so the card showed a live-looking status for a site whose record EPA
 * closed twelve years later. `archived` is a boolean and a boolean cannot be
 * printed, which is the problem `lib/adapters/fema.ts` solved for `SFHA_TF` by
 * reading the column a second time through `map`; `archivedLabel` is that, and
 * `archived` stays on the record behind it.
 *
 * A CLAUSE, NOT A FIFTH TEMPLATE. A clause is not an all-or-nothing choice
 * here: `assemble` in `lib/evidence/sentence.ts` drops a clause whose ref has
 * nothing to show and keeps the rest, which is exactly how `Non-NPL status:`
 * already disappears from US OIL RECOVERY's sentence while its date clause
 * prints. A template is what an absent state needs when it needs *different
 * words* — `lib/templates/fema.ts` has two because a missing `sfhaLabel` still
 * has to print the letter FEMA sent — and an unarchived site has nothing to
 * print. A second template would differ from `summary@1` by these two clauses,
 * would need a fifth condition kept disjoint from the three `statusRow` states,
 * and would put that choice in `lib/report/selection.ts`'s `semsPrimary`, for
 * no sentence a reader would ever see.
 *
 * THE MAP READS `Y` AND NOTHING ELSE, so an unarchived site says nothing rather
 * than "not archived". `SFHA_TF` maps both its letters because that phrase is
 * the claim the flood card exists to make and neither state may be a silence.
 * This is the other case: an archive is an event with a date, its absence is
 * not an event, and mapping `N` would put a sentence under every unarchived
 * site — all fifteen recorded Houston rows are `N` — to report that nothing
 * happened. Nationally it is the other way round, and that is the reason to be
 * careful rather than a reason to reconsider: docs/BRIEF.md's SEMS row counts
 * 40,823 of 55,632 sites archived, so on most addresses these two clauses do
 * print, and what they say is the paragraph below.
 *
 * The price is that an `archived_ind` this table does not hold reads
 * on the card the same as `N`. B10's verbatim rule is about an unknown source
 * *status*, and the three clauses above already pass every status string
 * through unread; an indicator we cannot read costs the reader an addition to
 * those, not the fact the card exists for. `archived` is what separates the two
 * for anyone who looks: `flag` makes it false for `N` and null for a letter it
 * does not hold.
 *
 * WHAT THE SENTENCE SAYS. `Superfund inventory record: archived.` The mapped
 * word is EPA's own and the map does not explain it: what an archived record
 * implies about the ground is EPA's business, and docs/BRIEF.md C2 forbids "No
 * records means safe", which is the inference a reader makes here if this
 * clause helps them. So the label names what was archived — the record in the
 * inventory, not the site, not the soil — and the clause stops. It cannot take
 * the column's own name the way the three clauses above take theirs, because
 * `Archived: archived.` is not a sentence and `Archived: yes.` is the boolean
 * again under another spelling.
 *
 * THE DATE IS ON SCREEN AND IS ITS OWN CLAUSE, for the reason the two Non-NPL
 * clauses are two: a `Y` with a null `archived_date` still gets the archived
 * sentence, and the date drops alone. It is the fact this item is about — 1996
 * beside 1984 is what tells a reader the status they just read is not the last
 * thing that happened. No `fallback` on it: `Date unavailable` is B10's wording
 * for a date missing where one is expected, and under a site that was never
 * archived there is no date to be missing.
 *
 * The other three templates gain nothing. `registry-only@1` and
 * `status-unavailable@1` have no retrieved row, so `archivedLabel` is null on
 * every record they can render over; `npl@1` is A2's name and distance.
 */

import { defineTemplate, fallback, km, sentence } from "@/lib/evidence/templates";

/** The site joined to an Envirofacts row, and the row is printed under its own column names. */
export const semsSiteSummary = defineTemplate(
	"sems-site",
	"sems-site/summary@1",
	(field) => [
		// Split for the same reason `npl@1` is: `distanceMeters` is null whenever
		// the layer sends no coordinate, and the three clauses below are labelled
		// column readouts that name no site, so one clause carrying both would
		// leave a joined row rendering "NPL status: ... Non-NPL status date: ..."
		// with the site named nowhere.
		sentence`${field("subject")}, EPA ID ${field("epaSiteId")}.`,
		sentence`${km(field("distanceMeters"))} from the mapped point.`,
		sentence`NPL status: ${field("semsNplStatus")}.`,
		sentence`Non-NPL status: ${field("nonNplStatus")}.`,
		sentence`Non-NPL status date: ${fallback(field("statusDate"), "Date unavailable")}.`,
		// Both drop on a site EPA has not archived, which is every one of the
		// fifteen recorded Houston rows and, nationally, 14,809 of 55,632. The
		// module comment argues why that silence is the right one, why the
		// wording is what it is, and why these are two clauses and not one.
		sentence`Superfund inventory record: ${field("archivedLabel")}.`,
		sentence`Archived date: ${field("archivedDate")}.`,
	],
	[{ state: "statusRow", is: "joined" }],
);

/**
 * No Envirofacts row joined. The registry's answer is printed as what it is —
 * the status of one environmental interest — and the gap is stated rather than
 * papered over with it.
 *
 * Naming the interest is what makes this sentence readable next to the one
 * after it. The registry's status string is NPL vocabulary (`SITE IS PART OF
 * NPL SITE`), and under the old wording the reader met the inventory's own
 * vocabulary under the registry's name and then read that the inventory
 * returned nothing. Attributed to the `SUPERFUND (NON-NPL)` interest it is the
 * registry's own fact, and the next clause is about a different system.
 *
 * Naming the facility in the same clause is what makes it true on its own. The
 * lead clause drops with a null coordinate and this one does not, so it carries
 * its own subject rather than a pronoun for the clause above; the module
 * comment argues the wording.
 *
 * "The Superfund inventory returned no status row" is a claim about what the
 * inventory answered, so it is the `no-row` state's sentence and nobody else's:
 * over a site whose status request failed it would report an answer that was
 * never given. The requirement, not the selection policy, is what makes that
 * impossible.
 */
export const semsSiteRegistryOnly = defineTemplate(
	"sems-site",
	"sems-site/registry-only@1",
	(field) => [
		sentence`${field("subject")}, ${km(field("distanceMeters"))} from the mapped point.`,
		sentence`EPA's facility registry records the ${field("interestType")} interest at ${field("subject")} as ${field("frsActiveStatus")}.`,
		sentence`The Superfund inventory returned no status row for ${field("epaSiteId")}.`,
	],
	[{ state: "statusRow", is: "no-row" }],
);

/**
 * The Envirofacts request for this site failed. Nothing about the inventory's
 * answer is known, so the sentence says so and stops.
 *
 * It leads with the same registry clause as the registry-only wording, naming
 * the facility for the same reason, and the two are one clause apart. That is
 * why both declare their `statusRow` state:
 * the pair is kept apart by the kernel refusing to render the wrong one, not by
 * a reader noticing the difference and not by the selection policy being
 * careful.
 */
export const semsSiteStatusUnavailable = defineTemplate(
	"sems-site",
	"sems-site/status-unavailable@1",
	(field) => [
		sentence`${field("subject")}, ${km(field("distanceMeters"))} from the mapped point.`,
		sentence`EPA's facility registry records the ${field("interestType")} interest at ${field("subject")} as ${field("frsActiveStatus")}.`,
		sentence`The Superfund inventory's status for ${field("epaSiteId")} could not be retrieved.`,
	],
	[{ state: "statusRow", is: "unavailable" }],
);

/**
 * B7: a site on the final National Priorities List is also named in its own
 * sentence.
 *
 * Name and distance, which is what A2 asks this block for. The status the site
 * is here for is not restated per site: the section headline states it once and
 * the section filter is that same string, so every record in this listing
 * carries it by construction, and printing it again put one site's status on
 * the demo card twice. The module comment has the card as it read and the
 * whole argument.
 *
 * Two clauses, not one. The naming clause holds only `subject`, which cannot be
 * null, so wherever this renders at all the site is named. The distance is a
 * clause of its own because `distanceMeters` is the one slot here that a row the
 * layer is allowed to send can leave null, and while it shared the clause it
 * took B7's whole sentence with it, off a card whose final-NPL count still
 * counted the site. The module comment argues both, and argues why the name
 * does not stand at the end of its clause on its own.
 */
export const semsSiteNpl = defineTemplate(
	"sems-site",
	"sems-site/npl@1",
	(field) => [
		sentence`${field("subject")} is listed by SEMS.`,
		sentence`${km(field("distanceMeters"))} from the mapped point.`,
	],
	// Kept exactly as it was, and it does more work than it did: the sentence no
	// longer names the status, so this is the only thing keeping a site that is
	// not on the final NPL out of the final-NPL listing.
	[{ slot: "semsNplStatus", equals: "Currently on the Final NPL" }],
);

export const semsTemplates = [
	semsSiteSummary,
	semsSiteRegistryOnly,
	semsSiteStatusUnavailable,
	semsSiteNpl,
];
