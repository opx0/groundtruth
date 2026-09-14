# derived-null-aqi.json — authored, not recorded

**Constructed 2026-09-16 by the U1.7 adapter agent. No AirNow response has ever
been captured by this repository.**

One row of `derived-current-observations.json` with `AQI` set to `null`. It
pins the missing-optional-field case of `docs/BRIEF.md` B12, and it is the only
case that selects `airnow-observation/no-index@1` in
`lib/templates/airnow.ts`: a row whose index is absent must not render the
sentence that states one.

Source of the shape: `derived-current-observations.source.md` in this directory.
That `AQI` is nullable is this adapter's own caution, not a documented fact —
nothing reachable says whether AirNow omits the key, sends `null`, or sends a
sentinel when a reporting area has no current index for a pollutant. If it omits
the key entirely the schema rejects the row and the source reports `malformed`,
which is a loud failure rather than a guessed index.
