# derived-unmapped-parameter.json — authored, not recorded

**Constructed 2026-09-16 by the U1.7 adapter agent. No AirNow response has ever
been captured by this repository.**

Two rows: one carrying a `ParameterName` this report has no record field for,
and one carrying `PM2.5`. It pins two things at once.

1. **`docs/BRIEF.md` B12's unknown-status case.** `ParameterName` is
   `z.string()` and never `z.enum()`, so a parameter this codebase has never
   seen parses without error instead of failing the whole response. The known
   row beside it still becomes a record.
2. **What this codebase then does with it, which is lose it.**
   `airnow-observation.pollutant` is `Sourced<"PM2.5" | "Ozone">` in
   `lib/evidence/records.ts` and the adapter may not change that kind, so a row
   outside those two produces no record and its parameter string survives only
   in the payload. That is a gap, and it is recorded in the adapter's module
   comment rather than hidden.

`PM10` is used as the unmapped example because it is the obvious third
criteria pollutant, **not** because anything reachable confirms AirNow spells it
that way, or that this service returns it at all. Source of the shape:
`derived-current-observations.source.md` in this directory.
