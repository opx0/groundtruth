/**
 * The FEMA flood-zone templates. docs/BRIEF.md A2, as corrected 2026-09-16:
 *
 *   The mapped point, a street-segment interpolation rather than a parcel
 *   boundary, is in zone AE, inside the Special Flood Hazard Area. FEMA's FIRM
 *   study identifier for this area is 48201C. Read from Esri's reduced-set copy
 *   of FEMA's National Flood Hazard Layer.
 *
 * A2's copy still carries ", dated 2026-03-11" on that last sentence and
 * this template deliberately does not. The date was checked against Esri's
 * item page out of band; no response this code parses states it, so a span
 * printing it would open a trace that does not support it. It stays in the
 * record's caveats and in the B10 no-polygon note. See lib/adapters/fema.ts.
 *
 * Two templates for one kind, and the record decides which prints:
 *
 *   summary@1        sfhaLabel present   SFHA_TF was a letter this report maps
 *   unmapped-flag@1  sfhaLabel absent    it was not, so the letter prints as sent
 *
 * On the requirements, which this file argued at length it did not need. The
 * argument was that a `Requirement` exists to stop the wrong template of a kind
 * rendering the right record, and that with one template per kind there is no
 * wrong one to pick. The first half is the rule and it still holds; the second
 * half stopped being true the moment B10's unknown-status wording turned out to
 * be a different sentence from the mapped one. Two templates of a kind is
 * exactly when the risk is real: the kind gate passes both, and nothing else in
 * the kernel knows that one of them is about a state the other denies. This
 * file has already paid for that once — three templates, two of them asserting
 * "inside" and "outside" with no requirement at all, and the fixtures review
 * caught both rendering over the same row. So each of the two declares the one
 * slot they differ over, `present: true` against `present: false` on
 * `sfhaLabel`. The pair is disjoint and exhaustive by construction: every
 * record of this kind matches exactly one, so no flood card loses its sentence
 * and none gets two.
 *
 * The requirement names `sfhaLabel` and not `specialFloodHazardArea`, which is
 * null in precisely the same states. Naming the slot the clause prints is what
 * keeps the guard and the sentence from drifting apart.
 *
 * On the unmapped flag. `map` returns null for a letter the table does not
 * hold, for a JSON null, and for "" — and "" is not hypothetical: the Pasadena
 * row itself carries "" in V_DATUM, VEL_UNIT and DUAL_ZONE. B10 wants an
 * unknown source status shown verbatim with "Meaning not mapped.", and
 * `sfhaFlag` is SFHA_TF read a third time through `identity`, so the letter is
 * on the record and the clause can show it instead of pointing at the trace.
 *
 * The quotation marks around it are a judgement. `text` keeps "" as "", and a
 * bare empty value inside a sentence is a hole — "…flag recorded for this area
 * is . Meaning not mapped." Quoting delimits the value, so an empty column
 * reads as an empty pair of quotes rather than as a typesetting accident, and
 * the same marks make a one-letter code visibly a code. The fallback for a JSON
 * null is then the empty string for the same reason: a word like "empty" inside
 * quotation marks reads as the column containing that word. On the card the two
 * absences say the same thing — the column sent nothing this report maps — and
 * the trace is where they separate, `rawValue` null in one and "" in the other.
 *
 * On the parcel caveat, which an earlier revision moved off this card. The zone
 * clause is the only sentence in the product that asserts a hazard designation
 * at a point; A5 requires a card to carry its limits on the card and C2 forbids
 * "Parcel-level flood risk", so the qualification belongs in the clause making
 * the assertion. It was moved off because inside a clause whose only slot was
 * `zoneCode` it explained nothing when clicked, which was a reason to put it
 * where it qualifies a slot rather than to drop it: the clause now carries the
 * SFHA phrase too, and the qualification is about that phrase at that point.
 * The adapter's record caveat stays as well, so the trace carries it for a
 * reader who came in through a value rather than through the sentence.
 *
 * On DFIRM_ID. The recorded fixture carries FEMA's own column description:
 * "Study Identifier… the two-digit State FIPS code, the three-digit county
 * FIPS code and the letter 'C' (e.g., 48107C). Within each FIRM Database, the
 * DFIRM_ID value will be identical." It is not a panel — panels are
 * `S_FIRM_Pan.FIRM_PAN` and look like `48201C0810L` — and being identical for
 * every polygon in the county it cannot "cover the mapped point" either. The
 * clause names the field and stops. The record field is `firmStudyId` in
 * `lib/evidence/records.ts`. `.dev/PLAN.md` item 15 named this file's own
 * defect: the clause already refused to call `DFIRM_ID` a panel, but the
 * field it traced to was still named for one, so a reader who opened it saw
 * the very thing the sentence had just denied. The new name says what the
 * field is instead of what it is not, and matches `floodAreaId` and
 * `sourceCitation` beside it, both named for what FEMA's own description
 * calls the value rather than for the column.
 *
 * On attribution. When `dataset` is ESRI_REDUCED_SET the values came from
 * Esri's redistribution, not FEMA's service — the adapter's own caveat says
 * so, and the fixture's field list says so too (`GlobalID` is "assigned by
 * ESRI Living Atlas during feature layer production"). So the clauses that are
 * only column readouts say "recorded for this area" and attribute nothing. The
 * study identifier keeps FEMA's name because a FIRM study identifier is FEMA's
 * own construct however it is redistributed, which is also how A2 words it, and
 * the Special Flood Hazard Area keeps it for the same reason: the designation
 * is FEMA's, the column carrying it in this copy is Esri's, and "recorded for
 * this area" is what says where the letter itself was read.
 *
 * On the two identifiers. FLD_AR_ID is "Primary key for table lookup", so the
 * clause gives it FEMA's own alias, Flood Area ID, and does not present it as a
 * name for the place. SOURCE_CIT is "Abbreviation used in the metadata file…
 * must match a value in L_Source_Cit": `48201C_FIRM1` is a lookup key, not a
 * citation of anything, and the clause calls it one.
 *
 * On the dataset. B12 requires a FEMA statement to name the dataset that
 * answered, and what it prints is `datasetLabel` — words a reader can act on,
 * whose provenance is the layer URL we queried — never the `dataset` enum,
 * which is an identifier of ours and tells a reader nothing.
 *
 * One fact per clause. DFIRM_ID, ZONE_SUBTY and SOURCE_CIT are nullable and a
 * clause dies whole when a slot is null, so each gets its own clause and a
 * missing one never takes the zone with it. FLD_ZONE and FLD_AR_ID are the two
 * the schema requires, which is why the zone clause is the one carrying the
 * SFHA phrase and the caveat: it is the fact the card exists for and it cannot
 * drop. The unmapped flag is its own clause for the same reason, not an
 * alternative ending to the zone clause. Every clause names the area again
 * rather than saying "it", so a dropped clause never leaves the next dangling.
 *
 * No distance. A polygon contains the mapped point rather than sitting some way
 * from it, so the adapter claims no location and `distanceMeters` is null.
 */

import type { Clause, FieldRef } from "@/lib/evidence/templates";
import { defineTemplate, fallback, sentence } from "@/lib/evidence/templates";

/**
 * Everything after the zone: the same columns whichever way SFHA_TF read, so
 * the two templates cannot drift apart on the facts they do not disagree about.
 */
function areaClauses(field: FieldRef<"fema-flood-zone">): Clause<"fema-flood-zone">[] {
	return [
		sentence`The zone subtype recorded for this area is ${field("zoneSubtype")}.`,
		sentence`FEMA's FIRM study identifier for this area is ${field("firmStudyId")}.`,
		sentence`The flood area ID recorded for this area is ${field("floodAreaId")}.`,
		sentence`The source-citation lookup key recorded for this area is ${field("sourceCitation")}.`,
		sentence`Read from ${field("datasetLabel")}.`,
	];
}

/** SFHA_TF was T or F: the card states the designation in FEMA's own words, read from the column. */
export const floodZoneSummary = defineTemplate(
	"fema-flood-zone",
	"fema-flood-zone/summary@1",
	(field) => [
		sentence`The mapped point, a street-segment interpolation rather than a parcel boundary, is in zone ${field("zoneCode")}, ${field("sfhaLabel")}.`,
		...areaClauses(field),
	],
	[{ slot: "sfhaLabel", present: true }],
);

/** SFHA_TF was something else, or nothing: B10's wording, with the column shown as sent. */
export const floodZoneUnmappedFlag = defineTemplate(
	"fema-flood-zone",
	"fema-flood-zone/unmapped-flag@1",
	(field) => [
		sentence`The mapped point, a street-segment interpolation rather than a parcel boundary, is in zone ${field("zoneCode")}.`,
		sentence`FEMA's Special Flood Hazard Area flag recorded for this area is "${fallback(field("sfhaFlag"), "")}". Meaning not mapped.`,
		...areaClauses(field),
	],
	[{ slot: "sfhaLabel", present: false }],
);

export const femaTemplates = [floodZoneSummary, floodZoneUnmappedFlag];
