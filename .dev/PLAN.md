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
| U0.2 | Evidence kernel, provenance, rendering contract | U0.1 | judgment | design race |
| U0.3 | Adapter contract, fetch wrapper, failure taxonomy | U0.2 | judgment | queued |
| U1.1 | SEMS adapter, ArcGIS plus Envirofacts join | U0.3 | hard | queued |
| U1.2 | Census geocoder adapter | U0.3 | specified | queued |
| U1.3 | FEMA adapter, NFHL with Esri fallback | U0.3 | hard | queued |
| U1.4 | FRS adapter, identity and coordinate quality | U0.3 | specified | queued |
| U1.5 | ECHO adapter, fixture-driven | U0.3 | hard | queued |
| U1.6 | AQS adapter | U0.3 | specified | queued |
| U1.7 | AirNow adapter | U0.3 | specified | queued |
| U2.1 | Selection and ordering policy | U0.2 | judgment | queued |
| U2.2 | Facility grouping by registry and program ID | U1.1 U1.4 | hard | queued |
| U2.3 | Template renderer, kind-gated | U0.2 | judgment | queued |
| U3.1 | Route handlers, streamed per source | U1.x | hard | queued |
| U3.2 | Coordinate cache with TTL, no identity | U3.1 | specified | queued |
| U3.3 | Privacy invariants and log redaction | U3.1 | judgment | queued |
| U4.1 | Search, examples, match confirmation | U3.1 | specified | queued |
| U4.2 | Report cards, independent source states | U3.1 | specified | queued |
| U4.3 | Trace panel | U2.3 | judgment | queued |
| U5.1 | Adapter fixture matrix, seven cases per source | U1.x | specified | queued |
| U5.2 | Renderer mutation tests | U2.3 | judgment | queued |
| U5.3 | Selection tests | U2.1 | specified | queued |
| U5.4 | Privacy tests | U3.3 | specified | queued |
| U5.5 | Playwright, the eight paths | U4.x | specified | queued |

## Known blockers

- ECHO and FEMA NFHL refuse connections from this machine. U1.5 and the
  authoritative half of U1.3 build against recorded fixtures and are marked
  unverified against live traffic until the app runs from a US region.
- AQS and AirNow need free keys the operator must register. Both adapters are
  built and tested against fixtures meanwhile.
