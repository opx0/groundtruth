# U3.1 / U4.1 — the geocode route and the search flow

Build the first two screens of the product and the server route behind them.
`docs/BRIEF.md` A2 describes the screens, B9 describes the privacy lifecycle,
and B10 describes the failure states.

## What to build

**A server route that geocodes an address.** It takes an address from the
browser, calls `geocode` from `lib/adapters/census.ts`, and returns the outcome.
It also needs a real `SourceIo` implementation, since the adapters have only
ever been driven by test doubles. That means `fetch` with `AbortController` for
timeouts, a SHA-256 of the exact response bytes, and the retrieval timestamp.

**The search screen.** One address field. The three curated examples from
`docs/BRIEF.md` A6, which are public non-residential addresses chosen because
each demonstrates something specific.

**The confirmation screen.** The matched address, the mapped point, and how
precise it is. The brief's own wording for the precision line is:

> The point sits on the 9301 to 9399 block, left side of the street segment,
> interpolated by the Census Geocoder. It marks the block, not the parcel.

That sentence is built from real fields on the match. Do not hardcode it.

**The three outcomes, as three different screens.** A confident match goes to
confirmation. Several candidates require a choice and must not auto-select.
No match asks for a fuller address and says which parts help, and it must not
imply the address does not exist, because the no-match fixture is a real
address that EPA has facilities at.

## The privacy rule, which is the point of this unit

The raw address goes to the server, and from the server to Census. Nowhere else.

- It must never reach a log line, an error payload, or any client-side storage.
- After confirmation the browser holds the coordinate and match metadata, and
  the address is not needed again.
- No analytics. No accounts. No database. Nothing persists.
- The privacy note on the search screen says plainly that Census receives the
  address and that every other source is queried with coordinates only.

Write a test that proves an address cannot be recovered from the route's
response, from its error response, or from anything it logs.

## What it must look like

Read `docs/BRIEF.md` A1 to A5 and build something that matches the seriousness
of the product. It is a tool for someone deciding whether to sign a lease, not a
dashboard. Plain, legible, fast, no decorative motion. Tailwind 4 is already
configured. It must work at phone width.

Do not invent product copy that makes claims. `docs/BRIEF.md` C2 lists phrases
that must never appear anywhere, and the words "safe" and "risk" are not
available to you.

## SCOPE

`app/**` and `tests/unit/app/**`. You may create `lib/io/**` for the real
`SourceIo`, since nothing else owns that yet.

Two other agents are editing `lib/evidence/**`, `lib/templates/**` and
`lib/report/**` right now. Read them, do not write them. Do not touch
`lib/adapters/**`, `docs/`, `.dev/` or `tests/fixtures/`.

## ACCEPTANCE

- `pnpm verify` green, and `pnpm build` succeeds. Paste both.
- If verify fails only in files you did not touch, say so and show your own
  files passing in isolation.
- The three outcomes each render their own screen, proven by tests.
- The privacy test described above.
- A test that the real `SourceIo` hashes the exact response bytes and honours
  an abort.
- No API keys, no secrets, and no fixture imports in anything that ships to the
  browser.

## FORBIDDEN

No new dependencies. No git commands, leave the tree dirty. No client-side
state libraries. No `any`, no type assertions.

## TIMEBOX

75 minutes. The route and the three outcomes matter more than visual polish.

## REPORT, 20 lines maximum

Files created. Real verify and build output. What each test proves. What the
three screens look like, in words. Anything you think is wrong.
