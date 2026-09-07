# arm-b — the evidence kernel: reading a field *is* citing it

**Central idea.** An adapter never writes provenance, because provenance is a
byproduct of field access: every raw payload is handed to the adapter as a
typed cursor, and every terminal read (`.text()`, `.epochMs()`, `.sqlDate()`)
returns a `Sourced<T>` that already knows the field path it came from, the raw
value at that path, the transform whose name is the method's name, the adapter
version, the retrieval time and the payload hash. A `Sourced<T>` cannot be
written by hand — it carries a module-private brand — so the only way to get a
value into a record is to read it from a source, and the only way to get text
onto the screen is to interpolate one into a clause.

Everything else follows from that: sentences are arrays of spans where each
non-prose span carries the citation it was built from, so the trace panel is a
property lookup rather than a join; and the report stores records only, never
sentences, so a deleted record has nowhere to leave text behind.

---

## 1. Usage first

### 1a. The SEMS adapter (both fixtures, one record)

```ts
// lib/sources/sems/adapter.ts   — server-only
import { z } from "zod";
import { defineAdapter, noData, either } from "@/lib/kernel";

const FrsLayer = z.object({
  features: z.array(z.object({
    attributes: z.object({
      REGISTRY_ID: z.string(),
      PRIMARY_NAME: z.string(),
      LATITUDE83: z.number().nullable(),
      LONGITUDE83: z.number().nullable(),
      ACCURACY_VALUE: z.number().nullable(),
      COLLECT_MTH_DESC: z.string().nullable(),
      REF_POINT_DESC: z.string().nullable(),
      UPDATE_DATE: z.number().nullable(),
      FAC_URL: z.string(),
      PGM_SYS_ID: z.string(),
      PGM_SYS_ACRNM: z.string(),
      INTEREST_TYPE: z.string(),
    }),
  })),
});

const EnvirofactsSite = z.array(z.object({
  site_id: z.string(),
  name: z.string(),
  epa_id: z.string(),
  npl_status_name: z.string(),
  non_npl_status_name: z.string().nullable(),
  non_npl_status_date: z.string().nullable(),
  archived_ind: z.string().nullable(),
  primary_latitude_decimal_val: z.number().nullable(),
  primary_longitude_decimal_val: z.number().nullable(),
}));

export const semsAdapter = defineAdapter({
  source: "sems",
  kind: "sems-site",
  version: 1,
  parts: { frs: FrsLayer, envirofacts_site: EnvirofactsSite },
  caveats: [
    "A SEMS record can mean assessment, proposed action, active cleanup, or completed work.",
    "The coordinate is a reference point, not a boundary.",
  ],

  // Plain code over validated data. `.value` reads through the cursor for
  // control flow; the cursor keeps the path so provenance stays exact.
  async fetch(q, io) {
    const frs = await io.get("frs", arcgisNearbyUrl(q.point, 5), { timeoutMs: 6_000 });
    const sites = frs.features.list()
      .filter((f) => f.attributes.PGM_SYS_ACRNM.value === "SEMS");
    if (sites.length === 0) return noData("No SEMS site within the stated boundary.");

    return Promise.all(sites.map(async (f) => {
      const ef = await io.get(
        "envirofacts_site",
        envirofactsUrl(f.attributes.PGM_SYS_ID.value),
        { timeoutMs: 6_000 },
      );
      return { frs: f, sems: ef.at(0) };
    }));
  },

  // The whole adapter's provenance surface. No Provenance literal anywhere.
  build: (b) => ({
    epaSiteId:    b.frs.attributes.PGM_SYS_ID.text(),
    semsSiteId:   b.sems.site_id.text(),
    frsRegistryId:b.frs.attributes.REGISTRY_ID.text(),
    frsName:      b.frs.attributes.PRIMARY_NAME.text(),
    semsName:     b.sems.name.text(),
    subject:      either(b.sems.name.text(), b.frs.attributes.PRIMARY_NAME.text()),
    interestType: b.frs.attributes.INTEREST_TYPE.text(),
    nplStatus:    b.sems.npl_status_name.text(),
    nonNplStatus: b.sems.non_npl_status_name.text(),
    statusDate:   b.sems.non_npl_status_date.sqlDate(),
    archived:     b.sems.archived_ind.yn(),
    effectiveAt:  b.sems.non_npl_status_date.sqlDate(),
    sourceUpdatedAt: b.frs.attributes.UPDATE_DATE.epochMs(),
    sourceRecordId:  b.frs.attributes.PGM_SYS_ID.text(),
    sourceUrl:    b.frs.attributes.FAC_URL.text(),
    location: {
      latitude:         b.frs.attributes.LATITUDE83.num(),
      longitude:        b.frs.attributes.LONGITUDE83.num(),
      accuracyMeters:   b.frs.attributes.ACCURACY_VALUE.num(),
      collectionMethod: b.frs.attributes.COLLECT_MTH_DESC.text(),
      referencePoint:   b.frs.attributes.REF_POINT_DESC.text(),
    },
    semsCoordinate: {
      latitude:         b.sems.primary_latitude_decimal_val.num(),
      longitude:        b.sems.primary_longitude_decimal_val.num(),
      accuracyMeters:   nullCell, collectionMethod: nullCell, referencePoint: nullCell,
    },
  }),
});
```

`id`, `retrievedAt`, `rawPayloadHash`, `distanceMeters`, `kind` and `source`
are not in that object and cannot be: `Built<R>` omits them. The kernel fills
them, which is why a distance can never be read from a source.

### 1b. Run the sources, select

```ts
// app/api/report/route.ts
const outcomes = await runSources(SOURCES, { point: confirmed.point, signal });
const report   = assembleReport({ origin: confirmed, outcomes });

report.sources.sems;       // { status: "ok", records: [...] }  — or no-data / unavailable
report.sections[0];        // { id: "sems", order: [all ids, sorted], previewCount: 5 }
```

`SOURCES` is `{ sems: semsAdapter, fema: femaAdapter, ... } satisfies
SourceTable` — a mapped type over every `SourceId`, so forgetting a source is a
compile error, and `report.sources` therefore has a row for every source
whatever happened at runtime. A section carries an **ordering over every
record**, never a subset; "up to five" is `order.slice(0, previewCount)` at
paint. Omission is not expressible.

### 1c. Render one sentence

```ts
// lib/sources/sems/sentences.ts
export const semsSentences = sentencesFor<SemsSiteRecord>({
  primary: (r, w) => w.sentence(
    w.clause`${r.semsName}, ${w.km(r.distanceMeters)}`,
    w.clause`${r.nplStatus}`,
    w.clause`Status: ${r.nonNplStatus}, as of ${r.statusDate}`,
  ),
  npl: (r, w) => w.sentence(w.clause`${r.subject} is on the National Priorities List`),
});

// lib/render/registry.ts  — the only place kinds and templates meet
export const SENTENCES = {
  "sems-site": semsSentences,
  "fema-flood-zone": femaSentences,
  // ...one entry per kind; a missing kind is a compile error
} satisfies SentenceRegistry;
```

```ts
// in the server component
const text = renderReport(report);            // ReadonlyMap<RecordId, readonly Sentence[]>
const s = text.get(valeroId)![0]!;
s.spans.map((x) => x.text).join("");
// "VALERO PLUME, 0.76 km. Not on the NPL. Status: Removal Only Site
//  (No Site Assessment Work Needed), as of 2022-02-08."
```

Clause 3 disappears entirely — not just its slot — when
`non_npl_status_name` is null, because a clause containing a null cell returns
`null` and `w.sentence` drops it.

### 1d. The trace panel reads it back

```tsx
function Sentence({ sentence, report }: { sentence: Sentence; report: Report }) {
  return <p>{sentence.spans.map((span, i) =>
    span.kind === "prose"
      ? <span key={i}>{span.text}</span>
      : <button key={i} onClick={() => setTrace(traceOf(span.cite, report))}>{span.text}</button>
  )}</p>;
}
```

```ts
traceOf(span.cite, report);
// {
//   agency: "EPA Superfund Enterprise Management System", recordKind: "sems-site",
//   recordIds: ["TXN000622182", "0622182", "110000460885"],
//   sourceUrl: "https://ofmpub.epa.gov/...p_registry_id=110000460885",
//   displayed: "VALERO PLUME",
//   normalized: "VALERO PLUME",
//   rows: [{ fieldLabel: "envirofacts_site.name", sourceField: "envirofacts_site[0].name",
//            rawValue: "VALERO PLUME", transform: "identity", adapterVersion: "sems@1",
//            retrievedAt: "2026-09-15T18:02:11Z", payloadSha256: "…" },
//          { fieldLabel: "frs.attributes.PRIMARY_NAME", rawValue: "HOUSTON REFINERY",
//            transform: "identity", adapterVersion: "sems@1", … }],
//   caveats: [...],
// }
```

Both names reach the panel because `either()` keeps the provenance of every
candidate it considered, not only the one it returned.

---

## 2. The types

```ts
// lib/kernel/cell.ts
declare const CELL: unique symbol;               // not exported: Sourced is unforgeable

export type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

export type Transform =
  | "identity" | "parse-number" | "normalize-date" | "parse-epoch-ms"
  | "normalize-distance" | "normalize-unit" | "normalize-pollutant"
  | "join-fields" | "map-boolean" | "haversine" | "first-present";

export type Provenance = {
  readonly sourceField: string;      // "envirofacts_site[0].name" — machine-exact path
  readonly fieldLabel: string;       // "envirofacts_site.name"    — indices stripped, for display
  readonly rawValue: JsonValue;
  readonly transform: Transform;
  readonly adapterVersion: string;   // "sems@1"
  readonly retrievedAt: string;      // stamp of the part this cell came from
  readonly payloadSha256: string;    // hash of that part's exact bytes
};

export type Sourced<T> = {
  readonly value: T;
  readonly provenance: readonly Provenance[];
  readonly [CELL]: "kernel";
};

export declare const nullCell: Sourced<null>;

/** The only way to build a Sourced from computation. Provenance unions the inputs. */
export declare function derive<const A extends readonly Sourced<unknown>[], U>(
  transform: Transform,
  inputs: A,
  fn: (...values: { [I in keyof A]: A[I] extends Sourced<infer V> ? V : never }) => U,
): Sourced<U>;

/** First non-null value; keeps every candidate's provenance. */
export declare function either<T>(...cells: readonly Sourced<T | null>[]): Sourced<T | null>;
```

```ts
// lib/kernel/cursor.ts — the typed, path-recording view of a validated payload
type Nullable<T, X> = null extends T ? X | null : X;

type Reads<T> =
  & (NonNullable<T> extends string
      ? { text(): Sourced<Nullable<T, string>>;
          num(): Sourced<Nullable<T, number>>;          // parse-number
          sqlDate(): Sourced<Nullable<T, string>>;      // "2022-02-08 00:00:00" -> "2022-02-08"
          yn(): Sourced<Nullable<T, boolean>>;          // "Y"/"N" -> map-boolean
          unit(): Sourced<Nullable<T, string>>;
          pollutant(): Sourced<Nullable<T, "PM2.5" | "Ozone">> }
      : unknown)
  & (NonNullable<T> extends number
      ? { num(): Sourced<Nullable<T, number>>;
          epochMs(): Sourced<Nullable<T, string>> }     // 1710413511000 -> "2024-03-14T10:51:51Z"
      : unknown)
  & (NonNullable<T> extends boolean ? { flag(): Sourced<Nullable<T, boolean>> } : unknown);

export type Cursor<T> =
  & { readonly value: T }
  & Reads<T>
  & (NonNullable<T> extends readonly (infer E)[]
      ? { at(i: number): Cursor<E>; list(): readonly Cursor<E>[] }
      : NonNullable<T> extends object
        ? { readonly [K in keyof NonNullable<T>]-?: Cursor<NonNullable<T>[K]> }
        : unknown);
```

```ts
// lib/kernel/adapter.ts
export type SourceId = "census" | "echo" | "frs" | "sems" | "aqs" | "airnow" | "fema";
export type RecordKind = EvidenceRecord["kind"];
export type RecordOfKind<K extends RecordKind> = Extract<EvidenceRecord, { kind: K }>;
export type RecordId = string & { readonly __recordId: unique symbol };

/** Machine-filled. Absent from what an adapter returns, so it cannot be forged. */
type Machine = "id" | "kind" | "source" | "retrievedAt" | "rawPayloadHash" | "distanceMeters";
export type Built<R extends EvidenceRecord> = Omit<R, Machine>;

declare const NO_DATA: unique symbol;
export type NoData = { readonly reason: string; readonly [NO_DATA]: true };
export declare function noData(reason: string): NoData;

export type SourceQuery = { readonly point: { lat: number; lon: number } };

export type SourceIo<P extends Record<string, z.ZodType>> = {
  get<K extends keyof P & string>(
    part: K, url: string, opts: { timeoutMs: number },
  ): Promise<Cursor<z.output<P[K]>>>;
};

export type SourceFailure = {
  readonly cause: "timeout" | "transport" | "http-status" | "malformed" | "rate-limited";
  readonly httpStatus: number | null;
  readonly retryAfterSeconds: number | null;
  readonly detail: string;          // never contains address or coordinates
};

export type SourceOutcome =
  | { readonly status: "ok"; readonly records: readonly EvidenceRecord[] }
  | { readonly status: "no-data"; readonly reason: string }
  | { readonly status: "unavailable"; readonly failure: SourceFailure };

export type Adapter<S extends SourceId> = {
  readonly source: S;
  readonly adapterVersion: string;
  run(q: SourceQuery, signal: AbortSignal): Promise<SourceOutcome>;   // never throws
};

export declare function defineAdapter<
  S extends SourceId, K extends RecordKind, P extends Record<string, z.ZodType>, B,
>(spec: {
  readonly source: S;
  readonly kind: K;
  readonly version: number;
  readonly parts: P;
  readonly caveats: readonly string[];
  fetch(q: SourceQuery, io: SourceIo<P>): Promise<readonly B[] | NoData>;
  build(bundle: B): Built<RecordOfKind<K>>;
}): Adapter<S>;

export type SourceTable = { readonly [S in SourceId]: Adapter<S> };
export declare function runSources(
  table: SourceTable, q: SourceQuery & { signal: AbortSignal },
): Promise<{ readonly [S in SourceId]: SourceOutcome }>;
```

```ts
// lib/kernel/report.ts
export type Section = {
  readonly id: string;
  readonly title: string;
  readonly order: readonly RecordId[];   // EVERY record of the section, ordered
  readonly previewCount: number;
};

export type Report = {
  readonly origin: GeocodeMatch;
  readonly records: ReadonlyMap<RecordId, EvidenceRecord>;
  readonly sources: { readonly [S in SourceId]: SourceOutcome };
  readonly sections: readonly Section[];
};                                        // note: no field anywhere holds a Sentence

export declare function assembleReport(input: {
  origin: GeocodeMatch;
  outcomes: { readonly [S in SourceId]: SourceOutcome };
}): Report;
```

```ts
// lib/kernel/sentence.ts
export type Citation = {
  readonly recordId: RecordId;
  readonly displayed: string;                     // exactly the span's text
  readonly normalized: JsonValue;                 // the cell's value
  readonly provenance: readonly Provenance[];
};

export type Span =
  | { readonly kind: "prose"; readonly text: string }
  | { readonly kind: "value"; readonly text: string; readonly cite: Citation };

export type Sentence = { readonly recordId: RecordId; readonly slot: string; readonly spans: readonly Span[] };
declare const CLAUSE: unique symbol;
export type Clause = { readonly spans: readonly Span[]; readonly [CLAUSE]: true };

type Displayable = string | number | boolean;
type Slot = Sourced<Displayable | null>;          // a bare string here is a type error

export type Writer = {
  clause(strings: TemplateStringsArray, ...slots: readonly Slot[]): Clause | null;
  sentence(...clauses: readonly (Clause | null)[]): Sentence;
  km(cell: Sourced<number | null>): Sourced<string | null>;      // display formatter, keeps provenance
  count(cell: Sourced<number>): Sourced<string>;
};

export type Template<R extends EvidenceRecord> = (record: R, w: Writer) => Sentence;
export type SentenceSet<R extends EvidenceRecord> = {
  readonly primary: Template<R>;
  readonly [slot: string]: Template<R>;           // property syntax: checked contravariantly
};
export declare function sentencesFor<R extends EvidenceRecord>(set: SentenceSet<R>): SentenceSet<R>;

export type SentenceRegistry = { readonly [K in RecordKind]: SentenceSet<RecordOfKind<K>> };

export declare function renderReport(report: Report): ReadonlyMap<RecordId, readonly Sentence[]>;
export declare function traceOf(cite: Citation, report: Report): TracePanel;

export type TracePanel = {
  readonly agency: string; readonly recordKind: RecordKind;
  readonly recordIds: readonly string[]; readonly sourceUrl: string;
  readonly displayed: string; readonly normalized: JsonValue;
  readonly rows: readonly Provenance[];
  readonly caveats: readonly string[];
};
```

---

## 3. The five mechanisms

**1. Representing and constructing a provenance-carrying value.** `Sourced<T>`
carries a `unique symbol` property whose symbol is declared but never exported,
so no code outside `lib/kernel` can write an object that satisfies the type —
not with a literal, not with a cast that survives review. The only producers are
the cursor's terminal readers, `derive`, `either`, and the kernel's own
`haversine`. Every cell is `Object.freeze`d at construction, so a value cannot
be edited after validation. The guarantee holds because forging the type is a
compile error and mutating the value is a runtime throw.

**2. An adapter turning bytes into records without hand-written provenance.**
`io.get(part, url)` validates bytes with that part's Zod schema, stamps
`retrievedAt` and the SHA-256, and returns a **cursor**: a proxy typed as a
recursive mapped type over the schema's output, where each node remembers the
path taken to reach it. A terminal reader supplies the remaining three
provenance fields — the field path and raw value from the node, the transform
from the method's own name, the adapter version from `defineAdapter`. There is
exactly one transform per method, so the recorded transform cannot disagree with
the applied one. The whole ceremony per field is one method call, which is
*shorter* than writing the value out longhand, and a typo in a field name is a
compile error rather than an `undefined`. Writing `b.sems.name.value` instead of
`b.sems.name.text()` yields a `string`, which the record field (`Sourced<string>`)
rejects — the failure mode is a type error at the exact line, not silent data.

**3. Binding a kind to its templates.** `SentenceRegistry` is a mapped type over
`RecordKind`, so the registry object is exhaustive or it does not compile, and
each value's type is `SentenceSet<RecordOfKind<K>>`. Because a template is a
function *property* whose record type sits in parameter position,
`strictFunctionTypes` checks it contravariantly: assigning `femaSentences` under
`"sems-site"` fails at the registry, which is the only file where a kind and a
template are ever named together. Callers never name a template — `renderReport`
dispatches on `record.kind` — so "used the wrong template" has no call site to
happen at. One internal lookup in `renderReport` needs an `as never`; it is
guarded by a runtime kind assertion and by test 1 below.

**4. What a rendered sentence is.** A `Sentence` is `{ recordId, slot, spans }`
and a span is either literal prose from the template's string chunks or a value
span carrying a `Citation` — the record id, the displayed text, the normalized
value, and the provenance array of the cell it came from. The trace panel is
`span.cite`; there is no index, no id-matching, nothing to fall out of sync. A
span's `text` is computed from `cite.normalized` at render time, so the two
cannot diverge. And sentences are never stored: `Report` has no field of type
`Sentence`, `renderReport` is a pure function of the record map called at paint,
so removing a record from the map removes its text by construction — there is no
cached copy to go stale.

**5. Failure, no-data, success.** `runSources` calls each adapter with its own
timeout and never lets one await another; `Adapter.run` is typed to return
`Promise<SourceOutcome>` and the kernel wraps the adapter body so that a throw,
an abort, a non-2xx, or a Zod failure becomes
`{ status: "unavailable", failure }` with the cause classified by the kernel
from what actually happened — an adapter cannot invent a cause. `no-data` is
returned by the adapter through `noData(reason)`, whose branded type means the
reason is authored copy, not a guess about why. The outcome map is a mapped type
over `SourceId`, so every source has a visible row in every report. Unknown
status codes survive because there is no mapping step to get wrong: statuses are
read with `.text()` into `Sourced<string>` and rendered verbatim; mapping one
would require writing a lookup table, which is conspicuous extra work in review.

---

## 4. Two things this shape makes hard

**`derive` is a hole the kernel cannot see into.** Anything that is not a direct
field read — joining two fields, building `programInterests` as an array, a unit
conversion — goes through `derive(transform, inputs, fn)`. The kernel checks
that the inputs are real cells and unions their provenance, but it cannot check
that the lambda did what the transform name claims. `derive("join-fields", [a,
b], () => "Superfund site")` produces a fully cited lie. Array-valued fields make
this worse: `Sourced<Array<{...}>>` has provenance for the array, not per
element, so a trace row for the third program interest is not reachable. The
mitigation is review discipline plus a lint rule bounding `derive` bodies, which
is weaker than every other guarantee here. Secondary cost of the same mechanism:
`Cursor<T>` is a recursive conditional mapped type, which makes editor feedback
sluggish on the larger ArcGIS schemas and produces unpleasant error text when a
field name is wrong.

**A sentence about more than one record has no home.** The kernel's unit is
one record, one sentence, one `recordId` on the span — that is precisely what
makes deletion provable. But B6 grouping ("two SEMS EPA IDs under one registry
ID") and B7 counts ("ECHO and SEMS counts before records", "3 of 12 within one
mile") are statements about a *set*. Under this design they need either a
synthetic aggregate record whose cells are `derive`d from the members — inheriting
the hole above and putting a fabricated record into the record map — or a second
rendering path for counts that does not go through `Sentence` and therefore is
not covered by the deletion test. I would take the synthetic record and label its
kind `"derived-group"` so it is visible in the map, but it is a real weakening: a
record that no source returned now exists in the structure that claims every
record came from a source.

---

## 5. The tests that catch a violation

**Wrong-kind template.** Type-level, in `tests/types/registry.test-d.ts`:
```ts
// @ts-expect-error femaSentences is SentenceSet<FemaFloodZoneRecord>
const bad = { ...SENTENCES, "sems-site": femaSentences } satisfies SentenceRegistry;
```
plus a runtime test that drives the one unsound dispatch line directly —
`renderWithSet(semsFixtureRecord, femaSentences)` must throw
`KindMismatch("sems-site", "fema-flood-zone")` rather than render. The type test
fails the build if `strictFunctionTypes` contravariance ever stops applying
(e.g. someone rewrites the template slot as a method shorthand); the runtime test
covers the `as never`.

**A value mutated after validation.** Two layers.
`expect(() => { (rec.semsName as { value: string }).value = "X"; }).toThrow(TypeError)`
— frozen cells throw in module strict mode. And a property test over every
fixture record: for every value span produced by `renderReport`,
`span.text === format(span.cite.normalized)` and
`span.cite.normalized === cellAt(report, span.cite).value`. A mutation that got
past the freeze still cannot make a span whose text disagrees with the cell it
claims, because the text is derived from it at paint.

**A record deleted but its text remaining.** Structural plus behavioural.
Type-level: `expectTypeOf<Extract<Report[keyof Report], Sentence>>().toBeNever()`
and a lint rule forbidding `Sentence` in any persisted or cached type, so there
is nowhere to stash one. Behavioural: render the full fixture report, drop the
VALERO PLUME record from `report.records`, re-render, and assert (a) no span
anywhere carries that `recordId`, and (b) the concatenated text of the whole
report does not contain `"VALERO PLUME"` or `"Removal Only Site"`. The second
assertion catches the failure the first would miss — text copied into a section
header or a count label.

**A sentence rendered with no provenance.** Type-level:
```ts
// @ts-expect-error a bare string is not a Slot
w.clause`${"VALERO PLUME"}, ${w.km(r.distanceMeters)}`;
```
Runtime, over every fixture record and every registered slot: every span of kind
`"value"` has `cite.provenance.length > 0`, and every span of kind `"prose"` has
text belonging to `ALLOWED_PROSE` — a snapshot set built by statically reading
the string chunks of every template in the registry. Any prose that is not a
reviewed literal chunk, and any factual-looking text that arrived without a
cell, fails. The same run asserts no span text matches `/\b(safe|unsafe|dangerous|clean)\b/i`,
which is the C2 rule enforced in the same pass.
