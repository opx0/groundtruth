# derived-annual-summary-unknown-status.json — authored, not recorded

**Constructed 2026-09-16 by the U1.6 adapter agent. No successful AQS response
has ever been captured by this repository.**

Row 1 of `derived-annual-summary-houston.json` under a header status EPA has
never sent this repository: `"Partial data returned during scheduled
maintenance"`. `https://aqs.epa.gov/aqsweb/documents/data_api.html` (read
2026-09-16) documents three statuses — the worked examples carry `"success"` and
`"No data matched your selection"`, and the prose adds `"FAILED"` — and
`docs/BRIEF.md` B2 says unknown source statuses are preserved verbatim and never
guessed at.

So `AqsHeaderEntry` types `status` as `z.string()` and nothing in
`lib/adapters/aqs.ts` branches on it. What decides the outcome is the body: rows
present means records, `Body: []` means no-data, and an `error` array in the
header means the source failed. This fixture pins that an unfamiliar status
costs the report nothing and is never mapped into our vocabulary — the record
built from it is byte-for-byte the record the success fixture builds.

Source of the row's shape: `derived-annual-summary-houston.source.md`.
