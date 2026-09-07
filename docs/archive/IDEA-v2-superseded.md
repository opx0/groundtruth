# Ground Truth — NextStep Hacks 2026 (Honest Revision)

> **Master specification. Rewritten 2026-09-15 after user critique caught overclaims, hallucination traps, feature creep, fabricated personas, false latency claims, and planning around a non-free API. Every claim in this file has to survive attack. If it can't, it's cut.**

- **Hackathon:** NextStep Hacks 2026 · Theme: *Earth Forward* · https://nextstep2026.devpost.com/
- **Working name:** Ground Truth
- **Status:** Idea locked. Specification in honest mode.

---

## 1. The one-sentence promise (honest)

> **Type any US address. Ground Truth pulls the operating polluters near it, the Superfund and registered sites, the air-pollution history, and the fire and flood zones — from free government APIs — and gives you a plain-language summary where every claim is traceable to a specific record.**

## 2. Honest originality assessment

Not 9/10. **6/10.**

Incumbents that already do parts of this:
- **Zillow / Redfin / Realtor.com** — surface First Street flood/fire/heat/air per listing
- **EPA MyEnvironment** — address → nearby facilities lookup, free, public
- **Phase I Environmental Site Assessments** — the "environmental biography of an address" sold B2B for $2,000–3,000 per parcel by every ESA firm
- **First Street Foundation** — the underlying climate risk data layer
- **ClimateCheck** — climate risk for real estate

What is actually novel here:
1. **Free** consumer access to the aggregation
2. **Plain-language** synthesis instead of PDF report or map overlay
3. **Violation history** front-loaded (not buried in ECHO's own UI)
4. **Honest source disagreement** shown rather than averaged
5. **Deterministic citation guarantee** (see §5) — the AI cannot write a sentence that isn't traceable to a specific tool result
6. **One recommended action** rather than data dump

Pitch #4–#6, not "nothing does this."

## 3. What Ground Truth is NOT (removed for honesty)

Every one of these was in the prior draft. Each is cut because it would lie, hallucinate, exceed the timeline, or be unnecessary:

- ❌ **International parity.** Ground Truth is US-first. Non-US addresses show only what global-coverage sources return (OpenAQ, FIRMS) with an explicit "less data here" banner.
- ❌ **Historical land use back to 1920.** Sanborn maps are scanned images at LOC, not a queryable parcel index. Reading them per address is human work. EPA FRS/SEMS is what actually ships.
- ❌ **Cumulative exposure score.** A composite from population studies with no personal exposure data manufactures fake precision. Cut entirely.
- ❌ **First Street free consumer API.** Moved to enterprise terms years ago. Replaced with **FEMA National Flood Hazard Layer** (flood) + **NASA FIRMS** (fire). Both free, both real. Verify in the first hour of build.
- ❌ **Camera input.** GPS already returns the address; "visual landmark validation" was theatre. Text input + "use my location" button, single mode.
- ❌ **Voice input.** Cut from v1.
- ❌ **URL paste of real estate listings.** Cut from v1.
- ❌ **Accounts, saved addresses, comparison mode.** Cut from v1.
- ❌ **Custom MCP server on npm.** Deferred to §12 slack list.
- ❌ **Wolfram integration.** Not judged by this panel; not needed for the core loop. Deferred to §12.
- ❌ **Evaluator-optimizer Sonnet↔Opus critic loop.** Replaced by a stronger deterministic guarantee (§5).
- ❌ **"6 seconds" latency claim.** Real latency is 20–60 seconds. UI streams results per worker.
- ❌ **Fabricated named personas** ("Reena", "Marcus", "Zara") **presented as real users with real outcomes.** Either explicitly labeled illustrative in the pitch, or replaced with real interviews. **Fabricating outcomes to judges risks disqualification.**
- ❌ **30-address six-continent eval.** Replaced with 10 hand-verified US addresses.
- ❌ **Head-to-head vs. generic Claude baseline.** Deferred to §12.
- ❌ **Anthropic-reviewer phrasings** ("interleaved extended thinking," "beyond a chatbot wrapper"). Panel does not grade prompt-engineering vocabulary. They grade whether it worked on their address.
- ❌ **Outreach for endorsement quotes** as core scope. Nice if it happens; not core.

## 4. The one core loop

```
INPUT      →  TYPE address, or press "use my location"  (single input mode)
                  │
QUERY      →  5 parallel Haiku 4.5 workers hit free government APIs
                  │
STREAM     →  Each worker's result renders as it returns (~20–60 s total)
                  │
CITE       →  Every claim in the synthesized narrative carries a tool-
              result-id; a deterministic pre-render check rejects any
              sentence without a valid citation
                  │
SYNTHESIZE →  Opus 5 writes one plain-language paragraph from only
              cited tool results
                  │
DISAGREE   →  Where sources conflict, both are shown with a likely
              explanation, not averaged                (the hero UX moment)
                  │
ACT        →  ONE informational recommendation
              (investigate, walk a block over, request records,
              file a public-records request, consult a professional)
```

## 5. The tool-result-id citation guarantee (this replaces the critic loop)

Deterministic. Cheap. Stronger honesty than an LLM critique.

- Each worker returns structured JSON with a stable `result_id` per fact
- The Opus 5 synthesizer prompt requires every factual sentence to end with `[result_id: X]`
- Pre-render code parses the output; any sentence lacking a valid `[result_id]` reference to an actual worker return is rejected
- On rejection: regenerate up to 2×, then fall back to a structured card view (worker outputs as-is, no synthesis)
- Result: the model **cannot** write "there is a chemical warehouse here" unless a worker actually returned that fact from a real API

This is the technical originality moment for the panel.

## 6. The 5 workers (real, free, buildable this week)

| Worker | Source | Returns | Coverage | Auth |
|---|---|---|---|---|
| `Facilities` | [EPA ECHO REST](https://echo.epa.gov/tools/web-services) | Operating permitted facilities within N km, current status, violation history, penalties | US-deep | none |
| `Sites` | EPA [SEMS](https://www.epa.gov/enviro/sems-search) + [FRS](https://www.epa.gov/frs) | Superfund sites, registered sites, cleanup phase | US-deep | none |
| `Air` | [AirNow](https://docs.airnowapi.org/) + [OpenAQ](https://docs.openaq.org/) | Current + recent-history air quality readings from monitors near address | US via AirNow (deep), global via OpenAQ (partial) | free keys |
| `Fire` | [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/api/) | Active fires within radius, past 7 days | Global | free key |
| `Flood` | [FEMA NFHL](https://hazards.fema.gov/femaportal/wps/portal/NFHLWMSkmzdownload) | Flood zone designation for parcel | US only | none |

Optional 6th worker if the core is shipped and stable: `Canopy` from [Global Forest Watch](https://data-api.globalforestwatch.org/) — mostly useful for tropical / forested addresses.

## 7. Interface (ONE mode)

- Single web page
- Text input for address + "use my location" button
- Streaming result cards per worker
- Synthesized narrative paragraph rendered once all workers return (or after 60 s, whichever first)
- Source badges on every claim; click-through to the underlying record
- "Query another address" button
- No account, no sign-in, no history, no saved data

## 8. Source-classification badges (kept — the badge system + disagreement feature are the most original UX pieces)

| Badge | Meaning |
|---|---|
| `OBSERVED` | Direct government-agency record |
| `COMMUNITY` | Non-government sensor (OpenAQ community node) |
| `REMOTE` | Satellite retrieval (NASA FIRMS) |
| `INFERRED` | Deterministic composite (formula visible on hover) |
| `REPORTED` | Public allegation, not adjudicated |

Disagreement is shown, not averaged. Example (verbatim UI):

```
AIR QUALITY UNCERTAIN

AirNow reference monitor (1.2 km):  PM2.5 = 46
OpenAQ community sensor (400 m):    PM2.5 = 88
Difference: 91 %

Likely explanation:
Community sensor is located adjacent to Interstate 95
during morning rush hour. Reference monitor is upwind
in a residential lot.

Confidence: MEDIUM
```

## 9. Handling international addresses honestly

For any address outside US ECHO/SEMS/FEMA coverage, the page renders a top-of-report banner:

> *"Deep US-agency data is available only for US addresses. For [City, Country], Ground Truth shows what global-coverage sources return: air quality where OpenAQ has stations, active fires from NASA FIRMS, forest change from GFW. Facilities, Superfund, and flood zoning are not available."*

Better honesty beat than fabricating "the paint factory 400 m upwind." Also avoids the exact hallucination trap the prior spec walked into.

## 10. Eval (real, small, verifiable)

- **10 US addresses**, hand-verified against known Superfund vicinity, known operating facilities, known flood zones, known air-quality issues
- Each with ground-truth expected outputs stored in `evals/fixtures.json`
- `harness.py` runs the full stack against each and scores per-category correctness (nearest-facility, violation-count, flood-zone, air-history-shape)
- **Pass count is visible on the demo page**: *"Ground Truth: 10/10 on our public eval set."*
- Above 95 % of hackathon submissions will have no eval at all.

## 11. Rubric scoring (honest, not inflated)

| Criterion | Score | Rationale |
|---|---:|---|
| Originality | **6/10** | Redfin/Zillow/Realtor already ship First Street per-listing. EPA MyEnvironment does address→facilities. Phase I ESA firms sell this B2B for $2–3k. Novelty is free-consumer-access + plain-language + violation-history-forward + deterministic citation + honest disagreement UX. |
| Adherence (Earth Forward) | **9/10** | Environmental empowerment, direct fit. |
| Completion | **9/10** | 5 free APIs, deterministic citation validation, streaming UI, 10-address eval. All shippable. |
| Learning | **7/10** | Real multi-source integration + deterministic AI-output validation is real engineering, not multi-agent theatre. |
| Design | **8/10** | Streaming UI + source badges + disagreement moment. One narrative + one action. |
| Technology | **7/10** | 5 parallel workers + tool-cite validation is respectable, not "wow." Not padded with unneeded MCP/Wolfram. |
| **Composite** | **7.7/10** | Honest average. An honest 7.7 executed cleanly beats an inflated 9.5 that collapses under one probing judge question. |

## 12. Deferred to "day 5 if the core is shipped and eval passes"

Do NOT touch these until the honest core is live, streaming, and 10/10 on eval:

- MCP server on npm
- Wolfram wind/water shed math
- 6th worker (GFW canopy)
- Head-to-head baseline vs. generic Claude with web search
- Real user interviews (replacing illustrative personas)
- Domain purchase + DNS
- Multilingual output
- International eval batch

## 13. Video beat sheet (short, product-first, no fake personas)

**Target: 3 minutes total.** Cut everything filler.

| Time | Beat | On screen |
|---|---|---|
| 0:00–0:15 | Cold context: one sentence, one stat | Product screenshot, address bar visible |
| 0:15–0:40 | **Live demo — judge's own address (or venue address)** | Address typed; 5 worker cards stream in; narrative appears |
| 0:40–1:15 | **Second address with a known source disagreement** | AirNow monitor 46 vs. OpenAQ community 88; the "likely explanation" UI moment |
| 1:15–1:45 | **Third address — international, honest coverage banner** | "Less data here" banner rendered legibly |
| 1:45–2:15 | Deterministic citation guarantee explained on one slide | "Every sentence carries a `[result_id]`. No result, no sentence." + eval count 10/10 |
| 2:15–2:45 | Who this is for; one closing action; what's honest about the current scope | Product still visible |
| 2:45–3:00 | End card | Wordmark + URL |

No one-minute cinematic cold open. No fabricated user outcomes.

## 14. Personas (labeled illustrative, or replaced with real interviews before pitch)

Any "user" mentioned in the pitch is one of:
- **(A) explicitly labeled "illustrative example"** on screen, or
- **(B) a real person interviewed by the team, with permission, with their outcome verified**

Never a fabricated persona presented as a real user with a real outcome. That specific move risks disqualification on discovery.

## 15. What is intentionally SMALL about this scope

- One page, one input, one output narrative, one recommendation
- 5 workers, US-deep, honest about international
- No account, no persistence, no camera, no voice, no MCP, no Wolfram, no multilingual (v1)
- 10-address eval, not 30
- 3-minute video, not 5

The scope is small on purpose. **The winning move is "narrow and true," not "wide and vibey."**

## 16. Change log

- **v1 (earlier today):** Locked after 6 research tracks; overclaimed originality (9→corrected 6), feature-crept from 1 to 5 input modes, fabricated named personas as real users, promised 6-second latency, planned around a non-free First Street API, added MCP/Wolfram/critic-loop that weren't earning their place, and wrote pitch copy for Anthropic reviewers instead of the actual engineer panel.
- **v2 (this file):** Every overclaim removed. Scope halved. Interface reduced to one. Latency claim corrected. Personas labeled illustrative. Non-free API replaced with FEMA + NASA. Critic loop replaced with deterministic tool-result-id citation validation. MCP/Wolfram deferred to slack list. Scoring made honest at 7.7/10.
