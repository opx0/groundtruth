# Fixtures

Unedited responses from live government endpoints, **except the nine `derived-`
files**, which were authored from published documentation rather than captured
and each carry a sibling `.source.md` saying so — see "AQS and AirNow" at the
end. Nothing else here is hand-written or trimmed. Production code cannot import
this directory and a test proves it.

Recorded 2026-09-16 unless a later note says otherwise.

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

## Not recorded

The authoritative FEMA NFHL endpoint refuses connections from the machine this
was built on. AQS and AirNow need free keys that have not been registered. See
the blocker note in `.dev/PLAN.md`.

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

## AQS and AirNow, failures only

Both air sources need a free key the operator has not registered, so neither
has a recorded success payload. What is recorded is what each answers without
one, captured live on 2026-09-16, and both are genuinely useful: they are the
rate-limit and the unauthenticated cases of the seven, in real bytes.

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

AQS's success envelope is `{"Header":[{status,request_time,url,rows}],"Body":[…]}`
according to EPA's own published API documentation, which is reachable from
here. It is `Body`, not `Data`. No success payload has been seen.

**`airnow/unauthenticated.json`.** AirNow without a key:

```
HTTP/2 401
www-authenticate: proprietary

{"WebServiceError":[{"Message":"Request not authenticated."}]}
```

So its error envelope is `WebServiceError`, an array of `{Message}` — that much
is now fact rather than assumption. Its success shape is still unverified, and
`docs/BRIEF.md` B2 still says so.

**B2's AirNow host is a redirect.** Re-checked from this machine on 2026-09-16,
with no key: `https://airnowapi.org/aq/observation/latLong/current?...` answers
`HTTP/2 301`, `server: awselb/2.0`, `location:
https://www.airnowapi.org:443/aq/observation/latLong/current?...`, and
`www.airnowapi.org` answers the 401 above — with and without a trailing slash on
the path. `lib/adapters/airnow.ts` therefore cites `www.`, because the citable
URL is printed on every AirNow record and it has to be one a reader can repeat.

Neither of these is a recording of a working source, and no adapter may treat
them as one. Any payload for the success path of either source is authored from
published documentation, is named with a `derived-` prefix, and carries a
sibling `.source.md` saying where the shape came from and that no real response
backs it. That is the same rule FEMA's NFHL half is built under.
