# Ground Truth

Type a US address. Read what the public environmental record says about it.
Click any sentence to open the government record behind it.

Live at https://ground-truth-946486142611.us-central1.run.app

## The problem

You found a place. The listing shows the kitchen, the light and the commute.
It does not show the refinery 750 metres east, the cleanup site 700 metres
away, the ozone monitor whose readings are public, or the flood zone the block
sits in.

All of that is public. It sits in six federal systems. Each has its own search
form and its own vocabulary, and none of them can be asked about one address
across all six. Renters never look. Buyers pay a consultant to look.

## What it does

Ground Truth asks all six systems about one address and returns one report.
Every sentence in the report is rendered from fields the agency sent, and every
sentence opens to show the agency, the record ID, the raw field, the raw value,
the date it was fetched, and a link to the original record.

The report is organised around the questions a person has, not around the
agencies' filing systems.

- The air here. Today's index from AirNow, and the recorded annual summaries
  from every monitor within 50 km, from EPA's Air Quality System.
- Water and flooding. The flood zone FEMA maps at the point, and whether the
  point sits inside the Special Flood Hazard Area.
- Land once contaminated. The Superfund sites EPA lists within 5 miles, which
  of them are on the National Priorities List, and how far each one is.
- Industry next door. The regulated facilities EPA ECHO lists within 5 miles,
  their compliance history, and the facility registry behind them.

## What it will not do

It does not score the home. It does not tell you the home is safe. Six sources
with six meanings do not add up to one number, and a number would be the first
thing a reader trusted and the last thing anyone could defend.

A source that fails says so and offers a retry. It is never replaced with a
cached or recorded answer. "No matching records" means the source returned
nothing within the boundary it was asked about, which is not the same as
nothing being there.

No sentence on the report was written by the software. Every one is a template
filled from an agency's own fields, and a test enumerates every word the
interface is allowed to write on its own. The report explains a term
the agencies use, such as "Removal Only Site" or "zone AE", in that agency's
own words, with a link to where they wrote it.

## How a report is made

1. You type an address, or pick one of twelve public addresses probed in
   advance. The address goes to the US Census Geocoder and nowhere else.
2. The geocoder returns a point on a street block, or several candidates, or
   no match. You confirm the match. The screen shows what confirming will ask.
3. Only then are the other six systems asked, with the point and a distance.
   The address you typed does not travel on.
4. Each system answers on its own. The report fills in as they arrive, and a
   source that cannot be reached says so without holding up the others.
5. The report lives in your browser and is gone when you close the tab. There
   are no accounts, no stored searches, and no addresses or coordinates in any
   log.

## What you see

Each answer sets its figures large, so a count of fifteen sites reads at a
glance. Where a source searched by distance, a strip shows every record
at its true distance from the point. It shows distance only, because the
record carries no direction and a mark at an angle would claim one.

A timeline runs across all four questions. Every dated fact from every source
sits on one axis of years, so you can see when things happened here without
reading a list. A source with no dated record says so instead of vanishing.

Where an agency publishes a scale, the report draws that scale and places the
value on it. AirNow's six air quality bands appear with AirNow's names and
edges. FEMA's definition of a floodplain is drawn as the three tiers FEMA
describes, with a marker on the tier this point falls in. The report never
invents a scale of its own, and it draws every band in one neutral colour,
because a coloured band would read as a verdict.

Clicking any underlined phrase opens the trace. The trace names the agency,
the record, the raw field, the raw value, the transform applied, the URL that
was fetched, and the SHA-256 of the exact bytes that came back.

## Try it

The twelve starting addresses are public, non-residential places, grouped by
what the record holds for them. Each was run through the application against
the live sources, and the line under each one says what came back that day.
Two of them are there because the geocoder finds nothing for one and seven
places for the other, and those screens are worth seeing too.

The address box suggests from the live geocoder once a street line is
complete, and from the twelve examples as you type. The geocoder completes
nothing, so a street name has to be whole before it answers.

## Run it yourself

```bash
bun install
bun dev
```

AirNow and EPA's Air Quality System need free keys. `scripts/setup.sh` opens
the right pages, writes `.env.local`, and checks what landed. Copying
`.env.example` by hand works too. The other sources are open.

Without the keys the report still runs. The two air cards say the source could
not be reached because this deployment holds no credential, which is a fact
about the deployment and not about the address. The other cards are
unaffected. Keys stay on the server and never reach browser code.

```bash
bun run verify   # typecheck, tests, lint
bun run e2e      # the full path from address to trace, in a browser
```

## Where it runs

The live deployment runs on Cloud Run in `us-central1`, and all six sources
answer from there, including FEMA's own National Flood Hazard Layer.

FEMA's layer refuses connections from outside the United States. Run the
application from elsewhere and the flood card falls back to Esri's copy of the
layer, names on the card which layer answered, and says what the copy cannot
tell apart. Run it from inside the US and you get FEMA's own answer.
