# derived-null-aqi.json — authored, not recorded

**Constructed 2026-09-16 by the U1.7 adapter agent, before any AirNow response
had been captured. A response has since been captured — see
`current-observations-houston.json` in this directory — and this file was kept
because that response does not hold the state it pins.**

One row in the shape AirNow really sends, with `AQI` set to `null`. It pins the
missing-optional-field case of `.dev/BRIEF.md` B12, and it is the only body that
selects `airnow-observation/no-index@1` in `lib/templates/airnow.ts`: a row whose
index is absent must not render the sentence that states one.

## What the recording settled and what it did not

Settled: the four keys. `ReportingArea`, `ParameterName`, `DateObserved` and
`AQI` were derived against the non-null fields `lib/evidence/records.ts` declares
for `airnow-observation` rather than against a published field list, because
AirNow's per-service documentation is behind a login. All four came back spelled
exactly as derived, so the shape of the row below is no longer a guess.

Not settled: **what AirNow sends when a reporting area has no current index for
a pollutant.** Every row of the recording carries one. Nothing reachable says
whether the service omits the key, sends `null`, or sends a sentinel. `null` is
this adapter's own caution. If AirNow omits the key entirely, the schema rejects
the row and the source reports `malformed`, which is a loud failure rather than a
guessed index — and this file would be the thing that was wrong.

## The values are not measurements

`Houston` is the author's short area name, not AirNow's: the recording calls the
same area `Houston-Galveston-Brazoria`. That difference is deliberate and load-
bearing in two tests — `tests/unit/report/selection.test.ts` and
`tests/unit/app/report-route.test.ts` each build one card from both bodies, and
each sentence names the area its own row carried. Do not "fix" the name here to
match the recording; doing so would delete the only assertion that the area on
screen is read off the record rather than off a constant.
