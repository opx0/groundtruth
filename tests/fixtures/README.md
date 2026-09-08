# Fixtures

Unedited responses from live government endpoints. Nothing here is hand-written
or trimmed. Production code cannot import this directory and a test proves it.

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

**Nulls are everywhere.** Coordinates, accuracy values, and collection methods
are null on real rows in `sems/arcgis-5mi-houston.json`.

## Not recorded

ECHO and the authoritative FEMA NFHL endpoint both refuse connections from the
machine this was built on. See the blocker note in `.dev/PLAN.md`.
AQS and AirNow need free keys that have not been registered.

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

## FEMA NFHL, still not recorded

`hazards.fema.gov` resets the TLS handshake before any HTTP exchange, from
every route tried. Unlike ECHO this is not flakiness and retries do not help.
`scripts/setup.sh` walks through capturing it from a US-reachable host.
