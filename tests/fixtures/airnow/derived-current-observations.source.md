# derived-current-observations.json — authored, not recorded

**These bytes were constructed. No AirNow response, successful or otherwise,
has ever been captured by this repository.** The only real AirNow bytes here
are `unauthenticated.json`, the HTTP 401 recorded live on 2026-09-16.

Constructed 2026-09-16 by the U1.7 adapter agent.

## What the field list is built from, and what it is not built from

The rule in `.dev/briefs/U1.6-U1.7-air.md` is that a derived fixture's field
names come from published documentation rather than from an author's
expectations. **AirNow's published response documentation could not be read.**

- `https://docs.airnowapi.org/webservices` — reachable without a login, read
  2026-09-16. It lists the service and describes it in one line: *"Current
  Observations by Reporting Area … By latitude/longitude — Get current AQI
  values and categories for a reporting area by latitude and longitude."* The
  same page lists that service under the heading **"Web Services that will be
  retired in the fall of 2026"**. It names no response field.
- `https://docs.airnowapi.org/CurrentObservationsByLatLon/docs` — read
  2026-09-16. It answers `302` to `https://docs.airnowapi.org/login`. So does
  `/files` and `/feeds`. The per-service pages, which are where a response
  field list would be, are behind an account. This matches `docs/BRIEF.md` B2:
  *"Rate limits are documented behind login."*

So the four keys below are **not** backed by a published field list. They are
the smallest set that can fill the non-null fields `docs/BRIEF.md` B4 and
`lib/evidence/records.ts` already declare for `airnow-observation`
(`reportingArea`, `pollutant`, `observedAt`) plus the one nullable field the
public one-line description does support (`AQI`):

| Key | Type | Why it is here |
|---|---|---|
| `ReportingArea` | string | B4's `reportingArea`, and B2's boundary row: "the reporting area or monitor location AirNow returns". |
| `ParameterName` | string | B4's `pollutant` is `"PM2.5" \| "Ozone"`, this report's vocabulary; something on the row has to say which of AirNow's parameters it carries, or the two cannot be told apart. |
| `DateObserved` | string | B4's `observedAt` is non-null, so the row must state a time. |
| `AQI` | number or null | The public one-line description says this service returns "AQI values". |

**The rule is applied asymmetrically here, and that is the honest way to say
it.** Rule 2 is "where the documentation does not say, do not invent", and
nothing published names *any* column of this service, so read strictly it empties
the schema. The four keys above are not better documented than the three below:
three of them are kept because `lib/evidence/records.ts` declares
`reportingArea`, `pollutant` and `observedAt` non-null on this kind and no record
exists without them, and `AQI` is kept because the public one-line description
names it and the kind holds it. `Category` is named by that same line and is
dropped anyway, because nothing requires it and nothing says whether it is a
string or an object. So: the record kind's own requirements are what the four
names were derived against, and rule 2 gets everything no requirement forces.
Both `lib/adapters/airnow.ts`'s caveats and a clause on both cards in
`lib/templates/airnow.ts` tell the reader all four are unverified.

**Fields deliberately absent**, per rule 2 of the brief — where the
documentation does not say, do not invent:

- `Category` — the same one-line description says "and categories", but nothing
  reachable says what carries one or whether it is a string or an object. It is
  read as `absent` on every record, and `lib/templates/airnow.ts` keeps a clause
  for it that drops until a recorded response names the column.
- `Concentration` and `Unit` — the words "data concentrations" appear on
  `/webservices` only under *Observations by Monitoring Site*, a different pair
  of services. Nothing attributes a concentration to this one.
- Any coordinate. Nothing reachable says this service returns one, so the record
  claims no `location` and the kernel computes no distance. A reporting area
  contains the mapped point rather than sitting some way from it, the same
  reason `lib/adapters/fema.ts` claims none for a polygon.

## The request details are unverified too

`lib/adapters/airnow.ts` sends `latitude`, `longitude`, `format`, and the key as
`API_KEY`, to the path `docs/BRIEF.md` B2 gives. The path is B2's; the three
parameter names are not backed by anything reachable.

The **host** is B2's with `www.` in front, and that is checked rather than
assumed. From this machine on 2026-09-16, with no key:

```
GET https://airnowapi.org/aq/observation/latLong/current?format=application/json&latitude=29.72&longitude=-95.26
HTTP/2 301
server: awselb/2.0
location: https://www.airnowapi.org:443/aq/observation/latLong/current?format=application/json&latitude=29.72&longitude=-95.26

GET https://www.airnowapi.org/aq/observation/latLong/current?...
HTTP/2 401
www-authenticate: proprietary
content-type: application/json;charset=UTF-8

{"WebServiceError":[{"Message":"Request not authenticated."}]}
```

— the same bytes `unauthenticated.json` holds. So B2's bare host is a redirect
and `www.` is the host that serves this service; the adapter cites the one that
answers, because the citable URL is printed on every AirNow record and a reader
has to be able to repeat it. The trailing slash is the adapter's own and B2 does
not carry it; both forms answered the same 401 in the same check. The response's
`content-type` on the recorded 401 was `application/json;charset=UTF-8`, which
is the only evidence here that JSON is what comes back.

## What happens if this shape is wrong

The schema is narrow on purpose. A response whose keys differ fails
`z.safeParse` in `lib/io/fetch-source-io.ts` and becomes
`SourceFailure("malformed")`, so the card says AirNow could not be read. It
does not become a record with a guessed value in it. Every record built from
this shape also carries a caveat saying the shape has never been checked against
a real response.

## The values

`Houston`, `2026-09-16`, `41` and `58` were chosen by the author to sit near the
Houston test point of `docs/BRIEF.md` A2. They are not measurements. No AQI in
this directory came from a monitor.
