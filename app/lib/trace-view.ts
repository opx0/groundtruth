import type { JsonValue } from "@/lib/evidence";
import type { SentenceViewMessage, WirePayloadRef, WireProvenance, WireSentenceTrace } from "@/app/lib/report-contract";

type RecordArm = Extract<WireSentenceTrace, { readonly scope: "record" }>;
type SectionArm = Extract<WireSentenceTrace, { readonly scope: "section" }>;
type SourceArm = Extract<WireSentenceTrace, { readonly scope: "source" }>;
type GroupArm = Extract<WireSentenceTrace, { readonly scope: "group" }>;

export type WireRecordId = SectionArm["section"]["counted"][number];
export type WireValueTrace = RecordArm["values"][number];
export type WireQueryProvenance = NonNullable<SectionArm["section"]["query"]>;

export type TraceScope = WireSentenceTrace["scope"];
export type TraceSpan = SentenceViewMessage["spans"][number];

export type ValuePresence = "clicked" | "displayed" | "context";

export type TraceValueRow = {
	readonly field: string;
	readonly displayed: string | null;
	readonly normalized: JsonValue;
	readonly provenance: readonly WireProvenance[];
	readonly presence: ValuePresence;
};

export type TraceIdentifier = { readonly label: string; readonly value: string };

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
	readonly clickedSpan: number | null;
	readonly clickedField: string | null;
	readonly rows: readonly TraceRow[];
	readonly absentRows: readonly TraceRowName[];
};

const A3_HEADER_ROWS: readonly TraceRowName[] = [
	"agency-and-kind",
	"record-ids",
	"original-record",
	"record-date",
	"source-updated",
	"retrieved",
	"caveats",
];

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

function lastSegment(field: string): string {
	const parts = field.split(".");
	return parts[parts.length - 1] ?? field;
}

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

const RECORD_HEADER_FIELDS: ReadonlySet<string> = new Set(["sourceUrl", "effectiveAt", "sourceUpdatedAt"]);

function recordRows(arm: RecordArm, spans: readonly TraceSpan[], clickedField: string | null): readonly TraceRow[] {
	const record = arm.record;
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

export function openableSpans(sentence: SentenceViewMessage): readonly number[] {
	return sentence.spans.flatMap((span, index) => (span.slot === null ? [] : [index]));
}
