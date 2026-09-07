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

`docs/BRIEF.md` section B2 records what was verified against each endpoint on
2026-09-16, including which hosts refuse traffic from outside the US and what
the fallbacks cost in accuracy.

## Running it

```bash
pnpm install
pnpm dev
```

AQS and AirNow need free keys. Copy `.env.example` to `.env.local` and fill
them in. Every other source is open. Keys stay server-side and never reach
browser code, which `pnpm test` enforces.

```bash
pnpm verify   # typecheck, unit tests, lint
pnpm e2e      # Playwright, the full address to trace path
```

## Layout

- `lib/` holds the evidence kernel, the source adapters, the selection policy,
  and the renderer. No React.
- `app/` holds the routes and the interface.
- `tests/fixtures/` holds unedited government API responses. Production code
  cannot import them and a test proves it.
- `docs/BRIEF.md` is the source of truth for scope, wording, and verification.
- `.dev/` holds the build's decision trail and unit clock.

## Status

Under construction. `.dev/PLAN.md` tracks which units are done and what each
one proved.
