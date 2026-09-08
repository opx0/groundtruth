/**
 * The adapter contract, source outcomes, and the step that completes a record.
 *
 * An adapter returns `Built<K>` values: everything it read from the source and
 * nothing the kernel owns. `complete` fills `id`, `distanceMeters` (always
 * haversine from the locus, never read from a source), and `payloads` (every
 * payload named anywhere in the record's provenance), then seals.
 */

import {
	recordId,
	storeOf,
	type Built,
	type EvidenceStore,
	type Kind,
	type RecordOf,
	type SourceId,
} from "./records";
import {
	haversine,
	isSourced,
	ReaderInvariant,
	seal,
	UnbrandedValue,
	type AdapterVersion,
	type Fetched,
	type GeoPoint,
	type JsonObject,
	type JsonValue,
	type PayloadRef,
	type Provenance,
	type QueryProvenance,
	type Sealed,
} from "./sourced";
import type { z } from "zod";

/** Where the report is centred. A point and a radius; there is no address field to leak. */
export type Locus = {
	readonly point: GeoPoint;
	readonly radiusMeters: number;
};

export type FailureCause = "timeout" | "refused" | "rate-limited" | "http" | "malformed" | "unknown";

/** Thrown by `SourceIo` and adapters. Carries no body and no coordinate. */
export class SourceFailure extends Error {
	readonly reason: FailureCause;
	readonly rawCode: JsonValue | null;
	readonly retryAfter: string | null;
	constructor(reason: FailureCause, rawCode: JsonValue | null = null, retryAfter: string | null = null) {
		super(`source ${reason}`);
		this.name = "SourceFailure";
		this.reason = reason;
		this.rawCode = rawCode;
		this.retryAfter = retryAfter;
	}
}

export type SourceUnavailable = {
	readonly status: "unavailable";
	readonly cause: FailureCause;
	/** Whatever the source said, never mapped into our vocabulary. */
	readonly rawCode: JsonValue | null;
	readonly retryAfter: string | null;
};

/** Three outcomes, per SYNTHESIS.md graft 2. Success carries at least one record, so zero records cannot pose as success. */
export type SourceOutcome<K extends Kind = Kind> =
	| {
			readonly status: "ok";
			readonly records: readonly [Sealed<RecordOf<K>>, ...Sealed<RecordOf<K>>[]];
			readonly retrievedAt: string;
	  }
	| { readonly status: "no-data"; readonly note: string; readonly retrievedAt: string }
	| SourceUnavailable;

export type SourceIo = {
	/** Fetch, hash, stamp, parse. Throws SourceFailure on timeout, http, or malformed. */
	get<Raw extends JsonObject>(url: URL, schema: z.ZodType<Raw>): Promise<Fetched<Raw>>;
	query(parameter: string, value: string | number, adapterVersion: AdapterVersion, payload: PayloadRef): QueryProvenance;
	now(): string;
};

export type Adapter<K extends Kind> = {
	readonly kind: K;
	readonly source: RecordOf<K>["source"];
	readonly version: AdapterVersion;
	run(locus: Locus, io: SourceIo): Promise<readonly Built<K>[]>;
};

export type SourcePolicy = { readonly timeoutMs: number };

export type SourceMap = { readonly [S in Exclude<SourceId, "census">]: SourceOutcome };

function isBag(x: unknown): x is Readonly<Record<string, unknown>> {
	return typeof x === "object" && x !== null;
}

function collectPayloads(x: unknown, into: Map<string, PayloadRef>, depth: number): void {
	if (!isBag(x) || depth > 6) return;
	if (isSourced(x)) {
		for (const p of x.provenance) collectFromProvenance(p, into, depth + 1);
		return;
	}
	for (const key of Object.keys(x)) collectPayloads(x[key], into, depth + 1);
}

function collectFromProvenance(p: Provenance, into: Map<string, PayloadRef>, depth: number): void {
	if (p.kind === "computation") {
		for (const input of p.inputs) for (const inner of input.provenance) collectFromProvenance(inner, into, depth + 1);
		return;
	}
	into.set(`${p.payload.sha256}|${p.payload.url}`, p.payload);
}

export class NoPayload extends Error {
	constructor(kind: string, sourceRecordId: string) {
		super(`${kind} ${sourceRecordId} names no payload in any field's provenance`);
		this.name = "NoPayload";
	}
}

/**
 * Fills the kernel-owned fields and seals. The only way to obtain a
 * `Sealed<RecordOf<K>>`. `K` is inferred from `built.kind`; the intersection
 * is only there because inference cannot see through the kind table.
 */
export function complete<K extends Kind>(locus: Locus, built: Built<K> & { readonly kind: K }): Sealed<RecordOf<K>> {
	const found = new Map<string, PayloadRef>();
	collectPayloads(built, found, 0);
	// Fetch order live, and independent of the adapter's field order.
	const ordered = [...found.values()].sort(
		(a, b) => a.retrievedAt.localeCompare(b.retrievedAt) || a.url.localeCompare(b.url),
	);
	const [first, ...rest] = ordered;
	if (first === undefined) throw new NoPayload(built.kind, built.sourceRecordId);
	const distanceMeters = built.location === null ? null : haversine(locus.point, built.location);
	return seal({
		...built,
		id: recordId(built.kind, built.sourceRecordId),
		distanceMeters,
		payloads: [first, ...rest],
	});
}

/** A kernel invariant (a reader given the wrong shape, a lookalike, no payload) means our parse of the response failed: malformed, named. */
function failureOf(error: unknown): SourceUnavailable {
	if (error instanceof SourceFailure) {
		return { status: "unavailable", cause: error.reason, rawCode: error.rawCode, retryAfter: error.retryAfter };
	}
	if (error instanceof ReaderInvariant || error instanceof UnbrandedValue || error instanceof NoPayload) {
		return { status: "unavailable", cause: "malformed", rawCode: error.name, retryAfter: null };
	}
	return { status: "unavailable", cause: "unknown", rawCode: null, retryAfter: null };
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new SourceFailure("timeout")), timeoutMs);
		work.then(
			(v) => {
				clearTimeout(timer);
				resolve(v);
			},
			(e: unknown) => {
				clearTimeout(timer);
				reject(e instanceof Error ? e : new SourceFailure("unknown"));
			},
		);
	});
}

export async function runSource<K extends Kind>(
	locus: Locus,
	adapter: Adapter<K>,
	io: SourceIo,
	policy: SourcePolicy,
): Promise<SourceOutcome<K>> {
	try {
		const built = await withTimeout(adapter.run(locus, io), policy.timeoutMs);
		const retrievedAt = io.now();
		const [first, ...rest] = built.map((b) => complete(locus, b));
		if (first === undefined) {
			return { status: "no-data", note: "No matching records within the stated boundary.", retrievedAt };
		}
		return { status: "ok", records: [first, ...rest], retrievedAt };
	} catch (error) {
		return failureOf(error);
	}
}

export const DEFAULT_POLICY: SourcePolicy = { timeoutMs: 8000 };

/** Every source settles independently; a failing one never blocks another. Never rejects. */
export async function runSources(
	locus: Locus,
	adapters: { readonly [S in Exclude<SourceId, "census">]: Adapter<Kind> },
	io: SourceIo,
	policies: Partial<Record<SourceId, SourcePolicy>> = {},
): Promise<SourceMap> {
	const run = (s: Exclude<SourceId, "census">): Promise<SourceOutcome> =>
		runSource(locus, adapters[s], io, policies[s] ?? DEFAULT_POLICY);
	const [echo, frs, sems, aqs, airnow, fema] = await Promise.all([
		run("echo"),
		run("frs"),
		run("sems"),
		run("aqs"),
		run("airnow"),
		run("fema"),
	]);
	return { echo, frs, sems, aqs, airnow, fema };
}

export function storeOfSources(sources: SourceMap): EvidenceStore {
	const records: Sealed<RecordOf<Kind>>[] = [];
	for (const outcome of Object.values(sources)) {
		if (outcome.status === "ok") records.push(...outcome.records);
	}
	return storeOf(records);
}
