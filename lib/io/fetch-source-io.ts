/**
 * The real `SourceIo`. Every adapter in this codebase has so far only ever
 * been driven by a fixture-backed test double; this is the first
 * implementation that touches the network, so every adapter that runs
 * against a live source runs on what is written here.
 *
 * Three obligations, per `docs/BRIEF.md` B1 and the unit brief:
 *
 * 1. `fetch` with `AbortController`, so a hung request cannot block a source
 *    forever. The timeout is a property of the `SourceIo` instance, not of
 *    each call, because `SourceIo.get` has no parameter for it.
 * 2. A SHA-256 of the exact bytes the response carried -- computed from the
 *    raw `ArrayBuffer`, before any JSON parsing, so a byte the parser would
 *    normalize away (whitespace, key order) still changes the hash. That is
 *    what makes the hash worth anything as a "this is what we saw" record.
 * 3. The retrieval timestamp, from one clock shared by `get` and `now`, so a
 *    record's payload and its outcome's `retrievedAt` cannot disagree.
 *
 * This module has no address-specific logic anywhere in it, and that is
 * deliberate: it fetches whatever `URL` it is given and reports what came
 * back, nothing more. `lib/adapters/census.ts` is the caller that hands this
 * `get` a URL carrying a raw address, and it is that caller's job -- already
 * done, see its `citablePayload` -- to rebuild a redacted payload before
 * anything reaches a return value, because this file's `payload.url` is
 * always the exact URL it fetched, address and all if the caller put one
 * there. Nothing here may start trying to guess at redaction; that would
 * just be a second, uncoordinated place doing the job the caller already
 * owns and is tested against.
 *
 * A thrown `SourceFailure` never carries the URL, the response body, or the
 * caught error's own message: only the fixed `FailureCause` enum and, for a
 * rate limit, the `Retry-After` header. Whatever the underlying `fetch`
 * threw is discarded rather than wrapped, because a runtime's own network
 * error can otherwise repeat the failing URL back in its message.
 */

import { createHash } from "node:crypto";
import { SourceFailure } from "@/lib/evidence";
import type { AdapterVersion, Fetched, JsonValue, PayloadRef, QueryProvenance, SourceIo } from "@/lib/evidence";
import type { z } from "zod";

export type FetchSourceIoOptions = {
	/** `AbortController.abort()` fires once this many milliseconds have elapsed since the request was issued. */
	readonly timeoutMs?: number;
	/** Overridable so a test can assert an exact `retrievedAt` and `now()`. Defaults to wall-clock UTC. */
	readonly clock?: () => string;
};

/** Matches `lib/evidence/source.ts`'s `DEFAULT_POLICY`, the budget for one whole adapter run. */
const DEFAULT_TIMEOUT_MS = 8_000;

/** The one implementation of `SourceIo` that reaches the network. */
export function createFetchSourceIo(options: FetchSourceIoOptions = {}): SourceIo {
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const clock = options.clock ?? ((): string => new Date().toISOString());

	async function get<Raw extends JsonValue>(
		url: URL,
		schema: z.ZodType<Raw>,
		signal?: AbortSignal,
	): Promise<Fetched<Raw>> {
		// Two reasons this request can stop early and they are opposite claims
		// about whose fault it was, so the caller's is checked before the timer's.
		// Merging them would have a trace say a source timed out when in fact
		// nobody was waiting for it any more.
		//
		// Read through a function rather than inline, because `aborted` flips
		// asynchronously and narrowing it once tells the compiler it cannot
		// change. Checked inline, the second read below is `false | undefined`
		// and TypeScript rejects the comparison as unreachable. It is not: that
		// is the exact interval this whole change exists to notice.
		const cancelled = (): boolean => signal?.aborted === true;
		if (cancelled()) throw new SourceFailure("cancelled");

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		const abandon = (): void => controller.abort();
		signal?.addEventListener("abort", abandon, { once: true });

		let response: Response;
		try {
			response = await fetch(url, {
				signal: controller.signal,
				headers: { accept: "application/json" },
				cache: "no-store",
			});
		} catch {
			// The caught error is never inspected or forwarded: some runtimes'
			// own network errors repeat the request URL in their message, and
			// that URL may carry an address.
			if (cancelled()) throw new SourceFailure("cancelled");
			throw controller.signal.aborted ? new SourceFailure("timeout") : new SourceFailure("refused");
		} finally {
			clearTimeout(timer);
			signal?.removeEventListener("abort", abandon);
		}

		const bytes = new Uint8Array(await response.arrayBuffer());
		const sha256 = createHash("sha256").update(bytes).digest("hex");
		const payload: PayloadRef = { url: url.toString(), sha256, retrievedAt: clock() };

		if (response.status === 429) {
			throw new SourceFailure("rate-limited", response.status, response.headers.get("retry-after"));
		}
		if (!response.ok) {
			throw new SourceFailure("http", response.status);
		}

		let json: unknown;
		try {
			json = JSON.parse(new TextDecoder("utf-8").decode(bytes));
		} catch {
			throw new SourceFailure("malformed", null);
		}

		const parsed = schema.safeParse(json);
		if (!parsed.success) throw new SourceFailure("malformed", null);
		return { raw: parsed.data, payload };
	}

	function query(
		parameter: string,
		value: string | number,
		adapterVersion: AdapterVersion,
		payload: PayloadRef,
	): QueryProvenance {
		return { kind: "query", parameter, value, adapterVersion, payload };
	}

	return { get, query, now: clock };
}
