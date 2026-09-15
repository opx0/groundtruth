# derived-annual-summary-unknown-status.json — authored, not recorded

**Constructed 2026-09-16 by the U1.6 adapter agent, before any successful AQS
response had been captured. One has since been captured — see
`annual-summary-houston.json` in this directory — and this file was kept
because that response does not hold the state it pins. Its row was replaced
with a real one at the same time, so only the header below is authored.**

A real row under a header status EPA has never sent this repository:
`"Partial data returned during scheduled maintenance"`. `https://aqs.epa.gov/aqsweb/documents/data_api.html` (read
2026-09-16) documents three statuses — the worked examples carry `"success"` and
`"No data matched your selection"`, and the prose adds `"FAILED"` — and
`docs/BRIEF.md` B2 says unknown source statuses are preserved verbatim and never
guessed at.

So `AqsHeaderEntry` types `status` as `z.string()` and nothing in
`lib/adapters/aqs.ts` branches on it. What decides the outcome is the body: rows
present means records, `Data: []` means no-data, and an `error` array in the
header means the source failed. This fixture pins that an unfamiliar status
costs the report nothing and is never mapped into our vocabulary — the record
built from it is byte-for-byte the record the success fixture builds.

Source of the row: `annual-summary-houston.json` in this directory, a real
`annualData/byBox` response. Only the header's `status` is authored.
