# derived-annual-summary-no-rows.json — authored, not recorded

**Constructed 2026-09-16 by the U1.6 adapter agent. No successful AQS response
has ever been captured by this repository.**

This is the closest thing here to a quotation. `https://aqs.epa.gov/aqsweb/documents/data_api.html`,
section "Error Handling and Status Codes", read 2026-09-16, publishes the
no-data response in full:

```json
{
  "Header": [
    {
      "status": "No data matched your selection",
      "request_time": "2018-06-13T10:15:42-04:00",
      "url": "https://...",
      "rows": 0
    }
  ],
  "Body": []
}
```

The status string, the shape and the HTTP 200 are EPA's. The timestamp and the
`url` are this repository's, and the `url` deliberately carries the two
credentials a real response would echo back — see
`derived-annual-summary-houston.source.md`.

It pins the no-records case of `docs/BRIEF.md` B12: zero rows with a 200 is an
answer, not a failure, and `lib/adapters/aqs.ts` turns it into the kernel's
`no-data` outcome carrying `noMonitorsNote`, which names the year it asked for.
