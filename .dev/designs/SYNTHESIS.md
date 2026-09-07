# Kernel synthesis decision

Base: **arm A**. Grafts from arm B, arm C, and the claim census. The full type
sketch to build against is `.dev/designs/arm-a.md` section 2, amended by the
five grafts below. Where this file and arm A disagree, this file wins.

## Why arm A is the base

It is the only arm where the product rule is enforced by the compiler rather
than by review.

- `sentence\`No data.\`` does not compile. A clause needs at least one field
  reference, so a factual sentence with no provenance cannot be written.
- `sentence\`${"VALERO PLUME"}\`` does not compile. A string is not a slot
  reference, so text cannot be interpolated past the provenance system.
- A template built for one record kind cannot name a field of another kind.
- The trace panel never receives a copy of provenance. It receives a record ID
  and a field name and reads the live store, so a deleted record makes both the
  sentence and its trace return nothing.
- Computation provenance recurses. The distance carries its four input
  coordinates, and each input carries its own provenance, so "0.76 km" traces
  to the two source coordinates *and* to the Census match behind the origin.
  Arms B and C both flattened this and could not have rendered the brief's own
  trace-panel example in section A3.

## Graft 1: the subject of a claim is not always a record

From the census in `.dev/census/`. Six of twenty-six required claims are about
a single record. Arm A's `Placement` pairs a `RecordId<K>` with a
`Template<K>`, which cannot express the other twenty.

`Placement` becomes a union over subject scope. A template declares the scope
it renders and the field references resolve against that subject:

- `origin`, the Census match. Block range, street side, candidate count.
- `source`, one source outcome. Status, retrieval time, why it is unavailable.
- `section`, one source's records within a boundary. **A count is the length of
  the ordering, never a number written down**, so removing a record lowers it.
  A section claim's provenance is the query: endpoint, boundary, retrieval time,
  and the IDs of the records counted.
- `record`, arm A's existing case, unchanged.
- `group`, several records the B6 rules tied together. Two EPA IDs under one
  registry ID, two names for one site, two coordinates that disagree.

Arm C established why this is safe to widen. The deletion guarantee comes from
rendering being a pure read of the store, not from record-scoping. Arm B
assumed record-scoping was doing that work and so treated widening as a threat.

A count hung on a synthetic record would be the only row in this codebase that
no agency returned. That is the exact thing the product promises never to do.

## Graft 2: three source outcomes, not two

From arm C. Arm A's `answered | failed` cannot express the brief's B10
requirement that "No matching records within the stated boundary" and "Source
unavailable" are different states that look different on screen.

```
SourceOutcome =
  | { status: "ok"; records: readonly [Sealed<R>, ...Sealed<R>[]] }
  | { status: "no-data"; note: string }
  | { status: "unavailable"; cause: FailureCause; rawCode: JsonValue | null; retryAfter: string | null }
```

The success tag carries a non-empty collection, so zero records cannot
masquerade as success. `rawCode` is whatever the source said, never mapped into
our vocabulary.

## Graft 3: the adapter cannot write a distance

From arm B's `Built<R>`. Arm A has the adapter call `haversine` and assign the
result, which leaves `distanceMeters: someOtherSourcedNumber` compiling fine.

The type an adapter returns omits `distanceMeters`, `id`, and `payloads`. The
kernel fills all three. The brief requires that distances are computed and
never read from a source, and this makes that unbreakable rather than observed.

## Graft 4: payloads are plural

Arm A caught a real error in `docs/BRIEF.md` B4. One SEMS record is built from
two responses, the ArcGIS layer and the Envirofacts join, so a single
`retrievedAt` and `rawPayloadHash` per record cannot be honest.

A record carries `payloads: readonly [PayloadRef, ...PayloadRef[]]` and every
field's provenance names the payload it came from. The trace panel then shows a
retrieval time and hash per displayed value rather than per record. Update the
brief to match.

## Graft 5: the brand needs a lint rule

Arm A is right that `as unknown as Sourced<T>` defeats the brand and that this
is policy, not type theory. Ban type assertions under `lib/evidence/` and
`lib/adapters/` with an ESLint rule, and add a test that the rule is on. A
guarantee with a documented bypass and no enforcement is not a guarantee.

## What each arm contributed

| Arm | Model | Contribution |
|---|---|---|
| A | fable | Base. Field-reference templates, recursive computation provenance, the payloads correction |
| B | opus | `Built<R>` omission, and the aggregate gap that started the census |
| C | sonnet | Purity as the real deletion mechanism, three-tag outcomes, non-empty success |
