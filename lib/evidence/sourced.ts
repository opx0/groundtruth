/**
 * The provenance-carrying value.
 *
 * The only ways to obtain a `Sourced<T>` are the readers returned by
 * `fieldsOf`, the formulas `haversine` and `coalesce`, and `fromQuery`. Each of
 * those captures where the value came from at the moment it is read. The brand
 * symbol is not exported, so no other module can build one by hand, and `seal`
 * rejects any lookalike at runtime.
 *
 * This module must never contain a type assertion or a non-null assertion.
 * `eslint.config.mjs` enforces that under `lib/evidence/`.
 */

export type JsonValue =
	| null
	| boolean
	| number
	| string
	| readonly JsonValue[]
	| { readonly [key: string]: JsonValue };

export type JsonObject = { readonly [key: string]: JsonValue };

export type AdapterVersion = `${string}@${number}`;

export type TransformName =
	| "identity"
	| "parse-number"
	| "normalize-date"
	| "parse-epoch-ms"
	| "map-boolean"
	| "join-fields";

export type Formula = "haversine" | "coalesce";

/** One response the record was built from. `url` carries coordinates only, never an address. */
export type PayloadRef = {
	readonly url: string;
	readonly sha256: string;
	readonly retrievedAt: string;
};

export type FieldProvenance = {
	readonly kind: "field";
	readonly dataset: string;
	readonly sourceField: string;
	readonly rawValue: JsonValue;
	readonly transform: TransformName;
	readonly adapterVersion: AdapterVersion;
	readonly payload: PayloadRef;
};

/** The dataset has no such field. Recorded so the trace can say so, rather than showing a null with no origin. */
export type AbsentProvenance = {
	readonly kind: "absent";
	readonly dataset: string;
	readonly sourceField: string;
	readonly adapterVersion: AdapterVersion;
	readonly payload: PayloadRef;
};

/** The value came from the request we made, not from the response. */
export type QueryProvenance = {
	readonly kind: "query";
	readonly parameter: string;
	readonly value: JsonValue;
	readonly adapterVersion: AdapterVersion;
	readonly payload: PayloadRef;
};

export type ComputationInput = {
	readonly name: string;
	readonly value: JsonValue;
	readonly provenance: readonly Provenance[];
};

export type ComputationProvenance = {
	readonly kind: "computation";
	readonly formula: Formula;
	readonly computedBy: `${string}@${number}`;
	readonly inputs: readonly [ComputationInput, ...ComputationInput[]];
};

export type Provenance =
	| FieldProvenance
	| AbsentProvenance
	| QueryProvenance
	| ComputationProvenance;

export const KERNEL_VERSION = "evidence-kernel@1";

const sourcedBrand: unique symbol = Symbol("ground-truth.sourced");

export type Sourced<T> = {
	readonly value: T;
	readonly provenance: readonly [Provenance, ...Provenance[]];
	readonly [sourcedBrand]: typeof sourcedBrand;
};

function make<T>(value: T, provenance: readonly [Provenance, ...Provenance[]]): Sourced<T> {
	return Object.freeze({ value, provenance, [sourcedBrand]: sourcedBrand });
}

export function isSourced(x: unknown): x is Sourced<unknown> {
	return typeof x === "object" && x !== null && sourcedBrand in x && x[sourcedBrand] === sourcedBrand;
}

export type GeoPoint = {
	readonly latitude: Sourced<number>;
	readonly longitude: Sourced<number>;
	readonly accuracyMeters: Sourced<number | null>;
	readonly collectionMethod: Sourced<string | null>;
	readonly referencePoint: Sourced<string | null>;
};

export type Fetched<Raw extends JsonObject> = {
	readonly raw: Raw;
	readonly payload: PayloadRef;
};

/** The keys of `Raw` whose value type is assignable to `T`. */
export type KeysWhere<Raw, T> = {
	[P in keyof Raw & string]: Raw[P] extends T ? P : never;
}[keyof Raw & string];

export class ReaderInvariant extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ReaderInvariant";
	}
}

/**
 * Binds one Zod-validated payload to a set of typed readers. Every reader takes
 * a key of the raw shape, constrained to the raw type the transform accepts,
 * and captures the key name, raw value, transform, adapter version, and payload
 * itself. Readers whose result type depends on nullability are overloaded so
 * the non-null case stays non-null in the type.
 */
export type FieldReader<Raw extends JsonObject> = {
	readonly raw: Raw;
	readonly dataset: string;
	readonly payload: PayloadRef;

	text<P extends KeysWhere<Raw, string | null>>(field: P): Sourced<Raw[P]>;

	number<P extends KeysWhere<Raw, string | number>>(field: P): Sourced<number>;
	number<P extends KeysWhere<Raw, string | number | null>>(field: P): Sourced<number | null>;

	date<P extends KeysWhere<Raw, string>>(field: P): Sourced<string>;
	date<P extends KeysWhere<Raw, string | null>>(field: P): Sourced<string | null>;

	epochMs<P extends KeysWhere<Raw, number>>(field: P): Sourced<string>;
	epochMs<P extends KeysWhere<Raw, number | null>>(field: P): Sourced<string | null>;

	flag<P extends KeysWhere<Raw, string | null>>(
		field: P,
		map: Readonly<Record<string, boolean>>,
	): Sourced<boolean | null>;

	join<P extends KeysWhere<Raw, string | null>>(
		fields: readonly [P, ...P[]],
		separator: string,
	): Sourced<string | null>;

	absent(field: string): Sourced<null>;

	point<
		La extends KeysWhere<Raw, string | number | null>,
		Lo extends KeysWhere<Raw, string | number | null>,
	>(
		latitude: La,
		longitude: Lo,
		extras: {
			readonly accuracy?: KeysWhere<Raw, number | null>;
			readonly method?: KeysWhere<Raw, string | null>;
			readonly referencePoint?: KeysWhere<Raw, string | null>;
		},
	): GeoPoint | null;
};

/** "2022-02-08 00:00:00" -> "2022-02-08"; an ISO instant keeps its date part; anything else is left verbatim. */
function normalizeDate(raw: string): string {
	const match = /^(\d{4}-\d{2}-\d{2})(?:[ T]|$)/.exec(raw);
	return match?.[1] ?? raw;
}

/** 1710413511000 -> "2024-03-14T10:51:51Z" */
function epochMsToIso(ms: number): string {
	const d = new Date(ms);
	if (Number.isNaN(d.getTime())) throw new ReaderInvariant(`epoch-ms ${ms} is not a valid instant`);
	return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function parseNumber(raw: string | number): number {
	if (typeof raw === "number") return raw;
	const n = Number(raw.trim());
	if (raw.trim() === "" || Number.isNaN(n)) throw new ReaderInvariant(`"${raw}" is not a number`);
	return n;
}

export function fieldsOf<Raw extends JsonObject>(
	fetched: Fetched<Raw>,
	dataset: string,
	adapterVersion: AdapterVersion,
): FieldReader<Raw> {
	const { raw, payload } = fetched;
	const bag: JsonObject = raw;

	function field(sourceField: string, transform: TransformName): FieldProvenance {
		const rawValue = bag[sourceField];
		if (rawValue === undefined) {
			throw new ReaderInvariant(`${dataset}.${sourceField} is not present on the validated payload`);
		}
		return { kind: "field", dataset, sourceField, rawValue, transform, adapterVersion, payload };
	}

	function text<P extends KeysWhere<Raw, string | null>>(name: P): Sourced<Raw[P]> {
		return make(raw[name], [field(name, "identity")]);
	}

	function readNumber(name: string): Sourced<number | null> {
		const v = bag[name];
		if (v === null) return make(null, [field(name, "parse-number")]);
		if (typeof v === "number") return make(v, [field(name, "identity")]);
		if (typeof v === "string") return make(parseNumber(v), [field(name, "parse-number")]);
		throw new ReaderInvariant(`${dataset}.${name} is not a number or string`);
	}

	function number<P extends KeysWhere<Raw, string | number>>(name: P): Sourced<number>;
	function number<P extends KeysWhere<Raw, string | number | null>>(name: P): Sourced<number | null>;
	function number(name: string): Sourced<number | null> {
		return readNumber(name);
	}

	function date<P extends KeysWhere<Raw, string>>(name: P): Sourced<string>;
	function date<P extends KeysWhere<Raw, string | null>>(name: P): Sourced<string | null>;
	function date(name: string): Sourced<string | null> {
		const v = bag[name];
		const p = field(name, "normalize-date");
		if (v === null) return make(null, [p]);
		if (typeof v === "string") return make(normalizeDate(v), [p]);
		throw new ReaderInvariant(`${dataset}.${name} is not a date string`);
	}

	function epochMs<P extends KeysWhere<Raw, number>>(name: P): Sourced<string>;
	function epochMs<P extends KeysWhere<Raw, number | null>>(name: P): Sourced<string | null>;
	function epochMs(name: string): Sourced<string | null> {
		const v = bag[name];
		const p = field(name, "parse-epoch-ms");
		if (v === null) return make(null, [p]);
		if (typeof v === "number") return make(epochMsToIso(v), [p]);
		throw new ReaderInvariant(`${dataset}.${name} is not an epoch-ms number`);
	}

	function flag(name: string, map: Readonly<Record<string, boolean>>): Sourced<boolean | null> {
		const v = bag[name];
		const p = field(name, "map-boolean");
		if (typeof v !== "string") return make(null, [p]);
		const mapped = map[v];
		return make(mapped === undefined ? null : mapped, [p]);
	}

	function join(names: readonly [string, ...string[]], separator: string): Sourced<string | null> {
		const parts: string[] = [];
		const provenance: [Provenance, ...Provenance[]] = [field(names[0], "join-fields")];
		for (const name of names.slice(1)) provenance.push(field(name, "join-fields"));
		for (const name of names) {
			const v = bag[name];
			if (typeof v === "string" && v !== "") parts.push(v);
		}
		return make(parts.length === 0 ? null : parts.join(separator), provenance);
	}

	function absent(name: string): Sourced<null> {
		return make(null, [{ kind: "absent", dataset, sourceField: name, adapterVersion, payload }]);
	}

	function point(
		latitude: string,
		longitude: string,
		extras: {
			readonly accuracy?: string;
			readonly method?: string;
			readonly referencePoint?: string;
		},
	): GeoPoint | null {
		const lat = readNumber(latitude);
		const lng = readNumber(longitude);
		if (lat.value === null || lng.value === null) return null;
		return Object.freeze({
			latitude: make(lat.value, lat.provenance),
			longitude: make(lng.value, lng.provenance),
			accuracyMeters: extras.accuracy === undefined ? absent("accuracy") : readNumber(extras.accuracy),
			collectionMethod:
				extras.method === undefined ? absent("collectionMethod") : nullableText(extras.method),
			referencePoint:
				extras.referencePoint === undefined
					? absent("referencePoint")
					: nullableText(extras.referencePoint),
		});
	}

	function nullableText(name: string): Sourced<string | null> {
		const v = bag[name];
		const p = field(name, "identity");
		if (v === null) return make(null, [p]);
		if (typeof v === "string") return make(v, [p]);
		throw new ReaderInvariant(`${dataset}.${name} is not a string`);
	}

	return { raw, dataset, payload, text, number, date, epochMs, flag, join, absent, point };
}

const EARTH_RADIUS_METERS = 6371008.8;

function radians(degrees: number): number {
	return (degrees * Math.PI) / 180;
}

/** Great-circle distance in whole meters. Both coordinates, with their own provenance, are the inputs. */
export function haversine(from: GeoPoint, to: GeoPoint): Sourced<number> {
	const dLat = radians(to.latitude.value - from.latitude.value);
	const dLng = radians(to.longitude.value - from.longitude.value);
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(radians(from.latitude.value)) *
			Math.cos(radians(to.latitude.value)) *
			Math.sin(dLng / 2) ** 2;
	const meters = Math.round(2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a)));
	return make(meters, [
		{
			kind: "computation",
			formula: "haversine",
			computedBy: KERNEL_VERSION,
			inputs: [
				{ name: "from.latitude", value: from.latitude.value, provenance: from.latitude.provenance },
				{ name: "from.longitude", value: from.longitude.value, provenance: from.longitude.provenance },
				{ name: "to.latitude", value: to.latitude.value, provenance: to.latitude.provenance },
				{ name: "to.longitude", value: to.longitude.value, provenance: to.longitude.provenance },
			],
		},
	]);
}

/** The first non-null value, with both candidates in the provenance so the trace shows what was passed over. */
export function coalesce<A extends JsonValue, B extends JsonValue>(
	first: Sourced<A> | null,
	second: Sourced<B>,
): Sourced<NonNullable<A> | B> {
	const inputs: [ComputationInput, ...ComputationInput[]] = [
		{ name: "first", value: first === null ? null : first.value, provenance: first === null ? [] : first.provenance },
		{ name: "second", value: second.value, provenance: second.provenance },
	];
	const provenance: [Provenance, ...Provenance[]] = [
		{ kind: "computation", formula: "coalesce", computedBy: KERNEL_VERSION, inputs },
	];
	if (first !== null && first.value !== null && first.value !== undefined) {
		return make(first.value, provenance);
	}
	return make(second.value, provenance);
}

export function fromQuery<T extends JsonValue>(q: QueryProvenance, value: T): Sourced<T> {
	return make(value, [q]);
}

const sealedBrand: unique symbol = Symbol("ground-truth.sealed");

export type Sealed<R> = R & { readonly [sealedBrand]: typeof sealedBrand };

export class UnbrandedValue extends Error {
	constructor(path: string) {
		super(`${path} is shaped like a Sourced value but was not produced by the evidence kernel`);
		this.name = "UnbrandedValue";
	}
}

function isBag(x: unknown): x is Readonly<Record<string, unknown>> {
	return typeof x === "object" && x !== null;
}

function freezeAll(x: unknown): void {
	if (!isBag(x)) return;
	Object.freeze(x);
	for (const key of Object.keys(x)) freezeAll(x[key]);
}

/**
 * Freezes everything. Outside a Sourced value, any `{value, provenance}` object
 * is a hand-built lookalike and is rejected. Inside one, the provenance was
 * built by the kernel and is only frozen.
 */
function deepFreeze(x: unknown, path: string): void {
	if (!isBag(x)) return;
	if (isSourced(x)) {
		freezeAll(x);
		return;
	}
	const bag: Readonly<Record<string, unknown>> = x;
	if ("value" in x && "provenance" in x) throw new UnbrandedValue(path);
	Object.freeze(bag);
	for (const key of Object.keys(bag)) deepFreeze(bag[key], `${path}.${key}`);
}

/** Deep-freezes the record and rejects any `{value, provenance}` lookalike that lacks the brand. */
export function seal<R extends { readonly kind: string }>(record: R): Sealed<R> {
	deepFreeze(record, record.kind);
	const sealed: Sealed<R> = { ...record, [sealedBrand]: sealedBrand };
	Object.freeze(sealed);
	return sealed;
}

export function isSealed(x: unknown): x is Sealed<object> {
	return typeof x === "object" && x !== null && sealedBrand in x && x[sealedBrand] === sealedBrand;
}
