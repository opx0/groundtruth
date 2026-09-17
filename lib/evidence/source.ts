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
			readonly query: QueryProvenance | null;
	  }
	| {
			readonly status: "no-data";
			readonly note: string;
			readonly retrievedAt: string;
			readonly query: QueryProvenance | null;
	  }
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

/**
 * Requests in the order they were issued. A slot is taken when `get` is called
 * and filled when it answers, so a leg that resolves first cannot displace the
 * leg that went first. A request that threw leaves its slot empty.
 */
type Issued = (PayloadRef | null)[];

function recordingInto(io: SourceIo, made: Issued, bound?: AbortSignal): SourceIo {
	return {
		get: async <Raw extends JsonValue>(
			url: URL,
			schema: z.ZodType<Raw>,
			signal?: AbortSignal,
		): Promise<Fetched<Raw>> => {
			const slot = made.length;
			made.push(null);
			const fetched = await io.get(url, schema, bound ?? signal);
			made[slot] = fetched.payload;
			return fetched;
		},
		query: (parameter, value, adapterVersion, payload) => io.query(parameter, value, adapterVersion, payload),
		now: () => io.now(),
	};
}

function boundTo(io: SourceIo, signal: AbortSignal, made: Issued): SourceIo {
	return recordingInto(io, made, signal);
}

export type WatchedIo = { readonly io: SourceIo; readonly made: readonly (PayloadRef | null)[] };

/**
 * An io that remembers what it fetched, for a caller that assembles its own
 * outcome instead of going through `runSource` and still owes its section a
 * request to name.
 */
export function watched(io: SourceIo): WatchedIo {
	const made: Issued = [];
	return { io: recordingInto(io, made), made };
}

/**
 * The request a section's own claims answer to: its count, its boundary, its
 * "no matching records" note.
 *
 * Read off what the adapter fetched rather than off the records it built,
 * because a source that matched nothing has no record to read it from, and
 * that is exactly the case where a reader wants to see what was asked.
 *
 * The first leg issued, never the first to answer and never the first by
 * timestamp: every adapter here asks its boundary question first and joins or
 * enriches afterwards, and a stub clock -- or a real one, inside a second --
 * ties the timestamps of every leg, which left the tiebreak to whichever URL
 * happened to sort first.
 */
export function requestMade(
	io: SourceIo,
	version: AdapterVersion,
	made: readonly (PayloadRef | null)[],
): QueryProvenance | null {
	const first = made.find((payload): payload is PayloadRef => payload !== null);
	return first === undefined ? null : io.query("request", first.url, version, first);
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

	const made: Issued = [];
	try {
		const built = await withTimeout(adapter.run(locus, boundTo(io, controller.signal, made)), policy.timeoutMs);
		const retrievedAt = io.now();
		const query = requestMade(io, adapter.version, made);
		const [first, ...rest] = built.map((b) => complete(locus, b));
		if (first === undefined) {
			return { status: "no-data", note: adapter.noDataNote ?? NO_DATA_NOTE, retrievedAt, query };
		}
		return { status: "ok", records: [first, ...rest], retrievedAt, query };
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
