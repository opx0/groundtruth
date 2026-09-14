/**
 * A3's table, computed. One `SentenceViewMessage` plus the index of the span
 * the reader clicked becomes the rows of screen 4, with no rendering involved,
 * so what the panel shows is a value a test can assert on.
 *
 * WHY THIS FILE EXISTS AT ALL. `docs/BRIEF.md` A3 is a table of eleven rows and
 * it was written over one Superfund site -- a `record`-scoped sentence. The wire
 * has four scopes, and 33 of the 48 sentences a report carries are not record
 * scoped. The rows A3 names exist on one arm of `SentenceTraceSchema` and not on
 * the others, so "build A3's table" is a question about three scopes A3 never
 * looked at. Answering it in the component would hide the answer inside JSX.
 *
 * WHAT EACH SCOPE PUTS IN A3'S ROWS.
 *
 * `record` fills every row: the agency and kind, the record's identifiers, the
 * agency's own page, the value rows, the record date, the source-update date,
 * the payloads, and the caveats.
 *
 * `section` is a count claim, and a count is not about a record. Its header
 * carries the agency, the kind counted, the boundary, and -- this is the
 * substitute for A3's "Record IDs" row -- `counted`, every record the count
 * counted, by kind and source record ID, in the ordering's own order. Click
 * "15" and you get the fifteen identities behind the 15. There is no record
 * page, no record date, no source-update date and no caveat on this scope,
 * because there is no one record for them to belong to. `SectionTrace.query` is
 * null on every section this route builds, so the boundary string is the whole
 * of what stands behind "5 miles".
 *
 * `source` is a claim about our own request, not about an agency's record. Its
 * header carries the agency, the status enum, the retrieval time, and -- when
 * the source could not be reached -- the failure cause, the raw code the source
 * sent, and any retry time. No record, no payload, no caveat.
 *
 * `group` names records that share an identifier. Its header carries the
 * members by kind and source record ID and the field they were grouped on, and
 * nothing else: no agency string, no record page, no caveats. Its values, alone
 * among the three non-record scopes, do carry provenance -- they are read off a
 * member record -- so the payloads and adapter versions in the Retrieved row are
 * recovered from the provenance rather than from a header.
 *
 * `absentRows` is that finding as data. It says which of A3's rows a scope
 * cannot fill, and the panel omits what it cannot fill rather than printing a
 * component-written excuse for it.
 *
 * THE 27 SPANS WITH AN EMPTY `provenance`. Every `source` span (14) and every
 * `section` span (13) of the Houston report resolves to a value whose
 * provenance array is empty: `sectionSubject` and `sourceSubject` in
 * `lib/evidence/sentence.ts` build their slots with `reported(value, query)`,
 * and `query` is null on every section this route builds. Their grounding is the
 * scope header, which is why the header rows here are built first and
 * unconditionally, and why a panel that rendered only `values[].provenance`
 * would show an empty citation on 27 of the report's 172 slotted spans.
 *
 * NOTHING HERE WRITES A SENTENCE. Every string in a row is a string from the
 * wire: a field name, a raw value, a dataset, an agency, an enum as sent. The
 * row names are keys, not prose; `app/components/trace-panel.tsx` owns the
 * labels a reader sees and they are chrome in the sense `.dev/briefs` uses --
 * none of them can become wrong because a government record changed.
 */

import type { JsonValue } from "@/lib/evidence";
import type { SentenceViewMessage, WirePayloadRef, WireProvenance, WireSentenceTrace } from "@/app/lib/report-contract";

/* -------------------------------------------------------------------------- */
/* What the wire gives us, named                                              */
/* -------------------------------------------------------------------------- */

type RecordArm = Extract<WireSentenceTrace, { readonly scope: "record" }>;
type SectionArm = Extract<WireSentenceTrace, { readonly scope: "section" }>;
type SourceArm = Extract<WireSentenceTrace, { readonly scope: "source" }>;
type GroupArm = Extract<WireSentenceTrace, { readonly scope: "group" }>;

/**
 * `app/lib/report-contract.ts` exports the schemas but not these three types,
 * and that file is not ours to edit, so they are read back off the arms they
 * appear on. A change to either shape is still a compile error here.
 */
export type WireRecordId = SectionArm["section"]["counted"][number];
export type WireValueTrace = RecordArm["values"][number];
export type WireQueryProvenance = NonNullable<SectionArm["section"]["query"]>;

export type TraceScope = WireSentenceTrace["scope"];
export type TraceSpan = SentenceViewMessage["spans"][number];

/* -------------------------------------------------------------------------- */
/* The rows                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Where a value sits relative to the click. `clicked` is the span the reader
 * opened; `displayed` is another span of the same sentence; `context` is a
 * value on the subject that this sentence does not show -- the reference point
 * and the accuracy value of A3's distance row are both of these.
 */
export type ValuePresence = "clicked" | "displayed" | "context";

export type TraceValueRow = {
	readonly field: string;
	readonly displayed: string | null;
	readonly normalized: JsonValue;
	readonly provenance: readonly WireProvenance[];
	readonly presence: ValuePresence;
};

/** One identifier, labelled by the wire's own word for it: a record kind, or the field the identifier was read from. */
export type TraceIdentifier = { readonly label: string; readonly value: string };

/** Which identities the `record-ids` row is listing. The panel picks its label from this; the values are the wire's. */
export type IdentifierRelation = "this-record" | "counted" | "grouped";

export type TraceRow =
	| { readonly row: "agency-and-kind"; readonly agency: string | null; readonly recordKind: string | null; readonly source: string | null }
	| { readonly row: "record-ids"; readonly relation: IdentifierRelation; readonly ids: readonly TraceIdentifier[] }
	| { readonly row: "original-record"; readonly value: TraceValueRow }
	| { readonly row: "boundary"; readonly boundary: string; readonly query: WireQueryProvenance | null }
	| {
			readonly row: "outcome";
			readonly status: string;
			readonly cause: string | null;
			readonly rawCode: JsonValue;
			readonly retryAfter: string | null;
	  }
	| { readonly row: "grouped-by"; readonly field: string }
	| { readonly row: "value"; readonly value: TraceValueRow }
	| { readonly row: "record-date"; readonly value: TraceValueRow }
	| { readonly row: "source-updated"; readonly value: TraceValueRow }
	| {
			readonly row: "retrieved";
			readonly at: readonly string[];
			readonly payloads: readonly WirePayloadRef[];
			readonly adapters: readonly string[];
	  }
	| { readonly row: "caveats"; readonly caveats: readonly string[] };

export type TraceRowName = TraceRow["row"];

export type TracePanelView = {
	readonly scope: TraceScope;
	readonly templateId: string;
	readonly spans: readonly TraceSpan[];
	/** The span the reader clicked, or null when the sentence arrived without a trace. */
	readonly clickedSpan: number | null;
	readonly clickedField: string | null;
	readonly rows: readonly TraceRow[];
	/** A3 rows this scope cannot fill. A property of the scope, not of this one trace. */
	readonly absentRows: readonly TraceRowName[];
};

/**
 * A3's eleven rows reduced to the seven that are header rows -- the four value
 * rows of A3 are `value` rows, one per displayed value, and every scope has
 * them. `record-date` is not in A3's table; `docs/BRIEF.md` B8 requires it
 * ("record date, source-update date, retrieval date") and A3's own sentence
 * shows it as "as of 2022-02-08".
 */
const A3_HEADER_ROWS: readonly TraceRowName[] = [
	"agency-and-kind",
	"record-ids",
	"original-record",
	"record-date",
	"source-updated",
	"retrieved",
	"caveats",
];

/** What each scope's arm can fill, from the wire types alone. Not a fact about any one trace. */
const CARRIED_BY_SCOPE: { readonly [S in TraceScope]: readonly TraceRowName[] } = {
	record: ["agency-and-kind", "record-ids", "original-record", "record-date", "source-updated", "retrieved", "caveats"],
	section: ["agency-and-kind", "record-ids", "boundary", "retrieved"],
	source: ["agency-and-kind", "outcome", "retrieved"],
	group: ["record-ids", "grouped-by", "retrieved"],
};

export function absentRowsFor(scope: TraceScope): readonly TraceRowName[] {
	const carried = CARRIED_BY_SCOPE[scope];
	return A3_HEADER_ROWS.filter((row) => !carried.includes(row));
}

/* -------------------------------------------------------------------------- */
/* Small readers                                                              */
/* -------------------------------------------------------------------------- */

function lastSegment(field: string): string {
	const parts = field.split(".");
	return parts[parts.length - 1] ?? field;
}

/**
 * A top-level leaf whose name ends in `Id` and whose value is a string: the
 * three identifiers of A3's "Record IDs" row are exactly these -- `epaSiteId`,
 * `semsSiteId`, `frsRegistryId`. Nested paths are left out on purpose: FRS
 * registry 110000460885 carries 38 programme-interest rows, each with its own
 * `programInterests.N.programId`, and listing all 38 under "Record IDs" would
 * bury the registry ID that names the record. They are still on screen, as
 * context value rows.
 */
function isIdentifierField(field: string): boolean {
	return !field.includes(".") && lastSegment(field).endsWith("Id");
}

function identifiersFrom(values: readonly WireValueTrace[]): readonly TraceIdentifier[] {
	const out: TraceIdentifier[] = [];
	for (const value of values) {
		if (!isIdentifierField(value.field)) continue;
		if (typeof value.normalized !== "string" || value.normalized === "") continue;
		out.push({ label: value.field, value: value.normalized });
	}
	return out;
}

function identifiersOf(ids: readonly WireRecordId[]): readonly TraceIdentifier[] {
	return ids.map((id) => ({ label: id.kind, value: id.sourceRecordId }));
}

function withoutRepeats(ids: readonly TraceIdentifier[]): readonly TraceIdentifier[] {
	const seen = new Set<string>();
	return ids.filter((id) => {
		const key = JSON.stringify([id.label, id.value]);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/** Every provenance in a tree, computation inputs included, in the order they were reached. */
function flatProvenance(provenance: readonly WireProvenance[]): readonly WireProvenance[] {
	const out: WireProvenance[] = [];
	const walk = (entries: readonly WireProvenance[]): void => {
		for (const entry of entries) {
			out.push(entry);
			if (entry.kind === "computation") for (const input of entry.inputs) walk(input.provenance);
		}
	};
	walk(provenance);
	return out;
}

function distinct(values: readonly string[]): readonly string[] {
	return [...new Set(values)];
}

function payloadKey(payload: WirePayloadRef): string {
	return JSON.stringify([payload.url, payload.sha256, payload.retrievedAt]);
}

function distinctPayloads(payloads: readonly WirePayloadRef[]): readonly WirePayloadRef[] {
	const seen = new Set<string>();
	return payloads.filter((payload) => {
		const key = payloadKey(payload);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/* -------------------------------------------------------------------------- */
/* Value rows                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The values of a sentence, ordered the way a reader met them: the clicked one
 * first, then the rest of the sentence in the order its spans name them, then
 * every value on the subject the sentence did not show.
 */
function valueRows(
	values: readonly WireValueTrace[],
	spans: readonly TraceSpan[],
	clickedField: string | null,
	excluded: ReadonlySet<string>,
): readonly TraceValueRow[] {
	const kept = values.filter((value) => !excluded.has(value.field));
	const byField = new Map<string, WireValueTrace>();
	for (const value of kept) if (!byField.has(value.field)) byField.set(value.field, value);

	const ordered: WireValueTrace[] = [];
	const taken = new Set<string>();
	const take = (field: string | null): void => {
		if (field === null || taken.has(field)) return;
		const value = byField.get(field);
		if (value === undefined) return;
		taken.add(field);
		ordered.push(value);
	};

	take(clickedField);
	for (const span of spans) take(span.slot === null ? null : span.slot.field);
	for (const value of kept) take(value.field);

	return ordered.map((value) => ({
		field: value.field,
		displayed: value.displayed,
		normalized: value.normalized,
		provenance: value.provenance,
		presence: value.field === clickedField ? "clicked" : value.displayed === null ? "context" : "displayed",
	}));
}

/**
 * A value that has a row of A3's own rather than a `value` row. It still has to
 * know whether it is the value the reader clicked: `sourceUrl`, `effectiveAt`
 * and `sourceUpdatedAt` are slots a template can place, and the registry card's
 * update-date sentence does place one, so a click on it must mark that row and
 * not leave the panel with nothing highlighted.
 */
function asValueRow(value: WireValueTrace, clickedField: string | null): TraceValueRow {
	const presence: ValuePresence =
		value.field === clickedField ? "clicked" : value.displayed === null ? "context" : "displayed";
	return {
		field: value.field,
		displayed: value.displayed,
		normalized: value.normalized,
		provenance: value.provenance,
		presence,
	};
}

/**
 * The Retrieved row. A3 wants the retrieval time, the adapter and the SHA-256
 * of the response bytes; where they live differs by scope, and for `group` the
 * only place they live is inside the provenance of the values.
 */
function retrievedRow(
	payloads: readonly WirePayloadRef[],
	provenance: readonly WireProvenance[],
	extraTimes: readonly string[],
): TraceRow | null {
	const fromProvenance = flatProvenance(provenance);
	const allPayloads = distinctPayloads([
		...payloads,
		...fromProvenance.flatMap((entry) => (entry.kind === "computation" ? [] : [entry.payload])),
	]);
	const adapters = distinct(
		fromProvenance.flatMap((entry) => (entry.kind === "computation" ? [] : [entry.adapterVersion])),
	);
	const at = distinct([...extraTimes, ...allPayloads.map((payload) => payload.retrievedAt)]);
	if (at.length === 0 && allPayloads.length === 0 && adapters.length === 0) return null;
	return { row: "retrieved", at, payloads: allPayloads, adapters };
}

/* -------------------------------------------------------------------------- */
/* One scope at a time                                                        */
/* -------------------------------------------------------------------------- */

/** The three fields of a record trace that have a row of their own, so they are not repeated as value rows. */
const RECORD_HEADER_FIELDS: ReadonlySet<string> = new Set(["sourceUrl", "effectiveAt", "sourceUpdatedAt"]);

function recordRows(arm: RecordArm, spans: readonly TraceSpan[], clickedField: string | null): readonly TraceRow[] {
	const record = arm.record;
	// The record's own identifier first, labelled by the field it was read from
	// when one of the record's fields holds it -- `epaSiteId` says more than
	// `sems-site` -- and by the kind when no field does.
	const fromFields = withoutRepeats(identifiersFrom(arm.values));
	const named = fromFields.some((id) => id.value === record.sourceRecordId);
	const ids = named ? fromFields : [{ label: record.kind, value: record.sourceRecordId }, ...fromFields];
	const rows: TraceRow[] = [
		{ row: "agency-and-kind", agency: record.agency, recordKind: record.kind, source: record.source },
		{ row: "record-ids", relation: "this-record", ids },
		{ row: "original-record", value: asValueRow(record.sourceUrl, clickedField) },
	];
	for (const value of valueRows(arm.values, spans, clickedField, RECORD_HEADER_FIELDS)) {
		rows.push({ row: "value", value });
	}
	rows.push({ row: "record-date", value: asValueRow(record.effectiveAt, clickedField) });
	rows.push({ row: "source-updated", value: asValueRow(record.sourceUpdatedAt, clickedField) });
	const retrieved = retrievedRow(record.payloads, [
		...arm.values.flatMap((value) => value.provenance),
		...record.sourceUrl.provenance,
		...record.effectiveAt.provenance,
		...record.sourceUpdatedAt.provenance,
	], []);
	if (retrieved !== null) rows.push(retrieved);
	if (record.caveats.length > 0) rows.push({ row: "caveats", caveats: record.caveats });
	return rows;
}

function sectionRows(arm: SectionArm, spans: readonly TraceSpan[], clickedField: string | null): readonly TraceRow[] {
	const section = arm.section;
	const rows: TraceRow[] = [
		{ row: "agency-and-kind", agency: section.agency, recordKind: section.kind, source: section.source },
		{ row: "record-ids", relation: "counted", ids: identifiersOf(section.counted) },
		{ row: "boundary", boundary: section.boundary, query: section.query },
	];
	for (const value of valueRows(arm.values, spans, clickedField, new Set())) rows.push({ row: "value", value });
	const times = arm.values.flatMap((value) =>
		value.field === "retrievedAt" && typeof value.normalized === "string" ? [value.normalized] : [],
	);
	const query = section.query === null ? [] : [section.query];
	const retrieved = retrievedRow([], [...arm.values.flatMap((value) => value.provenance), ...query], times);
	if (retrieved !== null) rows.push(retrieved);
	return rows;
}

function sourceRows(arm: SourceArm, spans: readonly TraceSpan[], clickedField: string | null): readonly TraceRow[] {
	const source = arm.source;
	const rows: TraceRow[] = [
		{ row: "agency-and-kind", agency: source.agency, recordKind: null, source: source.source },
		{ row: "outcome", status: source.status, cause: source.cause, rawCode: source.rawCode, retryAfter: source.retryAfter },
	];
	for (const value of valueRows(arm.values, spans, clickedField, new Set())) rows.push({ row: "value", value });
	const retrieved = retrievedRow(
		[],
		arm.values.flatMap((value) => value.provenance),
		source.retrievedAt === null ? [] : [source.retrievedAt],
	);
	if (retrieved !== null) rows.push(retrieved);
	return rows;
}

function groupRows(arm: GroupArm, spans: readonly TraceSpan[], clickedField: string | null): readonly TraceRow[] {
	const group = arm.group;
	const rows: TraceRow[] = [{ row: "record-ids", relation: "grouped", ids: identifiersOf(group.members) }];
	if (group.groupedBy !== null) rows.push({ row: "grouped-by", field: group.groupedBy });
	for (const value of valueRows(arm.values, spans, clickedField, new Set())) rows.push({ row: "value", value });
	const retrieved = retrievedRow(
		[],
		arm.values.flatMap((value) => value.provenance),
		[],
	);
	if (retrieved !== null) rows.push(retrieved);
	return rows;
}

function rowsFor(trace: WireSentenceTrace, spans: readonly TraceSpan[], clickedField: string | null): readonly TraceRow[] {
	switch (trace.scope) {
		case "record":
			return recordRows(trace, spans, clickedField);
		case "section":
			return sectionRows(trace, spans, clickedField);
		case "source":
			return sourceRows(trace, spans, clickedField);
		case "group":
			return groupRows(trace, spans, clickedField);
	}
}

/* -------------------------------------------------------------------------- */
/* The entry point                                                            */
/* -------------------------------------------------------------------------- */

/**
 * What a click on `spans[spanIndex]` opens. Null when there is nothing to open:
 * the index is off the end, the span is the template's own connective text and
 * has no field behind it, or the sentence reached the browser with no trace --
 * which `lib/report/sentence-view.ts` produces only for a subject that has left
 * the store, and which this report has never yet emitted.
 */
export function traceView(sentence: SentenceViewMessage, spanIndex: number): TracePanelView | null {
	const span = sentence.spans[spanIndex];
	if (span === undefined || span.slot === null) return null;
	const trace = sentence.trace;
	if (trace === null) return null;
	const clickedField = span.slot.field;
	return {
		scope: trace.scope,
		templateId: sentence.templateId,
		spans: sentence.spans,
		clickedSpan: spanIndex,
		clickedField,
		rows: rowsFor(trace, sentence.spans, clickedField),
		absentRows: absentRowsFor(trace.scope),
	};
}

/** Every span index a reader can open: the ones that carry a slot. */
export function openableSpans(sentence: SentenceViewMessage): readonly number[] {
	return sentence.spans.flatMap((span, index) => (span.slot === null ? [] : [index]));
}
