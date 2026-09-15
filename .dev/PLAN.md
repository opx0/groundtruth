# Build board

Exit predicate for this run, checked by command, not by opinion:

```
pnpm verify   # typecheck clean, unit tests green, lint clean
pnpm e2e      # the eight Playwright paths in docs/BRIEF.md B12 green
```

plus: every source in `docs/BRIEF.md` B2 has an adapter with the seven fixture
cases (success, no records, missing optional fields, unknown status, malformed,
rate limit, timeout), and the curated addresses in B14 render with working
trace panels.

A unit is done when its own check passes and it is committed. Not before.

**The exit predicate passes, 2026-09-16.**

```
pnpm verify   exit 0   733 tests across 35 files, typecheck and lint clean
pnpm e2e      exit 0   9 passed
bash .dev/census/mutation-check.sh   8 of 8
```

**Updated 2026-09-17.** `pnpm verify` now runs 739 tests across the same 35
files — six more than the 733 recorded the day before — typecheck and lint
still clean. `pnpm e2e` is still 9 passed and the mutation check is still 8 of
8.

Every source in `docs/BRIEF.md` B2 has an adapter and all seven B12 fixture
cases, or a written reason a case does not exist for it — the Census geocoder
has no status vocabulary, and AirNow's modelled success shape has no status
field, so neither has an unknown-status case and both say so in the test file
rather than inventing one.

The eight B12 Playwright paths run in a real browser against a real production
build, with the two API routes answered by the real handlers over committed
fixture bytes.

**Corrected 2026-09-16, same day.** This paragraph first claimed the curated
B14 addresses "render with working trace panels: paths 1, 4, 5 and 6 ... each
opening a panel to a raw field". A review checked it and it was wrong on two
counts, so what is actually driven:

- Four specs open a trace panel: `trace.spec.ts` (paths 4 and 5, the Superfund
  and ECHO records), `air.spec.ts` (path 7) and `failed-source.spec.ts`
  (path 8). `match.spec.ts` (path 1) asserts `data-field` on the confirm
  screen's origin spans and opens nothing — it cannot, because those spans
  deliberately do not open the panel: the report wire has no `origin` arm.
  `flood.spec.ts` (path 6) asserts both dataset namings and clicks nothing.
- Three of the five curated A6 addresses are driven: 9311 E Ave P, 9400 Clinton
  Dr and 100 Main St. **1300 Perdido St is not**, so the zone X levee subtype —
  the one verbatim agency string A6 puts on screen for that address — is
  asserted only in unit tests. The flood spec uses the Pasadena polygon and the
  Houston empty answer. Worth a ninth path.

The exit predicate itself does not ask for more than the eight paths, and it
passes. This note is here because the sentence above it was the one a reader
would take as the proof.

What is still blocked on the operator is listed below. It is one item now, not
three: FEMA's authoritative NFHL host. The two air keys were registered on
2026-09-16 and both sources are recorded. Nothing in the exit predicate depended
on either, because `not-configured` is a card the report states honestly and
`docs/BRIEF.md` A6 beat 6 is exactly that state.

**Corrected 2026-09-17.** FEMA's authoritative NFHL host answered for the
first time in this project's history, from us-central1 (Iowa) egress, in
0.26s — see Known blockers below for the full measurement and the three
fixtures it produced. The block was on egress, not on the request. Nothing is
left blocked on the operator: the air keys were cleared 2026-09-16 and FEMA's
host is cleared today.

## Model routing

Work is assigned by how much judgment it needs, not by size.

| Tier | Model | Gets |
|---|---|---|
| Judgment | fable | Kernel design, renderer and trace, selection policy, privacy invariants |
| Hard code | opus | Dual-dataset FEMA, streaming route, grouping, ECHO |
| Specified code | sonnet | Adapters with a settled shape, UI components, test suites |
| Mechanical | haiku | Fixture capture, config, small mechanical edits |

## Units

| ID | Unit | Depends on | Tier | State |
|---|---|---|---|---|
| U0.1 | Repo, toolchain, strict TS, vitest | none | mechanical | done |
| U0.2 | Evidence kernel, provenance, rendering contract | U0.1 | judgment | done |
| U0.3 | Adapter contract, fetch wrapper, failure taxonomy | U0.2 | judgment | done |
| U1.1 | SEMS adapter, ArcGIS plus Envirofacts join | U0.3 | hard | done |
| U1.2 | Census geocoder adapter | U0.3 | specified | done |
| U1.3 | FEMA adapter, NFHL with Esri fallback | U0.3 | hard | done (Esri only; NFHL unreachable) |
| U1.4 | FRS adapter, identity and coordinate quality | U0.3 | specified | done |
| U1.5 | ECHO adapter, fixture-driven | U0.3 | hard | done |
| U1.6 | AQS adapter | U0.3 | specified | done; recorded against a real key 2026-09-16, still answers `not-configured` where none is configured |
| U1.7 | AirNow adapter | U0.3 | specified | done; recorded against a real key 2026-09-16, still answers `not-configured` where none is configured |
| U2.0 | Record templates for the five unserved kinds | U0.2 | judgment | done |
| U2.1 | Selection and ordering policy | U0.2 U2.0 | judgment | done |
| U2.2 | Facility grouping by registry and program ID | U1.1 U1.4 | hard | done |
| U2.3 | Template renderer, kind-gated | U0.2 | judgment | done |
| U3.1 | Route handlers, streamed per source | U1.x U2.1 | hard | done |
| U3.2 | Coordinate cache with TTL, no identity | U3.1 | specified | done |
| U3.3 | Privacy invariants and log redaction | U3.1 | judgment | done; the report route accepts two numbers and nothing else |
| U4.1 | Search, examples, match confirmation | U3.1 | specified | done |
| U4.2 | Report cards, independent source states | U3.1 | specified | done |
| U4.3 | Trace panel | U2.3 | judgment | done |
| U5.1 | Adapter fixture matrix, seven cases per source | U1.x | specified | done, all seven sources |
| U5.2 | Renderer mutation tests | U2.3 | judgment | done via .dev/census/mutation-check.sh |
| U5.3 | Selection tests | U2.1 | specified | done with U2.1 |
| U5.4 | Privacy tests | U3.3 | specified | done, all five B12 lines |
| U5.5 | Playwright, the eight paths | U4.x | specified | done, `pnpm e2e` 9 passed — B12's eight plus one over the claims a review found |

## Known blockers

- **One host refuses connections, not two. Corrected 2026-09-16.** This bullet
  read: "ECHO and FEMA NFHL refuse connections from this machine. Both return a
  connection reset before any response body. Relaying the request through a
  public proxy was tried and is disallowed by the sandbox, correctly, so the
  bytes have to come from a machine that can reach them. Until then U1.5 and
  the authoritative half of U1.3 build against a schema derived from EPA's
  published column list, and every record they produce is marked
  `shapeUnverified` so the gap is visible in the report rather than hidden."
  Three claims in it are false, and all three were checked before this was
  written:

  - **ECHO is reachable.** It resets the stream on the first attempts and
    answers once the request carries retries and a longer timeout. Seven
    payloads under `tests/fixtures/echo/` were recorded from this machine on
    2026-09-16. `docs/BRIEF.md` B1 and B14 record the same correction, and
    `tests/fixtures/README.md` has the ECHO quirks it bought.
  - **U1.5's schema is not derived from a published column list.** It is built
    against those recorded bytes. The `qcolumns` list in `lib/adapters/echo.ts`
    is the one `scripts/capture-us-fixtures.sh` records with, which is why the
    two cannot drift.
  - **`shapeUnverified` never existed.** No record, type or field in this repo
    carries that marker and none ever did; this sentence was the only place the
    word appeared. What the NFHL half actually does is a record caveat, in
    `lib/adapters/fema.ts` under `FEMA_DATASETS.NFHL.caveats`: "No response from
    this layer has been recorded yet. The parse follows FEMA's published field
    names and is unverified against real bytes." That reaches the trace panel
    rather than a marker the reader would have to know to look for.

  **What is still true.** `hazards.fema.gov` resets the TLS handshake before any
  HTTP exchange, from every route tried, and retries do not help. Relaying
  through a public proxy was tried and is disallowed by the sandbox, correctly.
  So the authoritative half of U1.3 still parses FEMA's published field names
  against no recorded response, and clearing it needs one of: a US-region
  deploy, one curl from a US host, or a git remote so a CI runner can record
  the fixtures. `scripts/capture-us-fixtures.sh` captures it.

  **Corrected 2026-09-17.** The paragraph above says "`hazards.fema.gov`
  resets the TLS handshake before any HTTP exchange, from every route tried."
  That is no longer true, and it was possible to prove it wrong for the first
  time: measured from three egress points on the same NFHL endpoint, this
  machine (India) got a connection reset in 0.59s, asia-southeast1 got a
  connection reset in 0.46s, and us-central1 (Iowa) got HTTP 200 in 0.26s. The
  block was always on egress, not on the request — inferred for days and never
  proven until this measurement. Three NFHL fixtures are committed from that
  capture: `tests/fixtures/fema/nfhl-minimal-hazard.json`,
  `nfhl-zone-ae-pasadena.json` and `nfhl-layer-28.json`, taken by
  `scripts/capture-us-fixtures.sh`, which is what it was written for. A live
  NFHL test existed all along at `tests/unit/adapters/fema.test.ts`, gated
  behind `FEMA_LIVE=1`, and had never run before now; it passes from
  us-central1 in 224ms, and the live ECHO and SEMS suites pass from there too.
  Clearing the blocker turned out to be exactly the "US-region deploy" or "one
  curl from a US host" the paragraph above named as the way out.
- ~~AQS and AirNow need free keys the operator must register.~~ **Cleared
  2026-09-16.** The operator registered a key for each, both are in the
  gitignored `.env.local` at the repo root, and both sources now have recorded
  successes: `tests/fixtures/aqs/annual-summary-houston.json` (212 rows, thirty
  monitors) and `tests/fixtures/airnow/current-observations-houston.json` (three
  rows), each with its empty answer beside it. Six of the nine `derived-`
  fixtures were deleted; three survive because they hold states no recording
  does.

  **The recordings overturned four published-documentation guesses**, which is
  the part worth carrying forward. AQS's envelope is `Data`, not `Body`; its
  parameter column is `parameter`, not `parameter_name`; its unit column is
  `units_of_measure`, not `unit_of_measure`. All three came from the worked
  example on EPA's API page, which is a `sampleData` row — a different service
  of the same API — and this repository had argued explicitly for believing the
  page over EPA's own OpenAPI file. The fourth is AirNow's `Category`, which
  `lib/adapters/airnow.ts` refused to guess at because nothing said whether it
  was a string or an object: it is an object. Every caveat and every rendered
  clause that said an air shape was unverified has been removed, because it no
  longer is.

  **AQS echoes the request back in `Header[0].url`**, credentials and all. The
  committed recordings carry `REDACTED-EMAIL` and `REDACTED-KEY`, which is the
  only edit to either file, and `lib/adapters/aqs.ts` does the same substitution
  at runtime on every string EPA sends.

  What is still recorded is what each source answers *without* a key, and both
  are still worth having: AQS answers HTTP 429 with `Retry-After: 86400` from
  EPA's own exhausted shared test account, and AirNow answers HTTP 401 with
  `{"WebServiceError":[{"Message":"Request not authenticated."}]}`. The
  `not-configured` state is unchanged and still what a deployment holding no
  credential shows, which is `docs/BRIEF.md` A6 beat 6.

## Queued after the adapter fan-out

These touch `lib/evidence/**`, which five adapter agents are reading right now.
Editing it mid-run would make their typechecks fail for reasons that have
nothing to do with their work, so they wait.

1. [DONE c2b836a] **A status join that failed is not a status that is absent.** The SEMS
   adapter currently fails the whole source when one Envirofacts request errors,
   because the registry-only sentence says "the Superfund inventory returned no
   status row", and after a fetch error that sentence is a lie. The reasoning is
   right and the cost is wrong: one blipped request out of fifteen should not
   remove fourteen good sites. Add a third state so a record can say its status
   could not be retrieved, which is honest and keeps the other fourteen. This is
   the same no-data versus unavailable distinction the report already makes for
   whole sources, applied one level down.

2. [DONE c2b836a] **`SourceIo.get` cannot express a top-level JSON array.** Its `Raw` is
   constrained to `JsonObject`, and Envirofacts returns a bare array. The SEMS
   adapter worked around it inside its own file without an assertion. Widen the
   constraint to `JsonValue` and drop the workaround.

3. [DONE c2b836a] **Fifteen sites means fifteen parallel Envirofacts requests per report**,
   unthrottled. Fine against fixtures, rude against a government endpoint. Cap
   the concurrency.

4. **Deduplicate the ArcGIS query building.** Three adapters were told to keep
   their own copy so they would not serialize on one file. Now that they exist,
   fold the shared query shape into one place if it earns it, and leave it
   duplicated if it does not.

### Raised by the ECHO adapter, in priority order

5. [DONE c2b836a] **The trace currently shows a penalty value ECHO did not send.** ECHO sends
   `"$0"`. The kernel's number reader throws on a currency symbol, so the
   adapter strips it before reading, and the trace then names the field and the
   transform but reports the raw value as `"0"`. That is a false statement about
   what a government source sent, inside the one panel whose entire job is
   reporting exactly that. A record caveat discloses it, which is honest, but
   disclosure is not a fix. Add a `parse-currency` transform so the symbol is
   removed by a named transform with the original kept in provenance. **Do this
   one first.**

6. [DONE c2b836a] **No reader produces a structured value, and three adapters have now hit
   it.** ECHO needs a list of programme statuses, the registry needs a list of
   programme interests, and the geocoder needs an address range of two strings.
   Each worked around it differently and none could do it cleanly. The geocoder
   had to export its own match type because the kernel's declared one is
   literally unconstructable without hand-writing provenance, which is the one
   thing adapters are forbidden to do. Three independent hits makes this the
   most systemic gap open. Add a reader that builds a structured value and
   reconcile the geocoder's type back into the kernel.

   Original note, still accurate:
   **Array-valued fields have no per-element trace.** `programStatuses` and
   `programInterests` are typed as lists of objects, and no reader produces one,
   so the ECHO adapter fell back to a query-level provenance naming `qcolumns`.
   Each programme's compliance status is therefore displayed with no trace to
   the field it came from. Arm B predicted this exact gap in the design race and
   the FRS adapter has the same shape. A `fields.list(...)` reader is the fix.

7. [DONE c2b836a] **Dates are inconsistent across sources.** ECHO records hold `08/12/2024`
   while SEMS records hold `2022-02-08`. The ECHO adapter passed the value
   through verbatim rather than rewriting it, which was the right call, since
   rewriting would have made the trace claim ECHO sent an ISO date. A
   `parse-us-date` transform closes it properly.

### Raised by the FEMA adapter

8. [DONE 2026-09-16] **A no-data note cannot say which source answered.** `runSource` hard-codes
   the note, so the fan-out's flood slot cannot carry whether the authoritative
   layer or the fallback returned nothing, which is the one distinction that
   card exists to make. Until an adapter can supply its own no-data note, the
   report must call the flood adapter's own entry point rather than read the
   slot. Let an adapter supply the note.

   Closed. An adapter carries an optional `noDataNote` (`lib/evidence/source.ts`)
   and the no-data outcome is built as `adapter.noDataNote ?? NO_DATA_NOTE`, so
   the note is the answering adapter's whenever it has one to give.
   `lib/adapters/fema.ts` supplies each dataset's own B10 wording through
   `spec.noPolygonNote`, and `lib/adapters/aqs.ts` supplies one naming the
   summary year it reported on. `app/api/report/handler.ts`'s own fan-out note
   is still the hard-coded `NO_DATA_NOTE`, which is correct: it is the fallback
   for an adapter that states nothing. The flood card still takes a
   `FloodZoneResult` rather than a fan-out slot, but for a different reason than
   this item gave — the slot also cannot carry *which of the two layers failed*,
   which is the source placement `floodCard` adds. That is now a choice rather
   than a workaround.

9. **One timeout covers the whole flood source.** The fallback only runs after
   the authoritative layer fails, so a hang rather than a fast reset would eat
   the budget and the reader would get nothing instead of the fallback. Give the
   first leg a shorter deadline than the source as a whole.

   **Still open, but the reason it was parked is spent. Noted 2026-09-17.** It
   was parked because the authoritative host was unreachable, so a shorter
   deadline for a leg that never answered had nothing to measure against. It
   is reachable now — measured HTTP 200 from us-central1 in 0.26s on the same
   endpoint that resets from this machine and from asia-southeast1 — so the
   reason for parking it is spent. The timeout still covers the whole flood
   source and the first leg still has no deadline of its own; that part of
   the item is unchanged.

10. [DONE 2026-09-17] **`FLD_AR_ID` is required by the schema.** It is the layer's primary key and
    the adapter needs it for a record id, but no authoritative row has ever been
    seen, so a null there would read as malformed. Worth re-checking against the
    first real capture.

    Closed. The first real capture answered it: two authoritative rows,
    `48201C_8882` and `48201C_9306`, both carry a non-null `FLD_AR_ID`. The
    schema's requirement holds against real bytes, not just the published
    field list.

## Queue status after U1.8

Closed: 1, 2, 3, 5, 6, 7. The trace no longer misreports a value, structured
values have provenance, a failed join no longer costs fourteen good records,
top-level arrays parse, and both date shapes are named transforms.

Still open, none of them blocking:

- **4**, deduplicating the ArcGIS query building across three adapters. Left
  alone deliberately. The duplication is small and the abstraction has not
  earned itself yet.
- **9**, a shorter deadline for the authoritative flood layer so a hang cannot
  eat the budget before the fallback runs. Only matters once that host is
  reachable.
- **10**, re-checking that the flood layer's primary key is never null. Blocked
  on capturing one real response from that host.

Items 9 and 10 sit behind the same blocker: nobody has ever seen a response
from FEMA's authoritative flood layer.

**Corrected 2026-09-16.** This list carried **8** as open, and closed with
"Items 8, 9 and 10 all sit behind the same blocker: nobody has ever seen a
response from FEMA's authoritative flood layer." That was wrong about 8 when it
was written. 8 was a gap in the adapter contract — an adapter could not supply
its own no-data note — and no response from FEMA would have closed it. It is
closed above instead, by `lib/evidence/source.ts` reading `adapter.noDataNote`.
Only 9 and 10 ever needed the host.

**Corrected again 2026-09-17.** The line above, "Only 9 and 10 ever needed the
host," is now half-stale: the host answered. Measured from three egress
points on the same NFHL endpoint, this machine (India) and asia-southeast1
both got a connection reset, and us-central1 (Iowa) got HTTP 200 in 0.26s —
the block was on egress, not on the request. **10 is closed**: two real
authoritative rows, `48201C_8882` and `48201C_9306`, both carry a non-null
`FLD_AR_ID`, closed under its own entry above with the 2026-09-17 date. **9 is
unblocked but still open**: the reason it was parked — an unreachable host —
is spent, but nobody has yet given the first leg its own shorter deadline
than the source as a whole; see the note under item 9 itself.


## Queue raised by the record templates, U2.0

Three adversarial reviews and two rechecks ran over the template files. What
they found is either fixed in `7e0360d` or listed here. Nothing below blocks
the selection policy.

11. **`TemplateRegistry` has still never been instantiated.** The type in
    `lib/evidence/templates.ts` requires a non-empty template list per `Kind`,
    and nothing constructs one, so no compile-time check ties `echoTemplates`,
    `femaTemplates`, `frsTemplates` or `semsTemplates` into anything. It cannot
    be built until `aqs-monitor-summary` and `airnow-observation` have
    templates, which is U1.6 and U1.7. Build it in the same unit; a missing
    kind then becomes a compile error.

    **Still open, but the reason above is spent. Noted 2026-09-16.** U1.6 and
    U1.7 landed: `lib/templates/aqs.ts` and `lib/templates/airnow.ts` both
    exist, so both kinds have templates and the registry is constructible today.
    It was not built in the same unit. `TemplateRegistry` is still a type and
    nothing else — `lib/evidence/templates.ts` declares it,
    `lib/evidence/index.ts` re-exports it, and no file in `lib/`, `app/` or
    `tests/` constructs one. `app/api/report/handler.ts` hands templates to the
    cards per source instead, so a kind with no template is still a runtime
    absence rather than a compile error. What changed is that nothing is
    blocking it any more.

12. **`fema-flood-zone/unmapped-flag@1` renders null for every committed
    record.** By construction: both Esri fixtures carry `SFHA_TF` of `"T"` or
    `"F"`. Its three states (an unmapped letter, `""`, and null) are exercised
    from derived rows, each altering exactly one field. A real row with an
    unmapped flag would close it. Worth asking for in
    `scripts/capture-us-fixtures.sh`.

    **Still blocked. Checked 2026-09-17.** `scripts/capture-us-fixtures.sh` did
    exactly that: three NFHL fixtures are now committed —
    `tests/fixtures/fema/nfhl-minimal-hazard.json`, `nfhl-zone-ae-pasadena.json`
    and `nfhl-layer-28.json`. Every `SFHA_TF` in them still reads `"T"` or
    `"F"`. No unmapped letter came back, so this is still open on the same
    derived rows it started with.

13. **`sems-site` never prints `archived`.** `tests/fixtures/sems/envirofacts-archived.json`
    carries `archived_ind: "Y"` with `archived_date: 1996-01-25` beside a
    `non_npl_status_date` of 1984-09-01, so `summary@1` would show a 1984
    status with no sign that EPA archived the site twelve years later. It is a
    boolean and cannot be printed, which is exactly what `sfhaLabel` solved for
    `SFHA_TF`: the same `map` treatment applies.

14. **ECHO's penalty amount loses its grouping.** `FacLastPenaltyAmt` arrives
    as `"$0"` and is read to the number 0, so a real amount would render
    `$20254146`. A currency `DisplayFormat` beside `distance-km` and `date`
    would fix it. Not urgent: every recorded row is zero.

15. **The record field behind FEMA's study-identifier clause is still named
    `firmPanelId`.** The clause correctly refuses to call `DFIRM_ID` a panel;
    the trace panel beside it still shows the old name. Renaming it touches
    `lib/evidence/records.ts` and `lib/adapters/fema.ts`.

16. **`Requirement` has no slot-to-slot arm.** `sems-site/disagreement@1` was
    deleted because the only thing that could select it is a comparison of two
    slots, which neither the type nor `satisfies` can express, and because no
    recorded record is in the state it described. A `differsFrom` arm would let
    it come back the day one is.

17. [DONE 2026-09-16] **`sems-site/npl@1` is one clause, so a null coordinate takes the whole
    sentence.** A final-NPL site with no FRS coordinate would get no B7 NPL
    sentence at all, while `summary@1` still prints its NPL status. That is a
    silence rather than a false claim, and no recorded site reaches it — all
    fifteen have coordinates. Splitting the distance into its own clause fixes
    it; `tests/unit/templates/sems.test.ts` pins the current behaviour so the
    change is one assertion wide.

    Closed. `lib/templates/sems.ts` splits the distance into its own clause and
    the template now renders `US OIL RECOVERY is listed by SEMS as Currently on
    the Final NPL. 3.92 km from the mapped point.`, so the naming clause cannot
    drop and the distance drops alone. The "silence rather than a false claim"
    reasoning above is spent, and that file records why: `section/npl-count@1`
    counts a coordinate-less final-NPL site whatever its coordinate does, so the
    count stood beside the silence, which is the drift a separate NPL section
    exists to prevent.

## Queue raised by the selection policy, U2.1

Closed in `be212c7` and the round after it. What is left:

18. [DONE 2026-09-16] **One ECHO facility's name prints up to four times on its card**, in four
    consecutive sentences, because every secondary template names its subject
    inside its own clauses. That design is what lets a secondary be true
    wherever it is placed, and it is the fix for the duplicated lead clause in
    `7f2ac98` — but four is more than it should cost. The cheapest lever is
    whether the ECHO card places `echo-facility/industry-codes@1` at all: B2
    asks for no industry codes, and NAICS and SIC still reach the trace.

    Closed by exactly that lever. `echoTemplatesFor` in `lib/report/selection.ts`
    does not place `industry-codes@1`, and says why beside the code. The
    template is still defined and still renders when asked; `naicsCodes` and
    `sicCodes` are still slots on the record, so the trace behind every other
    ECHO sentence carries both with their provenance. Nothing is hidden, one
    sentence is gone, and three names remain rather than four.

19. **A final-NPL site prints its distance and its NPL status twice**, once from
    `sems-site/summary@1` in the main listing and once from `sems-site/npl@1`
    in the NPL listing. B7 asks for both sentences, ~~and A2's own example has
    no overlap only because its two NPL sites fall outside the nearest five~~.
    The answer is probably a layout one: A2 puts the NPL sentence in its own
    block under the list, which is U4.2's decision, not the policy's.

    **Corrected 2026-09-17.** The struck sentence is a factual error, checked
    against the real renderer. The SEMS listing is ordered by distance, and
    the final-NPL site `TXN000607093` (US OIL RECOVERY) ranks fifth at 3.92 km
    — inside the shown five — so it appears in both the shown five and the NPL
    listing. Its distance and its NPL status each print twice on the Houston
    demo card. The defect IS visible on the demo address, which the struck
    sentence denied. The other NPL site, `TXD980748453`, ranks twelfth at
    6.84 km and is genuinely outside the shown five — that half of the
    reasoning was right, it just did not hold for both sites.

20. **`SectionSubject` has no pollutant slot**, so an AQS pollutant with no
    qualifying monitor is named in the section's note rather than in a sentence
    of its own. B2 asks for the nearest qualified monitor *per pollutant*, so
    the failure should be visible per pollutant. Needs a per-pollutant count
    template and a slot to hang it on. Blocked behind the AQS adapter anyway.

21. [DONE 2026-09-16] **`group/shared-identifier@1` re-seats its second subject when a member
    leaves the store.** Deleting one of three members renders "PASADENA
    REFINING FIRE and PASADENA REFINING SYSTEM, INC. share one EPA facility
    registry ID, 110000462703" -- where the second is the record that ID names
    rather than a record sharing it. `GroupSubject.otherSubject` is the second
    live member, whatever it is.

    Closed. `lib/evidence/sentence.ts` now reads the two named records off the
    placement's own `members`, in order, rather than off the live ones: `const
    [firstId, secondId] = members`. A deleted member leaves that slot null and a
    null drops the clause, which is what deleting a record is supposed to do.
    The count and the identifier still read from whoever is left, because those
    are facts about the surviving group rather than about two named records.
