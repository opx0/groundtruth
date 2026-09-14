/**
 * The AQS monitor summary template. docs/BRIEF.md A2 gives the air card as its
 * template, because the values come from the monitor:
 *
 *   Nearest PM2.5 monitor: {monitor}, {distance} km from the mapped point.
 *   {year} annual mean: {value} {unit}. The monitor measures its own location,
 *   not this address. AQS data lags collection by 6 months or more.
 *
 * Three of those four sentences survive. The word "Nearest" does not, and the
 * two caveats moved into the clauses holding the slots they qualify. Both are
 * argued below.
 *
 * ONE TEMPLATE, AND WHY THAT IS ENOUGH. `lib/templates/fema.ts` argues that two
 * templates of one kind is exactly when a `Requirement` earns its place, because
 * the kind gate passes both and nothing else knows one of them speaks about a
 * state the other denies. There is no second template here and nothing on this
 * record is a state: every slot this template prints is non-null by
 * construction — `monitorId` is a `coalesce` that cannot be null, `pollutant`,
 * `period` and `statistic` are `fromQuery` values, and `value` and `unit` are
 * required columns of the schema — and the one nullable slot,
 * `observationCount`, has a clause of its own that drops. So `requires` is
 * empty, and the day a second template appears both must declare what they
 * differ over.
 *
 * "NEAREST" IS GONE, AND THAT IS THE ONE THING THIS FILE COULD NOT SAY. A2
 * leads with "Nearest PM2.5 monitor", and docs/BRIEF.md B2's boundary table
 * does promise the nearest qualified monitor per pollutant. But "nearest" is a
 * fact about the selection, not a field on the record: nothing on an
 * `aqs-monitor-summary` says whether another monitor is closer, and
 * `lib/adapters/aqs.ts` returns every monitor within 50 km rather than one.
 * `.dev/briefs/U2.0-record-templates.md` is explicit — a sentence not supported
 * by a field is deleted, not softened — and a `Requirement` cannot express
 * "nearest" either, so the guard that keeps the wrong template off a record
 * could not be built for this claim. The framing survives where it is true:
 * `lib/report/selection.ts` shows one record per pollutant, ordered by
 * distance, under `section/retrieved-at@1`'s "Searched within 50 km of the
 * mapped point" and a per-pollutant no-data note. The card still reads as the
 * nearest monitor; the sentence just stops asserting it.
 *
 * THE DISTANCE CLAUSE CARRIES A2's SPATIAL CAVEAT. "The monitor measures its
 * own location, not this address" qualifies exactly one claim on this card, the
 * distance, and a caveat in a clause cannot outlive the value it is about. If
 * the coordinate is ever absent the whole clause drops and the qualification
 * drops with it, which is right: there is no distance left to qualify. It is
 * also in the record's `caveats`, for the reader who arrives through the trace
 * rather than through the sentence, which is what `lib/templates/fema.ts` does
 * with the parcel caveat and `lib/templates/airnow.ts` with the reporting area.
 *
 * THE VALUE CLAUSE CARRIES THE LAG. "AQS data lags collection by six months or
 * more" is what makes the year in front of the value readable: without it a
 * 2025 mean on a 2026 report looks like a stale number rather than the most
 * recent whole year the source can hold. It qualifies `period` and `value`, so
 * it sits in their clause, and both are non-null wherever this template renders
 * at all.
 *
 * THE DERIVED SHAPE IS A CLAUSE TOO, BECAUSE RULE 3 PUTS IT ON THE CARD.
 * `.dev/briefs/U1.6-U1.7-air.md` rule 3 requires that the reader can see, *on
 * the card*, that this row shape has never been checked against a real
 * response. A record caveat does not do that: `caveats` is a field of
 * `RecordTrace`, and a card is its sentences, so an audit rendered this card
 * and found no word of it there. So the fourth clause says it, and it hangs on
 * `statistic`.
 *
 * `statistic` is the reference and not a convenient one. It is this file's own
 * word for *which column of the service this record read*
 * (`lib/adapters/aqs.ts` builds it with `fromQuery` over the service we
 * called), and the column name is precisely the thing that is unverified — so
 * the clause qualifies the slot it hangs on rather than borrowing it. It is a
 * `fromQuery` value, present wherever this template renders at all, so the
 * qualification cannot outlive the mean and the unit it is about, and a card
 * that prints a number always prints what the number's column name rests on.
 * It stays in `caveats` as well, for the reader who arrived through the trace.
 *
 * WHAT IS STILL ONLY A CAVEAT: that AQS returns several summary rows per
 * monitor and this is the first. That one qualifies the retrieval rather than a
 * slot — it is true of a record whose every clause dropped — and no field on
 * this record states which row was kept, so a clause carrying it would hang on
 * a reference chosen only to satisfy the rule that a clause needs one.
 *
 * THE ID PRINTS THE PARAMETER CODE AFTER THE POLLUTANT'S NAME. "PM2.5 monitor
 * 48-201-1039-88101" ends in `88101`, which is AQS's code for PM2.5, so the
 * pollutant is on screen twice in two vocabularies. Trimming the id to
 * `48-201-1039` would be rewriting an agency's identifier, which B2 and the
 * unit brief both forbid, and printing the id without the pollutant would make
 * the reader learn a five-digit code to know what was measured. The repetition
 * is the cheap half of that trade. `monitorId` is also short by one field —
 * AQS identifies a monitor by state, county, site, parameter and POC, and the
 * POC is a number the kernel's `join` cannot read — which `lib/adapters/aqs.ts`
 * states, and no clause here claims otherwise: it says "monitor" and prints
 * what the record holds.
 *
 * THE OBSERVATION COUNT IS LABEL-THEN-VALUE. `lib/templates/sections.ts` argues
 * the register and it applies here for the same reason: a template cannot
 * branch, so a sentence carrying a count has to read correctly at 1 and at 365,
 * and "calculated from 1 observations" is not English. The count also has its
 * own clause rather than a tail on the value, because it is the one slot on
 * this kind that can be null — `lib/adapters/aqs.ts` reads it from a column EPA
 * names only in prose — and a clause dies whole when any reference has nothing
 * to show. Sharing a clause with the mean would mean a monitor with no count
 * published shows no mean either.
 *
 * WHAT NO FIELD SUPPORTS, so no sentence says it: which sample duration or
 * pollutant standard this summary is calculated under (the columns are not
 * published, so the adapter keeps the first row and caveats it); the monitor's
 * site name (AQS publishes no name column for this service, so the id is the
 * only name); the POC; and any comparison of the value to a standard, which
 * docs/BRIEF.md C2 forbids outright and no field would support anyway.
 */

import { defineTemplate, km, sentence } from "@/lib/evidence/templates";

/**
 * One monitor's annual summary. Four clauses, four independent facts: what and
 * where the monitor is, what it averaged over the year we asked for, how many
 * observations that average rests on, and what the column names behind those
 * numbers are worth.
 */
export const aqsMonitorSummary = defineTemplate("aqs-monitor-summary", "aqs-monitor-summary/summary@1", (field) => [
	sentence`${field("pollutant")} monitor ${field("monitorId")} is ${km(field("distanceMeters"))} from the mapped point, and measures its own location, not this address.`,
	sentence`${field("period")} ${field("statistic")}: ${field("value")} ${field("unit")}. AQS data lags collection by six months or more.`,
	sentence`Observations in the summary: ${field("observationCount")}.`,
	sentence`No response from this service has been recorded, so this ${field("statistic")} is read from column names this report derived and is unverified against real bytes.`,
]);

export const aqsTemplates = [aqsMonitorSummary];
