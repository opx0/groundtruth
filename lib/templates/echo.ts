/**
 * The ECHO facility templates. docs/BRIEF.md A2 promises this sentence:
 *
 *   First: {facility}, {distance} km, {program}, last formal action {date}.
 *
 * Three of those four slots exist on the record. `{program}` does not, and
 * nothing here approximates it. ECHO sends four statute compliance columns as
 * `programStatuses`, a container of four `Sourced` leaves rather than a leaf of
 * its own, so it is not in `SlotKeys` and no clause can name it; the two
 * columns a facility row does carry, `FacNAICSCodes` and `FacSICCodes`, are
 * industry classifications and not the programme a facility is regulated
 * under. `echoFacilitySummary` therefore prints the facility-wide
 * `FacComplianceStatus` where A2 wanted the programme, which is a fact the row
 * holds, and `echoFacilityIndustryCodes` prints the industry codes under their
 * own names so they can never be read as a programme. The per-statute
 * statuses still reach the reader in full: `subjectValues` walks the container
 * and the trace panel lists `programStatuses.CAA` through
 * `programStatuses.SDWA`, each with its own column and raw value.
 *
 * PRIMARY AND SECONDARY, the rule the selection policy may rely on.
 *
 * Exactly one template per record is the primary. It names the facility, it
 * prints the distance, and it is the only template here that does either.
 * `summary@1` and `no-status@1` are the two, and they are disjoint by
 * requirement on `complianceStatus`, so a record has exactly one of them
 * whatever ECHO sent. Every other template is a secondary: no naming clause of
 * its own, no distance, and the facility named inside the clauses that carry
 * its facts, the way `echoFacilityIndustryCodes` has always done it. A
 * secondary therefore reads correctly wherever a card places it, above or
 * below the primary or alone, and it renders null when every one of its
 * clauses drops, which is correct and wanted: a secondary with nothing to say
 * should say nothing rather than echo the primary.
 *
 * This is the correction of a real defect, not a preference. Five of the six
 * templates opened with the byte-identical clause "{subject}, {distance} from
 * the mapped point.", and on five of the seven recorded facilities both
 * `summary@1` and `no-formal-action@1` render, so a card placing both printed
 * the name and the distance twice:
 *
 *   CARGILL INCORPORATED, 0.22 km from the mapped point. Compliance status in
 *   ECHO's twelve-quarter history: No Violation Identified. CARGILL
 *   INCORPORATED, 0.22 km from the mapped point. ECHO's facility summary
 *   carries no formal enforcement action date for registry ID 110005085898.
 *
 * The argument below for `industry-codes@1` — "printing the name and the
 * distance again would print them twice on the same card" — was always the
 * argument for every template that co-renders, and the templates that actually
 * co-render on the majority of rows are the ones it had not been applied to.
 *
 * Two clauses were byte-identical across templates that co-render, and each
 * now belongs to exactly one. The formal-action date clause stood in both
 * `summary@1` and `formal-action@1`, and on SOUTH COAST TERMINALS PTF both
 * render, so "Most recent formal enforcement action in ECHO's facility
 * summary: 2024-08-12." printed twice on one card; it belongs to
 * `formal-action@1`, the template named for it, and is gone from `summary@1`.
 * The compliance-status clause stood in both `summary@1` and
 * `noncompliance@1`, which co-render on PORT TERMINAL FACILITY; it belongs to
 * `summary@1`, whose requirement is that column. Nothing is lost by either
 * move: `summary@1` renders over every row with a status and `no-status@1`
 * over the one without, so a status reaches the card whatever else is placed,
 * and `formal-action@1` renders over every row that has a date.
 *
 * On which template prints when. The selection policy makes this choice, not a
 * branch in a template, and docs/BRIEF.md B7's ECHO order is what it follows.
 * What is no longer true is that the policy is the only thing standing between
 * a template and a record it must not speak for: `no-status@1` used to render
 * "EPA ECHO reported no compliance status for registry ID 110009747514" over
 * the one row in the fixture whose status is `Violation Identified`, because
 * nothing in the template referenced the column that decides whether that
 * sentence is true. Each template that asserts a state now declares it and
 * `assemble` refuses the rest:
 *
 *   summary@1            PRIMARY    complianceStatus present      ECHO answered with a status
 *   no-status@1          PRIMARY    complianceStatus absent       the status column is empty
 *   noncompliance@1      secondary  quartersInNoncompliance >= 1  the facility has a quarter
 *   formal-action@1      secondary  lastFormalActionDate present  the summary carries a date
 *   no-formal-action@1   secondary  lastFormalActionDate absent   that column is empty
 *   industry-codes@1     secondary  none                          it only prints two columns
 *
 * `noncompliance@1` needs a threshold, not a presence check. `present` is
 * satisfied by the value `0`, and five of the seven rows have `FacQtrsWithNC`
 * of "0", so the template named for noncompliance rendered "Quarters of
 * noncompliance in ECHO's twelve-quarter history: 0." over facilities that
 * have none — while `lib/templates/sections.ts` counts this same group as
 * "{count} of them have at least one quarter". `atLeast: 1` is the threshold
 * that section filter applies, so the count and the list cannot describe
 * different sets.
 *
 * It requires that one column and nothing else. An earlier version also
 * required `complianceStatus`, which made the quarters count hostage to a
 * different column: a row with six quarters and an empty status would have
 * been refused by `noncompliance@1` and by `summary@1` alike and fallen to
 * `no-status@1`, which says nothing about quarters. The status clause is no
 * longer in this template at all — it is `summary@1`'s — and a row with
 * quarters and no status gets its absence stated by `no-status@1`, which is
 * that row's primary.
 *
 * `industry-codes@1` declares nothing because it asserts nothing: every clause
 * is a readout of a column it names, so a null takes its clause and, when both
 * columns are null, the whole sentence.
 *
 * Narrowing `noncompliance@1` to one row leaves no row unspoken for.
 * `summary@1` and `no-status@1` partition the seven on the status column, and
 * that partition is now the whole of what a row needs: one of the two is the
 * row's primary and carries its name and its distance. Six of the seven get
 * `summary@1`; WESTWAY FEED PRODUCTS LLC, whose `FacComplianceStatus` is null,
 * gets `no-status@1`. The cross-product test asserts that partition rather
 * than trusting it, and asserts per row that a primary rendered.
 *
 * Where the facility is named inside a secondary. A secondary names it once,
 * in a clause that cannot drop, and the clauses after it are read under that
 * one. `formal-action@1` requires its date, so its first clause always
 * renders and carries the name; `noncompliance@1` requires its quarters count,
 * likewise; `no-formal-action@1` is one clause and references only slots that
 * cannot be null. `industry-codes@1` is the exception and names the facility
 * in both of its clauses, because it has no guaranteed clause: either industry
 * column can be null, so either clause can be the only one on screen.
 *
 * Judgement calls about wording.
 *
 * Statuses are printed verbatim and never restated. "No Violation Identified"
 * and "Violation Identified" are ECHO's sentences, and a null status is not a
 * third value in that vocabulary: it is an empty column, which is why
 * `echoFacilityNoStatus` says the column is empty instead of letting a clause
 * drop and leaving a facility that looks clean. `echoFacilityNoFormalAction`
 * exists for the same reason one column over: `FacDateLastFormalAction` is
 * null on six of the seven rows, and a silently dropped clause is read as "no
 * enforcement history" when all the column supports is "this summary column is
 * empty".
 *
 * Every clause that prints a compliance status names ECHO's twelve-quarter
 * history, because an unqualified status reads as today's. That is the
 * record's own caveat ("covers the last twelve quarters of federally reported
 * data and is not a statement about conditions today"), which otherwise
 * reaches only the trace, and docs/BRIEF.md C2 forbids "Real-time
 * environmental history". `lib/templates/sections.ts` rewrote A2's "current
 * noncompliance" into the same noun phrase, so the count and the record agree
 * on screen and in their hedging.
 *
 * The twelve quarters are ECHO's own published definition of
 * `FAC_QTRS_WITH_NC` — quarters with noncompliance out of the last twelve —
 * and not anything the metadata endpoint said: that returns `Description:
 * null` for this column as for every other
 * (`tests/fixtures/echo/metadata.json`). A published column definition is the
 * same class of evidence this repo already accepted for the AQS response
 * envelope and the FEMA column descriptions. What the metadata's silence does
 * rule out is a window for `FAC_PENALTY_COUNT`, whose name states no span at
 * all, which is why "on record" came out of the penalty clause and the
 * facility summary went in.
 *
 * Every clause that prints an enforcement or penalty column names ECHO's
 * facility summary, because that is the extent of what was retrieved. "Last
 * formal enforcement action {date}" and "Penalty actions on record: 1" both
 * claim a complete history; ECHO's own metadata returns `Description: null`
 * for `FAC_PENALTY_COUNT` and for every other column here (see
 * `tests/fixtures/echo/metadata.json`), so nothing retrieved says how far back
 * these columns reach. A superlative scoped to the summary — "most recent
 * formal enforcement action in ECHO's facility summary" — is exactly what the
 * column holds and claims nothing further.
 *
 * `FacLastPenaltyAmt` is the literal string "$0" on all seven rows, including
 * six whose `FacPenaltyCount` and `FacDateLastPenalty` are both null, which is
 * to say six facilities with no penalty at all — while the same response's
 * query header reports `"TotalPenalties": "$1,250"` within the quarter mile,
 * and the 5-mile fixture reports $20,254,146. So "Most recent penalty: $0"
 * stated that a penalty of zero dollars was assessed.
 *
 * The clause names the column and stops — but it has to name the whole of what
 * the column is. Dropping the assertion took "most recent" with it and left
 * "Penalty amount column in ECHO's facility summary: $0.", which reads as the
 * facility's penalty amount in general, and a reader taking that $0 for a
 * total is contradicted by the query header of the very bytes it was parsed
 * from. `FAC_LAST_PENALTY_AMT` is the amount of the last penalty, so the
 * clause says which penalty it is the amount of. The date stays a clause of
 * its own so that a null in one does not take the other off the screen.
 *
 * Note for a later unit: `formatValue` prints the parsed number, so a real
 * amount renders `$20254146` and loses ECHO's grouping. A currency display
 * format belongs beside `km` and `day` in the kernel, and is deliberately not
 * added here.
 *
 * `FacSICCodes` is `"2048 5171"` on the Cargill row and `FacNAICSCodes` is
 * `"311119"`: both columns hold space-separated lists, so the clause says
 * "codes" and reads the same for one code and for several. "under SIC 2048
 * 5171" read as a single code.
 *
 * `echoFacilityIndustryCodes` answers what a facility is rather than what its
 * record says, so it stands beside one of the others rather than instead of
 * it. It was the first secondary and its shape is now the shape of all four:
 * no naming clause, the subject named inside each clause instead, and the
 * whole template null when every column it reads is null.
 *
 * Every clause that prints a distance says what the distance is measured from.
 * `0.22 km` alone names no origin, and `sems-site/npl@1` has said "from the
 * mapped point" since it was written. Only a primary prints one now, so there
 * is exactly one such clause per card, which is what the defect above was
 * about.
 *
 * THE DISTANCE IS ITS OWN CLAUSE, and the facility is named without it.
 * `distanceMeters` is the only slot either primary leads with that can be
 * null: `FacLat` and `FacLong` are `z.string().nullable()` in
 * `lib/adapters/echo.ts`, a row without both gets `location: null`, and
 * `complete` then leaves `distanceMeters` null. While the name and the
 * distance shared one clause, that null took the clause and `summary@1`
 * collapsed to "Compliance status in ECHO's twelve-quarter history: No
 * Violation Identified." with no facility named at all. No recorded row
 * reaches this; the test that does builds one through the real adapter from
 * the real page bytes with `FacLat` and `FacLong` nulled on the Cargill row.
 *
 * `fallback` is the wrong instrument for it. A fallback span still points at
 * its slot, which is the whole reason the brief allows one — but
 * `distanceMeters` is `Sourced<number> | null`, not `Sourced<number | null>`,
 * so when there is no coordinate there is no leaf and no provenance behind it,
 * and `trace` returns null for that span. It would put text on screen with a
 * dead click behind it, which nothing else in this codebase does. Splitting
 * the clause costs nothing and the distance drops the way every other null
 * here drops.
 *
 * What closes the naming clause is `registryId`. The clause cannot end on
 * `subject` — `SOUTH-PORT SYSTEMS, INC.` is a real row and would render
 * `INC..` — and `registryId` is the only other slot ECHO always sends, so it
 * is the only thing that can hold that position. It earns it: it is the
 * identifier the ECHO facility report is looked up by, and it is what the two
 * stated-absence templates were already printing to say which facility the
 * empty column belongs to. `no-formal-action@1` has stopped printing it for
 * that reason, so no card prints a registry ID twice.
 *
 * `FacSNCFlg` is the letter Y or N. It is named as ECHO's flag and printed as
 * the letter, because expanding N into a word would be this codebase mapping a
 * code, and it sits next to the quarters count so that a twelve-quarter
 * history is never read as ECHO's own significant-noncompliance determination.
 *
 * `SOUTH-PORT SYSTEMS, INC., registry ID 110016765277.` is correct and is not
 * to be re-litigated: retaining an abbreviation's period before a comma is
 * standard English. The real hazard is an abbreviated name in clause-final
 * position, which would render `INC..`; `lib/templates/frs.ts` avoids it, and
 * no clause here ends on the subject — the two clauses of `no-formal-action@1`
 * and `industry-codes@1` that would have put a name last were written to carry
 * something after it.
 *
 * Nothing here uses `fallback`. sems-site needs it because one clause carries a
 * status and its date together; every clause here is either self-contained or
 * has a template of its own, so a null drops exactly the clause it belongs to
 * and the two stated absences that matter have templates of their own above.
 */

import { defineTemplate, km, sentence } from "@/lib/evidence/templates";

/**
 * PRIMARY. A2's facility sentence, minus the slot no field fills: the name,
 * the distance, and the status ECHO answered with. It is the primary for every
 * row whose `FacComplianceStatus` is not null, which is six of the seven in
 * the quarter-mile fixture.
 *
 * Three clauses, not one. The naming clause references only slots ECHO always
 * sends, so it cannot drop and the facility is named whatever else is missing;
 * the distance is its own clause because `distanceMeters` is null for a row
 * ECHO sent no coordinate for; the status is its own because it is a separate
 * fact, and the requirement keeps it from being an empty one.
 *
 * The formal-action clause that used to end this template is
 * `echoFacilityFormalAction`'s, and only its: it rendered here as well, and on
 * SOUTH COAST TERMINALS PTF both templates render, so the same date printed
 * twice on one card.
 */
export const echoFacilitySummary = defineTemplate(
	"echo-facility",
	"echo-facility/summary@1",
	(field) => [
		sentence`${field("subject")}, registry ID ${field("registryId")}.`,
		sentence`${km(field("distanceMeters"))} from the mapped point.`,
		sentence`Compliance status in ECHO's twelve-quarter history: ${field("complianceStatus")}.`,
	],
	[{ slot: "complianceStatus", present: true }],
);

/**
 * SECONDARY. B7's first ECHO group: a facility whose summary carries a formal
 * enforcement action date. It requires that date, so its first clause always
 * renders, which is why that clause is the one that names the facility and the
 * three after it need not. The penalty count, date and amount are three
 * clauses because a facility can have a counted action and no amount, or an
 * amount and no date, and no absence should take another fact off the screen.
 *
 * It carries no name-and-distance clause of its own: the primary beside it
 * carries those, and carrying them twice was the defect.
 */
export const echoFacilityFormalAction = defineTemplate(
	"echo-facility",
	"echo-facility/formal-action@1",
	(field) => [
		sentence`Most recent formal enforcement action in ECHO's facility summary for ${field("subject")}: ${field("lastFormalActionDate")}.`,
		sentence`Penalties counted in ECHO's facility summary: ${field("penaltyCount")}.`,
		sentence`Most recent penalty date in ECHO's facility summary: ${field("lastPenaltyDate")}.`,
		sentence`Amount of the most recent penalty in ECHO's facility summary: $${field("lastPenaltyAmountUsd")}.`,
	],
	[{ slot: "lastFormalActionDate", present: true }],
);

/**
 * SECONDARY. `FacDateLastFormalAction` is null. The dropped clause would read
 * as a facility with no enforcement history; the column supports only that
 * ECHO's facility summary has nothing in it, which is what this says, for the
 * facility it is empty for. ECHO answered: this is the row's own absence, not
 * a failed request.
 *
 * One clause, which names the facility and ends on connective text rather than
 * on the name — `SOUTH-PORT SYSTEMS, INC.` is one of the six rows this renders
 * over. It no longer prints the registry ID: the primary beside it does, and
 * this template is on five of the same cards.
 */
export const echoFacilityNoFormalAction = defineTemplate(
	"echo-facility",
	"echo-facility/no-formal-action@1",
	(field) => [
		sentence`For ${field("subject")}, ECHO's facility summary carries no formal enforcement action date.`,
	],
	[{ slot: "lastFormalActionDate", present: false }],
);

/**
 * SECONDARY. B7's second ECHO group. The count is of quarters, not of
 * violations, and the sentence says whose twelve-quarter history it is. It
 * requires at least one quarter and nothing else: `present` is satisfied by
 * `0` and would let a template named for noncompliance render over the five
 * rows with none, and requiring the status column as well would give a
 * different column a veto over the count this template exists to print.
 *
 * ECHO's significant-noncompliance letter follows, attributed, so a
 * twelve-quarter history is never read as ECHO's own determination. The
 * compliance status is not here: it is `echoFacilitySummary`'s clause, both
 * templates render over PORT TERMINAL FACILITY, and the status printed twice
 * on that card. A row with quarters and no status gets its absence from
 * `echoFacilityNoStatus`, which is that row's primary.
 */
export const echoFacilityNoncompliance = defineTemplate(
	"echo-facility",
	"echo-facility/noncompliance@1",
	(field) => [
		sentence`Quarters of noncompliance in ECHO's twelve-quarter history for ${field("subject")}: ${field("quartersInNoncompliance")}.`,
		sentence`ECHO's significant noncompliance flag: ${field("significantNoncomplianceFlag")}.`,
	],
	[{ slot: "quartersInNoncompliance", atLeast: 1 }],
);

/**
 * PRIMARY. `FacComplianceStatus` is null on a real row in the fixture. A
 * dropped clause would leave the facility looking like one ECHO had nothing
 * against, so the empty column is stated under the registry ID it is empty
 * for. This is the row's own absence, not a failed request: ECHO answered. The
 * requirement, not the selection policy, is what keeps it off the six rows
 * with a status.
 *
 * The name, the registry ID and the absence are one clause because none of the
 * three can drop and splitting them would only repeat the identity; the
 * distance is a clause of its own for the same reason it is in
 * `echoFacilitySummary`.
 */
export const echoFacilityNoStatus = defineTemplate(
	"echo-facility",
	"echo-facility/no-status@1",
	(field) => [
		sentence`${field("subject")}, registry ID ${field("registryId")}: EPA ECHO's facility summary carries no compliance status.`,
		sentence`${km(field("distanceMeters"))} from the mapped point.`,
	],
	[{ slot: "complianceStatus", present: false }],
);

/**
 * SECONDARY. What the facility is, in the two classification systems ECHO
 * carries. Named as NAICS and SIC and nothing else: these are industry codes,
 * they are not A2's `{program}`. One clause each keeps a null in one system
 * from taking the other off the screen, and because either can be the only
 * clause left, both name the facility — this is the one template here with no
 * clause its requirement guarantees.
 */
export const echoFacilityIndustryCodes = defineTemplate(
	"echo-facility",
	"echo-facility/industry-codes@1",
	(field) => [
		sentence`NAICS codes ECHO lists for ${field("subject")}: ${field("naicsCodes")}.`,
		sentence`SIC codes ECHO lists for ${field("subject")}: ${field("sicCodes")}.`,
	],
);

export const echoTemplates = [
	echoFacilitySummary,
	echoFacilityFormalAction,
	echoFacilityNoFormalAction,
	echoFacilityNoncompliance,
	echoFacilityNoStatus,
	echoFacilityIndustryCodes,
];
