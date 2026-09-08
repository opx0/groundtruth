/**
 * Rendered text and its trace.
 *
 * A `Sentence` is spans of connective text and `{field, display}` references.
 * It carries no values and no provenance. `render` and `trace` read the record
 * from the store at call time, so deleting the record makes both return null
 * and `verify` reject any sentence that was rendered before.
 */

import {
	AGENCY,
	type EvidenceStore,
	type Kind,
	type RecordId,
	type RecordOf,
	type SourceId,
} from "./records";
import { isSourced, type JsonValue, type PayloadRef, type Provenance, type Sealed, type Sourced } from "./sourced";
import type { AnyRef, DisplayFormat, Template } from "./templates";

/** Subject scopes from SYNTHESIS.md graft 1. This unit implements `record`; the others are added by their units. */
export type Placement = {
	[K in Kind]: {
		readonly scope: "record";
		readonly recordId: RecordId<K>;
		readonly template: Template<K>;
	};
}[Kind];

export type Span = {
	readonly text: string;
	/** null: connective text from the template. */
	readonly slot: { readonly field: string; readonly display: DisplayFormat } | null;
};

export type Sentence = {
	readonly recordId: RecordId;
	readonly templateId: string;
	readonly spans: readonly [Span, ...Span[]];
};

export type ValueTrace = {
	readonly field: string;
	/** As shown, after DisplayFormat; null if this value is not on screen in the sentence. */
	readonly displayed: string | null;
	readonly normalized: JsonValue;
	readonly provenance: readonly Provenance[];
};

export type Trace = {
	readonly record: {
		readonly kind: Kind;
		readonly source: SourceId;
		readonly agency: string;
		readonly sourceRecordId: string;
		readonly sourceUrl: string;
		readonly payloads: readonly PayloadRef[];
		readonly caveats: readonly string[];
		readonly effectiveAt: ValueTrace;
		readonly sourceUpdatedAt: ValueTrace;
	};
	readonly clicked: ValueTrace;
	/** Every Sourced field on the record, found by brand at runtime. Nested points appear as "location.latitude". */
	readonly values: readonly ValueTrace[];
};

export class KindMismatch extends Error {
	constructor(recordKind: string, templateKind: string) {
		super(`template for ${templateKind} cannot render a ${recordKind} record`);
		this.name = "KindMismatch";
	}
}

type Bag = Readonly<Record<string, unknown>>;

/** Any non-null object can be read by string key, yielding unknown. */
function isBag(x: unknown): x is Bag {
	return typeof x === "object" && x !== null;
}

/** The Sourced value at `field`, or null when the field is absent or holds no reader result. */
function sourcedAt(record: Bag, field: string): Sourced<unknown> | null {
	const v = record[field];
	return isSourced(v) ? v : null;
}

export function formatValue(value: unknown, display: DisplayFormat): string | null {
	if (value === null || value === undefined) return null;
	switch (display) {
		case "distance-km": {
			if (typeof value !== "number") return null;
			return `${(Math.round(value / 10) / 100).toFixed(2)} km`;
		}
		case "text": {
			if (typeof value === "string") return value;
			if (typeof value === "number" || typeof value === "boolean") return String(value);
			return null;
		}
	}
}

function spanFor(record: Bag, ref: AnyRef<Kind>): Span | null {
	const sourced = sourcedAt(record, ref.field);
	const shown = sourced === null ? null : formatValue(sourced.value, ref.display);
	const text = shown ?? ref.fallback;
	if (text === null) return null;
	return { text, slot: { field: ref.field, display: ref.display } };
}

/** All spans of one clause, or null when any reference has nothing to show: a missing field removes its clause. */
function clauseSpans(record: Bag, strings: readonly string[], refs: readonly AnyRef<Kind>[]): Span[] | null {
	const spans: Span[] = [];
	for (let i = 0; i < strings.length; i += 1) {
		const connective = strings[i];
		if (connective !== undefined && connective !== "") spans.push({ text: connective, slot: null });
		const ref = refs[i];
		if (ref === undefined) continue;
		const span = spanFor(record, ref);
		if (span === null) return null;
		spans.push(span);
	}
	return spans;
}

function renderRecord<K extends Kind>(
	store: EvidenceStore,
	recordId: RecordId<K>,
	template: Template<K>,
): Sentence | null {
	const record = store.get(recordId);
	if (record === undefined) return null;
	if (record.kind !== template.kind) throw new KindMismatch(record.kind, template.kind);
	const bag: Bag = record;
	const spans: Span[] = [];
	for (const clause of template.clauses) {
		const rendered = clauseSpans(bag, clause.strings, clause.refs);
		if (rendered === null) continue;
		if (spans.length > 0) spans.push({ text: " ", slot: null });
		spans.push(...rendered);
	}
	const [first, ...rest] = spans;
	if (first === undefined) return null;
	const nonEmpty: readonly [Span, ...Span[]] = [first, ...rest];
	return Object.freeze({ recordId, templateId: template.id, spans: Object.freeze(nonEmpty) });
}

/** Reads the record from the store now. Null if the record is absent or every clause dropped. */
export function render(store: EvidenceStore, placement: Placement): Sentence | null {
	return renderRecord(store, placement.recordId, placement.template);
}

export function renderAll(store: EvidenceStore, placements: readonly Placement[]): readonly Sentence[] {
	const out: Sentence[] = [];
	for (const placement of placements) {
		const sentence = render(store, placement);
		if (sentence !== null) out.push(sentence);
	}
	return out;
}

function toJson(value: unknown): JsonValue {
	if (value === null || value === undefined) return null;
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
	if (Array.isArray(value)) return value.map(toJson);
	if (isBag(value)) {
		const out: { [key: string]: JsonValue } = {};
		for (const key of Object.keys(value)) out[key] = toJson(value[key]);
		return out;
	}
	return null;
}

function valueTrace(field: string, sourced: Sourced<unknown>, displayed: string | null): ValueTrace {
	return { field, displayed, normalized: toJson(sourced.value), provenance: sourced.provenance };
}

/** Walks the record one level into non-Sourced objects (GeoPoint), naming nested values "location.latitude". */
function sourcedValues(record: Bag, shown: ReadonlyMap<string, string>): ValueTrace[] {
	const out: ValueTrace[] = [];
	const visit = (bag: Bag, prefix: string, depth: number): void => {
		for (const key of Object.keys(bag)) {
			const path = prefix === "" ? key : `${prefix}.${key}`;
			const v = bag[key];
			if (isSourced(v)) {
				out.push(valueTrace(path, v, shown.get(path) ?? null));
			} else if (depth < 1 && isBag(v) && !Array.isArray(v)) {
				visit(v, path, depth + 1);
			}
		}
	};
	visit(record, "", 0);
	return out;
}

function recordTrace<K extends Kind>(record: Sealed<RecordOf<K>>, shown: ReadonlyMap<string, string>): Trace["record"] {
	return {
		kind: record.kind,
		source: record.source,
		agency: AGENCY[record.source],
		sourceRecordId: record.sourceRecordId,
		sourceUrl: record.sourceUrl,
		payloads: record.payloads,
		caveats: record.caveats,
		effectiveAt: valueTrace("effectiveAt", record.effectiveAt, shown.get("effectiveAt") ?? null),
		sourceUpdatedAt: valueTrace("sourceUpdatedAt", record.sourceUpdatedAt, shown.get("sourceUpdatedAt") ?? null),
	};
}

/**
 * Explains the span at `spanIndex` from the live record. Null when the record
 * is gone, the index is out of range, or the span is connective text.
 */
export function trace(store: EvidenceStore, sentence: Sentence, spanIndex: number): Trace | null {
	const span = sentence.spans[spanIndex];
	if (span === undefined || span.slot === null) return null;
	const record = store.get(sentence.recordId);
	if (record === undefined) return null;
	const bag: Bag = record;
	const clicked = sourcedAt(bag, span.slot.field);
	if (clicked === null) return null;

	const shown = new Map<string, string>();
	for (const s of sentence.spans) if (s.slot !== null) shown.set(s.slot.field, s.text);

	return {
		record: recordTrace(record, shown),
		clicked: valueTrace(span.slot.field, clicked, span.text),
		values: sourcedValues(bag, shown),
	};
}

/** Re-renders from the current store and compares span by span. False if the text is not derivable now. */
export function verify(store: EvidenceStore, sentence: Sentence, templates: readonly Template<Kind>[]): boolean {
	const template = templates.find((t) => t.id === sentence.templateId && t.kind === sentence.recordId.kind);
	if (template === undefined) return false;
	const fresh = renderRecord(store, sentence.recordId, template);
	if (fresh === null || fresh.spans.length !== sentence.spans.length) return false;
	return fresh.spans.every((span, i) => {
		const was = sentence.spans[i];
		return (
			was !== undefined &&
			was.text === span.text &&
			(was.slot === null ? span.slot === null : span.slot !== null && was.slot.field === span.slot.field)
		);
	});
}
