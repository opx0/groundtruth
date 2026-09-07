# Arm C — Evidence kernel, built from the actual fixture bytes

Grounding facts this design is answerable to (all verified against `tests/fixtures/`):

- `sems/arcgis-5mi-houston.json`, feature `OBJECTID 7121`: `REGISTRY_ID "110000460885"`,
  `PRIMARY_NAME "HOUSTON REFINERY"`, `LATITUDE83 29.722274`, `LONGITUDE83 -95.254401`,
  `ACCURACY_VALUE null`, `COLLECT_MTH_DESC null`, `UPDATE_DATE 1710413511000` (epoch ms).
- `sems/envirofacts-TXN000622182.json`: `name "VALERO PLUME"`, `primary_latitude_decimal_val null`,
  `primary_longitude_decimal_val null`, `non_npl_status_date "2022-02-08 00:00:00"` (string, not epoch).
  Same registry, different name, different (missing) coordinate — the canonical case.
- `census/ambiguous-100-main-st.json`: 8 `addressMatches` for one input address, no confidence field.
  `census/no-match-9400-clinton.json`: 0 matches. Census never emits a match-type/quality field.
- `fema/esri-no-polygon-houston.json`: `features: []`, no `fields` array at all — a clean success
  that must not look like an error.
- `fema/esri-zone-ae-pasadena.json`: `SFHA_TF: "T"` (string, not boolean), `ZONE_SUBTY: null`.

## Usage first

```ts
import { readFileSync } from "node:fs";
import {
  parseArcgisSemsResponse,
  parseEnvirofactsSemsSite,
  buildSemsSiteRecord,
} from "@/kernel/adapters/sems";
import { haversine } from "@/kernel/geo";
import { selectForSummary } from "@/kernel/selection";
import { TEMPLATES, templatesFor, renderSentence } from "@/kernel/render";
import type { SourceResult, SemsSiteRecord, Sentence, Span } from "@/kernel/types";

// 1. Adapter: two raw payloads, one record, provenance for both names kept separately.

const arcgis = parseArcgisSemsResponse(
  readFileSync("tests/fixtures/sems/arcgis-5mi-houston.json", "utf8"),
);
const houstonRefineryFeature = arcgis.records.find(
  (r) => r.attributes.REGISTRY_ID === "110000460885",
)!;

const envirofacts = parseEnvirofactsSemsSite(
  readFileSync("tests/fixtures/sems/envirofacts-TXN000622182.json", "utf8"),
);

const originCoordinate = { latitude: 29.720658823001, longitude: -95.261995884462 }; // Census match, server-side only

const semsRecord: SemsSiteRecord = buildSemsSiteRecord({
  arcgis: houstonRefineryFeature.attributes,
  envirofacts: envirofacts.status === "ok" ? envirofacts.records[0] : null,
  origin: originCoordinate,
  adapterVersion: "sems@1",
  retrievedAt: "2026-09-15T00:00:00Z",
  rawPayloadHash: arcgis.rawPayloadHash,
});

// semsRecord.frsName.value       === "HOUSTON REFINERY"   (from ArcGIS PRIMARY_NAME)
// semsRecord.semsName.value      === "VALERO PLUME"        (from Envirofacts name)
// semsRecord.location            === { lat 29.722274, lon -95.254401, accuracy null, ... }
// semsRecord.distanceMeters.value  ≈ 755   (haversine, both coordinates carried in provenance)
// semsRecord.statusDate.value    === "2022-02-08"          (normalize-date, not the raw string)

// 2. Selection: every fetched record is kept; only the summary slice is bounded, per source.

const semsResult: SourceResult<SemsSiteRecord> = { status: "ok", records: [semsRecord /* , ...14 more */] };
const summarySems = selectForSummary(semsResult, { limit: 5, by: "distance" });
// summarySems.status === "ok" -> summarySems.shown (<=5, ordered), summarySems.remaining (count)
// a "no-data" or "error" SourceResult passes through selectForSummary untouched — no source can
// throw the whole report off the rails.

// 3. Render: one template, bound to "sems-site" at the type level, produces a Sentence.

const template = templatesFor(TEMPLATES, "sems-site")[0]!;
const sentence: Sentence = renderSentence(semsRecord, template);
// sentence.spans -> [
//   { type: "value", text: "VALERO PLUME", trace: { sourceField: "name", rawValue: "VALERO PLUME", ... } },
//   { type: "literal", text: ", " },
//   { type: "value", text: "0.76 km", trace: { sourceField: "haversine(...)", ... } },
//   { type: "literal", text: ". Not on the National Priorities List. Status: " },
//   { type: "value", text: "Removal Only Site (No Site Assessment Work Needed)", trace: {...} },
//   { type: "literal", text: ", as of " },
//   { type: "value", text: "2022-02-08", trace: {...} },
// ]

// 4. Trace panel: a click hands you the span, the span already carries everything A3 needs.

function openTracePanel(span: Span) {
  if (span.type !== "value") return null; // literals have nothing to trace, by construction
  return span.trace; // { agency, recordKind, sourceRecordId, sourceUrl, sourceField, rawValue,
                      //   normalizedValue, transform, adapterVersion, recordDate, sourceUpdatedAt,
                      //   retrievedAt, distanceInputs, caveats }
}

const nameTrace = openTracePanel(sentence.spans[0]!)!;
// nameTrace.rawValue === "VALERO PLUME"
// nameTrace.caveats includes: 'FRS lists the same registry ID as "HOUSTON REFINERY" (PRIMARY_NAME).'
```

## The types

```ts
// ---------- Provenance primitives ----------

type SourceId = "census" | "frs" | "sems" | "fema" | "echo" | "aqs" | "airnow";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type Transform =
  | "identity"
  | "parse-number"
  | "normalize-date" // "2022-02-08 00:00:00" -> "2022-02-08"
  | "parse-epoch-ms" // 1710413511000 -> "2024-03-14T10:51:51Z"
  | "map-boolean" // "T" -> true, null -> null
  | "haversine" // two Coordinates -> meters
  | "prefer-non-null"; // pick the first non-null of several Sourced<T | null>

interface ProvenanceAtom {
  readonly sourceField: string; // dotted path into the raw record, e.g. "envirofacts_site.name"
  readonly rawValue: JsonValue; // byte-identical to what the source sent, pre-transform
  readonly transform: Transform;
  readonly adapterVersion: string; // e.g. "sems@1"
}

declare const SOURCED_BRAND: unique symbol;

/** Only `field()` and `derive()` can produce a value of this type. */
interface Sourced<T> {
  readonly value: T;
  // never empty: a Sourced value with zero provenance atoms cannot exist
  readonly provenance: readonly [ProvenanceAtom, ...ProvenanceAtom[]];
  readonly [SOURCED_BRAND]: true;
}

/** True only for objects actually produced by field()/derive() — not anything shaped like one. */
declare function isSourced(x: unknown): x is Sourced<unknown>;

/** Read one field off an already-Zod-validated raw record; provenance is inferred from Raw/K. */
declare function field<Raw extends Record<string, JsonValue>, K extends keyof Raw & string>(
  raw: Raw,
  key: K,
  transform: Transform,
  adapterVersion: string,
): Sourced<unknown>; // concrete adapters narrow via a per-transform overload table, omitted here

/** Combine one or more already-Sourced values into a new derived Sourced value (e.g. haversine). */
declare function derive<T>(
  transform: Transform,
  adapterVersion: string,
  inputs: readonly Sourced<unknown>[],
  computed: T,
): Sourced<T>;

// ---------- Coordinates and geo ----------

interface Coordinates {
  readonly latitude: number;
  readonly longitude: number;
}

interface GeoPoint {
  readonly latitude: Sourced<number>;
  readonly longitude: Sourced<number>;
  readonly accuracyMeters: Sourced<number | null>; // FRS ACCURACY_VALUE — frequently null
  readonly collectionMethod: Sourced<string | null>; // FRS COLLECT_MTH_DESC — frequently null
  readonly referencePoint: Sourced<string | null>; // FRS REF_POINT_DESC
}

declare function haversine(from: Coordinates, to: Coordinates): number;

// ---------- Source-level result: failure / no-data / success are three shapes, not one ----------

type SourceResult<T> =
  | { readonly status: "ok"; readonly records: readonly [T, ...T[]] } // never empty by construction
  | { readonly status: "no-data"; readonly reason: string } // queried fine, nothing at this point
  | { readonly status: "error"; readonly code: JsonValue; readonly message: string }; // code verbatim

// ---------- Evidence records ----------

interface EvidenceBase {
  readonly id: string;
  readonly source: SourceId;
  readonly sourceRecordId: string;
  readonly sourceUrl: string;
  readonly location: GeoPoint | null; // null, not a GeoPoint of nulls, when raw coords are absent
  readonly distanceMeters: Sourced<number> | null; // null when either endpoint is missing
  readonly retrievedAt: string;
  readonly rawPayloadHash: string;
  readonly caveats: readonly string[];
}

interface SemsSiteRecord extends EvidenceBase {
  readonly kind: "sems-site";
  readonly source: "sems";
  readonly epaSiteId: Sourced<string>; // PGM_SYS_ID / epa_id
  readonly registryId: Sourced<string | null>; // REGISTRY_ID
  readonly frsName: Sourced<string>; // ArcGIS PRIMARY_NAME
  readonly semsName: Sourced<string | null>; // Envirofacts name — null when no join match
  readonly nplStatus: Sourced<string>; // npl_status_name, verbatim
  readonly nonNplStatus: Sourced<string | null>; // non_npl_status_name, verbatim
  readonly statusDate: Sourced<string | null>; // non_npl_status_date, normalize-date
  readonly archived: Sourced<boolean | null>; // archived_ind, map-boolean
}

interface FemaFloodZoneRecord extends EvidenceBase {
  readonly kind: "fema-flood-zone";
  readonly source: "fema";
  readonly zoneCode: Sourced<string>; // FLD_ZONE
  readonly zoneSubtype: Sourced<string | null>; // ZONE_SUBTY
  readonly specialFloodHazardArea: Sourced<boolean | null>; // SFHA_TF, map-boolean
}

interface CensusMatchRecord extends EvidenceBase {
  readonly kind: "census-match";
  readonly source: "census";
  readonly matchedAddress: Sourced<string>;
  readonly candidateCount: number; // addressMatches.length — surfaces ambiguity structurally
}

type EvidenceRecord = SemsSiteRecord | FemaFloodZoneRecord | CensusMatchRecord; // + others, same shape

// ---------- Adapter surface (SEMS shown; others follow the same two calls) ----------

interface ArcgisSemsAttributes {
  readonly REGISTRY_ID: string;
  readonly PRIMARY_NAME: string;
  readonly LATITUDE83: number | null;
  readonly LONGITUDE83: number | null;
  readonly ACCURACY_VALUE: number | null;
  readonly COLLECT_MTH_DESC: string | null;
  readonly REF_POINT_DESC: string | null;
  readonly UPDATE_DATE: number; // epoch ms, always present
  readonly PGM_SYS_ID: string;
  readonly INTEREST_TYPE: string;
}

interface EnvirofactsSemsSite {
  readonly site_id: string;
  readonly name: string;
  readonly epa_id: string;
  readonly primary_latitude_decimal_val: string | null;
  readonly primary_longitude_decimal_val: string | null;
  readonly npl_status_name: string;
  readonly non_npl_status_name: string | null;
  readonly non_npl_status_date: string | null; // "2022-02-08 00:00:00"
  readonly archived_ind: string | null; // "N" / "Y" / null
}

declare function parseArcgisSemsResponse(
  raw: string,
): { readonly records: readonly { attributes: ArcgisSemsAttributes }[]; readonly rawPayloadHash: string };

declare function parseEnvirofactsSemsSite(raw: string): SourceResult<EnvirofactsSemsSite>;

declare function buildSemsSiteRecord(input: {
  readonly arcgis: ArcgisSemsAttributes;
  readonly envirofacts: EnvirofactsSemsSite | null; // join miss is a real, expected case
  readonly origin: Coordinates;
  readonly adapterVersion: string;
  readonly retrievedAt: string;
  readonly rawPayloadHash: string;
}): SemsSiteRecord;

// ---------- Selection (per-source, bounded summary slice; nothing is ever discarded) ----------

declare function selectForSummary<T extends EvidenceRecord>(
  result: SourceResult<T>,
  opts: { readonly limit: number; readonly by: "distance" },
): SourceResult<T> extends { status: "ok" }
  ? { readonly status: "ok"; readonly shown: readonly T[]; readonly remaining: number }
  : SourceResult<T>;

// ---------- Sentences: what gets rendered, and what the trace panel reads ----------

interface TraceEntry {
  readonly agency: string;
  readonly recordKind: EvidenceRecord["kind"];
  readonly sourceRecordId: string;
  readonly sourceUrl: string;
  readonly sourceField: string;
  readonly rawValue: JsonValue;
  readonly normalizedValue: JsonValue;
  readonly transform: Transform;
  readonly adapterVersion: string;
  readonly recordDate: string | null;
  readonly sourceUpdatedAt: string | null;
  readonly retrievedAt: string;
  readonly distanceInputs: { readonly from: Coordinates; readonly to: Coordinates } | null;
  readonly caveats: readonly string[];
}

type Span =
  | { readonly type: "literal"; readonly text: string }
  | { readonly type: "value"; readonly text: string; readonly trace: TraceEntry };

interface Sentence {
  readonly recordId: string;
  readonly kind: EvidenceRecord["kind"];
  readonly spans: readonly Span[];
}

declare function literalSpan(text: string): Span;
declare function valueSpan<T>(sourced: Sourced<T>, format: (value: T) => string, extra: { readonly recordId: string; readonly recordKind: EvidenceRecord["kind"]; readonly sourceRecordId: string; readonly sourceUrl: string; readonly caveats: readonly string[] }): Span;

// ---------- Templates: bound to one kind, checked twice ----------

interface Template<K extends EvidenceRecord["kind"]> {
  readonly kind: K; // runtime tag — the test-time backstop
  readonly id: string;
  readonly build: (record: Extract<EvidenceRecord, { kind: K }>) => readonly Span[];
}

type TemplateRegistry = { readonly [K in EvidenceRecord["kind"]]: readonly Template<K>[] };

declare const TEMPLATES: TemplateRegistry;

declare function templatesFor<K extends EvidenceRecord["kind"]>(
  registry: TemplateRegistry,
  kind: K,
): readonly Template<K>[];

declare function renderSentence<K extends EvidenceRecord["kind"]>(
  record: Extract<EvidenceRecord, { kind: K }>,
  template: Template<K>,
): Sentence;

// ---------- Report assembly: sentences are derived, never stored ----------

declare function renderReport(records: readonly EvidenceRecord[], registry: TemplateRegistry): readonly Sentence[];
```

## The five mechanisms

**1. Provenance-carrying value.** `Sourced<T>` pairs a value with a non-empty tuple of
`ProvenanceAtom`s and a unique-symbol brand that only `field()`/`derive()` can attach; the tuple
type (`[atom, ...atom[]]`) makes "traceable to at least one raw field" a type-level fact, not a
convention, which matters the moment a value like distance needs two atoms instead of one.

**2. Adapter construction without hand-written provenance.** `field(raw, key, transform, version)`
reads `raw[key]` off an already-Zod-parsed object (so the key is a real, checked property, not an
index into an untyped bag) and fills `sourceField`/`rawValue` from `key`/`raw[key]` automatically;
the adapter writes `field(arcgis, "PRIMARY_NAME", "identity", v)` and `field(envirofacts, "name",
"identity", v)` as two independent calls into two independent raw objects, which is exactly why
`frsName` and `semsName` can hold "HOUSTON REFINERY" and "VALERO PLUME" side by side instead of one
overwriting the other.

**3. Kind-bound templates.** `Template<K>.build` takes `Extract<EvidenceRecord, {kind: K}>`, so
assigning a `SemsSiteRecord` to a `Template<"fema-flood-zone">` is a compile error at the call site
in `TEMPLATES`; `renderSentence` additionally checks `template.kind === record.kind` at runtime
before calling `build`, which is the backstop for the one place a `TemplateRegistry` could be
assembled with a mismatched entry via an unchecked cast.

**4. What a sentence is, and how deletion removes it.** A `Sentence` is not a string; it is spans,
and every "value" span embeds its own `TraceEntry` at construction time via `valueSpan`, which is
the only function allowed to produce that span shape and which requires an actual branded
`Sourced<T>` to call. `renderReport` is a pure map over its input array — `records.flatMap(...)` —
so a record's text exists in the output if and only if the record is in the input; there is no
cache or store that can retain a sentence for a record no longer passed in, and no separate string
representation to fall out of sync with the record it came from.

**5. Failure vs. no-data vs. success.** `SourceResult<T>` has three tags: `"error"` (raw `code` kept
as `JsonValue`, never mapped to a known enum, satisfying "unknown status codes preserved verbatim"),
`"no-data"` (the source answered and found nothing — FEMA's empty `features: []`, Census's empty
`addressMatches`), and `"ok"` with a *non-empty* tuple of records (so "zero records" can never be
mistaken for success). `selectForSummary` and `renderReport` both take one `SourceResult` per source
independently, so an `"error"` in FEMA never touches the SEMS or Census results sitting next to it.

## Two things this shape makes hard

1. **Cross-record, cross-source comparisons have no natural home.** B6's grouping rule — same FRS
   registry ID under two SEMS EPA IDs, or "the FRS coordinate differs from the Envirofacts
   coordinate for this same site" — is a fact about *two records*, not one, but every `Sourced<T>`
   and every `Template<K>` is scoped to a single `EvidenceRecord`. Representing a grouped or
   compared fact means inventing a second-class "comparison record" (or bolting an ad hoc field
   like `semsCoordinate` onto `SemsSiteRecord` for the specific case this brief calls out) rather
   than reusing the same mechanism, and that seam will need its own template-binding and trace
   story later.

2. **Every derived value costs a name.** Because `Sourced<T>` can only be produced by `field()` or
   `derive()`, even a trivial transformation — uppercasing a name for display, trimming whitespace —
   must either be smuggled into an existing named `Transform` or get its own entry in the closed
   `Transform` union plus a paragraph explaining it. That is the right tax for `haversine` and
   `parse-epoch-ms`; it is real friction for the dozens of small formatting decisions a renderer
   accumulates, and it will tempt someone in a hurry to format a `.value` outside the mechanism
   entirely, silently detaching the displayed text from its trace.

## The tests that catch a violation

- **Wrong-kind template.** Build a `Template<"fema-flood-zone">` whose `kind` is forged to
  `"sems-site"` via `as unknown as Template<"sems-site">` (simulating a bug in how `TEMPLATES` was
  assembled), pass a real `SemsSiteRecord` to `renderSentence`. Assert it throws before calling
  `build`, because the runtime `template.kind === record.kind` check fires first.

- **A value mutated after validation.** Take `semsRecord.frsName` (a real `Sourced<string>`
  returned by the adapter, which deep-freezes every record it returns) and, in strict-mode test
  code, assign `semsRecord.frsName.value = "X"`. Assert the assignment throws `TypeError` (frozen
  object) and that a fresh read of `semsRecord.frsName.value` still reads `"HOUSTON REFINERY"`.

- **A record deleted but its text remaining.** Call `renderReport([semsRecord], TEMPLATES)`, assert
  the returned sentences contain `"VALERO PLUME"`. Call `renderReport([], TEMPLATES)` — not "mark
  deleted," an actual absent record — and assert the returned array is empty and no sentence
  anywhere contains `"VALERO PLUME"` or references `semsRecord.id`.

- **A sentence rendered with no provenance.** Construct a plain object that is structurally
  identical to `Sourced<string>` — `{ value: "X", provenance: [{ sourceField: "fake", rawValue:
  "X", transform: "identity", adapterVersion: "sems@1" }] }` — but lacks the `SOURCED_BRAND` symbol
  (as anything reconstructed from `JSON.parse` would). Pass it to `valueSpan`. Assert it throws via
  `isSourced`, rather than silently emitting a "value" span whose trace was fabricated by the
  caller instead of carried from a real adapter read.
