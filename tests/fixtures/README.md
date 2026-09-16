# Fixtures

Unedited responses from live government endpoints, **except the three `derived-`
files**, which were authored rather than captured and each carry a sibling
`.source.md` saying so — see "AQS and AirNow" at the end. Nothing else here is
hand-written or trimmed, with one stated exception: the two AQS recordings have
the two credentials in EPA's echoed request URL replaced, described below.
Production code cannot import this directory and a test proves it.

Recorded 2026-09-16 unless a later note says otherwise.

*There were nine `derived-` files until 2026-09-16.* An operator registered
keys for both air sources that day and six of the nine were replaced by
recordings of the same states. What survives is three bodies that hold a state
no recording does: a null AQI, a failed AQS header, and an AQS status EPA has
never sent.

## Gotchas these fixtures exist to pin

**ArcGIS answers an error with HTTP 200.** `fema/esri-error-bad-geometry.json`
is a 400-class failure delivered with a 200 status and an `error` object in the
body. An adapter that checks only the status code will report a failed query as
a success. Every ArcGIS-backed adapter must look for `error` in the parsed body.

**A count of zero is a real answer, not a failure.**
`sems/arcgis-no-records-nevada.json` is a successful query with `features: []`.
The report must say "no matching records within the stated boundary", which is
a different screen state from "source unavailable".

**One site, two names.** Registry `110000460885` is `HOUSTON REFINERY` in the
ArcGIS layer and `VALERO PLUME` in Envirofacts. Both must reach the trace panel.

**One registry ID, two EPA IDs.**
`frs/arcgis-registry-110000462703-two-ids.json` holds two SEMS site IDs under
one FRS registry ID. This is the grouping rule in `docs/BRIEF.md` B6 rule 1.

**One facility, thirty-eight program interest rows.**
`frs/arcgis-registry-110000460885.json` spans fifteen programs. FRS is an
identity lookup, not a list to render.

**Statuses are sentences, not codes.** `sems/envirofacts-archived.json` carries
`NFRAP-Site does not qualify for the NPL based on existing information`. Status
text is passed through verbatim and never mapped.

**Dates arrive in two shapes.** ArcGIS sends epoch milliseconds as a number.
Envirofacts sends `2022-02-08 00:00:00` as a string. Census sends no date and
no match-type field at all.

**Nulls are everywhere, but not where you would guess.** In
`sems/arcgis-5mi-houston.json` the accuracy values and collection methods are
null while the coordinates are present. The null coordinates are on the
Envirofacts side, in `sems/envirofacts-TXN000622182.json`. Corrected after the
SEMS adapter checked the bytes and found this note wrong.

**The Envirofacts join almost always hits.** All fifteen sites in the Houston
layer fixture have an Envirofacts row, checked against the live endpoint on
2026-09-16. `sems/envirofacts-no-row.json` is the genuine empty response, a
bare `[]` with an HTTP 200, captured with a well-formed EPA ID that has no
record. Treat a missing row as rare, and treat a failed request for a row as a
different thing entirely: one means the inventory has nothing, the other means
we did not get to ask.

## Census, the two curated addresses that had none

Recorded 2026-09-17. `census/` held three files -- the Houston match, an
ambiguous list and a no-match -- so of the five curated addresses in
`docs/BRIEF.md` A6 only three could reach the confirm screen, and the other two
could be driven for their flood half alone.

`census/match-1300-perdido-st.json` and `census/match-400-n-richey-st.json`
close that. Both are single matches, unedited, captured from
`geocoding.geo.census.gov` with `benchmark=Public_AR_Current`, which is
reachable from anywhere and always was. Nobody had asked it for these two
addresses.

**Richey's coordinate is the Pasadena flood point.** The match returns
-95.219950, 29.717476, which is exactly the geometry
`scripts/capture-us-fixtures.sh` uses for `nfhl-zone-ae-pasadena.json` and
`esri-zone-ae-pasadena.json`. The curated address and the flood recordings were
captured months apart and describe the same spot, so A6 row 2 can now be driven
end to end from the address rather than from a coordinate typed into a test.

## Not recorded

The authoritative FEMA NFHL endpoint refuses connections from the machine this
was built on. See the blocker note in `.dev/PLAN.md`.

*Corrected 2026-09-16, again.* This paragraph also said "AQS and AirNow need
free keys that have not been registered". They were registered that day and both
sources are recorded; only the NFHL half is still true.

*Corrected 2026-09-16.* This section read "ECHO and the authoritative FEMA NFHL
endpoint both refuse connections from the machine this was built on." The ECHO
half is wrong, and this file contradicted itself about it six lines down: the
next heading is "## ECHO, recorded 2026-09-16" and `echo/` holds seven payloads.
Only the NFHL half was ever true of both, and it still is.

## ECHO, recorded 2026-09-16

ECHO refused this machine on the first attempts and then answered once the
request carried retries and a longer timeout. It is reachable; it is just slow
and flaky to open. The capture script keeps the retries for that reason.

**ECHO hides the longitude unless you ask for it.** `FAC_LONG` is column 18 of
ECHO's own metadata and it is absent from the default response, while `FacLat`
is present. A facility then has a latitude, no longitude, and no computable
distance. `facilities-page-quarter-mi.json` was captured with an explicit
`qcolumns` list for that reason, and the capture script now always sends one.

**Everything is a string.** `FacLat` is `"29.72263"`, `QueryRows` is `"7"`, and
a penalty is `"$0"` with the currency symbol attached. Nothing is a JSON number.

**Dates are US order.** `FacDateLastFormalAction` is `08/12/2024`, meaning
August, not December.

**Two calls, and the second word differs.** `get_facilities` returns counts and
a `QueryID` with `Message: "Success"`. `get_qid` returns the rows with
`Message: "Working"`. Neither word means failure.

**Zero rows is still Success.** `facilities-none-nevada.json` has
`QueryRows: "0"` and `Message: "Success"`, which is the no-data state.

**Errors come back 200 again.** `error-unknown-queryid.json` is an HTTP 200
whose body is `Results.Error.ErrorMessage`. That is a different error shape
from the ArcGIS one above, so the two adapters cannot share a check.

## ECHO, recaptured 2026-09-16 from a US host

`scripts/capture-us-fixtures.sh` was re-run and brought back one thing the repo
did not have: **`facilities-page-1.json`, the real answer for the demo
address.** All 1,686 facilities within five miles of 9311 E Ave P, in one page,
matched to `facilities-5mi-houston.json` by `QueryID` — the summary and its
page are a pair and must stay one. It is 1.2 MB, which is what 1,686 facilities
costs, and it is the only fixture in the repo that exercises the query the
demonstration actually makes; every other ECHO test runs on the quarter-mile
pair, which is seven rows.

Three files changed in the same run and neither change is interesting:
`QueryID` went from 613 to 223, because ECHO mints a fresh one per call, and
`facility-detail.json`'s document list reordered. That `QueryID` broke a passing
test that had written the digits down — `tests/unit/adapters/echo.test.ts` now
reads the id out of the bytes, so the next recapture cannot break it either.

**The capture script is not idempotent, by design.** Re-running it replaces
recordings with whatever the endpoint says today. That is the point — a fixture
is what a government endpoint really sent — but it means a recapture can change
rendered text and break a test, and when it does the test is usually right to
break. Check the diff before assuming otherwise.

## FEMA NFHL, still not recorded

`hazards.fema.gov` resets the TLS handshake before any HTTP exchange, from
every route tried. Unlike ECHO this is not flakiness and retries do not help.
`scripts/setup.sh` walks through capturing it from a US-reachable host.

## AQS and AirNow, recorded 2026-09-16

This section read "AQS and AirNow, failures only" until an operator registered a
free key for each on 2026-09-16. Both sources now have recorded successes, a
recorded empty answer, and the failure each gives without a credential.

**`aqs/annual-summary-houston.json`.** `annualData/byBox` for the demonstration
coordinate: 212 rows over thirty distinct monitors, twelve PM2.5 and eighteen
ozone, one of which is outside B2's 50 km circle and is dropped by the adapter's
own haversine rather than by the box.

**Its two credentials are replaced, and nothing else is.** EPA echoes the whole
request back in `Header[0].url`, query string included, so the committed copy
carries `REDACTED-EMAIL` and `REDACTED-KEY` in place of the operator's. That is
the only edit to either AQS recording. `lib/adapters/aqs.ts` does the same
substitution at runtime on every string EPA sends, for the same reason: a
failed header quoting the request back would otherwise print a live key in the
trace panel.

**This recording overturned three published-documentation guesses.** The second
top-level array is `Data`, not `Body`; the parameter column is `parameter`, not
`parameter_name`; the unit column is `units_of_measure`, not `unit_of_measure`.
All three came from the worked example on EPA's API page, which is a
`sampleData` row — a different service of the same API. The page does not
publish a column list for `annualData` at all, and still does not; the
difference is that the columns are now read off an answer.

**`aqs/annual-summary-no-rows.json`.** The same query over a box with no
monitor: `"No data matched your selection"`, `rows: 0`, `Data: []`. An answer
with nothing in it, not a failure — a different screen state by construction.

**`airnow/current-observations-houston.json`.** Three rows for
`Houston-Galveston-Brazoria`: O3, PM2.5 and PM10. All four keys
`lib/adapters/airnow.ts` derived before any response existed came back spelled
exactly as derived. `PM10` is outside this report's two-pollutant vocabulary and
its row is dropped, which is the case `derived-unmapped-parameter.json` used to
be authored for. `Category` arrives as `{"Number":1,"Name":"Good"}`, which is
why the rule that kept it out of the schema was worth following: it was named in
AirNow's one public line and nothing said whether it was a string or an object.

**`airnow/no-observations.json`.** A bare `[]`, two bytes, for a coordinate
AirNow has no reporting area for.

**`aqs/rate-limited.json`.** EPA publishes a shared test account
(`email=test@aqs.api&key=test`) and it is exhausted, so every request to it —
including `list/classes` — answers:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 86400
X-Powered-By: Air Quality Systems API, version 2

{"error":"Daily limit for account use exceeded. Retry later."}
```

A real 429 with a real `Retry-After`, which is what `lib/io/fetch-source-io.ts`
turns into `SourceFailure("rate-limited", 429, "86400")` before parsing. The
body is recorded; the headers are documented here because a fixture file holds
bytes, not a response.

*This paragraph said the success envelope was
`{"Header":[…],"Body":[…]}` "according to EPA's own published API
documentation", and that "it is `Body`, not `Data`".* The recording says `Data`.
The documentation page really does print `Body` — in a worked example for
`sampleData`, a different service — and EPA's OpenAPI file said `Data` all
along. Believing the page over the specification was a defensible call and it
was wrong.

**`airnow/unauthenticated.json`.** AirNow without a key:

```
HTTP/2 401
www-authenticate: proprietary

{"WebServiceError":[{"Message":"Request not authenticated."}]}
```

So its error envelope is `WebServiceError`, an array of `{Message}`. Its success
shape was unverified until the recording above; its per-service documentation is
still behind a login and its field list is still not published anywhere
reachable, so what changed is that the four field names are read off a response
instead of derived from the record kind's own requirements.

**B2's AirNow host is a redirect.** Re-checked from this machine on 2026-09-16,
with no key: `https://airnowapi.org/aq/observation/latLong/current?...` answers
`HTTP/2 301`, `server: awselb/2.0`, `location:
https://www.airnowapi.org:443/aq/observation/latLong/current?...`, and
`www.airnowapi.org` answers the 401 above — with and without a trailing slash on
the path. `lib/adapters/airnow.ts` therefore cites `www.`, because the citable
URL is printed on every AirNow record and it has to be one a reader can repeat.

**The `derived-` rule has not changed.** A body this repository authored is
named with a `derived-` prefix and carries a sibling `.source.md` saying where
its shape came from and what no real response backs. Three such bodies are left
here, each pinning a state no recording holds, and each note now says which
recording settled the rest of its shape. FEMA's NFHL half is still built under
the same rule, and still has no recording at all.
