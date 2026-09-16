import { createHash } from "node:crypto";
import { SourceFailure } from "@/lib/evidence";
import type { AdapterVersion, Fetched, JsonValue, PayloadRef, QueryProvenance, SourceIo } from "@/lib/evidence";
import type { z } from "zod";

export type FetchSourceIoOptions = {
	readonly timeoutMs?: number;
	readonly clock?: () => string;
};

const DEFAULT_TIMEOUT_MS = 8_000;

export function createFetchSourceIo(options: FetchSourceIoOptions = {}): SourceIo {
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const clock = options.clock ?? ((): string => new Date().toISOString());

	async function get<Raw extends JsonValue>(
		url: URL,
		schema: z.ZodType<Raw>,
		signal?: AbortSignal,
	): Promise<Fetched<Raw>> {
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
