/**
 * Kind-bound templates.
 *
 * A template is a list of clauses, and a clause is connective text around
 * typed field references. The references are the only thing a clause can
 * interpolate, and each one names a `Sourced` field of one record kind. So:
 *
 *   sentence`No data.`             does not compile: a clause needs a reference
 *   sentence`${"VALERO PLUME"}`    does not compile: a string is not a reference
 *   field("zoneCode") in a sems-site template does not compile: wrong kind
 *
 * A template holds no values. Rendering re-reads every field from the live
 * store, so text is a pure function of the store.
 */

import type { Kind, RecordOf } from "./records";
import type { Sourced } from "./sourced";

export type DisplayFormat = "text" | "distance-km";

/** The keys of `R` that hold a `Sourced` value, or a `Sourced` value that may be absent. */
export type SourcedKeys<R> = {
	[P in keyof R & string]: NonNullable<R[P]> extends Sourced<unknown> ? P : never;
}[keyof R & string];

type SlotValue<R, P extends keyof R> = NonNullable<R[P]> extends Sourced<infer V> ? V : never;

export type NumericKeys<K extends Kind> = {
	[P in SourcedKeys<RecordOf<K>>]: SlotValue<RecordOf<K>, P> extends number | null ? P : never;
}[SourcedKeys<RecordOf<K>>];

const refBrand: unique symbol = Symbol("ground-truth.slot-ref");

/**
 * A reference to one field of one record kind. Only `defineTemplate`'s `field`
 * can make one, and `field` is what constrains `P` to a Sourced key of `K`.
 * Keeping `P` a plain string here keeps `SlotRef` covariant in `K`, so a
 * `Template<"sems-site">` flows into a `Template<Kind>` list.
 */
export type SlotRef<K extends Kind, P extends string = string> = {
	readonly [refBrand]: typeof refBrand;
	readonly kind: K;
	readonly field: P;
	readonly display: DisplayFormat;
	/** Rendered when the value is null. The span still points at the field, so the trace shows the null's provenance. */
	readonly fallback: string | null;
};

export type AnyRef<K extends Kind> = SlotRef<K, string>;

export type Clause<K extends Kind> = {
	readonly strings: readonly string[];
	readonly refs: readonly [AnyRef<K>, ...AnyRef<K>[]];
};

export type Template<K extends Kind> = {
	readonly id: string;
	readonly kind: K;
	readonly clauses: readonly [Clause<K>, ...Clause<K>[]];
};

/** Every kind has an allowlist of at least one template. */
export type TemplateRegistry = {
	readonly [K in Kind]: readonly [Template<K>, ...Template<K>[]];
};

export type FieldRef<K extends Kind> = <P extends SourcedKeys<RecordOf<K>>>(field: P) => SlotRef<K, P>;

export function sentence<K extends Kind>(
	strings: TemplateStringsArray,
	...refs: [AnyRef<K>, ...AnyRef<K>[]]
): Clause<K> {
	return Object.freeze({ strings: Object.freeze([...strings.raw]), refs: Object.freeze(refs) });
}

export function fallback<K extends Kind, P extends string>(
	ref: SlotRef<K, P>,
	text: string,
): SlotRef<K, P> {
	return Object.freeze({ ...ref, fallback: text });
}

export function km<K extends Kind, P extends NumericKeys<K>>(
	ref: SlotRef<K, P>,
): SlotRef<K, P> {
	return Object.freeze({ ...ref, display: "distance-km" });
}

export function defineTemplate<K extends Kind>(
	kind: K,
	id: string,
	build: (field: FieldRef<K>) => readonly [Clause<K>, ...Clause<K>[]],
): Template<K> {
	const field: FieldRef<K> = (name) => {
		const ref: SlotRef<K, typeof name> = { [refBrand]: refBrand, kind, field: name, display: "text", fallback: null };
		Object.freeze(ref);
		return ref;
	};
	return Object.freeze({ id, kind, clauses: build(field) });
}

export function isSlotRef(x: unknown): x is AnyRef<Kind> {
	return typeof x === "object" && x !== null && refBrand in x && x[refBrand] === refBrand;
}
