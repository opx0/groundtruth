# Ground Truth

Type a US address. Read what the public environmental record says about it.
Click any sentence to open the government record behind it.

## The problem

You found a place. The listing shows the kitchen, the light, the commute. It
does not show the refinery 750 metres east, the removal-action cleanup site
700 metres away, the ozone monitor whose summer readings are public, or the
flood zone the block sits in.

All of that is public. It sits in six federal systems, each with its own
search form and its own vocabulary, and none of them can be asked about one
address across all six. Renters never look. Buyers pay a consultant to look.

Ground Truth asks all six about one address and returns one report. Every
sentence in the report opens to show the agency, the record ID, the raw field,
the date, and a link to the original record.

## What it does not do

It does not score the home. It does not tell you the home is safe. Six sources
with six meanings do not add up to one number, and a number would be the first
thing a reader trusted and the last thing we could defend.

A source that fails says so and offers a retry. It is never quietly replaced
with a cached or recorded answer. "No matching records" means the source
returned nothing, which is not the same as nothing being there.

## Sources

| Source | What it answers |
|---|---|
| US Census Geocoder | Which mapped point the address resolves to, and how precisely |
| EPA ECHO | Regulated facilities, compliance status, violations, enforcement |
| EPA FRS | Facility identity, program IDs, coordinate quality |
| EPA SEMS | Superfund assessment and cleanup sites |
| EPA AQS | Historical PM2.5 and ozone readings from nearby monitors |
| AirNow | Current preliminary air conditions |
| FEMA NFHL | The flood designation at the mapped point |

`.dev/BRIEF.md` section B2 records what was verified against each endpoint on
2026-09-16, including which hosts refuse traffic from outside the US and what
the fallbacks cost in accuracy.

## Running it

```bash
bun install
bun dev
```

AQS and AirNow need free keys. `scripts/setup.sh` is a wizard that opens the
right pages, says what to click, writes `.env.local` and checks what landed;
copying `.env.example` by hand works too. Every other source is open.

Without those keys the report still runs: both air cards say the source could
not be reached because this deployment holds no credential for it, which is a
fact about us rather than about the address, and the other five cards are
unaffected. Keys stay server-side and never reach browser code — `bun run test`
builds the app and scans the client bundle to prove it.

```bash
bun run verify   # typecheck, unit tests, lint
bun run e2e      # Playwright, the full address to trace path
```

## Layout

- `lib/` holds the evidence kernel, the source adapters, the selection policy,
  and the renderer. No React.
- `app/` holds the routes and the interface.
- `tests/fixtures/` holds unedited government API responses, except three files
  named `derived-`, which were written by hand because they hold a state no
  real response does: a null air-quality index, a failed AQS header, and an AQS
  status EPA has never sent. Each carries a sibling `.source.md` saying so.
  Production code cannot import any of it — a lint rule forbids it and a test
  reads the built bundle.
- `.dev/BRIEF.md` is the spec: scope, wording, and what was verified against
  each endpoint. `.dev/BUILD.md` is the build log.

## Status

695 unit tests and 14 browser paths, both green, driven against a production
build. `.dev/BUILD.md` has the detail.

It runs, here:

    https://ground-truth-946486142611.us-central1.run.app

Cloud Run, `us-central1`, answering live reports from all six sources,
including FEMA's own flood layer.

One thing is still about where you run it rather than about the code. FEMA's
authoritative layer refuses traffic from outside the US — measured, it resets
in half a second from India and Singapore and answers in a quarter of one from
Iowa. Run this from outside the US and the flood card falls back to Esri's
copy and says on the card which layer answered and what the copy can't tell
apart. Run it from inside and you get FEMA's own answer.
