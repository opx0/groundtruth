# Ground Truth — session handoff

Written 2026-09-16 at the end of the session that took the build from the
selection policy to a passing exit predicate. Everything durable is in the
repo; this covers only what would otherwise be lost with the conversation.

**Repo:** own git repo, branch `main`, 51 commits, **no remote and nothing
pushed** — deliberate, the operator asked for local commits only.

## Where it stands

```
pnpm verify                        exit 0   733 tests across 35 files
pnpm e2e                           exit 0   9 passed
bash .dev/census/mutation-check.sh          8 of 8
pnpm build                         compiles
```

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

1. **AQS and AirNow keys**, both free. Without them both cards honestly report
   that this deployment holds no credential; the other five sources are
   unaffected and the demo still runs. Do not register either against the
   operator's email without them doing it.
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
- **Ask an agent to prove its new test fails** against the old behaviour. Three
  committed tests turned out to be unable to fail, including both tests of an
  ordering that could be deleted entirely with the suite still green.
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
- **A fixture you author is not a recording.** Nine files carry a `derived-`
  prefix and a sibling `.source.md`; every record built from one says on the
  card that its shape is unverified. Keep that rule.
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
