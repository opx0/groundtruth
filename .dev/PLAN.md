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
| U1.6 | AQS adapter | U0.3 | specified | briefed, blocked on the operator's key |
| U1.7 | AirNow adapter | U0.3 | specified | briefed, blocked on the operator's key |
| U2.0 | Record templates for the five unserved kinds | U0.2 | judgment | done |
| U2.1 | Selection and ordering policy | U0.2 U2.0 | judgment | **next** |
| U2.2 | Facility grouping by registry and program ID | U1.1 U1.4 | hard | done |
| U2.3 | Template renderer, kind-gated | U0.2 | judgment | done |
| U3.1 | Route handlers, streamed per source | U1.x | hard | geocode route done; report route **next** |
| U3.2 | Coordinate cache with TTL, no identity | U3.1 | specified | queued |
| U3.3 | Privacy invariants and log redaction | U3.1 | judgment | partly done in the geocode route |
| U4.1 | Search, examples, match confirmation | U3.1 | specified | done |
| U4.2 | Report cards, independent source states | U3.1 | specified | queued |
| U4.3 | Trace panel | U2.3 | judgment | queued |
| U5.1 | Adapter fixture matrix, seven cases per source | U1.x | specified | queued |
| U5.2 | Renderer mutation tests | U2.3 | judgment | done via .dev/census/mutation-check.sh |
| U5.3 | Selection tests | U2.1 | specified | queued |
| U5.4 | Privacy tests | U3.3 | specified | partly done in the geocode route |
| U5.5 | Playwright, the eight paths | U4.x | specified | queued |

## Known blockers

- ECHO and FEMA NFHL refuse connections from this machine. Both return a
  connection reset before any response body. Relaying the request through a
  public proxy was tried and is disallowed by the sandbox, correctly, so the
  bytes have to come from a machine that can reach them. Until then U1.5 and
  the authoritative half of U1.3 build against a schema derived from EPA's
  published column list, and every record they produce is marked
  `shapeUnverified` so the gap is visible in the report rather than hidden.
  Clearing it needs one of: a US-region deploy, one curl from a US host, or a
  git remote so a CI runner can record the fixtures.
- AQS and AirNow need free keys the operator must register. Neither adapter is
  written yet; `.dev/briefs/U1.6-U1.7-air.md` briefs both. What is recorded is
  what each answers *without* a key, captured live on 2026-09-16, and both are
  real bytes worth having: AQS answers HTTP 429 with `Retry-After: 86400` from
  EPA's own exhausted shared test account, and AirNow answers HTTP 401 with
  `{"WebServiceError":[{"Message":"Request not authenticated."}]}`, which pins
  its error envelope for the first time. Neither success shape has been seen.
  AQS's response envelope is `{"Header":[...],"Body":[...]}` per EPA's own
  published API documentation, which is reachable from here.

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

8. **A no-data note cannot say which source answered.** `runSource` hard-codes
   the note, so the fan-out's flood slot cannot carry whether the authoritative
   layer or the fallback returned nothing, which is the one distinction that
   card exists to make. Until an adapter can supply its own no-data note, the
   report must call the flood adapter's own entry point rather than read the
   slot. Let an adapter supply the note.

9. **One timeout covers the whole flood source.** The fallback only runs after
   the authoritative layer fails, so a hang rather than a fast reset would eat
   the budget and the reader would get nothing instead of the fallback. Give the
   first leg a shorter deadline than the source as a whole.

10. **`FLD_AR_ID` is required by the schema.** It is the layer's primary key and
    the adapter needs it for a record id, but no authoritative row has ever been
    seen, so a null there would read as malformed. Worth re-checking against the
    first real capture.

## Queue status after U1.8

Closed: 1, 2, 3, 5, 6, 7. The trace no longer misreports a value, structured
values have provenance, a failed join no longer costs fourteen good records,
top-level arrays parse, and both date shapes are named transforms.

Still open, none of them blocking:

- **4**, deduplicating the ArcGIS query building across three adapters. Left
  alone deliberately. The duplication is small and the abstraction has not
  earned itself yet.
- **8**, an adapter supplying its own no-data note, so the flood card can say
  which of its two datasets returned nothing. Needed before the flood card is
  wired to the shared fan-out; until then the report calls the flood adapter
  directly, which works.
- **9**, a shorter deadline for the authoritative flood layer so a hang cannot
  eat the budget before the fallback runs. Only matters once that host is
  reachable.
- **10**, re-checking that the flood layer's primary key is never null. Blocked
  on capturing one real response from that host.

Items 8, 9 and 10 all sit behind the same blocker: nobody has ever seen a
response from FEMA's authoritative flood layer.


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

12. **`fema-flood-zone/unmapped-flag@1` renders null for every committed
    record.** By construction: both Esri fixtures carry `SFHA_TF` of `"T"` or
    `"F"`. Its three states (an unmapped letter, `""`, and null) are exercised
    from derived rows, each altering exactly one field. A real row with an
    unmapped flag would close it. Worth asking for in
    `scripts/capture-us-fixtures.sh`.

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

17. **`sems-site/npl@1` is one clause, so a null coordinate takes the whole
    sentence.** A final-NPL site with no FRS coordinate would get no B7 NPL
    sentence at all, while `summary@1` still prints its NPL status. That is a
    silence rather than a false claim, and no recorded site reaches it — all
    fifteen have coordinates. Splitting the distance into its own clause fixes
    it; `tests/unit/templates/sems.test.ts` pins the current behaviour so the
    change is one assertion wide.
