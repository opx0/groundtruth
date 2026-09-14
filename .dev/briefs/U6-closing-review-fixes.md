# U6 — what the closing review found

Three reviewers went over the session's work with the exit predicate already
passing: one enumerated every sentence the product can render, one attacked the
machinery, one checked whether the repo still describes itself. Everything
below is quoted from a run, not read off the code.

Fix the ones in your section. The comment findings matter as much as the code
ones here: a comment that argues for something the code no longer does is a
confident wrong explanation, and this build has enough rounds behind it that
several are now contradicting each other inside one file.

---

## A. The selection policy, and everything that pins what it renders

### A1. The NPL headline reads 0 on a card naming two final-NPL sites

`semsNplSection`'s filter is `{ field: "semsNplStatus", equals: FINAL_NPL_STATUS }`,
and `semsNplStatus` is Envirofacts' `npl_status_name` — null whenever that
site's join does not land. Envirofacts is a second host, asked once per site,
fifteen times at `STATUS_CONCURRENCY = 4`. Failing it for exactly the two NPL
sites of the demo address, everything else from the committed fixtures:

```
[section/sems-npl-count@1] Sites on the final National Priorities List within 5 miles of the mapped point: 0.
...
[sems-site/status-unavailable@1] U.S. OIL RECOVERY, 3.92 km from the mapped point. EPA's facility registry records the SUPERFUND NPL interest at U.S. OIL RECOVERY as CURRENTLY ON THE FINAL NPL. The Superfund inventory's status for TXN000607093 could not be retrieved.
[sems-site/status-unavailable@1] GENEVA INDUSTRIES/FUHRMANN ENERGY, 6.84 km ... as CURRENTLY ON THE FINAL NPL. ...
```

The status line still reads `answered with records`. Nothing says the count is
incomplete. This is `docs/BRIEF.md` A6 row 1's headline number — "two final-NPL
sites at 3.92 km and 6.84 km" — silently becoming zero, with the registry's
contradicting answer printed twice on the same card.

A count filtered on a field that a partial outage nulls must not be stated as a
count of the world. Decide how, and make the card say what it does not know.
`sections.ts` is not yours; if the fix needs a new template, say exactly what it
should say.

### A2. FRS claims a five-mile search it never made

`lookupFrsFacility` asks `where=REGISTRY_ID='...'` for at most five registry
IDs the SEMS card named. There is no radius in the request. But `BOUNDARY.frs`
is `"5 miles"` and `frs` is in `RADIUS_BOUNDARY`, so with FRS returning nothing:

```
[source/retrieved@1]      EPA Facility Registry Service answered with no matching records, retrieved ...
[section/retrieved-at@1]  Searched within 5 miles of the mapped point, retrieved ...
[section/no-records@1]    No matching records within the stated boundary.
```

`docs/BRIEF.md` B14 records **6,915 FRS interest rows within 5 miles of this
exact point**. The card asserts an absence over an area it never queried, which
is the one thing the README promises it does not do. The successful path is
wrong the same way, more quietly.

`tests/unit/report/selection.test.ts` asserts that string as correct, so the
suite pins it rather than catching it.

A boundary is display text for a request and has to describe the request that
was made. The FRS section also needs a note of its own rather than
`NO_DATA_NOTE`.

### A3. "X and X share one EPA facility registry ID"

A SEMS record's `subject` coalesces the Envirofacts name over the FRS name, so
when Envirofacts returns no row both members of a registry group fall back to
the same `PRIMARY_NAME`. From committed bytes:

```
PASADENA REFINING SYSTEM, INC. and PASADENA REFINING SYSTEM, INC. share one EPA facility registry ID, 110000462703.
HOUSTON REFINERY and HOUSTON REFINERY share one EPA facility registry ID, 110000460885.
```

And on the ordinary demo path the same template pairs a site with its own
registry entry:

```
[group/shared-identifier@1]     VALERO PLUME and HOUSTON REFINERY share one EPA facility registry ID, 110000460885.
[frs-facility/cross-reference@1] EPA's facility registry carries the name HOUSTON REFINERY for registry ID 110000460885.
```

A3 and B6 establish those two as **one site under two names**, not two records
sharing an ID — and the second sentence, already on the card, is the correct
statement of it. `tests/unit/app/report-flow.test.ts` asserts the first as
correct.

Keep the template for the genuine case, which renders correctly:
`PASADENA REFINING FIRE and PRSI FIRE share one EPA facility registry ID,
110000462703.`

### Your files

`lib/report/selection.ts` and every test that pins a string it produces:
`tests/unit/report/selection.test.ts`, `tests/unit/app/report-route.test.ts`,
`tests/unit/app/report-screen.test.ts`, `tests/unit/app/report-flow.test.ts`,
`tests/unit/app/trace-view.test.ts`, `tests/unit/app/trace-panel.test.ts`,
`tests/unit/app/helpers/report-stream-fixtures.ts`, and `tests/e2e/**`.

`pnpm e2e` is part of your acceptance: run it.

---

## B. The adapters

### B1. A prototype key builds a record whose value is a function

`AIRNOW_PARAMETERS[row.ParameterName]` is an index into an object literal,
guarded only by `!== undefined`:

```
AIRNOW_PARAMETERS["NO2"]          -> undefined        (dropped? true)
AIRNOW_PARAMETERS["constructor"]  -> [Function Object] (dropped? false)
AIRNOW_PARAMETERS["__proto__"]    -> {}               (dropped? false)
```

A row whose `ParameterName` is `"constructor"` builds a **sealed record** with
`pollutant.value` a function. Through the real route the wire schema then
refuses it and the card is lost entirely:

```
events: card:aqs card:echo card:fema card:sems card:frs groups end:failed
console.error: ["report: a source card could not be built"]
```

No `card:airnow` event at all. The reader gets "Sources settled: 5 of 6" and a
Retry, with nothing saying which source is missing. One string in one row costs
the whole card and fails the report.

`lib/adapters/aqs.ts` has the same lookup and is saved by a second `Map` guard
beside it. AirNow has none.

### B2. Three comments argue for a `FailureCause` the code stopped using

`lib/adapters/aqs.ts` and `lib/adapters/airnow.ts` both argue at length that
the enum "is a closed enum of six", that `unknown` is the honest choice, and
that "the enum wants a seventh member and adding one is not this unit's to do".
It was added in `295e639`; both adapters now throw `not-configured`, and the
card says "this deployment holds no credential for it". A reader who trusts the
argument would undo the commit. The two `NO_KEY` docstrings have the same
problem one level down.

### B3. The SEMS adapter still says the two statuses are two vocabularies

`lib/adapters/sems.ts`: *"The statuses differ, in vocabulary as well as value.
FRS `ACTIVE_STATUS` and Envirofacts `npl_status_name` land in separate fields
and one is never a stand-in for the other."*

`lib/evidence/records.ts` corrects this by name and by date: on all fifteen
recorded sites `ACTIVE_STATUS` is `npl_status_name` upper-cased, differing on
none. `sems-site/disagreement@1` was deleted because of it. The adapter that
builds both fields is the one file still telling the reader otherwise.

### B4. "common" where two other files say "rare"

`lib/adapters/sems.ts`: *"A site with no Envirofacts row at all is a real and
common case."* `docs/BRIEF.md` B14 and `tests/fixtures/README.md` both record
15 of 15 sites having a row and both say, in those words, that a missing row is
rare. Both were written as corrections of this line.

### Your files

`lib/adapters/airnow.ts`, `lib/adapters/aqs.ts`, `lib/adapters/sems.ts`, and
`tests/unit/adapters/{airnow,aqs,sems}.test.ts`.

---

## C. The cache, the handler, and the confirm screen

### C1. The cache hands out its own stored objects

`return { raw: parsed.data, payload: entry.payload }` — and `remember` stores
`fetched.raw` by reference, the same object the miss returned to its caller.

```
miss  : inner calls = 1
hit   : QueryID the next caller reads = "MUTATED-BY-CALLER"
payload identity across two hits: true
payload identity miss vs hit   : true
retrievedAt the next caller reads: 1999-01-01T00:00:00Z
```

A caller mutating what the miss handed it writes into the map for every later
request in the process, and every caller across every concurrent report is
handed the *same* `PayloadRef` instance — so a mutation of `payload.retrievedAt`
rewrites the retrieval time for everyone. No adapter mutates either today, so
this is a live hazard rather than a live defect. It is still a decorator whose
whole contract is "returned byte for byte as the fetch produced it", handing
out mutable references to the bytes.

### C2. A client that goes away cancels nothing

`cancel() { open = false; }` is the whole disconnect path; no `AbortController`
exists in the handler, and `withTimeout` rejects without cancelling what it
raced.

```
requests issued when the client cancelled: 3
requests issued 2s later                 : 25
```

Twenty-two of twenty-five upstream EPA requests are issued after the reader is
gone — with ECHO's 45 s budget, about 25 s of work per abandoned tab. Decide
whether to fix it or to write down why not; either is defensible, silence is
not. It is government infrastructure on the other end.

### C3. Three comments are stale

- `app/api/report/handler.ts` lists, under privacy properties **held here**:
  *"No cache, and so no cache key tied to a user, session, IP or browser. U3.2
  adds a cache; this unit adds none."* U3.2 landed and `app/api/report/route.ts`
  wraps the io in it. The property survives — point at
  `lib/io/cache-source-io.ts` for why — but a reader of the handler would
  conclude the report path is uncached.
- `app/components/confirm-screen.tsx` calls the trace panel "a later unit". It
  shipped. What is true is narrower and more useful: the panel exists, and
  *these* spans still do not open it, because the report wire has no origin arm.
- `lib/io/cache-source-io.ts` says the bare AirNow host "302s to www."; the
  adapter and the fixtures README both record a **301**, from a real check.

### Your files

`lib/io/cache-source-io.ts`, `tests/unit/app/cache-source-io.test.ts`, and
comment-only edits in `app/api/report/handler.ts` and
`app/components/confirm-screen.tsx`. Do not change behaviour in those last two
without saying so; another agent owns the tests that pin them.

---

## D. The template and kernel comments

Comment-only. Change no behaviour; if you find one that needs changing, report
it.

1. **`lib/templates/sems.ts`'s module comment says `summary@1` is unfixed** —
   *"`summary@1` is the one still open… the fix is the same split this pass
   made; this pass was scoped to `npl@1`, so the string is recorded here and
   asserted below rather than changed."* It was split, thirty lines below, with
   an inline comment saying so. A module comment contradicting an inline
   comment in the same file is the worst version of this: the next reader has
   to pick one. The same comment's "all three have it" is now two, and its
   quoted rendered string is not what that row renders.
2. **`lib/evidence/templates.ts` counts five `sems-site` templates.** There are
   four; `disagreement@1` was deleted. This is the `Requirement` doc, the one
   place a reader goes to learn why the gate exists, so an inflated count reads
   as a missing template somewhere.
3. **`lib/templates/echo.ts` says `industry-codes@1` "stands beside one of the
   others".** The card stopped placing it; `lib/report/selection.ts` says so
   and the code proves it. The file's own table still lists it as placed.
4. **Three kernel comments say the grouping is "wired in a later unit"** —
   `lib/evidence/templates.ts`, `lib/evidence/sentence.ts`,
   `lib/templates/groups.ts`. It is wired, in `app/api/report/handler.ts`. The
   "nothing here decides it" halves stay true; the "later unit" halves should
   name where it landed.
5. **`lib/templates/sections.ts` lists `SectionSpec`'s fields** as "the kind,
   the boundary, the query, and the filter" — it also carries `retrievedAt`,
   `note` and `carried`, and this very file defines the three templates that
   read them.

### Your files

`lib/templates/*.ts`, `lib/evidence/templates.ts`, `lib/evidence/sentence.ts`.

---

## E. The documents

No code. Correct each against what the code does, and where a line was itself a
dated correction that has gone wrong, say so rather than quietly rewriting it —
this repo's habit is to leave the wrong conclusion visible beside the right one
and that habit is worth keeping.

1. **`.dev/PLAN.md`** says "Neither adapter is written yet" for AQS and AirNow,
   while its own Units table two screens up marks both done and both are
   registered in the route.
2. **`.dev/PLAN.md`'s "Known blockers"** still says ECHO refuses connections,
   still says its schema is derived from a published column list, and still
   refers to a `shapeUnverified` marker that exists nowhere in the repo but in
   that sentence. `docs/BRIEF.md` corrected the ECHO half a day later.
3. **`.dev/PLAN.md` queue items 8, 17, 18 and 21 are closed by the code** —
   check each and move them. Item 11's reasoning has also aged: both air kinds
   now have templates and `TemplateRegistry` is still uninstantiated.
4. **`docs/BRIEF.md` A2's correction note** says the block-not-parcel notice
   "moved to the origin sentence… a FEMA template asserting it had no field
   behind it". Both FEMA templates now lead with it, and `lib/templates/fema.ts`
   explains the reversal. A dated correction that is itself wrong is worse than
   no correction.
5. **`docs/BRIEF.md`'s reachability table and the paragraph under it** still
   list `echodata.epa.gov` as refused and say local development runs ECHO from
   recorded fixtures "with the replay label from B11". The same document says
   ECHO is reachable. And there is no replay path: nothing in the repo matches
   `Recorded demonstration` or `replay`, and the route is live fetch only.
6. **`docs/BRIEF.md` A2's example sentences** are the copy the templates were
   deliberately written away from: screen 2 shows "left side of the street
   segment" where the renderer prints Census's own `L` and omits the TIGER
   line; screen 3's SEMS example predates the label-then-value register, the
   `EPA ID` slot, and prints `Not on the National Priorities List` where the
   record holds `Not on the NPL` — an expansion of a status string that B2's
   last line forbids.
7. **`docs/BRIEF.md` B14** records the New Orleans CBD Esri answer as "X, 0.2%
   annual chance"; the committed fixture for that curated address carries
   `ZONE_SUBTY: 'Area With Reduced Flood Risk Due To Levee'`, which is what A6
   states for the same address. The log and the bytes disagree about the one
   flood subtype the demo shows verbatim.
8. **`tests/fixtures/README.md`'s "Not recorded" section** says ECHO refuses
   connections; six lines later the same file has "## ECHO, recorded
   2026-09-16" and the directory holds seven payloads. Only the NFHL half is
   still true.

### Your files

`docs/BRIEF.md`, `tests/fixtures/README.md`, `.dev/PLAN.md`.

---

## Acceptance, everyone

1. `pnpm verify` green and `bash .dev/census/mutation-check.sh` 8 of 8 — except
   section A, which also runs `pnpm e2e`. Paste real output.
2. Each code fix has a test that fails without it; say what you ran to watch it
   fail.
3. Zero type assertions, non-null assertions or `any`.
4. No new dependencies. No network. No git.
