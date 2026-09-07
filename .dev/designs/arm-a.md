# Arm A — evidence kernel: references, not copies

Central idea: **the only way to make a `Sourced<T>` is to read a named key off a
validated payload**, and **a template is a list of typed field references, not
values**. The type checker then proves three things by construction: a value
without provenance cannot exist, a template cannot name a field its record kind
lacks, and a sentence cannot contain any text except template connectives and
values re-read from the live record at render time.

Module surface (`lib/evidence/`), five files, nothing named after a phase:

| file | owns | exports |
|---|---|---|
| `sourced.ts` | the brand, provenance, transforms, `seal` | `Sourced`, `Provenance`, `fieldsOf`, `haversine`, `coalesce`, `seal` |
| `records.ts` | the B4 record kinds | `EvidenceRecord`, `RecordOf`, `Kind`, `RecordId` |
| `source.ts` | adapter contract, outcomes, fan-out | `Adapter`, `SourceOutcome`, `SourceIo`, `runSources` |
| `templates.ts` | kind-bound templates | `defineTemplate`, `sentence`, `fallback`, `km`, `TemplateRegistry` |
| `sentence.ts` | rendered text and its trace | `Sentence`, `render`, `trace`, `verify` |

---

## 1. Usage first

### SEMS adapter, one record from the fixtures

```ts
// lib/adapters/sems.ts   (server-only)
import "server-only";
import { z } from "zod";
import { arcgis } from "./arcgis";                       // shared ArcGIS FeatureSet schema builder
import { fieldsOf, haversine, coalesce, seal } from "@/lib/evidence/sourced";
import type { Adapter } from "@/lib/evidence/source";

// Status fields are z.string(), never z.enum(): unknown codes survive verbatim.
const FrsAttrs = z.object({
  REGISTRY_ID: z.string(), PRIMARY_NAME: z.string(), PGM_SYS_ID: z.string(),
  INTEREST_TYPE: z.string(), ACTIVE_STATUS: z.string().nullable(),
  LATITUDE83: z.number().nullable(), LONGITUDE83: z.number().nullable(),
  ACCURACY_VALUE: z.number().nullable(), COLLECT_MTH_DESC: z.string().nullable(),
  REF_POINT_DESC: z.string().nullable(), UPDATE_DATE: z.number().nullable(),
  FAC_URL: z.string(),
});
const EnvirofactsSite = z.array(z.object({
  site_id: z.string(), name: z.string(), epa_id: z.string(),
  primary_latitude_decimal_val: z.string().nullable(),
  primary_longitude_decimal_val: z.string().nullable(),
  npl_status_name: z.string(), non_npl_status_name: z.string().nullable(),
  non_npl_status_date: z.string().nullable(), archived_ind: z.string().nullable(),
}));

export const sems: Adapter<"sems-site"> = {
  source: "sems",
  version: "sems@1",
  async run(locus, io) {
    // locus has a GeoPoint and a radius. There is no address field to read.
    const layer = await io.get(frsSemsQueryUrl(locus), arcgis.featureSet(FrsAttrs));
    const records = [];
    for (const feature of layer.raw.features) {
      const frs = fieldsOf({ raw: feature.attributes, payload: layer.payload }, "frs_program_facility", this.version);
      const epaId = feature.attributes.PGM_SYS_ID;                 // TXN000622182
      const ef = await io.get(envirofactsUrl(epaId), EnvirofactsSite);
      const site = ef.raw[0] === undefined ? null
        : fieldsOf({ raw: ef.raw[0], payload: ef.payload }, "envirofacts_site", this.version);

      const location = frs.point("LATITUDE83", "LONGITUDE83", {
        accuracy: "ACCURACY_VALUE", method: "COLLECT_MTH_DESC", referencePoint: "REF_POINT_DESC",
      });                                                          // null when either coord is null

      records.push(seal({
        kind: "sems-site", source: "sems",
        id: recordId("sems-site", epaId), sourceRecordId: epaId,
        sourceUrl: site ? cumulisUrl(site.raw.site_id) : feature.attributes.FAC_URL,
        subject: coalesce(site?.text("name") ?? null, frs.text("PRIMARY_NAME")),
        location,
        distanceMeters: location ? haversine(locus.point, location) : null,
        effectiveAt: site?.date("non_npl_status_date") ?? frs.absent("non_npl_status_date"),
        sourceUpdatedAt: frs.epochMs("UPDATE_DATE"),
        payloads: site ? [layer.payload, ef.payload] : [layer.payload],
        caveats: SEMS_CAVEATS,
        epaSiteId: frs.text("PGM_SYS_ID"),
        semsSiteId: site?.text("site_id") ?? null,
        frsRegistryId: frs.text("REGISTRY_ID"),
        frsName: frs.text("PRIMARY_NAME"),                         // HOUSTON REFINERY
        semsName: site?.text("name") ?? null,                      // VALERO PLUME
        interestType: frs.text("INTEREST_TYPE"),
        nplStatus: site?.text("npl_status_name") ?? frs.text("ACTIVE_STATUS"),
        nonNplStatus: site?.text("non_npl_status_name") ?? null,
        statusDate: site?.date("non_npl_status_date") ?? null,    // "2022-02-08 00:00:00" -> "2022-02-08"
        archived: site?.flag("archived_ind", { Y: true, N: false }) ?? null,
        semsCoordinate: site?.point("primary_latitude_decimal_val", "primary_longitude_decimal_val", {}) ?? null,
      }));
    }
    return records;
  },
};
```

What is *not* written here: any `sourceField`, `rawValue`, `transform`,
`adapterVersion`, hash or retrieval timestamp. `fieldsOf` captured all of it
from the key name, the payload it was bound to, and the reader method used.
`frs.text("REGISTRY_IDD")` is a compile error (not a key of the Zod-inferred
raw type). `frs.epochMs("PRIMARY_NAME")` is a compile error (not a number key).

### Fan-out: one failing source never blocks

```ts
// app/report/[id]/page.tsx (server)
const sources = await runSources(locus, { sems, frs, echo, aqs, airnow, fema }, io);   // census is the geocoder, not an adapter
//    ^ { [S in SourceId]: SourceOutcome }  — every source is present, by type.
const store = storeOf(sources);          // EvidenceStore: every record sealed, keyed by RecordId
```

### Selection

```ts
// lib/report/select.ts
export function selectReport(sources: SourceMap, store: EvidenceStore): ReportPlan {
  const semsAll = store.ofKind("sems-site");                       // readonly Sealed<SemsSiteRecord>[]
  const ordered = orderByDistanceUnknownLast(semsAll);
  const placements: Placement[] = ordered.slice(0, 5).map((r) => ({
    recordId: r.id,                                                 // RecordId<"sems-site">
    template: r.nplStatus.value === "Currently on the Final NPL" ? templates["sems-site"][1] : templates["sems-site"][0],
    //         ^ Template<"sems-site"> — pairing r.id with templates["fema-flood-zone"][0] does not compile
  }));
  return { sources, sections: [{ source: "sems", total: semsAll.length, placements, truncated: semsAll.length > 5 }] };
}
```

### Renderer, one sentence

```ts
// lib/templates/sems.ts
export const semsSiteSummary = defineTemplate("sems-site", "sems-site/summary@1", (f) => [
  sentence`${f.semsName}, ${km(f.distanceMeters)}.`,
  sentence`${f.nplStatus}.`,
  sentence`Status: ${f.nonNplStatus}, as of ${fallback(f.statusDate, "Date unavailable")}.`,
]);
// f.zoneCode           -> compile error: not a field of SemsSiteRecord
// sentence`No data.`   -> compile error: a clause needs at least one field reference
// sentence`${"VALERO"}`-> compile error: string is not a SlotRef

// at request time
const sentence = render(store, placement);   // Sentence | null (null when the record is gone or every clause is empty)
// sentence.spans ===
// [ { text: "VALERO PLUME", slot: { field: "semsName", display: "text" } },
//   { text: ", ", slot: null },
//   { text: "0.76 km", slot: { field: "distanceMeters", display: "distance-km" } },
//   { text: ". ", slot: null },
//   { text: "Not on the NPL", slot: { field: "nplStatus", display: "text" } }, ... ]
```

### Trace panel reading it back

```ts
// app/report/[id]/trace-panel.tsx — click on span index 2 ("0.76 km")
const t = trace(store, sentence, 2);
// t.record.sourceRecordId === "TXN000622182"; t.record.sourceUrl -> cumulis; t.record.payloads[1].sha256, retrievedAt
// t.clicked.field === "distanceMeters"; t.clicked.displayed === "0.76 km"; t.clicked.normalized === 755
// t.clicked.provenance[0] ===
//   { kind: "computation", formula: "haversine", adapterVersion: "sems@1",
//     inputs: [ { name: "from.latitude",  value: 29.720659, provenance: [census coordinates.y ...] },
//               { name: "from.longitude", value: -95.261996, provenance: [...] },
//               { name: "to.latitude",    value: 29.722274,  provenance: [{ kind:"field", dataset:"frs_program_facility", sourceField:"LATITUDE83", rawValue: 29.722274, transform:"identity", ... }] },
//               { name: "to.longitude",   value: -95.254401, provenance: [...] } ] }
// t.values -> every Sourced field of the record, so the panel also lists
//   frsName  { sourceField: "PRIMARY_NAME", rawValue: "HOUSTON REFINERY" }  next to
//   semsName { sourceField: "name", dataset: "envirofacts_site", rawValue: "VALERO PLUME" }
//   sourceUpdatedAt { sourceField: "UPDATE_DATE", rawValue: 1710413511000, transform: "parse-epoch-ms" } -> "2024-03-14T10:51:51Z"
```

The panel never receives a copy of provenance. It receives `{recordId, field}`
and reads the current record. Delete the record from the store and both
`render` and `trace` return `null` for it.

---

## 2. The types

```ts
// ───────────── lib/evidence/sourced.ts ─────────────
import type { z } from "zod";

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [k: string]: JsonValue };
export type AdapterVersion = `${string}@${number}`;
export type TransformName =
  | "identity" | "parse-number" | "normalize-date" | "parse-epoch-ms" | "map-boolean" | "join-fields";
export type Formula = "haversine" | "coalesce" | "normalize-distance" | "normalize-unit" | "normalize-pollutant";

export type PayloadRef = {
  readonly url: string;            // query string with coordinates only; never an address
  readonly sha256: string;         // of the exact response bytes
  readonly retrievedAt: string;    // ISO-8601, stamped by SourceIo at fetch time
};

export type FieldProvenance = {
  readonly kind: "field";
  readonly dataset: string;        // "frs_program_facility" | "envirofacts_site" | ...
  readonly sourceField: string;    // the raw key, captured from the reader call
  readonly rawValue: JsonValue;
  readonly transform: TransformName;
  readonly adapterVersion: AdapterVersion;
  readonly payload: PayloadRef;
};
export type QueryProvenance = {   // value came from the request we made, not the response (AQS param=88101 -> "PM2.5", FEMA dataset)
  readonly kind: "query";
  readonly parameter: string;
  readonly value: JsonValue;
  readonly adapterVersion: AdapterVersion;
  readonly payload: PayloadRef;
};
export type ComputationProvenance = {
  readonly kind: "computation";
  readonly formula: Formula;
  readonly adapterVersion: AdapterVersion;
  readonly inputs: readonly { readonly name: string; readonly value: JsonValue; readonly provenance: readonly Provenance[] }[];
};
export type Provenance = FieldProvenance | QueryProvenance | ComputationProvenance;

declare const sourcedBrand: unique symbol;   // NOT exported: no module can build a Sourced literal
export type Sourced<T> = {
  readonly value: T;
  readonly provenance: readonly [Provenance, ...Provenance[]];
  readonly [sourcedBrand]: true;
};

export type GeoPoint = {
  readonly latitude: Sourced<number>;
  readonly longitude: Sourced<number>;
  readonly accuracyMeters: Sourced<number | null>;
  readonly collectionMethod: Sourced<string | null>;
  readonly referencePoint: Sourced<string | null>;
};

export type Fetched<Raw> = { readonly raw: Raw; readonly payload: PayloadRef };

type KeysWhere<Raw, T> = { [P in keyof Raw & string]: Raw[P] extends T ? P : never }[keyof Raw & string];
type Nullable<Field, Out> = null extends Field ? Out | null : Out;

export type FieldReader<Raw extends object> = {
  readonly raw: Raw;
  text<P extends KeysWhere<Raw, string | null>>(field: P): Sourced<Raw[P]>;                          // identity
  number<P extends KeysWhere<Raw, string | number | null>>(field: P): Sourced<Nullable<Raw[P], number>>; // parse-number
  date<P extends KeysWhere<Raw, string | null>>(field: P): Sourced<Nullable<Raw[P], string>>;         // normalize-date
  epochMs<P extends KeysWhere<Raw, number | null>>(field: P): Sourced<Nullable<Raw[P], string>>;      // parse-epoch-ms
  flag<P extends KeysWhere<Raw, string | null>>(field: P, map: Readonly<Record<string, boolean>>): Sourced<boolean | null>; // map-boolean; unmapped -> null, raw kept
  join<P extends KeysWhere<Raw, string | null>>(fields: readonly [P, ...P[]], separator: string): Sourced<string | null>; // join-fields, one provenance per field
  absent(field: string): Sourced<null>;                                                             // records that a field is not in this dataset
  point<La extends KeysWhere<Raw, string | number | null>, Lo extends KeysWhere<Raw, string | number | null>>(
    lat: La, lng: Lo,
    extras: { accuracy?: KeysWhere<Raw, number | null>; method?: KeysWhere<Raw, string | null>; referencePoint?: KeysWhere<Raw, string | null> },
  ): GeoPoint | null;                                                                                 // null if either coordinate is null
};

export function fieldsOf<Raw extends object>(fetched: Fetched<Raw>, dataset: string, adapterVersion: AdapterVersion): FieldReader<Raw> { throw new Error("not implemented"); }
export function haversine(from: GeoPoint, to: GeoPoint): Sourced<number> { throw new Error("not implemented"); }   // meters; both coordinates in provenance
export function coalesce<A, B>(first: Sourced<A> | null, second: Sourced<B>): Sourced<NonNullable<A> | B> { throw new Error("not implemented"); }
export function fromQuery<T extends JsonValue>(q: QueryProvenance, value: T): Sourced<T> { throw new Error("not implemented"); }
export function isSourced(x: unknown): x is Sourced<unknown> { throw new Error("not implemented"); }

declare const sealedBrand: unique symbol;
export type Sealed<R> = R & { readonly [sealedBrand]: true };
/** Deep-freezes; throws if any {value, provenance} shaped property lacks the brand (a hand-built lookalike). */
export function seal<R extends { readonly kind: string }>(record: R): Sealed<R> { throw new Error("not implemented"); }

// ───────────── lib/evidence/records.ts ─────────────
import type { Sourced, GeoPoint, PayloadRef, Sealed } from "./sourced";

export type SourceId = "census" | "echo" | "frs" | "sems" | "aqs" | "airnow" | "fema";
export type Kind = EvidenceRecord["kind"];

declare const idBrand: unique symbol;
export type RecordId<K extends Kind = Kind> = string & { readonly [idBrand]: K };
export function recordId<K extends Kind>(kind: K, sourceRecordId: string): RecordId<K> { throw new Error("not implemented"); }

export type EvidenceBase<K extends string, S extends SourceId> = {
  readonly kind: K;
  readonly source: S;
  readonly id: RecordId<K & Kind>;
  readonly sourceRecordId: string;
  readonly sourceUrl: string;
  readonly subject: Sourced<string>;
  readonly location: GeoPoint | null;
  readonly distanceMeters: Sourced<number> | null;   // only haversine can make one
  readonly effectiveAt: Sourced<string | null>;
  readonly sourceUpdatedAt: Sourced<string | null>;
  readonly payloads: readonly [PayloadRef, ...PayloadRef[]];   // replaces B4 retrievedAt + rawPayloadHash: a record may come from two payloads
  readonly caveats: readonly string[];
};

export type SemsSiteRecord = EvidenceBase<"sems-site", "sems"> & {
  readonly epaSiteId: Sourced<string>;
  readonly semsSiteId: Sourced<string | null> | null;
  readonly frsRegistryId: Sourced<string | null>;
  readonly frsName: Sourced<string>;
  readonly semsName: Sourced<string | null> | null;
  readonly interestType: Sourced<string>;
  readonly nplStatus: Sourced<string | null>;
  readonly nonNplStatus: Sourced<string | null> | null;
  readonly statusDate: Sourced<string | null> | null;
  readonly archived: Sourced<boolean | null> | null;
  readonly semsCoordinate: GeoPoint | null;
};
export type FemaFloodZoneRecord = EvidenceBase<"fema-flood-zone", "fema"> & {
  readonly dataset: Sourced<"NFHL" | "ESRI_REDUCED_SET">;        // fromQuery
  readonly zoneCode: Sourced<string>;
  readonly zoneSubtype: Sourced<string | null>;
  readonly specialFloodHazardArea: Sourced<boolean | null>;
  readonly firmPanelId: Sourced<string | null>;
  readonly floodAreaId: Sourced<string | null>;
  readonly sourceCitation: Sourced<string | null>;
};
// EchoFacilityRecord, EchoComplianceRecord, EchoEnforcementRecord, FrsFacilityRecord,
// AqsMonitorSummaryRecord, AirNowObservationRecord: as B4, with EvidenceBase<K, S>.
export type EvidenceRecord = SemsSiteRecord | FemaFloodZoneRecord /* | ...the rest of B4 */;
export type RecordOf<K extends Kind> = Extract<EvidenceRecord, { readonly kind: K }>;

export type GeocodeMatch = {   // not an EvidenceRecord: it holds the address and never reaches adapters
  readonly matchedAddress: Sourced<string>;
  readonly point: GeoPoint;
  readonly addressRange: Sourced<{ readonly from: string; readonly to: string }>;
  readonly tigerLineId: Sourced<string>;
  readonly streetSide: Sourced<string>;
  readonly candidateCount: number;
  readonly payload: PayloadRef;
};

export type EvidenceStore = {
  get<K extends Kind>(id: RecordId<K>): Sealed<RecordOf<K>> | undefined;
  ofKind<K extends Kind>(kind: K): readonly Sealed<RecordOf<K>>[];
  without(id: RecordId): EvidenceStore;          // the only "delete": returns a new store
  readonly size: number;
};

// ───────────── lib/evidence/source.ts ─────────────
import type { z } from "zod";
import type { GeoPoint, Fetched, Sealed, QueryProvenance, AdapterVersion } from "./sourced";
import type { Kind, RecordOf, SourceId, EvidenceStore } from "./records";

export type Locus = { readonly point: GeoPoint; readonly radiusMeters: number };   // no address, structurally

export type SourceFailure = {
  readonly reason: "timeout" | "refused" | "rate-limited" | "http" | "malformed";
  readonly httpStatus?: number;
  readonly retryAfterSeconds?: number;
  readonly schemaIssue?: string;      // Zod path only; never the body
};
export type SourceOutcome<K extends Kind = Kind> =
  | { readonly status: "answered"; readonly records: readonly Sealed<RecordOf<K>>[]; readonly queried: readonly QueryProvenance[]; readonly retrievedAt: string }
  | { readonly status: "failed"; readonly failure: SourceFailure };
// "no matching records" is answered + records.length === 0; the FEMA no-polygon sentence reads `queried` for the dataset.

export type SourceIo = {
  get<Raw>(url: URL, schema: z.ZodType<Raw>): Promise<Fetched<Raw>>;   // fetch, hash, stamp, parse; throws SourceFailure on timeout/malformed/http
  query(parameter: string, value: string | number, adapterVersion: AdapterVersion): QueryProvenance;
};
export type Adapter<K extends Kind> = {
  readonly source: RecordOf<K>["source"];
  readonly version: AdapterVersion;
  run(locus: Locus, io: SourceIo): Promise<readonly Sealed<RecordOf<K>>[]>;   // may throw; runSources contains it
};
export type SourcePolicy = { readonly timeoutMs: number; readonly retries: number };
export type SourceMap = { readonly [S in SourceId]: SourceOutcome };

export function runSources(
  locus: Locus,
  adapters: { readonly [S in Exclude<SourceId, "census">]: Adapter<Kind> },   // census is the geocoder, not an adapter
  io: SourceIo,
  policies?: Partial<Record<SourceId, SourcePolicy>>,
): Promise<SourceMap> { throw new Error("not implemented"); }   // allSettled; never rejects
export function storeOf(sources: SourceMap): EvidenceStore { throw new Error("not implemented"); }

// ───────────── lib/evidence/templates.ts ─────────────
import type { Sourced } from "./sourced";
import type { Kind, RecordOf } from "./records";

export type DisplayFormat = "text" | "distance-km" | "date" | "count" | "usd" | "aqi";

type SourcedKeys<R> = { [P in keyof R & string]: R[P] extends Sourced<unknown> | null ? P : never }[keyof R & string];
type SlotValue<R, P extends keyof R> = R[P] extends Sourced<infer V> | null ? V : never;

declare const refBrand: unique symbol;
export type SlotRef<R, P extends SourcedKeys<R>> = {
  readonly [refBrand]: R;             // phantom: ties the ref to its record type
  readonly field: P;
  readonly display: DisplayFormat;
  readonly fallback: string | null;   // rendered when the value is null; the span still points at the null provenance
};
export type FieldRefs<R> = { readonly [P in SourcedKeys<R>]: SlotRef<R, P> };

export type Clause<R> = {
  readonly strings: readonly string[];                                              // connective text only
  readonly refs: readonly [SlotRef<R, SourcedKeys<R>>, ...SlotRef<R, SourcedKeys<R>>[]];   // at least one
};
declare const templateIdBrand: unique symbol;
export type TemplateId<K extends Kind> = string & { readonly [templateIdBrand]: K };
export type Template<K extends Kind> = {
  readonly id: TemplateId<K>;
  readonly kind: K;
  readonly clauses: readonly [Clause<RecordOf<K>>, ...Clause<RecordOf<K>>[]];
};
export type TemplateRegistry = { readonly [K in Kind]: readonly [Template<K>, ...Template<K>[]] };   // every kind has an allowlist

export function sentence<R>(
  strings: TemplateStringsArray,
  ...refs: [SlotRef<R, SourcedKeys<R>>, ...SlotRef<R, SourcedKeys<R>>[]]
): Clause<R> { throw new Error("not implemented"); }
export function fallback<R, P extends SourcedKeys<R>>(ref: SlotRef<R, P>, text: string): SlotRef<R, P> { throw new Error("not implemented"); }
type NumericKeys<R> = { [P in SourcedKeys<R>]: SlotValue<R, P> extends number | null ? P : never }[SourcedKeys<R>];
export function km<R, P extends NumericKeys<R>>(ref: SlotRef<R, P>): SlotRef<R, P> { throw new Error("not implemented"); }
export function defineTemplate<K extends Kind>(
  kind: K,
  id: string,
  build: (f: FieldRefs<RecordOf<K>>) => readonly [Clause<RecordOf<K>>, ...Clause<RecordOf<K>>[]],
): Template<K> { throw new Error("not implemented"); }

// ───────────── lib/evidence/sentence.ts ─────────────
import type { JsonValue, Provenance, PayloadRef } from "./sourced";
import type { Kind, RecordId, SourceId, EvidenceStore } from "./records";
import type { Template, DisplayFormat } from "./templates";

export type Placement = { [K in Kind]: { readonly recordId: RecordId<K>; readonly template: Template<K> } }[Kind];

export type Span = {
  readonly text: string;
  readonly slot: { readonly field: string; readonly display: DisplayFormat } | null;   // null: connective text from the template
};
export type Sentence = {
  readonly recordId: RecordId;
  readonly templateId: string;
  readonly spans: readonly [Span, ...Span[]];   // constructor guarantees at least one span has a slot
};
export type ReportPlan = {
  readonly sources: { readonly [S in SourceId]: import("./source").SourceOutcome };
  readonly sections: readonly { readonly source: SourceId; readonly total: number; readonly placements: readonly Placement[]; readonly truncated: boolean }[];
};

export type ValueTrace = {
  readonly field: string;
  readonly displayed: string | null;          // as shown, after DisplayFormat; null if not on screen
  readonly normalized: JsonValue;
  readonly provenance: readonly Provenance[];
};
export type Trace = {
  readonly record: {
    readonly kind: Kind; readonly source: SourceId; readonly agency: string;
    readonly sourceRecordId: string; readonly sourceUrl: string;
    readonly payloads: readonly PayloadRef[]; readonly caveats: readonly string[];
    readonly effectiveAt: ValueTrace; readonly sourceUpdatedAt: ValueTrace;
  };
  readonly clicked: ValueTrace;
  readonly values: readonly ValueTrace[];      // every Sourced field on the record, found by brand at runtime
};

/** Reads the record from the store now. Returns null if the record is absent or every clause dropped. */
export function render(store: EvidenceStore, placement: Placement): Sentence | null { throw new Error("not implemented"); }
export function renderPlan(store: EvidenceStore, plan: ReportPlan): readonly Sentence[] { throw new Error("not implemented"); }
export function trace(store: EvidenceStore, sentence: Sentence, spanIndex: number): Trace | null { throw new Error("not implemented"); }
/** Re-renders and compares span by span; false if any text is not derivable from the current record. */
export function verify(store: EvidenceStore, sentence: Sentence, registry: TemplateRegistry): boolean { throw new Error("not implemented"); }
```

---

## 3. Mechanisms

**1. Provenance-carrying value.** `Sourced<T>` carries an unexported `unique
symbol` brand and a non-empty provenance tuple, and is only produced by
`fieldsOf` readers, `haversine`, `coalesce`, `fromQuery`. An object literal
cannot satisfy the type, so a provenance-less value fails to compile; `seal`
deep-freezes and rejects any `{value, provenance}` lookalike lacking the brand
at runtime, so an `as` cast fails the first test that seals it.

**2. Adapter without hand-written provenance.** `fieldsOf(fetched, dataset,
version)` binds one reader to one Zod-validated payload; each method call
(`text`, `date`, `epochMs`, `flag`, `join`, `point`) takes a `keyof Raw`
constrained to the right raw type, and captures the key name, raw value,
transform name, adapter version, and payload hash/timestamp itself. The adapter
body is field-to-field assignment; the mismatch between an ArcGIS epoch and an
Envirofacts date string is the choice of reader method, checked against the
raw key's type. Two-source records use two readers; both names survive because
they are two fields.

**3. Kind-bound templates.** Templates are built against `FieldRefs<RecordOf<K>>`,
a mapped type over the `Sourced` keys of that one kind, so `f.zoneCode` on a
`sems-site` template does not compile. `TemplateRegistry` is `{[K in Kind]:
Template<K>[]}` and `Placement` is a distributive union pairing `RecordId<K>`
with `Template<K>`, so a wrong-kind placement does not compile either. `render`
re-checks `template.kind === record.kind` for casts, covered by test.

**4. A rendered sentence.** A `Sentence` is spans of connective text and
`{field, display}` references, with no provenance copied in; `render` and
`trace` read the record from the store at call time. A `Clause` needs at least
one ref by tuple type, a clause whose refs are all null is dropped, a template
literal cannot interpolate a string. Text is therefore a pure function of the
store: removing a record from the store makes `render` return `null` and
`verify` reject any stale sentence.

**5. Outcomes.** `SourceOutcome` is `answered | failed`; `runSources` runs
adapters under `allSettled` with per-source timeouts and converts any throw into
`failed` with a `SourceFailure` that has no field for a body or coordinate.
`SourceMap` is a mapped type over `SourceId`, so a report that omits a source's
status does not compile, and the selection reads outcomes, never promises.

---

## 4. Two things this shape makes hard

1. **Templates cannot branch or compute.** A template is a static list of field
   references. "NPL sites get their own sentence", "Meaning not mapped" for
   unknown statuses, and every per-record variation must be either a second
   template chosen by selection, or a computed `Sourced` attached to the record
   by the adapter (`coalesce`, a glossary formula). Template count and adapter
   field count grow instead; the template language stays trivial on purpose.

2. **Every raw shape must be fully typed in Zod, and the guarantees stop at an
   `as` cast.** Readers only accept `keyof Raw`, so a field is unreadable until
   it is in the schema; ArcGIS layers with forty attributes need explicit
   subsets, nested raw objects need a second `fieldsOf` on the sub-object, and
   the `point`/`join` readers are the only multi-key entry points. The brand
   trick is defeated by `as unknown as Sourced<string>`; the honest guard is an
   ESLint `no-restricted-syntax` rule banning type assertions in `lib/evidence`
   and `lib/adapters`, plus the `seal` runtime check. That rule is policy, not
   type theory.

---

## 5. The test that would catch a violation

| Violation | Test |
|---|---|
| Wrong-kind template | `tests/unit/templates.types.test.ts`: `// @ts-expect-error` on `defineTemplate("sems-site", ..., (f) => [sentence\`${f.zoneCode}\`])` and on `{ recordId: semsId, template: femaTemplate } satisfies Placement`; `tsc` fails if either line ever compiles. Runtime: `render(store, { recordId: semsId, template: femaTemplate as never })` throws `KindMismatch`. |
| Value mutated after validation | `tests/unit/sems.adapter.test.ts`: record from `arcgis-5mi-houston` + `envirofacts-TXN000622182`; `expect(() => { (rec.nplStatus as { value: string }).value = "x" }).toThrow(TypeError)` (frozen, ESM strict); `// @ts-expect-error` on the same assignment without cast (readonly). Then `expect(render(...).spans[4].text).toBe("Not on the NPL")` from a fresh store. |
| Record deleted, text remains | `tests/unit/sentence.test.ts`: `s = render(store, p)`; `store2 = store.without(p.recordId)`; `expect(render(store2, p)).toBeNull()`; `expect(renderPlan(store2, plan).map(x => x.spans.map(y => y.text).join(""))).not.toContain("VALERO PLUME")`; `expect(verify(store2, s, registry)).toBe(false)`; `expect(trace(store2, s, 0)).toBeNull()`. |
| Sentence with no provenance | `// @ts-expect-error` on `sentence\`No data.\`` and on `sentence\`${"VALERO"}\``; runtime: `seal({...rec, semsName: { value: "VALERO", provenance: [] }})` throws `UnbrandedValue`; property test: for every `Sentence` from every fixture through every registry template, `spans.some(s => s.slot !== null)` and every slot resolves via `trace` to `provenance.length >= 1`. |
