/**
 * The provenance-carrying value.
 *
 * The only ways to obtain a `Sourced<T>` are the readers returned by
 * `fieldsOf`, the formulas `haversine`, `coalesce`, and `urlFrom`, and
 * `fromQuery`. Each of those captures where the value came from at the moment
 * it is read. The brand symbol is not exported, so no other module can build
 * one by hand, and `seal` rejects any lookalike at runtime.
 *
 * A `Sourced<T>` is always a scalar leaf. A value with structure, an address
 * range of two strings or a facility's status under each of four statutes, is
 * a plain frozen container of leaves, built by `pick`, never one `Sourced`
 * wrapping an object. That is what lets the trace list every element by its
 * own path ("programStatuses.CAA") with the field it came from, instead of one
 * provenance for the whole container. `GeoPoint` is the same shape, built by
 * `point`.
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
	| "parse-currency"
	| "normalize-date"
	| "parse-us-date"
	| "parse-epoch-ms"
	| "map-boolean"
	/** A code to the word the source's own field description gives it. The code and this transform's name stay in the trace, so the mapping is on screen rather than silent. */
	| "map-code"
	| "join-fields";

export type Formula = "haversine" | "coalesce" | "url-template";

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

/** One validated response. `Raw` is any JSON value: Envirofacts answers with a bare array, and that is a payload too. */
export type Fetched<Raw extends JsonValue> = {
	readonly raw: Raw;
	readonly payload: PayloadRef;
};

/** The keys of `Raw` whose value type is assignable to `T`. */
export type KeysWhere<Raw, T> = {
	[P in keyof Raw & string]: Raw[P] extends T ? P : never;
}[keyof Raw & string];

/**
 * The spec of a structured value: each name the record will use, mapped to the
 * text field of the row it is read from. Only text fields, because every
 * structured value an adapter has needed so far is made of them; a shape that
 * needs another transform is a new reader, not a loosened spec.
 */
export type PickSpec<Raw> = { readonly [name: string]: KeysWhere<Raw, string | null> };

/** What `pick` builds: a frozen container with one `Sourced` leaf per name, typed from the field it names. */
export type Picked<Raw, S extends PickSpec<Raw>> = { readonly [N in keyof S]: Sourced<Raw[S[N]]> };

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

	/** "$0" or "$1,250.00" to a number. The string the source sent, symbol and all, is the trace's raw value. */
	currency<P extends KeysWhere<Raw, string>>(field: P): Sourced<number>;
	currency<P extends KeysWhere<Raw, string | null>>(field: P): Sourced<number | null>;

	date<P extends KeysWhere<Raw, string>>(field: P): Sourced<string>;
	date<P extends KeysWhere<Raw, string | null>>(field: P): Sourced<string | null>;

	/** "08/12/2024", month first, to "2024-08-12". The raw string survives in the trace, so the reordering is visible. */
	usDate<P extends KeysWhere<Raw, string>>(field: P): Sourced<string>;
	usDate<P extends KeysWhere<Raw, string | null>>(field: P): Sourced<string | null>;

	epochMs<P extends KeysWhere<Raw, number>>(field: P): Sourced<string>;
	epochMs<P extends KeysWhere<Raw, number | null>>(field: P): Sourced<string | null>;

	flag<P extends KeysWhere<Raw, string | null>>(
		field: P,
		map: Readonly<Record<string, boolean>>,
	): Sourced<boolean | null>;

	/**
	 * A code read as the word the agency's own field description gives it:
	 * FEMA's `SFHA_TF` is "T" or "F" for inside or outside the Special Flood
	 * Hazard Area, and a boolean cannot be printed. Null for a code the table
	 * does not hold, exactly as `flag` does, so an unmapped value is visible as
	 * an absence rather than guessed at. The raw code is the trace's raw value
	 * and the transform is named, so nothing here is a silent rewrite.
	 */
	map<P extends KeysWhere<Raw, string | null>>(
		field: P,
		table: Readonly<Record<string, string>>,
	): Sourced<string | null>;

	join<P extends KeysWhere<Raw, string | null>>(
		fields: readonly [P, ...P[]],
		separator: string,
	): Sourced<string | null>;

	absent(field: string): Sourced<null>;

	/**
	 * A structured value: several text fields of this row, read at once into
	 * one frozen container keyed by the names the record uses. Each leaf is an
	 * ordinary `text` read with its own field provenance, so the trace lists
	 * "addressRange.from" against `fromAddress`, not one provenance for the
	 * pair. A list is many rows picked the same way, one reader per row.
	 */
	pick<S extends PickSpec<Raw>>(spec: S): Picked<Raw, S>;

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

/**
 * "$0" -> 0, "$1,250.50" -> 1250.5, "-$40" -> -40. An optional sign, an
 * optional dollar sign, digits with optional thousands separators, an optional
 * fraction. Anything else is a `ReaderInvariant`, not a guess.
 */
function parseCurrency(raw: string): number {
	const match = /^\s*(-?)\s*\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*$/.exec(raw);
	const sign = match?.[1];
	const whole = match?.[2];
	if (match === null || sign === undefined || whole === undefined) {
		throw new ReaderInvariant(`"${raw}" is not a currency amount`);
	}
	return Number(`${sign}${whole.replace(/,/g, "")}${match[3] ?? ""}`);
}

function twoDigits(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}

/** "08/12/2024" -> "2024-08-12". Month first, always; a day past the month's end or any other shape is a `ReaderInvariant`. */
function usDateToIso(raw: string): string {
	const match = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(raw);
	const month = Number(match?.[1]);
	const day = Number(match?.[2]);
	const year = Number(match?.[3]);
	const d = new Date(Date.UTC(year, month - 1, day));
	if (
		match === null ||
		d.getUTCFullYear() !== year ||
		d.getUTCMonth() !== month - 1 ||
		d.getUTCDate() !== day
	) {
		throw new ReaderInvariant(`"${raw}" is not a month/day/year date`);
	}
	return `${year}-${twoDigits(month)}-${twoDigits(day)}`;
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

	function currency<P extends KeysWhere<Raw, string>>(name: P): Sourced<number>;
	function currency<P extends KeysWhere<Raw, string | null>>(name: P): Sourced<number | null>;
	function currency(name: string): Sourced<number | null> {
		const v = bag[name];
		// The provenance is built first, from the untouched raw value: the trace
		// reports "$0" because that is what arrived, whatever the value became.
		const p = field(name, "parse-currency");
		if (v === null) return make(null, [p]);
		if (typeof v === "string") return make(parseCurrency(v), [p]);
		throw new ReaderInvariant(`${dataset}.${name} is not a currency string`);
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

	function usDate<P extends KeysWhere<Raw, string>>(name: P): Sourced<string>;
	function usDate<P extends KeysWhere<Raw, string | null>>(name: P): Sourced<string | null>;
	function usDate(name: string): Sourced<string | null> {
		const v = bag[name];
		const p = field(name, "parse-us-date");
		if (v === null) return make(null, [p]);
		if (typeof v === "string") return make(usDateToIso(v), [p]);
		throw new ReaderInvariant(`${dataset}.${name} is not a month/day/year string`);
	}

	/** `text` for one name of a spec, checked at runtime as well as by type because the field name arrived through data. */
	function textLeaf<S extends PickSpec<Raw>, K extends keyof S & string>(spec: S, name: K): Sourced<Raw[S[K]]> {
		const sourceField: S[K] = spec[name];
		const v = raw[sourceField];
		if (v !== null && typeof v !== "string") throw new ReaderInvariant(`${dataset}.${sourceField} is not a string`);
		return make(v, [field(sourceField, "identity")]);
	}

	/** True once every name in the spec has its leaf: the one place a container-in-progress becomes a `Picked`. */
	function isPicked<S extends PickSpec<Raw>>(spec: S, out: Partial<Picked<Raw, S>>): out is Picked<Raw, S> {
		return Object.keys(spec).every((name) => name in out);
	}

	function pick<S extends PickSpec<Raw>>(spec: S): Picked<Raw, S> {
		if (Object.keys(spec).length === 0) {
			throw new ReaderInvariant(`${dataset}: a structured value needs at least one field`);
		}
		const out: Partial<Picked<Raw, S>> = {};
		for (const name in spec) out[name] = textLeaf(spec, name);
		if (!isPicked(spec, out)) throw new ReaderInvariant(`${dataset}: a picked field was not read`);
		return Object.freeze(out);
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

	function mapCode(name: string, table: Readonly<Record<string, string>>): Sourced<string | null> {
		const v = bag[name];
		const p = field(name, "map-code");
		if (typeof v !== "string") return make(null, [p]);
		const mapped = table[v];
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

	return {
		raw,
		dataset,
		payload,
		text,
		number,
		currency,
		date,
		usDate,
		epochMs,
		flag,
		map: mapCode,
		join,
		absent,
		pick,
		point,
	};
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

/** The one slot a source-record URL template may carry. */
const SLOT = "{id}";

/**
 * The record's link on the agency's own site, built from an identifier the
 * kernel read from the source. The template names the slot exactly once as
 * `{id}`, so the trace shows both the raw field the identifier came from and
 * the template that shaped the URL, and a template that lost its slot, or an
 * empty identifier, is a `ReaderInvariant` rather than a confident wrong link.
 */
export function urlFrom(template: string, id: Sourced<string>): Sourced<string> {
	if (template.split(SLOT).length !== 2) {
		throw new ReaderInvariant(`url template "${template}" must contain ${SLOT} exactly once`);
	}
	if (id.value === "") throw new ReaderInvariant(`url template "${template}" was given an empty identifier`);
	const url = template.replace(SLOT, encodeURIComponent(id.value));
	return make(url, [
		{
			kind: "computation",
			formula: "url-template",
			computedBy: KERNEL_VERSION,
			inputs: [
				{ name: "template", value: template, provenance: [] },
				{ name: "id", value: id.value, provenance: id.provenance },
			],
		},
	]);
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
