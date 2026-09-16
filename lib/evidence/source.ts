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

/**
 * Why a source could not be asked, or could not answer.
 *
 * `not-configured` is the one that is not about the network: this
 * deployment holds no credential for a source that requires one, so no
 * request was made. Three separate units reported the enum missing it and
 * each settled for `unknown` with a `rawCode` -- which made a card say the
 * reason was not known when it was the one thing that was. It is a failure
 * rather than a fourth outcome because the reader's question is the same:
 * this source is not on the report, and here is why.
 *
 * `cancelled` is the other one that is not about the source at all. The reader
 * closed the tab, so the work was abandoned mid-flight. It is separated from
 * `timeout` because the two are opposite claims about whose fault it was, and
 * a trace that said a source timed out when in fact nobody was waiting for it
 * any more would be this codebase's own kind of lie. A card carrying it is
 * built but never sent, because by definition nobody is there to read it.
 */
export type FailureCause =
	| "cancelled"
	| "timeout"
	| "refused"
	| "rate-limited"
	| "http"
	| "malformed"
	| "not-configured"
	| "unknown";

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
	/**
	 * Fetch, hash, stamp, parse. Throws SourceFailure on timeout, http, or
	 * malformed. `Raw` may be a bare array: Envirofacts sends one.
	 *
	 * `signal` is optional because almost nobody is the caller. No adapter ever
	 * passes one. It belongs to whoever owns the reason the work should stop,
	 * which is `runSource` for a source that has spent its budget and the report
	 * route for a reader who has gone. Both bind it to the whole io for one run
	 * rather than threading it down, so an adapter that loops over fifteen sites
	 * needs no change to become cancellable. An implementation that ignores it is
	 * still correct, only uncancellable, which every test double here is.
	 */
	get<Raw extends JsonValue>(url: URL, schema: z.ZodType<Raw>, signal?: AbortSignal): Promise<Fetched<Raw>>;
	query(parameter: string, value: string | number, adapterVersion: AdapterVersion, payload: PayloadRef): QueryProvenance;
	now(): string;
};

/** The wording of a no-data outcome when nothing better is known about why the source answered empty. */
export const NO_DATA_NOTE = "No matching records within the stated boundary.";

export type Adapter<K extends Kind> = {
	readonly kind: K;
	readonly source: RecordOf<K>["source"];
	readonly version: AdapterVersion;
	/**
	 * What an empty answer from this adapter means, in its own words, when it
	 * means something more specific than `NO_DATA_NOTE`. The flood adapters
	 * need it: an empty answer from FEMA's layer and from Esri's reduced copy
	 * are different facts.
	 */
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

/**
 * Classifies a thrown error as an unavailable outcome. A `SourceFailure`
 * carries its own cause; a kernel invariant (a reader given the wrong shape, a
 * lookalike, no payload) means our parse of the response failed: malformed,
 * named. Anything else is unknown, with no body carried out. Exported so an
 * adapter that fans out to per-record requests can classify one failed
 * request the same way the kernel classifies a failed source, rather than
 * inventing a cause of its own.
 */
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
 * The same io, with one signal bound into every request it makes.
 *
 * This is what makes a looping adapter cancellable without changing a line of
 * it. SEMS asks Envirofacts fifteen times, ECHO walks its pages, FRS walks its
 * registry IDs, and not one of them knows a signal exists: they call `get` on
 * whatever io they were handed, and this decides what that means. The
 * alternative on the table was threading an `AbortSignal` parameter through
 * every adapter, which is a change to every loop in the codebase to express
 * something none of those loops has an opinion about.
 *
 * `query` and `now` are wrapped rather than passed by reference, so an
 * implementation that uses `this` is not quietly unbound on the way through.
 */
function boundTo(io: SourceIo, signal: AbortSignal): SourceIo {
	return {
		get: <Raw extends JsonValue>(url: URL, schema: z.ZodType<Raw>): Promise<Fetched<Raw>> =>
			io.get(url, schema, signal),
		query: (parameter, value, adapterVersion, payload) => io.query(parameter, value, adapterVersion, payload),
		now: () => io.now(),
	};
}

/**
 * `signal` is the caller's reason to stop, and the report route's is the reader
 * having closed the tab.
 *
 * Two things end an adapter's work here and until 2026-09-17 neither stopped
 * it. `withTimeout` below rejects the race and walks away, so an adapter whose
 * budget expired kept looping and kept issuing requests after the card that
 * gave up on it had already been sent. And a disconnected reader stopped events
 * without stopping requests: twenty-two of a report's twenty-five upstream
 * requests were issued after the reader had gone, measured and recorded in
 * `app/api/report/handler.ts`.
 *
 * Both are the same missing thing, so both get the same one. This function owns
 * a controller, binds it into the io, and fires it the moment the run is over
 * by any route other than success. The caller's signal chains into it.
 */
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
		// The abort is the point. Whatever ended this run, the adapter behind it
		// may still be mid-loop, and this is the only thing that reaches it.
		controller.abort();
		return unavailableOf(error);
	} finally {
		signal?.removeEventListener("abort", stop);
	}
}

export const DEFAULT_POLICY: SourcePolicy = { timeoutMs: 8000 };

/** Every source settles independently; a failing one never blocks another. Never rejects. */
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
