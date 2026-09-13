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
 * states the rule and applies it to all five of its lead clauses; the other
 * three here had never said it and now do.
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
 * `summary@1`'s three remaining clauses are labelled statements of their own
 * column — `NPL status: …` — that point at nothing outside themselves, so a
 * dropped lead clause costs the reader the site's name and leaves no sentence
 * false. `npl@1` is a single clause that names its subject inside itself, so a
 * null distance takes the whole sentence and not its antecedent: a final-NPL
 * site with no FRS coordinate gets no B7 sentence at all. That is a silence
 * rather than a false claim, and splitting the distance into a second clause is
 * a change this pass was not asked to make; the null-coordinate test below
 * pins the behaviour so the next pass decides it deliberately.
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
 * `npl@1` declares the value rather than the state because the status string
 * is the whole of what it asserts, and `present: true` was satisfied by any of
 * the three strings the recorded bytes hold: `Currently on the Final NPL` (2
 * sites), `Site is Part of NPL Site` (1), `Not on the NPL` (12). B7 gives the
 * final-NPL sites a sentence of their own beside a count of them, and thirteen
 * of the fifteen were getting the sentence while the count excluded them.
 * `equals` is the honest requirement: it names exactly what the sentence
 * asserts, and it is the same string the NPL section filter selects on, so the
 * count and the list cannot describe different sets. It is safe on a record
 * with no Envirofacts row because `semsNplStatus` is then plain null, and
 * `satisfies` in `lib/evidence/sentence.ts` fails an `equals` on a null slot
 * before it ever compares.
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
 */

import { defineTemplate, fallback, km, sentence } from "@/lib/evidence/templates";

/** The site joined to an Envirofacts row, and the row is printed under its own column names. */
export const semsSiteSummary = defineTemplate(
	"sems-site",
	"sems-site/summary@1",
	(field) => [
		sentence`${field("subject")}, ${km(field("distanceMeters"))} from the mapped point.`,
		sentence`NPL status: ${field("semsNplStatus")}.`,
		sentence`Non-NPL status: ${field("nonNplStatus")}.`,
		sentence`Non-NPL status date: ${fallback(field("statusDate"), "Date unavailable")}.`,
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

/** B7: a site on the final National Priorities List is also named in its own sentence. */
export const semsSiteNpl = defineTemplate(
	"sems-site",
	"sems-site/npl@1",
	(field) => [
		sentence`${field("subject")} is listed by SEMS as ${field("semsNplStatus")}, ${km(field("distanceMeters"))} from the mapped point.`,
	],
	[{ slot: "semsNplStatus", equals: "Currently on the Final NPL" }],
);

export const semsTemplates = [
	semsSiteSummary,
	semsSiteRegistryOnly,
	semsSiteStatusUnavailable,
	semsSiteNpl,
];
