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
	type JsonValue,
	type PayloadRef,
	type Provenance,
	type QueryProvenance,
	type Sealed,
} from "./sourced";
import type { z } from "zod";

export type Locus = {
	readonly point: GeoPoint;
	readonly radiusMeters: number;
};

export type FailureCause =
	| "cancelled"
	| "timeout"
	| "refused"
	| "rate-limited"
	| "http"
	| "malformed"
	| "not-configured"
	| "unknown";

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
	readonly rawCode: JsonValue | null;
	readonly retryAfter: string | null;
};

export type SourceOutcome<K extends Kind = Kind> =
	| {
			readonly status: "ok";
			readonly records: readonly [Sealed<RecordOf<K>>, ...Sealed<RecordOf<K>>[]];
			readonly retrievedAt: string;
	  }
	| { readonly status: "no-data"; readonly note: string; readonly retrievedAt: string }
	| SourceUnavailable;

export type SourceIo = {
	get<Raw extends JsonValue>(url: URL, schema: z.ZodType<Raw>, signal?: AbortSignal): Promise<Fetched<Raw>>;
	query(parameter: string, value: string | number, adapterVersion: AdapterVersion, payload: PayloadRef): QueryProvenance;
	now(): string;
};

export const NO_DATA_NOTE = "No matching records within the stated boundary.";

export type Adapter<K extends Kind> = {
	readonly kind: K;
	readonly source: RecordOf<K>["source"];
	readonly version: AdapterVersion;
	readonly noDataNote?: string;
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

export function complete<K extends Kind>(locus: Locus, built: Built<K> & { readonly kind: K }): Sealed<RecordOf<K>> {
	const found = new Map<string, PayloadRef>();
	collectPayloads(built, found, 0);
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

export function unavailableOf(error: unknown): SourceUnavailable {
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

function boundTo(io: SourceIo, signal: AbortSignal): SourceIo {
	return {
		get: <Raw extends JsonValue>(url: URL, schema: z.ZodType<Raw>): Promise<Fetched<Raw>> =>
			io.get(url, schema, signal),
		query: (parameter, value, adapterVersion, payload) => io.query(parameter, value, adapterVersion, payload),
		now: () => io.now(),
	};
}

export async function runSource<K extends Kind>(
	locus: Locus,
	adapter: Adapter<K>,
	io: SourceIo,
	policy: SourcePolicy,
	signal?: AbortSignal,
): Promise<SourceOutcome<K>> {
	const controller = new AbortController();
	const stop = (): void => controller.abort();
	// `addEventListener` never fires for a signal that has already aborted, so
	// the standing state is read as well as the future event.
	if (signal?.aborted === true) controller.abort();
	else signal?.addEventListener("abort", stop, { once: true });

	try {
		const built = await withTimeout(adapter.run(locus, boundTo(io, controller.signal)), policy.timeoutMs);
		const retrievedAt = io.now();
		const [first, ...rest] = built.map((b) => complete(locus, b));
		if (first === undefined) {
			return { status: "no-data", note: adapter.noDataNote ?? NO_DATA_NOTE, retrievedAt };
		}
		return { status: "ok", records: [first, ...rest], retrievedAt };
	} catch (error) {
		controller.abort();
		return unavailableOf(error);
	} finally {
		signal?.removeEventListener("abort", stop);
	}
}

export const DEFAULT_POLICY: SourcePolicy = { timeoutMs: 8000 };

export async function runSources(
	locus: Locus,
	adapters: { readonly [S in Exclude<SourceId, "census">]: Adapter<Kind> },
	io: SourceIo,
	policies: Partial<Record<SourceId, SourcePolicy>> = {},
	signal?: AbortSignal,
): Promise<SourceMap> {
	const run = (s: Exclude<SourceId, "census">): Promise<SourceOutcome> =>
		runSource(locus, adapters[s], io, policies[s] ?? DEFAULT_POLICY, signal);
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
