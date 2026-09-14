# derived-annual-summary-data-envelope.json — authored, not recorded

**Constructed 2026-09-16 by the U1.6 adapter agent. No successful AQS response
has ever been captured by this repository.**

The success fixture's header and one row, with the second array named `Data`
instead of `Body`. It exists because EPA's own two documents disagree, and this
repository had to choose:

- `https://aqs.epa.gov/aqsweb/documents/data_api.html` (read 2026-09-16, page
  footer "last updated on 2020-01-10") says the response "has two top-level
  elements. A header and a body", and **both** of its worked JSON examples plus
  its no-data and failed examples carry `"Body"`.
- `https://aqs.epa.gov/aqsweb/documents/aqs_api_specification.json` (read
  2026-09-16), the OpenAPI file linked from that same page, names the second
  array **`Data`** in every one of its response schemas.

`docs/BRIEF.md` B14 and `.dev/briefs/U1.6-U1.7-air.md` both record the envelope
as `Body`, from the page that carries the actual JSON, and `lib/adapters/aqs.ts`
parses `Body`.

This fixture pins the cost of that choice being wrong. A `Data` envelope fails
`AqsResponse`, `lib/io/fetch-source-io.ts` reports `SourceFailure("malformed")`,
and the card says AQS could not be read. It is B12's malformed-response case,
and it is a loud failure rather than a card that reports "no monitors within
50 km" because the rows were in an array nobody looked at.
