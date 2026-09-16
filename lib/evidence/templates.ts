import type { Kind, RecordOf } from "./records";
import type { Provenance, Sourced } from "./sourced";

export type DisplayFormat = "text" | "distance-km" | "date" | "currency-dollar";

export const DISPLAY_FORMATS: { readonly [K in DisplayFormat]: K } = {
	text: "text",
	"distance-km": "distance-km",
	date: "date",
	"currency-dollar": "currency-dollar",
};

export type Reported<T> = {
	readonly reported: T;
	readonly provenance: readonly Provenance[];
};

export type SectionSubject = {
	readonly scope: "section";
	readonly count: Reported<number>;
	readonly boundary: Reported<string>;
	readonly retrievedAt: Reported<string> | null;
	readonly note: Reported<string> | null;
	readonly notShown: Reported<number> | null;
	readonly filterField: Reported<string> | null;
	readonly filterValue: Reported<string> | null;
};

export type SourceSubject = {
	readonly scope: "source";
	readonly agency: Reported<string>;
	readonly status: Reported<string>;
	readonly retrievedAt: Reported<string> | null;
	readonly cause: Reported<string> | null;
	readonly rawCode: Reported<string> | null;
	readonly retryAfter: Reported<string> | null;
};

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

export type GroupSubject = {
	readonly scope: "group";
	readonly subject: Sourced<string> | null;
	readonly otherSubject: Sourced<string> | null;
	readonly groupedBy: Sourced<unknown> | null;
	readonly distanceMeters: Sourced<number> | null;
	readonly members: Reported<number>;
};

type Subjects = { readonly [K in Kind]: RecordOf<K> } & {
	readonly section: SectionSubject;
	readonly source: SourceSubject;
	readonly origin: OriginSubject;
	readonly group: GroupSubject;
};

export type SubjectKey = keyof Subjects;
export type SubjectOf<T extends SubjectKey> = Subjects[T];

export type WideScope = Exclude<SubjectKey, Kind>;

export type SourcedKeys<R> = {
	[P in keyof R & string]: NonNullable<R[P]> extends Sourced<unknown> ? P : never;
}[keyof R & string];

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
	readonly fallback: string | null;
};

export type AnyRef<T extends SubjectKey> = SlotRef<T, string>;

export type Clause<T extends SubjectKey> = {
	readonly strings: readonly string[];
	readonly refs: readonly [AnyRef<T>, ...AnyRef<T>[]];
};

export type Requirement =
	| { readonly slot: string; readonly equals: string | number | boolean | null }
	| { readonly slot: string; readonly present: boolean }
	| { readonly slot: string; readonly atLeast: number }
	| { readonly state: string; readonly is: string };

export type TypedRequirement<T extends SubjectKey> =
	| { readonly slot: SlotKeys<SubjectOf<T>>; readonly equals: string | number | boolean | null }
	| { readonly slot: SlotKeys<SubjectOf<T>>; readonly present: boolean }
	| { readonly slot: NumericKeys<T>; readonly atLeast: number }
	| { readonly state: StateKeys<SubjectOf<T>>; readonly is: string };

export type Template<T extends SubjectKey> = {
	readonly id: string;
	readonly kind: T;
	readonly clauses: readonly [Clause<T>, ...Clause<T>[]];
	readonly requires: readonly Requirement[];
};

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

export function day<T extends SubjectKey, P extends TextKeys<T>>(
	ref: SlotRef<T, P>,
): SlotRef<T, P> {
	return Object.freeze({ ...ref, display: "date" });
}

export function dollars<T extends SubjectKey, P extends NumericKeys<T>>(
	ref: SlotRef<T, P>,
): SlotRef<T, P> {
	return Object.freeze({ ...ref, display: "currency-dollar" });
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
