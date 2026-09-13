/**
 * Subject-bound templates.
 *
 * A template is a list of clauses, and a clause is connective text around
 * typed field references. The references are the only thing a clause can
 * interpolate, and each one names a slot of one subject. So:
 *
 *   sentence`No data.`             does not compile: a clause needs a reference
 *   sentence`${"VALERO PLUME"}`    does not compile: a string is not a reference
 *   field("zoneCode") in a sems-site template does not compile: wrong kind
 *   field("epaSiteId") in a section template does not compile: wrong subject
 *
 * A template holds no values. Rendering re-reads every slot from the live
 * store, so text is a pure function of the store.
 *
 * SYNTHESIS.md graft 1: the subject of a claim is not always a record. Twenty
 * of the twenty-six claims in `.dev/census/` are about something wider, so the
 * subject a template binds to is a `SubjectKey`: one of the record kinds, or
 * `section`, `source`, `origin`, `group`. Widening the subject is safe because
 * the deletion guarantee comes from rendering being a pure read of the store,
 * not from a sentence being pinned to one record (arm C). Nothing here caches.
 */

import type { Kind, RecordOf } from "./records";
import type { Provenance, Sourced } from "./sourced";

/**
 * How a slot's value is written on screen. The trace always carries the
 * normalized value and the raw one, so a display format narrows what is shown
 * without hiding anything: `distance-km` prints metres as kilometres, `date`
 * prints the date part of an instant.
 */
export type DisplayFormat = "text" | "distance-km" | "date";

/**
 * A fact about our own retrieval rather than a value an agency returned: how
 * many records an ordering holds, the boundary we asked within, whether a
 * source answered at all and why not. No agency sent these, so none of them is
 * a `Sourced` value and none of them may ever become a record: a count hung on
 * a synthetic row would be the one row in this codebase no agency returned.
 *
 * `provenance` carries the query behind the fact when a payload was kept, and
 * is empty when the fact is only about the request we made. A section's count
 * is additionally backed by the ids counted, which the trace lists; those ids
 * are read from the store at trace time, never stored here.
 *
 * Only the kernel builds one. `Reported` is a type, not a constructor: there
 * is no exported way to make one, exactly as with `Sourced`.
 */
export type Reported<T> = {
	readonly reported: T;
	readonly provenance: readonly Provenance[];
};

/**
 * One source's records within its stated boundary.
 *
 * `count` is the length of the section's ordering, recomputed from the store
 * on every render. It is never a number anyone wrote down, so removing a
 * record lowers it by itself and the deletion guarantee holds for an aggregate
 * the same way it holds for a record.
 *
 * `note` is present only when the ordering is empty, so the no-data wording
 * cannot render over a section that holds records.
 */
export type SectionSubject = {
	readonly scope: "section";
	readonly count: Reported<number>;
	readonly boundary: Reported<string>;
	readonly retrievedAt: Reported<string> | null;
	readonly note: Reported<string> | null;
};

/**
 * One source's outcome: its status, its retrieval time, and when it is
 * unavailable, why. B10 requires that this stays visibly different from a
 * section with zero records, and it is: `cause` exists only on an unavailable
 * source and `retrievedAt` only on one that answered, so neither template can
 * render over the other's subject.
 */
export type SourceSubject = {
	readonly scope: "source";
	readonly agency: Reported<string>;
	readonly status: Reported<string>;
	readonly retrievedAt: Reported<string> | null;
	readonly cause: Reported<string> | null;
	readonly rawCode: Reported<string> | null;
	readonly retryAfter: Reported<string> | null;
};

/**
 * The geocode match. Every slot is a `Sourced` leaf of the kernel's own
 * `GeocodeMatch`, re-referenced, never rebuilt: the two ends of the address
 * range keep the Census fields they were read from. The point locates a block
 * rather than a parcel, which the template says in its own words.
 */
export type OriginSubject = {
	readonly scope: "origin";
	readonly matchedAddress: Sourced<string>;
	readonly blockFrom: Sourced<string>;
	readonly blockTo: Sourced<string>;
	readonly streetSide: Sourced<string>;
	readonly tigerLineId: Sourced<string>;
	readonly latitude: Sourced<number>;
	readonly longitude: Sourced<number>;
};

/**
 * Several records the B6 grouping rules tied together: two EPA site IDs under
 * one registry ID, one site carrying two names, two sources disagreeing on a
 * coordinate. Which records form a group is `lib/report/grouping.ts`'s
 * decision and is wired in a later unit; this is only the shape a group is
 * rendered through.
 *
 * `members` is the count of members still in the store, so a deleted member
 * shrinks the group instead of leaving a stale number behind.
 */
export type GroupSubject = {
	readonly scope: "group";
	readonly subject: Sourced<string>;
	readonly otherSubject: Sourced<string> | null;
	readonly groupedBy: Sourced<unknown> | null;
	readonly distanceMeters: Sourced<number> | null;
	readonly members: Reported<number>;
};

/** Every subject a template can bind to: a record kind, or one of the four wider scopes. */
type Subjects = { readonly [K in Kind]: RecordOf<K> } & {
	readonly section: SectionSubject;
	readonly source: SourceSubject;
	readonly origin: OriginSubject;
	readonly group: GroupSubject;
};

export type SubjectKey = keyof Subjects;
export type SubjectOf<T extends SubjectKey> = Subjects[T];

/** The four scopes whose subject is not a single record. */
export type WideScope = Exclude<SubjectKey, Kind>;

/** The keys of `R` that hold a `Sourced` value, or a `Sourced` value that may be absent. */
export type SourcedKeys<R> = {
	[P in keyof R & string]: NonNullable<R[P]> extends Sourced<unknown> ? P : never;
}[keyof R & string];

/** The keys of a subject a clause may reference: a `Sourced` leaf, or a `Reported` fact about the retrieval. */
export type SlotKeys<S> = {
	[P in keyof S & string]: NonNullable<S[P]> extends Sourced<unknown> | Reported<unknown> ? P : never;
}[keyof S & string];

type SlotValue<S, P extends keyof S> = NonNullable<S[P]> extends Sourced<infer V>
	? V
	: NonNullable<S[P]> extends Reported<infer W>
		? W
		: never;

export type NumericKeys<T extends SubjectKey> = {
	[P in SlotKeys<SubjectOf<T>>]: SlotValue<SubjectOf<T>, P> extends number | null ? P : never;
}[SlotKeys<SubjectOf<T>>];

export type TextKeys<T extends SubjectKey> = {
	[P in SlotKeys<SubjectOf<T>>]: SlotValue<SubjectOf<T>, P> extends string | null ? P : never;
}[SlotKeys<SubjectOf<T>>];

/**
 * The keys of `S` that hold a tagged outcome: a plain object with a string
 * `status`. `sems-site`'s `statusRow` is the only one today. It is not a
 * `Sourced` leaf and never renders; it exists so a template can declare which
 * of those outcomes it is allowed to speak about.
 */
export type StateKeys<S> = {
	[P in keyof S & string]: NonNullable<S[P]> extends { readonly status: string } ? P : never;
}[keyof S & string];

const refBrand: unique symbol = Symbol("ground-truth.slot-ref");

/**
 * A reference to one slot of one subject. Only `defineTemplate`'s `field` can
 * make one, and `field` is what constrains `P` to a slot of `T`. Keeping `P` a
 * plain string here keeps `SlotRef` covariant in `T`, so a
 * `Template<"sems-site">` flows into a `Template<SubjectKey>` list.
 */
export type SlotRef<T extends SubjectKey, P extends string = string> = {
	readonly [refBrand]: typeof refBrand;
	readonly kind: T;
	readonly field: P;
	readonly display: DisplayFormat;
	/** Rendered when the value is null. The span still points at the slot, so the trace shows the null's provenance. */
	readonly fallback: string | null;
};

export type AnyRef<T extends SubjectKey> = SlotRef<T, string>;

export type Clause<T extends SubjectKey> = {
	readonly strings: readonly string[];
	readonly refs: readonly [AnyRef<T>, ...AnyRef<T>[]];
};

/**
 * A condition the subject must satisfy before a template may render over it.
 *
 * The kind gate stops a Superfund template rendering an ECHO facility. It does
 * not stop the *wrong* Superfund template rendering the *right* record: four of
 * the five `sems-site` templates each assert something about what the Superfund
 * inventory answered, and every one of them would render happily over a record
 * in any of the three states, because none of them references the field that
 * decides which is true. The same hole let `echo-facility/no-status@1` state
 * that ECHO reported no compliance status over a record whose status is
 * "Violation Identified".
 *
 * So a template that asserts a state declares it, and `assemble` refuses to
 * render when the subject does not hold. The selection policy still chooses;
 * the kernel now refuses a wrong choice instead of trusting one. The condition
 * is data, like `SectionFilter`, not a closure, so it can be read off the
 * template and shown.
 *
 * `slot` names a `Sourced` or `Reported` leaf and compares its value; `state`
 * names a tagged outcome and compares its tag. The four comparisons are the
 * ones `SectionFilter` has: a count of zero is present, so a template named for
 * a threshold needs `atLeast` and not `present`, exactly as a section does.
 */
export type Requirement =
	| { readonly slot: string; readonly equals: string | number | boolean | null }
	| { readonly slot: string; readonly present: boolean }
	| { readonly slot: string; readonly atLeast: number }
	| { readonly state: string; readonly is: string };

/** The same condition with its field names constrained to real slots of `T`. Only `defineTemplate` uses it; `Template` keeps the plain strings so it stays covariant in `T`. */
export type TypedRequirement<T extends SubjectKey> =
	| { readonly slot: SlotKeys<SubjectOf<T>>; readonly equals: string | number | boolean | null }
	| { readonly slot: SlotKeys<SubjectOf<T>>; readonly present: boolean }
	| { readonly slot: NumericKeys<T>; readonly atLeast: number }
	| { readonly state: StateKeys<SubjectOf<T>>; readonly is: string };

export type Template<T extends SubjectKey> = {
	readonly id: string;
	readonly kind: T;
	readonly clauses: readonly [Clause<T>, ...Clause<T>[]];
	/** Empty for a template that asserts nothing about the subject's state. */
	readonly requires: readonly Requirement[];
};

/** Every kind has an allowlist of at least one template. */
export type TemplateRegistry = {
	readonly [K in Kind]: readonly [Template<K>, ...Template<K>[]];
};

export type FieldRef<T extends SubjectKey> = <P extends SlotKeys<SubjectOf<T>>>(field: P) => SlotRef<T, P>;

export function sentence<T extends SubjectKey>(
	strings: TemplateStringsArray,
	...refs: [AnyRef<T>, ...AnyRef<T>[]]
): Clause<T> {
	return Object.freeze({ strings: Object.freeze([...strings.raw]), refs: Object.freeze(refs) });
}

export function fallback<T extends SubjectKey, P extends string>(
	ref: SlotRef<T, P>,
	text: string,
): SlotRef<T, P> {
	return Object.freeze({ ...ref, fallback: text });
}

export function km<T extends SubjectKey, P extends NumericKeys<T>>(
	ref: SlotRef<T, P>,
): SlotRef<T, P> {
	return Object.freeze({ ...ref, display: "distance-km" });
}

/**
 * Prints the date part of an instant. `parse-epoch-ms` turns ArcGIS's
 * 1710413511000 into "2024-03-14T10:51:51Z", and a clause that prints that
 * whole string claims a clock time and a timezone FRS never stated: its
 * UPDATE_DATE is a date. docs/BRIEF.md A3's own trace row shows this field as
 * 2024-03-14. The instant stays in the trace as the normalized value.
 */
export function day<T extends SubjectKey, P extends TextKeys<T>>(
	ref: SlotRef<T, P>,
): SlotRef<T, P> {
	return Object.freeze({ ...ref, display: "date" });
}

export function defineTemplate<T extends SubjectKey>(
	kind: T,
	id: string,
	build: (field: FieldRef<T>) => readonly [Clause<T>, ...Clause<T>[]],
	requires: readonly TypedRequirement<T>[] = [],
): Template<T> {
	const field: FieldRef<T> = (name) => {
		const ref: SlotRef<T, typeof name> = { [refBrand]: refBrand, kind, field: name, display: "text", fallback: null };
		Object.freeze(ref);
		return ref;
	};
	return Object.freeze({ id, kind, clauses: build(field), requires: Object.freeze([...requires]) });
}

export function isSlotRef(x: unknown): x is AnyRef<SubjectKey> {
	return typeof x === "object" && x !== null && refBrand in x && x[refBrand] === refBrand;
}
