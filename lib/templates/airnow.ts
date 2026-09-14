/**
 * The AirNow observation templates.
 *
 * `docs/BRIEF.md` A2 shows an air card, but the copy it shows is AQS's — a
 * monitor, a distance and an annual mean. AirNow is the other air source and it
 * is not that shape: B2's boundary row for it is "the reporting area or monitor
 * location AirNow returns", B7 requires the summary to show "the AirNow result
 * or no-data state", and that is the whole of what the product promises here.
 * So these sentences are written from the record's own fields rather than from
 * A2's copy, and they say less than A2's air card does because this record
 * holds less.
 *
 * Two templates, and the record decides which prints:
 *
 *   summary@1   aqi present   AirNow stated an index, and it is printed
 *   no-index@1  aqi absent    it did not, and that is stated instead
 *
 * The pair is disjoint and exhaustive on one slot, `present: true` against
 * `present: false` on `aqi`, so every record of this kind gets exactly one
 * sentence and none gets two. `lib/templates/fema.ts` argues why two templates
 * of a kind is precisely when a requirement stops being optional: the kind gate
 * passes both, nothing else in the kernel knows that one of them denies what
 * the other asserts, and "reported no index" over a record carrying 58 would be
 * a false sentence the selection policy alone cannot prevent.
 *
 * ON WHICH CAVEAT IS A CLAUSE AND WHICH IS A RECORD CAVEAT. The brief asks for
 * this decision and A2's AQS copy is where the question comes from: its last
 * two sentences are "The monitor measures its own location, not this address."
 * and "AQS data lags collection by 6 months or more." They are not the same
 * kind of statement and they do not belong in the same place.
 *
 * The first qualifies the value. It says the number you just read is about
 * somewhere else, and it is false — or rather meaningless — the moment the
 * value it qualifies is gone. `qualification` is this file's version of it, and
 * it is a clause carrying `${reportingArea}`, so it cannot outlive that slot: a
 * store with the record deleted renders nothing, and a null reporting area
 * takes the qualification down with the sentence it qualifies. Putting it in
 * `caveats` instead would leave the trace panel holding a sentence about a
 * value that is no longer on screen, which is the failure this whole kernel is
 * built to prevent.
 *
 * The second is about the source. "AirNow reports preliminary current
 * conditions and updates them hourly" is true of AirNow whether or not this
 * record exists and whatever any of its fields hold; no field on this record
 * states it, and the only way to put it in a clause would be to hang it on a
 * reference it has nothing to do with. A clause needs a reference for a reason,
 * and a reference chosen just to satisfy that rule is the abuse of it. So it is
 * in `lib/adapters/airnow.ts`'s `caveats`, where it is a disclosure reachable
 * from the trace rather than a claim about a value.
 *
 * ON THE THIRD CAVEAT, WHICH IS A CLAUSE FOR A DIFFERENT REASON.
 * `.dev/briefs/U1.6-U1.7-air.md` rule 3 requires that the reader can see, *on
 * the card*, that this row shape has never been checked against a real
 * response. `caveats` does not do that: it is a field of `RecordTrace`, and a
 * card is its sentences, so an audit rendered both templates and found nothing
 * on either card saying so. `derivation` below is that sentence, and the
 * objection above does not reach it. The hourly-update caveat is true of AirNow
 * whether or not this record exists; this one is a statement about how this
 * row's own values were read, and every value either template prints came
 * through a field name nothing published — so whichever slot it hangs on, it
 * qualifies that slot rather than borrowing it.
 *
 * It hangs on `pollutant` because that is the slot naming the row rather than
 * one of its values, and the shape caveat is about the row. It also has to be a
 * slot present wherever either template renders: `aqi` is pinned absent on one
 * of them, `category` is null on every record this adapter can build, and
 * neither could carry a sentence that must always print.
 *
 * `lib/templates/fema.ts` splits the same pair the same way and keeps its point
 * caveat in both places; this file follows it, so the reporting-area
 * qualification is a clause here *and* a record caveat there, and a reader who
 * arrived through a value rather than through the sentence still meets it.
 *
 * ON THE CATEGORY CLAUSE, WHICH CURRENTLY NEVER PRINTS. `category` is null on
 * every record this adapter can build, because AirNow's per-service
 * documentation is behind a login and nothing reachable says which column
 * carries a category or whether it is a string or an object — so the adapter
 * leaves it out of the schema and reads it as `absent`. The clause stays for
 * two reasons. It is the honest shape of the card: the one public description
 * of this service says it returns "AQI values and categories", so the sentence
 * the product owes a reader has a category in it, and the reason they are not
 * seeing one is a gap this repository can close by recording one response. And
 * a missing slot removing its own clause is the mechanism that makes that safe
 * — the clause disappears rather than rendering "AirNow's category for that
 * index is ." — so the card is correct today and complete the day the column is
 * known. It is its own clause for that reason and shares none.
 *
 * It belongs to `summary@1` alone. "AirNow's category for that index" needs an
 * index to point at, and `no-index@1` is the template for a row that has none,
 * so putting the clause in the shared tail would have left a pronoun with no
 * antecedent waiting for the day the column is recorded.
 *
 * ON WHAT THE CATEGORY CLAUSE WILL SAY WHEN IT PRINTS. "AirNow's category for
 * that index is Moderate" attributes the word to AirNow and states it. It does
 * not explain it, expand it or grade it. EPA's category names are a scale, and
 * `docs/BRIEF.md` C2 forbids this report from carrying a severity or a verdict
 * — but the prohibition is on judgements this report makes, not on printing an
 * agency's own field, which is the same reason `lib/templates/fema.ts` prints
 * "inside the Special Flood Hazard Area". Naming AirNow in the clause is what
 * keeps the two apart: the category is theirs, and the sentence says so.
 *
 * ON THE ARTICLE, WHICH IS WHY THE INDEX COMES BEFORE THE POLLUTANT. A
 * template cannot branch, so one sentence has to be grammatical for both
 * members of the pollutant vocabulary, and "a ${pollutant} air quality index"
 * renders "a PM2.5 air quality index" and "a Ozone air quality index". The
 * summary therefore states the index first and attaches the pollutant with a
 * preposition, and `no-index@1` uses the pollutant adjectivally where no article
 * stands in front of it. Neither wording needs to know which word filled the
 * slot, which is the property that makes it a single template rather than two.
 *
 * ON "AIR QUALITY INDEX" SPELT OUT. The record field is `aqi` and the agency's
 * column is `AQI`, but a card that reads "AirNow reports a PM2.5 AQI of 58"
 * assumes the reader knows the acronym, and the trace panel shows the raw field
 * name `AQI` beside the span for anyone who wants it. The words are EPA's own
 * expansion of its own initialism, not a gloss this file invented.
 *
 * ON THE POLLUTANT WORD. `pollutant` is `Sourced<"PM2.5" | "Ozone">`, this
 * report's vocabulary rather than AirNow's, and its provenance is the query
 * that says so. AirNow's own parameter string, `PM2.5` or `O3`, reaches the
 * record through `subject` and is in the trace. No clause prints `subject`: it
 * is the reporting area and the parameter joined, and both halves are already
 * on the card under their own names, so printing it would say "Houston O3"
 * beside "the Houston reporting area" and tell the reader nothing twice.
 *
 * NO DISTANCE. `distanceMeters` is null on every record of this kind by
 * construction — the adapter claims no location, because a reporting area
 * contains the mapped point rather than sitting some way from it. B10's
 * "distance next to every value" is about a distant air monitor, which is AQS's
 * card and not this one. A `km(field("distanceMeters"))` clause here would drop
 * on every record, which is not a sentence but a place a reader would expect
 * one, so there is none.
 *
 * ONE CLAUSE FOR THE LEAD, NOT THREE. A clause dies whole when any reference
 * has nothing to show, so the rule is that an optional field never shares with
 * a required one. Neither lead clause breaks it: `reportingArea` is
 * `z.string()` on the adapter's schema and cannot be null, `observedAt` is read
 * from a `z.string()` column and is the field the record kind declares
 * non-null, `pollutant` is a `fromQuery` value that exists wherever the record
 * does, and `aqi` is pinned present or absent by each template's own
 * requirement. Every slot in a lead clause is therefore guaranteed wherever
 * that template renders at all, and neither lead can leave the card with the
 * area unnamed. `lib/templates/frs.ts` closes the dangling-clause hazard with
 * the same argument.
 */

import type { Clause, FieldRef } from "@/lib/evidence/templates";
import { defineTemplate, sentence } from "@/lib/evidence/templates";

/**
 * What both templates end on. Shared so the two cannot drift apart on the one
 * thing they do not disagree over, the way `lib/templates/fema.ts` shares its
 * column readouts.
 *
 * It comes after the values it qualifies, and it names the area again rather
 * than saying "it", so a dropped clause above never leaves it dangling. Only
 * `derivation` follows it, because that one is about every clause above
 * including this one.
 */
function qualification(field: FieldRef<"airnow-observation">): Clause<"airnow-observation"> {
	return sentence`AirNow's observations describe the ${field("reportingArea")} reporting area, not the mapped point.`;
}

/**
 * The other shared clause: rule 3's disclosure, on the card rather than only in
 * the trace. `pollutant` is present on every record of this kind, so this
 * sentence prints wherever either template does — and drops with the record it
 * is about, which a `caveats` entry could not do.
 */
function derivation(field: FieldRef<"airnow-observation">): Clause<"airnow-observation"> {
	return sentence`No response from this service has been recorded, so this ${field("pollutant")} row is read through field names this report derived and is unverified against real bytes.`;
}

/** AirNow stated an index for this pollutant: the card prints it, attributed, with no word added to it. */
export const airnowObservationSummary = defineTemplate(
	"airnow-observation",
	"airnow-observation/summary@1",
	(field) => [
		sentence`AirNow reports an air quality index of ${field("aqi")} for ${field("pollutant")} in the ${field("reportingArea")} reporting area, observed ${field("observedAt")}.`,
		sentence`AirNow's category for that index is ${field("category")}.`,
		qualification(field),
		derivation(field),
	],
	[{ slot: "aqi", present: true }],
);

/**
 * AirNow answered for this pollutant and stated no index. That is a fact about
 * what AirNow sent, which is why it is a template of its own with a requirement
 * behind it and not a fallback inside the sentence above: over a record
 * carrying an index it would report an answer that was never given.
 *
 * It is also not the no-data state. A source that answered with no rows at all
 * is `lib/evidence/source.ts`'s `no-data` and gets a source sentence; this is a
 * row that exists and holds no index.
 */
export const airnowObservationNoIndex = defineTemplate(
	"airnow-observation",
	"airnow-observation/no-index@1",
	(field) => [
		sentence`AirNow's ${field("pollutant")} observation for the ${field("reportingArea")} reporting area, observed ${field("observedAt")}, carries no air quality index.`,
		qualification(field),
		derivation(field),
	],
	[{ slot: "aqi", present: false }],
);

export const airnowTemplates = [airnowObservationSummary, airnowObservationNoIndex];
