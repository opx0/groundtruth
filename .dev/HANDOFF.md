# Ground Truth — session handoff

Written 2026-09-16 at the end of the session that took the build from the
selection policy to a passing exit predicate, and extended the same day when an
operator registered keys for both air sources. Everything durable is in the
repo; this covers only what would otherwise be lost with the conversation.

**Repo:** own git repo, branch `main`, 51 commits, **no remote and nothing
pushed** — deliberate, the operator asked for local commits only.

## Where it stands

```
pnpm verify                        exit 0   742 tests across 36 files
pnpm e2e                           exit 0   9 passed
bash .dev/census/mutation-check.sh          8 of 8
pnpm build                         compiles standalone
```

It also runs, which it did not before. `2026-09-17`: the build is deployed on a
Compute Engine instance in `us-central1`, served by
`ground-truth.service` on port 8300, and answers a live report across all six
locus sources in about fourteen seconds. The full predicate passes there too,
in a clean shell and in one holding the operator's real keys.

That is `.dev/PLAN.md`'s exit predicate, and it passes. Every unit on the board
is done. `docs/BRIEF.md` is still the source of truth for scope and wording.

## Read these first, in this order

| Path | What it is |
|---|---|
| `docs/BRIEF.md` | Product and engineering source of truth. A is the pitch, B the build, C the guardrails. Several lines carry dated corrections; those are deliberate and the wrong conclusion is left visible beside the right one. |
| `.dev/PLAN.md` | The unit board, the exit predicate, and an open queue of twenty-one numbered items with the closed ones marked. |
| `.dev/briefs/` | One brief per unit, in the order they were built. The later ones (`U2.0b`, `U2.0c`, `U2.1b`, `U6`) are review findings rather than units, and reading one is the fastest way to see what kind of defect this codebase actually produces. |
| `lib/evidence/sentence.ts` | The renderer's module comment is the design argument for the whole thing: rendering is a pure read of the store, nothing caches, and that is what makes the deletion guarantee hold. |
| `.dev/decisions.tsv` | `column -s$'\t' -t .dev/decisions.tsv` renders it. |

## What this session added to the kernel, and why

Each of these was forced by a defect, not designed up front. If one looks
gratuitous, the reason is in its own comment.

- **`Requirement` on a template.** The kind gate stopped a Superfund template
  rendering an ECHO record and did nothing to stop the *wrong* Superfund
  template rendering the *right* one. A template that asserts a state now
  declares it and `assemble` refuses otherwise.
- **`SectionSpec.carried` and `SectionSubject.notShown`.** ECHO answers 1,686
  facilities within five miles; the report carries a bounded head and now says
  what that cost, as a number recomputed from the store like the count.
- **`SourcePlacement.agency`.** FEMA is one `SourceId` and two layers, and the
  flood card said one named source both answered and could not be reached.
- **`FailureCause` gained `not-configured`.** Three units in a row reported the
  enum missing it and each settled for `unknown`, which made a card say the
  reason was not known when it was the one thing that was.
- **`map-code` reader, `date` display format, `day()`.** A boolean cannot be
  printed and an epoch-ms field should not claim a clock time.

## What is still open, and who can close it

**Only the operator can clear these.** `scripts/setup.sh` walks all of them.

0. ~~**FEMA's NFHL host.**~~ **Cleared 2026-09-17, and it was never about the
   host.** `hazards.fema.gov` resets the TLS handshake from India in 0.59 s and
   from `asia-southeast1` in 0.46 s, and answers HTTP 200 from `us-central1` in
   0.26 s. The block is on egress. That had been inferred for days and was
   proven by running the same request from three places.
   `scripts/capture-us-fixtures.sh` then did what it was written for, and three
   NFHL fixtures are committed. The live test at the foot of
   `tests/unit/adapters/fema.test.ts`, gated behind `FEMA_LIVE=1` and never once
   run, passes from there in 224 ms. So do the live ECHO and SEMS suites.

   The consequence is bigger than a fixture. The deployment reaches the
   authoritative layer, so the flood card states FEMA's own zone X and its
   `AREA OF MINIMAL FLOOD HAZARD` subtype where the Esri copy returns no
   features and could only say it was unable to tell minimal hazard from
   unmapped. That path had never been exercised by any test; two now cover it.

1. ~~**AQS and AirNow keys**, both free.~~ **Cleared 2026-09-16.** The operator
   registered both. The keys live in the gitignored `.env.local` at the repo
   root and nowhere else, and both sources now have a recorded success and a
   recorded empty answer. Two things about that are worth knowing before
   touching either: AQS echoes the request URL back in `Header[0].url`, so the
   committed recordings carry `REDACTED-EMAIL`/`REDACTED-KEY` and any recapture
   must do the same; and the recordings falsified four things this codebase had
   written down and argued for, which `tests/fixtures/README.md` lists. Do not
   register anything against the operator's email without them doing it.
2. **FEMA's NFHL host** resets the TLS handshake from this machine by every
   route tried. The report answers from Esri's reduced-set copy and says on the
   card which layer answered and what the copy cannot distinguish. One capture
   from a US-reachable host closes it.
3. EPA's shared AQS test account is exhausted and answers 429 to everything. It
   has never once worked; re-checking it costs a request.

**Open in the code**, all in `.dev/PLAN.md`'s queue with numbers:

- A disconnected client cancels nothing: twenty-two of twenty-five upstream
  requests are issued after the reader has gone. `app/api/report/handler.ts`
  carries the measurement and the shape of the fix — an `AbortSignal` through
  `SourceIo`, which is a kernel change every looping adapter has to honour.
- `TemplateRegistry` has still never been instantiated, and now nothing blocks
  it.
- `SectionSpec.query` is null at every call site, so clicking a count or a
  boundary opens a trace with no payload behind it. Closing it needs a
  `SourceOutcome` that carries a query out.
- No Playwright path drives 1300 Perdido St, so the zone X levee subtype — the
  one verbatim agency string A6 shows for that address — is asserted only in
  unit tests.

## How this session worked, and what to keep doing

The delegation pattern is the thing worth carrying forward, and one part of it
earned its keep more than the rest.

- **A brief file per unit** under `.dev/briefs/`, then an agent told to read it.
  Goal, reading order, file scope, numbered checkable acceptance, what is
  forbidden, a capped report format.
- **Disjoint file scope per parallel agent, stated explicitly.** Five agents ran
  at once repeatedly. The one collision that got through was two agents sharing
  a *fixture plan* while owning different files — scope by what a file means,
  not only by its path.
- **The verify pass is where the value is.** Ask for an empirical run — render
  every template against every fixture and print the strings — not a
  read-through. Every serious defect this session was found that way, in work
  that was already green with an accurate self-report: a template asserting the
  opposite of what a record said, a count that disagreed with the records
  beneath it, a credential reaching the screen through a source's own error
  text, a headline number silently becoming zero.
- **Run the suite somewhere other than your laptop.** Doing it on the
  deployment host, in a shell holding the operator's real keys, failed eight
  tests across four files that pass here. Four files assume this deployment
  holds no air credential, `tests/unit/app/report-route.test.ts` states that as
  a rule, and nothing enforced it: it held only because vitest does not read
  `.env.local` the way next does. None of the eight messages mentioned a
  credential, so the reader hunts the renderer for a defect that is in their
  shell. `tests/setup/no-ambient-credentials.ts` now makes the rule true and
  `tests/unit/hermetic.test.ts` guards it.
- **Ask an agent to prove its new test fails** against the old behaviour. Three
  committed tests turned out to be unable to fail, including both tests of an
  ordering that could be deleted entirely with the suite still green.
- **A derived fixture is a bet, and saying so out loud is what lets you
  collect.** Every air record carried a caveat naming its shape as unverified,
  and the cards printed it. When the keys arrived, four of those bets turned
  out to be losing ones — an envelope, two column names and a field type — and
  each was found in minutes because the exact claim was written where the
  recording could contradict it. A schema that had been permissive, or a
  comment that had said "probably", would have put a wrong number on a card
  instead.
- **Verify artifacts, never self-reports.** Several agents reported green while
  a file they did not own was red. That is honest and still not the answer to
  "is the build green".

## Things that will bite you

- **`.dev/census/mutation-check.sh` must report 8 of 8** after any kernel
  change. It deliberately breaks each guarantee and confirms it fails. If you
  move code a mutation targets, fix its `sed` expression rather than deleting
  the case — that happened once this session and the script caught itself.
- **Do not run it while agents are working.** It mutates shared files in place
  and restores from `/tmp/mut.bak`.
- **Changing a rendered sentence breaks exact-string assertions across four or
  five files**, and that is the design working. Update them and say why; do not
  loosen an assertion to a substring.
- **A fixture you author is not a recording.** Three files carry a `derived-`
  prefix and a sibling `.source.md` — there were nine until the air keys
  arrived, and six were replaced by recordings of the same states. Each of the
  three survives because it holds a state no recording does, and each note says
  which recording settled the rest of its shape. Keep that rule; it is what
  made the air fixtures worth recapturing at all, because the cards said out
  loud that they were guesses.
- **Never write a claim `docs/BRIEF.md` C2 forbids.** The renderer has no path
  that emits a verdict, and three separate audits went looking.

## Two traps this session walked into

- **A stale `next start` on port 3000 silently serves an old build.**
  `playwright.config.ts` used to reuse an existing server locally, so `pnpm e2e`
  would rebuild, then test the *previous* build anyway. Six of nine paths failed
  with the search button stuck disabled and nothing in the output said why. It
  is now `reuseExistingServer: false`; if you see that failure shape, check
  nothing is listening on 3000.
- **`scripts/setup.sh` writes `.env.local` beside itself if you run it from
  `scripts/`.** Next.js reads `.env.local` from the project root, so the keys
  are silently not picked up. It was moved by hand once; the script should
  resolve the repo root rather than the working directory.

## One judgement call to revisit

The report withholds the final-NPL count entirely when any Superfund site's
status could not be retrieved, because a count of the sites the inventory
answered for is not a count of the world and no template says the narrower
thing. That is honest and it is also a silence. Two sentences would close it
properly, and `lib/report/selection.ts`'s `nplCountHeadline` comment names
both, along with the kernel arm the second one needs — `SectionFilter` cannot
express "this slot is absent", only "this slot's value is X".
