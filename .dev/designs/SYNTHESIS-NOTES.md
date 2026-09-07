# Synthesis notes, kept while the arms run

## Open finding: aggregate sentences

Arm B's shape binds one sentence to one record, which is what makes the
deletion guarantee provable. It then correctly notices that the report's most
important sentence is not about a record at all:

> EPA's Superfund inventory lists **15 sites within 5 miles** of the mapped
> point.

Arm B offers two ways out and dislikes both: a synthetic record no source
returned, or a second rendering path the deletion test does not cover.

There is a third. Give a sentence two possible scopes, record and section.
A section sentence takes the section, not a record, and the count it prints is
`order.length` rather than a number anyone wrote down. That keeps the deletion
guarantee for free, because removing a record shortens `order` and the count
follows. It also gives the trace panel something honest and clickable for a
count: the query boundary, the endpoint, the retrieval time, and the list of
record IDs that make up the number.

A count is evidence about a query, so its citation should describe the query.
Inventing a record to hang it on would be the one place in this codebase where
we fabricate a row that no agency returned, which is exactly what the product
promises never to do.

## What to carry forward from arm B regardless of which arm wins

- `Built<R>` omitting kernel-filled fields, so `distanceMeters` cannot be read
  from a source even by accident.
- `either()` keeping the provenance of every candidate it considered, which is
  how both the FRS name and the SEMS name reach the trace panel.
- A section holding an ordering over every record, with "first five" applied at
  paint. Omission is then not expressible.
- The source table as a mapped type over every source ID, so the report has a
  row per source whatever happened at runtime.

## The premise both arms shared, and why it fails

Arm B and arm C reached the same wall from opposite directions. Arm B is
type-first, arm C is data-first, and both reported the same cost: facts that
span more than one record have no home. Two independent failures at one gate
is evidence about the premise, not about the designs.

The premise, written down:

> A factual sentence is about one record, so provenance and rendering can be
> scoped to one record.

The census in `.dev/census/` counts every claim the report is required to
render, taken from the brief's Part A screens and its B6, B7, and B10 rules,
and classifies each by what the claim is actually about. Rerun it with
`node .dev/census/census.mjs`.

```
section    8  31%
record     6  23%
source     5  19%
group      5  19%
origin     2   8%
```

Six of twenty-six. The premise is false for roughly three quarters of the
report. Both arms built the 23% case well and bolted on the rest.

## What replaces it

The domain object is a **claim**, and a claim names its subject. The subject is
a closed union, not always a record:

- `origin`, the geocode match. The block range, the street side, the precision.
- `source`, one source's outcome. Status, retrieval time, why it is unavailable.
- `section`, one source's records inside a boundary. Counts live here, and a
  count is `order.length`, never a number anyone wrote down.
- `record`, one agency record. What arms B and C already handle.
- `group`, several records the grouping rules tied together. Two EPA IDs under
  one registry ID, two names for one site, two coordinates that disagree.

Arm C supplies the reason this generalizes safely. It observed that the
deletion guarantee comes from rendering being a pure function of the report
currently held, with nothing cached, rather than from record-scoping. Arm B
believed record-scoping was what made the guarantee hold, which is why it saw
generalizing as a threat. Once purity is the mechanism, the subject can widen
to all five scopes and the guarantee is untouched. Removing a record shortens
the ordering, the count falls, and the sentence changes on the next paint.

A count traced back to its query is honest evidence. A count hung on a
synthetic record would be the one row in this codebase that no agency returned.

## Carried forward from arm C

- `SourceResult` with three tags, where the success tag carries a non-empty
  collection, so zero records cannot masquerade as success.
- The raw source error code preserved as-is, never mapped to our vocabulary.
- Rendering as a pure map over the held records, no cache anywhere.
