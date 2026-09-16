import { createHash } from "node:crypto";
import type { Fetched, JsonValue, PayloadRef, SourceIo } from "@/lib/evidence";
import type { z } from "zod";

const MINUTE_MS = 60_000;

export type CachedSource = "echo" | "frs" | "sems" | "aqs" | "airnow" | "fema";

export const TTL_MS: { readonly [S in CachedSource]: number } = {
	airnow: 10 * MINUTE_MS,
	echo: 60 * MINUTE_MS,
	frs: 60 * MINUTE_MS,
	sems: 60 * MINUTE_MS,
	aqs: 60 * MINUTE_MS,
	fema: 60 * MINUTE_MS,
};

type Endpoint = {
	readonly host: string;
	readonly path: string;
	readonly source: CachedSource;
};

const ENDPOINTS: readonly Endpoint[] = [
	{ host: "www.airnowapi.org", path: "/aq/", source: "airnow" },
	{ host: "airnowapi.org", path: "/aq/", source: "airnow" },
	{ host: "echodata.epa.gov", path: "/echo/", source: "echo" },
	{ host: "aqs.epa.gov", path: "/data/api/", source: "aqs" },
	{ host: "services.arcgis.com", path: "/cJ9YHowT8TU7DUyn/arcgis/rest/services/FRS_INTERESTS_SEMS/", source: "sems" },
	{ host: "data.epa.gov", path: "/efservice/", source: "sems" },
	{ host: "services.arcgis.com", path: "/cJ9YHowT8TU7DUyn/arcgis/rest/services/FRS_INTERESTS/", source: "frs" },
	{ host: "hazards.fema.gov", path: "/arcgis/rest/services/public/NFHL/", source: "fema" },
	{
		host: "services.arcgis.com",
		path: "/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Flood_Hazard_Reduced_Set_gdb/",
		source: "fema",
	},
];

export function cacheTtlMs(url: URL): number | null {
	if (url.protocol !== "https:") return null;
	const endpoint = ENDPOINTS.find((e) => e.host === url.host && url.pathname.startsWith(e.path));
	return endpoint === undefined ? null : TTL_MS[endpoint.source];
}

export function cacheKey(url: URL): string {
	return createHash("sha256").update(url.toString(), "utf8").digest("hex");
}

export const MAX_ENTRIES = 256;

type Entry = {
	readonly raw: JsonValue;
	readonly payload: PayloadRef;
	readonly expiresAtMs: number;
};

export type CacheSourceIoOptions = {
	readonly maxEntries?: number;
};

export function createCacheSourceIo(inner: SourceIo, options: CacheSourceIoOptions = {}): SourceIo {
	const maxEntries = options.maxEntries ?? MAX_ENTRIES;
	const entries = new Map<string, Entry>();

	function nowMs(): number {
		return Date.parse(inner.now());
	}

	function live(entry: Entry, atMs: number): boolean {
		return atMs < entry.expiresAtMs;
	}

	function dropExpired(atMs: number): void {
		for (const [key, entry] of entries) {
			if (!live(entry, atMs)) entries.delete(key);
		}
	}

	function evictOldest(): void {
		for (const key of entries.keys()) {
			entries.delete(key);
			return;
		}
	}

	function remember(key: string, fetched: Fetched<JsonValue>, ttlMs: number): void {
		entries.delete(key);
		entries.set(key, {
			raw: structuredClone(fetched.raw),
			payload: structuredClone(fetched.payload),
			expiresAtMs: Date.parse(fetched.payload.retrievedAt) + ttlMs,
		});
		while (entries.size > maxEntries) evictOldest();
	}

	async function get<Raw extends JsonValue>(
		url: URL,
		schema: z.ZodType<Raw>,
		signal?: AbortSignal,
	): Promise<Fetched<Raw>> {
		const ttlMs = cacheTtlMs(url);
		if (ttlMs === null) return inner.get(url, schema, signal);

		const key = cacheKey(url);
		const atMs = nowMs();
		dropExpired(atMs);

		const entry = entries.get(key);
		if (entry !== undefined) {
			const parsed = schema.safeParse(structuredClone(entry.raw));
			if (parsed.success) return { raw: parsed.data, payload: structuredClone(entry.payload) };
			entries.delete(key);
		}

		const fetched = await inner.get(url, schema, signal);
		remember(key, fetched, ttlMs);
		return fetched;
	}

	return { get, query: inner.query, now: inner.now };
}
