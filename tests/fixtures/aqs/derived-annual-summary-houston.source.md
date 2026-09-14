# derived-annual-summary-houston.json — authored, not recorded

**These bytes were constructed. No successful AQS response has ever been
captured by this repository.** The only real AQS bytes here are
`rate-limited.json`, the HTTP 429 recorded live on 2026-09-16.

Constructed 2026-09-16 by the U1.6 adapter agent.

## Where the shape comes from

| Part | Source | Date read |
|---|---|---|
| The envelope (`Header` array, `Body` array, the header keys, the no-data and failed headers) | `https://aqs.epa.gov/aqsweb/documents/data_api.html`, sections "Output Format - JSON" and "Error Handling and Status Codes" | 2026-09-16 |
| Ten of the thirteen row keys | the same page's one published row, in "Output Format - JSON" — which is a `sampleData` row, so they are published for this API and not for this service | 2026-09-16 |
| `arithmetic_mean`, `observation_count`, and the singular `unit_of_measure` | derived; see below | 2026-09-16 |

**The shape of a row has never been checked against a real response from this
service, and every record built from it carries a caveat saying so.**

## The page does not publish the columns of this service

This is the thing `.dev/briefs/U1.6-U1.7-air.md` did not expect, and it is worth
stating plainly. `data_api.html` says:

> The body is an array with one object per data row. The contents of the object
> will vary based on the request made. (E.g. the columns of data returned are
> different for each query.

and points at `metaData/fieldsByService` for the per-service list. That service
needs a working key. It was called once from this machine on 2026-09-16 —
`metaData/fieldsByService?email=test@aqs.api&key=test&service=annualData` — and
answered `429 Too Many Requests`, `Retry-After: 86400`, body
`{"error":"Daily limit for account use exceeded. Retry later."}`: the same
exhausted shared account `rate-limited.json` records. It was not called again.

EPA's OpenAPI file, `https://aqs.epa.gov/aqsweb/documents/aqs_api_specification.json`
(read 2026-09-16, `swagger: 2.0`), was checked for the same reason. Its response
schemas are untyped `{Header: [object], Data: [object]}` and its own description
sends the reader back to `metaData/fieldsByService`. It also calls the second
array **`Data`**, which contradicts `data_api.html` and both of that page's
worked examples. This repository follows the page, and
`derived-annual-summary-data-envelope.json` pins what happens if the OpenAPI
file turns out to be right: the parse fails and the source reports `malformed`.

## The thirteen keys, one at a time

`AnnualSummaryRow` declares thirteen. Ten are EPA's own spelling, copied from
the published row. That row is a `sampleData` row, so they are published for
this API and not for this service:

`state_code`, `county_code`, `site_number`, `parameter_code`, `poc`,
`latitude`, `longitude`, `datum`, `parameter_name`, `date_of_last_change`.

Three are derived. `unit_of_measure` is one of the three and not one of the ten:
its spelling is the published row's, but EPA spells the same field plural in its
own annual-summary file format, so choosing between the two spellings *for this
service* is this repository's choice rather than EPA's statement. Counting it on
both sides, as an earlier version of this file did, made the ten look like
eleven and the thirteen look like fourteen.

| Key | Why this spelling | What it fills |
|---|---|---|
| `arithmetic_mean` | The page names no mean column anywhere. EPA's AirData annual-summary file format, `https://aqs.epa.gov/aqsweb/airdata/FileFormats.html` §4.2 field 28 (read 2026-09-16), calls the field "Arithmetic Mean": "The average (arithmetic mean) value for the year." The snake_case spelling is this repository's, following the published row's convention. | `value`, which `lib/evidence/records.ts` requires to be non-null |
| `observation_count` | The page names the field only in prose — "You can use the 'observation count' field on the annualData service to determine how much data exists" — and never spells it. FileFormats §4.2 field 17 is "Observation Count". | `observationCount` |
| `unit_of_measure` | The published row's own spelling, singular. FileFormats §4.2 field 15 calls the same field "**Units** of Measure", plural. This is the coin-flip most likely to be wrong in this file. | `unit` |

If any of the three is spelled differently by the live service, `z.safeParse` in
`lib/io/fetch-source-io.ts` rejects the body and the card says AQS could not be
read. No record is built carrying a guessed number.

**Left out, per rule 2 of the brief.** Every other column of the annual summary
— sample duration, pollutant standard, metric used, event type, observation
percent, completeness, the maxima and percentiles, the local site name — is
named only in the AirData *file* format and not as an API key, so none is in
the schema and none is on the record. Two of them cost the report something and
the loss is stated rather than hidden: without `sample_duration`,
`pollutant_standard` and `event_type` the adapter cannot tell one monitor's
several summary rows apart, so it keeps the first and says so in a caveat; and
without `local_site_name` a monitor has no name but its id.

Row 1 below nonetheless carries ten of those columns. They are there so a test
can prove that a column this repository does not declare changes nothing — zod
strips it — and **their spellings are not claimed to be EPA's.**

## What is in the body, and what none of it is

Five rows, all constructed:

| Row | Monitor | Distance from the A2 Houston point | Why it is here |
|---|---|---|---|
| 1 | `48-201-1039-88101`, POC 1 | 1.51 km | the success case |
| 2 | the same monitor again | 1.51 km | AQS returns several summary rows per monitor per year; this one has a different mean, and the adapter must keep exactly one |
| 3 | `48-201-0024-44201`, POC 1 | 15.76 km | the ozone half of B2's "nearest qualified PM2.5 monitor and nearest qualified ozone monitor" |
| 4 | `48-201-0416-88101`, POC 3 | 20.88 km | `observation_count` and `date_of_last_change` both null: B12's missing-optional-fields case |
| 5 | `48-473-0002-88101`, POC 1 | 55.90 km | inside the bounding box the request has to send, outside B2's 50 km circle, so the haversine boundary is what drops it |

**The identifiers are shaped like AQS identifiers and are not claimed to be real
monitors. The means, the observation counts and the dates are not
measurements.** `9.8`, `0.0421`, `8.4`, `7.1`, `121`, `214` and `118` were
chosen by the author to sit in the range the units make plausible. No number in
this directory came from a monitor.

The `status` is `"success"`, lower case, because that is what the page's worked
example carries; the same page's prose says `"SUCCESS"`. The header also carries
`url`, and a real one would echo the request back **with `email` and `key` in
it** — so this fixture's `url` carries `operator@example.test` and
`REDACT-ME-NOT-A-REAL-KEY`, and `tests/unit/adapters/aqs.test.ts` proves neither
string reaches a record, a payload, a provenance or an error. The schema does
not declare `url`, so zod strips it before anything can read it. `request_time`
and `rows` are documented and unread for the same reason; note that the page's
prose calls the count `row` while both its examples call it `rows`.
