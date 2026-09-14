/**
 * Rendered text and its trace.
 *
 * A `Sentence` is spans of connective text and `{field, display}` references.
 * It carries no values and no provenance. `render` and `trace` read the
 * subject from the store at call time, so deleting a record makes both return
 * null and `verify` reject any sentence that was rendered before.
 *
 * Nothing in this module caches. That, and not record-scoping, is what makes
 * the deletion guarantee hold (SYNTHESIS.md graft 1, arm C). It is why the
 * subject of a sentence can be wider than one record: a section's count is the
 * length of an ordering recomputed from the store on every render, so removing
 * a record lowers the count by itself. A count written down as a number could
 * drift away from the records behind it; the length of an ordering cannot. If
 * a scope ever seems to need a cache to work, the property is gone and the
 * design, not the cache, is what needs revisiting.
 */

import {
	AGENCY,
	KINDS,
	type EvidenceStore,
	type GeocodeMatch,
	type Kind,
	type RecordId,
	type RecordOf,
	type SourceId,
	type SourceOf,
} from "./records";
import type { FailureCause, SourceOutcome } from "./source";
import {
	isSourced,
	type JsonValue,
	type PayloadRef,
	type Provenance,
	type QueryProvenance,
	type Sealed,
	type Sourced,
} from "./sourced";
import type {
	AnyRef,
	DisplayFormat,
	Requirement,
	GroupSubject,
	OriginSubject,
	Reported,
	SectionSubject,
	SlotKeys,
	SourceSubject,
	SubjectKey,
	Template,
} from "./templates";

/* -------------------------------------------------------------------------- */
/* Subjects                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Which of a source's records a section counts. The field is a named slot of
 * the kind, so a filter cannot name a field the record does not have. There is
 * no free-form predicate: the rule that selects the ordering is data, visible
 * in the trace, not a closure.
 */
export type SectionFilter<F extends string = string> =
	| { readonly field: F; readonly equals: string | number | boolean | null }
	| { readonly field: F; readonly atLeast: number }
	/** The field holds a value rather than null. "Has a formal enforcement action on record" is this, and is not expressible as an equals or a threshold. */
	| { readonly field: F; readonly present: true };

/**
 * One source's records within its stated boundary, described well enough that
 * the ordering can be rebuilt from the store at any moment. It holds no
 * records and no count.
 *
 * `F` stays a plain string on the type so a `SectionSpec<"sems-site",
 * "frsActiveStatus">` flows into a `SectionSpec`, the same covariance trick
 * `SlotRef` uses. `defineSection` is what constrains it to a real slot.
 */
export type SectionSpec<K extends Kind = Kind, F extends string = string> = {
	readonly kind: K;
	readonly source: SourceOf<K>;
	/** How the boundary reads on screen, e.g. "5 miles". Its trace is the query that set it. */
	readonly boundary: string;
	/** The request behind the section: endpoint, boundary parameter, retrieval time. Null when no payload was kept. */
	readonly query: QueryProvenance | null;
	readonly retrievedAt: string | null;
	/** Null counts every record of the kind. */
	readonly filter: SectionFilter<F> | null;
	/**
	 * How many of the ordering the report actually carries, or null when it
	 * carries all of it. A report cannot ship a sentence and a trace for every
	 * one of the 1,686 facilities ECHO answers within five miles, so it carries
	 * a bounded head of the ordering -- and a bound the reader cannot see is a
	 * lie. This is what lets the section say how many it did not show, as a
	 * number recomputed from the store like the count beside it, never one the
	 * report wrote down.
	 */
	readonly carried: number | null;
	/** What the section says when the ordering is empty. */
	readonly note: string;
};

export function defineSection<K extends Kind, F extends SlotKeys<RecordOf<K>> = SlotKeys<RecordOf<K>>>(
	spec: SectionSpec<K, F>,
): SectionSpec<K, F> {
	return Object.freeze(spec);
}

/* -------------------------------------------------------------------------- */
/* Placements                                                                 */
/* -------------------------------------------------------------------------- */

/** Arm A's original case: one record, one template of that record's kind. */
export type RecordPlacement = {
	[K in Kind]: {
		readonly scope: "record";
		readonly recordId: RecordId<K>;
		readonly template: Template<K>;
	};
}[Kind];

export type SectionPlacement<K extends Kind = Kind, F extends string = string> = {
	readonly scope: "section";
	readonly section: SectionSpec<K, F>;
	readonly template: Template<"section">;
};

export type SourcePlacement = {
	readonly scope: "source";
	readonly source: SourceId;
	readonly outcome: SourceOutcome;
	readonly template: Template<"source">;
	/**
	 * What this outcome is about, when the source's own name is too coarse.
	 * FEMA is one `SourceId` and two datasets, and the flood card carries two
	 * outcomes: the authoritative layer that refused and the Esri copy that
	 * answered. Under `AGENCY.fema` both sentences read "FEMA National Flood
	 * Hazard Layer", so the card said the same named source both answered and
	 * could not be reached, in consecutive sentences. Null uses `AGENCY`.
	 *
	 * This names our own request, not a field any agency sent -- `agency` is a
	 * `Reported`, like `status` and `cause` beside it.
	 */
	readonly agency: string | null;
};

export type OriginPlacement = {
	readonly scope: "origin";
	readonly match: GeocodeMatch;
	readonly template: Template<"origin">;
};

/**
 * Records the grouping rules tied together. Members may be of different kinds,
 * because two of the B6 rules are about two sources disagreeing, so
 * `groupedBy` names a slot read from the lead member at render time and is
 * null when that member does not have it. Which records belong in a group, and
 * which slot ties them, is `lib/report/grouping.ts`'s decision and is wired in
 * a later unit; nothing here decides it.
 */
export type GroupPlacement<K extends Kind = Kind, F extends string = string> = {
	readonly scope: "group";
	readonly members: readonly [RecordId<K>, ...RecordId<K>[]];
	readonly groupedBy: F | null;
	readonly template: Template<"group">;
};

/** The five subject scopes of SYNTHESIS.md graft 1. */
export type Placement =
	| RecordPlacement
	| SectionPlacement
	| SourcePlacement
	| OriginPlacement
	| GroupPlacement;

/** What a sentence remembers about its subject: everything but the template, so a forged sentence cannot smuggle one in. */
export type SentenceSubject =
	| { readonly scope: "record"; readonly recordId: RecordId }
	| { readonly scope: "section"; readonly section: SectionSpec }
	| {
			readonly scope: "source";
			readonly source: SourceId;
			readonly outcome: SourceOutcome;
			readonly agency: string | null;
	  }
	| { readonly scope: "origin"; readonly match: GeocodeMatch }
	| {
			readonly scope: "group";
			readonly members: readonly [RecordId, ...RecordId[]];
			readonly groupedBy: string | null;
	  };

export type Span = {
	readonly text: string;
	/** null: connective text from the template. */
	readonly slot: { readonly field: string; readonly display: DisplayFormat } | null;
};

export type Sentence = {
	readonly subject: SentenceSubject;
	readonly templateId: string;
	readonly spans: readonly [Span, ...Span[]];
};

/* -------------------------------------------------------------------------- */
/* Traces                                                                     */
/* -------------------------------------------------------------------------- */

export type ValueTrace = {
	readonly field: string;
	/** As shown, after DisplayFormat; null if this value is not on screen in the sentence. */
	readonly displayed: string | null;
	readonly normalized: JsonValue;
	readonly provenance: readonly Provenance[];
};

export type RecordTrace = {
	readonly kind: Kind;
	readonly source: SourceId;
	readonly agency: string;
	readonly sourceRecordId: string;
	/** The agency link, with the identifier field and template that produced it. */
	readonly sourceUrl: ValueTrace;
	readonly payloads: readonly PayloadRef[];
	readonly caveats: readonly string[];
	readonly effectiveAt: ValueTrace;
	readonly sourceUpdatedAt: ValueTrace;
};

/**
 * What stands behind a section claim: the query we made, and the records
 * counted. `counted` is read from the store at trace time, in the ordering's
 * own order, so it always agrees with the count on screen.
 */
export type SectionTrace = {
	readonly kind: Kind;
	readonly source: SourceId;
	readonly agency: string;
	readonly boundary: string;
	readonly query: QueryProvenance | null;
	readonly counted: readonly RecordId[];
};

export type SourceTrace = {
	readonly source: SourceId;
	readonly agency: string;
	readonly status: SourceOutcome["status"];
	readonly retrievedAt: string | null;
	readonly cause: string | null;
	readonly rawCode: JsonValue | null;
	readonly retryAfter: string | null;
};

export type OriginTrace = {
	readonly matchedAddress: string;
	readonly payload: PayloadRef;
};

export type GroupTrace = {
	/** The members still in the store, in the placement's order. */
	readonly members: readonly RecordId[];
	readonly groupedBy: string | null;
};

/** Explained by scope: a record-scoped span has a record behind it, a section-scoped span an ordering. */
export type Trace =
	| {
			readonly scope: "record";
			readonly record: RecordTrace;
			readonly clicked: ValueTrace;
			readonly values: readonly ValueTrace[];
	  }
	| {
			readonly scope: "section";
			readonly section: SectionTrace;
			readonly clicked: ValueTrace;
			readonly values: readonly ValueTrace[];
	  }
	| {
			readonly scope: "source";
			readonly source: SourceTrace;
			readonly clicked: ValueTrace;
			readonly values: readonly ValueTrace[];
	  }
	| {
			readonly scope: "origin";
			readonly origin: OriginTrace;
			readonly clicked: ValueTrace;
			readonly values: readonly ValueTrace[];
	  }
	| {
			readonly scope: "group";
			readonly group: GroupTrace;
			readonly clicked: ValueTrace;
			readonly values: readonly ValueTrace[];
	  };

export class KindMismatch extends Error {
	constructor(recordKind: string, templateKind: string) {
		super(`template for ${templateKind} cannot render a ${recordKind} record`);
		this.name = "KindMismatch";
	}
}

/* -------------------------------------------------------------------------- */
/* Slots                                                                      */
/* -------------------------------------------------------------------------- */

type Bag = Readonly<Record<string, unknown>>;

/** Any non-null object can be read by string key, yielding unknown. */
function isBag(x: unknown): x is Bag {
	return typeof x === "object" && x !== null;
}

function isReported(x: unknown): x is Reported<unknown> {
	return isBag(x) && "reported" in x && "provenance" in x && Array.isArray(x.provenance);
}

/** The kernel's only way to make a `Reported` fact. Not exported: a subject is built here or not at all. */
function reported<T>(value: T, provenance: readonly Provenance[]): Reported<T> {
	return Object.freeze({ reported: value, provenance: Object.freeze(provenance) });
}

/** What a span reads: a `Sourced` leaf or a `Reported` fact, flattened to the two things rendering needs. */
type Slot = { readonly value: unknown; readonly provenance: readonly Provenance[] };

/** The slot at `field`, or null when the field is absent or holds neither a reader result nor a reported fact. */
function slotAt(subject: Bag, field: string): Slot | null {
	const v = subject[field];
	if (isSourced(v)) return { value: v.value, provenance: v.provenance };
	if (isReported(v)) return { value: v.reported, provenance: v.provenance };
	return null;
}

export function formatValue(value: unknown, display: DisplayFormat): string | null {
	if (value === null || value === undefined) return null;
	switch (display) {
		case "distance-km": {
			if (typeof value !== "number") return null;
			return `${(Math.round(value / 10) / 100).toFixed(2)} km`;
		}
		case "date": {
			// The date part of an ISO instant, and anything else verbatim: this
			// narrows what is shown, it never reinterprets what was read.
			if (typeof value !== "string") return null;
			return /^(\d{4}-\d{2}-\d{2})(?:[T ]|$)/.exec(value)?.[1] ?? value;
		}
		case "text": {
			if (typeof value === "string") return value;
			if (typeof value === "number" || typeof value === "boolean") return String(value);
			return null;
		}
	}
}

function spanFor(subject: Bag, ref: AnyRef<SubjectKey>): Span | null {
	const slot = slotAt(subject, ref.field);
	const shown = slot === null ? null : formatValue(slot.value, ref.display);
	const text = shown ?? ref.fallback;
	if (text === null) return null;
	return { text, slot: { field: ref.field, display: ref.display } };
}

/** All spans of one clause, or null when any reference has nothing to show: a missing slot removes its clause. */
function clauseSpans(
	subject: Bag,
	strings: readonly string[],
	refs: readonly AnyRef<SubjectKey>[],
): Span[] | null {
	const spans: Span[] = [];
	for (let i = 0; i < strings.length; i += 1) {
		const connective = strings[i];
		if (connective !== undefined && connective !== "") spans.push({ text: connective, slot: null });
		const ref = refs[i];
		if (ref === undefined) continue;
		const span = spanFor(subject, ref);
		if (span === null) return null;
		spans.push(span);
	}
	return spans;
}

/** A plain tagged outcome, the shape `Requirement`'s `state` compares against. */
function isTagged(x: unknown): x is { readonly status: string } {
	return isBag(x) && typeof x["status"] === "string";
}

/**
 * Whether the subject is in the state the template says it speaks about. Every
 * requirement must hold; a template that declares none renders as before.
 * See `Requirement` in ./templates for why this exists.
 */
function satisfies(subject: Bag, requires: readonly Requirement[]): boolean {
	for (const requirement of requires) {
		if ("state" in requirement) {
			const tagged = subject[requirement.state];
			if (!isTagged(tagged) || tagged.status !== requirement.is) return false;
			continue;
		}
		const slot = slotAt(subject, requirement.slot);
		if ("present" in requirement) {
			// A field that is null itself and a `Sourced` whose value is null are
			// the same absence to a reader, and both count as not present.
			if ((slot !== null && slot.value !== null) !== requirement.present) return false;
			continue;
		}
		if (slot === null) return false;
		if ("atLeast" in requirement) {
			if (typeof slot.value !== "number" || slot.value < requirement.atLeast) return false;
			continue;
		}
		if (slot.value !== requirement.equals) return false;
	}
	return true;
}

function assemble(subject: Bag, template: Template<SubjectKey>, remembered: SentenceSubject): Sentence | null {
	if (!satisfies(subject, template.requires)) return null;
	const spans: Span[] = [];
	for (const clause of template.clauses) {
		const rendered = clauseSpans(subject, clause.strings, clause.refs);
		if (rendered === null) continue;
		if (spans.length > 0) spans.push({ text: " ", slot: null });
		spans.push(...rendered);
	}
	const [first, ...rest] = spans;
	if (first === undefined) return null;
	const nonEmpty: readonly [Span, ...Span[]] = [first, ...rest];
	return Object.freeze({ subject: remembered, templateId: template.id, spans: Object.freeze(nonEmpty) });
}

/* -------------------------------------------------------------------------- */
/* Orderings                                                                  */
/* -------------------------------------------------------------------------- */

type AnyRecord = Sealed<RecordOf<Kind>>;

function isPresent<T>(x: T | undefined): x is T {
	return x !== undefined;
}

function distanceOf(record: AnyRecord): number {
	return record.distanceMeters === null ? Number.POSITIVE_INFINITY : record.distanceMeters.value;
}

function matchesFilter(record: AnyRecord, filter: SectionFilter): boolean {
	const bag: Bag = record;
	const v = bag[filter.field];
	if (!isSourced(v)) return false;
	if ("equals" in filter) return v.value === filter.equals;
	if ("present" in filter) return v.value !== null;
	return typeof v.value === "number" && v.value >= filter.atLeast;
}

/**
 * The records of a section, in the order the report shows them: nearest first,
 * ties broken by the source's own identifier, records with no coordinate last.
 * A pure read of the store. The section's count is this array's length, which
 * is why removing a record lowers it with nothing else touched.
 */
export function sectionOrdering(store: EvidenceStore, section: SectionSpec): readonly AnyRecord[] {
	const filter = section.filter;
	const all = store.ofKind(section.kind);
	const kept = filter === null ? all : all.filter((record) => matchesFilter(record, filter));
	return [...kept].sort(
		(a, b) => distanceOf(a) - distanceOf(b) || a.sourceRecordId.localeCompare(b.sourceRecordId),
	);
}

/* -------------------------------------------------------------------------- */
/* Subject construction                                                       */
/* -------------------------------------------------------------------------- */

function sectionSubject(store: EvidenceStore, section: SectionSpec): SectionSubject {
	const ordering = sectionOrdering(store, section);
	const query: readonly Provenance[] = section.query === null ? [] : [section.query];
	// Recomputed from the store like the count, so removing a record lowers one
	// and raises the other by itself. Null when the report carries the whole
	// ordering, and null when nothing was left out, so the sentence cannot
	// render "0 not shown" over a section that showed everything.
	const left = section.carried === null ? 0 : Math.max(0, ordering.length - section.carried);
	return {
		scope: "section",
		count: reported(ordering.length, query),
		boundary: reported(section.boundary, query),
		retrievedAt: section.retrievedAt === null ? null : reported(section.retrievedAt, query),
		// Only an empty section has a note, so the no-data wording cannot render over a section that holds records.
		note: ordering.length === 0 ? reported(section.note, query) : null,
		notShown: left === 0 ? null : reported(left, query),
	};
}

function printableCode(raw: JsonValue | null): string | null {
	if (typeof raw === "string") return raw;
	if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
	return null;
}

/**
 * What a source outcome says, in words. `outcome.status` and
 * `FailureCause` are this codebase's own enums, and printing them put
 * "answered ok" and "could not be reached: http" on every card. They are facts
 * about our own request, so wording them renames nothing an agency sent -- and
 * `SourceTrace` still carries the enum, the same way `sfhaFlag` keeps the
 * letter behind `sfhaLabel`.
 */
const STATUS_WORDS: { readonly [S in SourceOutcome["status"]]: string } = {
	ok: "with records",
	"no-data": "with no matching records",
	unavailable: "that it could not be reached",
};

const CAUSE_WORDS: { readonly [C in FailureCause]: string } = {
	timeout: "the request timed out",
	refused: "the host refused the connection",
	"rate-limited": "the source rate-limited the request",
	http: "the source answered with an error status",
	malformed: "the response could not be read",
	"not-configured": "this deployment holds no credential for it",
	unknown: "the reason is not known",
};

function sourceSubject(source: SourceId, outcome: SourceOutcome, named: string | null): SourceSubject {
	const agency = reported(named ?? AGENCY[source], []);
	const status = reported(STATUS_WORDS[outcome.status], []);
	if (outcome.status === "unavailable") {
		const code = printableCode(outcome.rawCode);
		return {
			scope: "source",
			agency,
			status,
			retrievedAt: null,
			cause: reported(CAUSE_WORDS[outcome.cause], []),
			rawCode: code === null ? null : reported(code, []),
			retryAfter: outcome.retryAfter === null ? null : reported(outcome.retryAfter, []),
		};
	}
	return {
		scope: "source",
		agency,
		status,
		retrievedAt: reported(outcome.retrievedAt, []),
		cause: null,
		rawCode: null,
		retryAfter: null,
	};
}

function originSubject(match: GeocodeMatch): OriginSubject {
	return {
		scope: "origin",
		matchedAddress: match.matchedAddress,
		blockFrom: match.addressRange.from,
		blockTo: match.addressRange.to,
		streetSide: match.streetSide,
		tigerLineId: match.tigerLineId,
		latitude: match.point.latitude,
		longitude: match.point.longitude,
	};
}

function liveMembers(store: EvidenceStore, members: readonly RecordId[]): readonly AnyRecord[] {
	return members.map((id) => store.get(id)).filter(isPresent);
}

function groupSubject(
	store: EvidenceStore,
	members: readonly RecordId[],
	groupedBy: string | null,
): GroupSubject | null {
	const live = liveMembers(store, members);
	// The group still exists while any member does, so the count and the
	// identifier it was grouped on read from whoever is left.
	const [anyLive] = live;
	if (anyLive === undefined) return null;
	const bag: Bag = anyLive;
	const key = groupedBy === null ? undefined : bag[groupedBy];
	// The two named records, though, are the placement's own first two. Reading
	// them off `live` meant deleting a member re-seated the sentence on the next
	// survivor: a three-member group losing its second rendered "PASADENA
	// REFINING FIRE and PASADENA REFINING SYSTEM, INC. share one EPA facility
	// registry ID", where the second is the record that ID names rather than a
	// record sharing it. A null here drops the clause, which is what deleting a
	// record is supposed to do.
	const [firstId, secondId] = members;
	const first = firstId === undefined ? undefined : store.get(firstId);
	const second = secondId === undefined ? undefined : store.get(secondId);
	return {
		scope: "group",
		subject: first === undefined ? null : first.subject,
		otherSubject: second === undefined ? null : second.subject,
		groupedBy: isSourced(key) ? key : null,
		distanceMeters: anyLive.distanceMeters,
		members: reported(live.length, []),
	};
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                  */
/* -------------------------------------------------------------------------- */

function renderRecord<K extends Kind>(
	store: EvidenceStore,
	recordId: RecordId<K>,
	template: Template<K>,
): Sentence | null {
	const record = store.get(recordId);
	if (record === undefined) return null;
	if (record.kind !== template.kind) throw new KindMismatch(record.kind, template.kind);
	return assemble(record, template, { scope: "record", recordId });
}

function renderSection(
	store: EvidenceStore,
	section: SectionSpec,
	template: Template<"section">,
): Sentence | null {
	return assemble(sectionSubject(store, section), template, { scope: "section", section });
}

function renderSource(
	source: SourceId,
	outcome: SourceOutcome,
	agency: string | null,
	template: Template<"source">,
): Sentence | null {
	return assemble(sourceSubject(source, outcome, agency), template, {
		scope: "source",
		source,
		outcome,
		agency,
	});
}

function renderOrigin(match: GeocodeMatch, template: Template<"origin">): Sentence | null {
	return assemble(originSubject(match), template, { scope: "origin", match });
}

function renderGroup(
	store: EvidenceStore,
	members: readonly [RecordId, ...RecordId[]],
	groupedBy: string | null,
	template: Template<"group">,
): Sentence | null {
	const subject = groupSubject(store, members, groupedBy);
	if (subject === null) return null;
	return assemble(subject, template, { scope: "group", members, groupedBy });
}

/** Reads the subject from the store now. Null if it is gone or every clause dropped. */
export function render(store: EvidenceStore, placement: Placement): Sentence | null {
	switch (placement.scope) {
		case "record":
			return renderRecord(store, placement.recordId, placement.template);
		case "section":
			return renderSection(store, placement.section, placement.template);
		case "source":
			return renderSource(placement.source, placement.outcome, placement.agency, placement.template);
		case "origin":
			return renderOrigin(placement.match, placement.template);
		case "group":
			return renderGroup(store, placement.members, placement.groupedBy, placement.template);
	}
}

export function renderAll(store: EvidenceStore, placements: readonly Placement[]): readonly Sentence[] {
	const out: Sentence[] = [];
	for (const placement of placements) {
		const sentence = render(store, placement);
		if (sentence !== null) out.push(sentence);
	}
	return out;
}

/* -------------------------------------------------------------------------- */
/* Tracing                                                                    */
/* -------------------------------------------------------------------------- */

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

function valueTrace(field: string, slot: Slot, displayed: string | null): ValueTrace {
	return { field, displayed, normalized: toJson(slot.value), provenance: slot.provenance };
}

function sourcedTrace(field: string, sourced: Sourced<unknown>, displayed: string | null): ValueTrace {
	return valueTrace(field, { value: sourced.value, provenance: sourced.provenance }, displayed);
}

/**
 * Every slot on the subject, at any depth, found by brand or by shape and
 * named by its path: "location.latitude", "zones.0.code". A slot is a leaf, so
 * the walk never descends into a provenance chain. Only the ancestors of the
 * current path are held, so one object reachable by two paths is reported
 * under both and a cycle still cannot spin.
 */
function subjectValues(subject: Bag, shown: ReadonlyMap<string, string>): ValueTrace[] {
	const out: ValueTrace[] = [];
	const ancestors = new Set<Bag>();
	const visit = (bag: Bag, prefix: string): void => {
		if (ancestors.has(bag)) return;
		ancestors.add(bag);
		for (const key of Object.keys(bag)) {
			const path = prefix === "" ? key : `${prefix}.${key}`;
			const v = bag[key];
			if (isSourced(v)) {
				out.push(sourcedTrace(path, v, shown.get(path) ?? null));
			} else if (isReported(v)) {
				out.push(valueTrace(path, { value: v.reported, provenance: v.provenance }, shown.get(path) ?? null));
			} else if (isBag(v)) {
				visit(v, path);
			}
		}
		ancestors.delete(bag);
	};
	visit(subject, "");
	return out;
}

function recordTrace<K extends Kind>(record: Sealed<RecordOf<K>>, shown: ReadonlyMap<string, string>): RecordTrace {
	return {
		kind: record.kind,
		source: record.source,
		agency: AGENCY[record.source],
		sourceRecordId: record.sourceRecordId,
		sourceUrl: sourcedTrace("sourceUrl", record.sourceUrl, shown.get("sourceUrl") ?? null),
		payloads: record.payloads,
		caveats: record.caveats,
		effectiveAt: sourcedTrace("effectiveAt", record.effectiveAt, shown.get("effectiveAt") ?? null),
		sourceUpdatedAt: sourcedTrace("sourceUpdatedAt", record.sourceUpdatedAt, shown.get("sourceUpdatedAt") ?? null),
	};
}

function shownFields(sentence: Sentence): ReadonlyMap<string, string> {
	const shown = new Map<string, string>();
	for (const s of sentence.spans) if (s.slot !== null) shown.set(s.slot.field, s.text);
	return shown;
}

/**
 * Explains the span at `spanIndex` from the live subject. Null when the
 * subject is gone, the index is out of range, or the span is connective text.
 */
export function trace(store: EvidenceStore, sentence: Sentence, spanIndex: number): Trace | null {
	const span = sentence.spans[spanIndex];
	if (span === undefined || span.slot === null) return null;
	const field = span.slot.field;
	const shown = shownFields(sentence);
	const subject = sentence.subject;

	switch (subject.scope) {
		case "record": {
			const record = store.get(subject.recordId);
			if (record === undefined) return null;
			const bag: Bag = record;
			const clicked = slotAt(bag, field);
			if (clicked === null) return null;
			return {
				scope: "record",
				record: recordTrace(record, shown),
				clicked: valueTrace(field, clicked, span.text),
				values: subjectValues(bag, shown),
			};
		}
		case "section": {
			const section = subject.section;
			const bag: Bag = sectionSubject(store, section);
			const clicked = slotAt(bag, field);
			if (clicked === null) return null;
			return {
				scope: "section",
				section: {
					kind: section.kind,
					source: section.source,
					agency: AGENCY[section.source],
					boundary: section.boundary,
					query: section.query,
					counted: sectionOrdering(store, section).map((record) => record.id),
				},
				clicked: valueTrace(field, clicked, span.text),
				values: subjectValues(bag, shown),
			};
		}
		case "source": {
			const outcome = subject.outcome;
			const bag: Bag = sourceSubject(subject.source, outcome, subject.agency);
			const clicked = slotAt(bag, field);
			if (clicked === null) return null;
			return {
				scope: "source",
				source: {
					source: subject.source,
					// The trace carries the agency this outcome was attributed to and
					// the raw cause enum, not the words the card printed.
					agency: subject.agency ?? AGENCY[subject.source],
					status: outcome.status,
					retrievedAt: outcome.status === "unavailable" ? null : outcome.retrievedAt,
					cause: outcome.status === "unavailable" ? outcome.cause : null,
					rawCode: outcome.status === "unavailable" ? outcome.rawCode : null,
					retryAfter: outcome.status === "unavailable" ? outcome.retryAfter : null,
				},
				clicked: valueTrace(field, clicked, span.text),
				values: subjectValues(bag, shown),
			};
		}
		case "origin": {
			const bag: Bag = originSubject(subject.match);
			const clicked = slotAt(bag, field);
			if (clicked === null) return null;
			return {
				scope: "origin",
				origin: { matchedAddress: subject.match.matchedAddress.value, payload: subject.match.payload },
				clicked: valueTrace(field, clicked, span.text),
				values: subjectValues(bag, shown),
			};
		}
		case "group": {
			const group = groupSubject(store, subject.members, subject.groupedBy);
			if (group === null) return null;
			const bag: Bag = group;
			const clicked = slotAt(bag, field);
			if (clicked === null) return null;
			return {
				scope: "group",
				group: {
					members: liveMembers(store, subject.members).map((record) => record.id),
					groupedBy: subject.groupedBy,
				},
				clicked: valueTrace(field, clicked, span.text),
				values: subjectValues(bag, shown),
			};
		}
	}
}

/* -------------------------------------------------------------------------- */
/* Verifying                                                                  */
/* -------------------------------------------------------------------------- */

function isRecordTemplate(template: Template<SubjectKey>): template is Template<Kind> {
	return KINDS.some((kind) => kind === template.kind);
}

function isSectionTemplate(template: Template<SubjectKey>): template is Template<"section"> {
	return template.kind === "section";
}

function isSourceTemplate(template: Template<SubjectKey>): template is Template<"source"> {
	return template.kind === "source";
}

function isOriginTemplate(template: Template<SubjectKey>): template is Template<"origin"> {
	return template.kind === "origin";
}

function isGroupTemplate(template: Template<SubjectKey>): template is Template<"group"> {
	return template.kind === "group";
}

/** The subject key a template must declare to render this subject. */
function subjectKeyOf(subject: SentenceSubject): SubjectKey {
	return subject.scope === "record" ? subject.recordId.kind : subject.scope;
}

function reRender(store: EvidenceStore, subject: SentenceSubject, template: Template<SubjectKey>): Sentence | null {
	switch (subject.scope) {
		case "record":
			return isRecordTemplate(template) ? renderRecord(store, subject.recordId, template) : null;
		case "section":
			return isSectionTemplate(template) ? renderSection(store, subject.section, template) : null;
		case "source":
			return isSourceTemplate(template)
				? renderSource(subject.source, subject.outcome, subject.agency, template)
				: null;
		case "origin":
			return isOriginTemplate(template) ? renderOrigin(subject.match, template) : null;
		case "group":
			return isGroupTemplate(template) ? renderGroup(store, subject.members, subject.groupedBy, template) : null;
	}
}

/** Re-renders from the current store and compares span by span. False if the text is not derivable now. */
export function verify(
	store: EvidenceStore,
	sentence: Sentence,
	templates: readonly Template<SubjectKey>[],
): boolean {
	const key = subjectKeyOf(sentence.subject);
	const template = templates.find((t) => t.id === sentence.templateId && t.kind === key);
	if (template === undefined) return false;
	const fresh = reRender(store, sentence.subject, template);
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
