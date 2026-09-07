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
