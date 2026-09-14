# derived-no-observations.json — authored, not recorded

**Constructed 2026-09-16 by the U1.7 adapter agent. No AirNow response has ever
been captured by this repository**, so this is not a recording of AirNow
answering with nothing.

An empty JSON array. It exists to pin the no-data case of `docs/BRIEF.md` B12:
a source that answered and held no matching records is a different screen state
from a source that could not be reached, and `lib/evidence/source.ts` turns zero
records into `{status: "no-data"}` rather than a failure.

Source of the shape: `derived-current-observations.source.md` in this directory
argues the whole field list and records what could and could not be read from
`https://docs.airnowapi.org/webservices` on 2026-09-16. Nothing reachable states
what this service sends when it has no observation for a point; an empty array
is the author's reading of a JSON list service, not a documented behaviour. If
AirNow instead answers with an object or an error envelope, that is a parse
failure or an `http` failure, and both are honest outcomes distinct from
no-data.
