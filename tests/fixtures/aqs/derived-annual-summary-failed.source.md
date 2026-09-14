# derived-annual-summary-failed.json — authored, not recorded

**Constructed 2026-09-16 by the U1.6 adapter agent. No successful AQS response
has ever been captured by this repository.**

The failed-request header, published in full at
`https://aqs.epa.gov/aqsweb/documents/data_api.html`, section "Error Handling
and Status Codes", read 2026-09-16:

```json
{
  "Header": [
    {
      "status": "Failed",
      "request_time": "2018-06-13T08:05:46.588-04:00",
      "url": "https://...",
      "error": [ "value is missing or the value is empty: param" ]
    }
  ],
  "Body": []
}
```

The status, the `error` array and its message are EPA's, verbatim. The timestamp
and the `url` are this repository's.

The page says this arrives with **HTTP 400**, so `lib/io/fetch-source-io.ts`
turns it into `SourceFailure("http", 400)` before any parse and this body is
never reached in production. It exists because ECHO and ArcGIS both deliver
errors at HTTP 200 (see `tests/fixtures/README.md`), and if AQS ever does, an
error header must not read as a successful empty answer:
`lib/adapters/aqs.ts`'s `headerErrors` throws `SourceFailure("http", [...])`
carrying EPA's own message array, unmapped.
