/**
 * The coordinate cache of `docs/BRIEF.md` B9, as a `SourceIo` that wraps
 * another `SourceIo`.
 *
 * WHY A DECORATOR. `SourceIo` is the one seam every adapter fetches through,
 * so a caching `SourceIo` puts the whole TTL table in one file and changes no
 * adapter. It also means the cache can only ever see what the seam passes:
 * a `URL` and a schema. There is no request, no header, no cookie and no
 * socket in scope here, which is why B9's "no cache key tied to a user,
 * session, IP, or browser" is true by construction rather than by care.
 *
 * WHAT THE KEY IS. The SHA-256, in hex, of the exact URL string an adapter
 * asked for -- scheme, host, path, and every query parameter in the order the
 * adapter wrote them. Two properties follow, and both are load-bearing:
 *
 *   1. It is *complete*. Every byte of the request is in the digest, so no two
 *      different requests share an entry. A cache that keyed on less -- host
 *      and latitude, say, rounded -- would serve one point's bytes as another
 *      point's answer, which is a correctness bug wearing a privacy bug's
 *      clothes.
 *   2. It is *only* the URL. Nothing about who asked is in it, because nothing
 *      about who asked reaches this file.
 *
 * WHAT AN OPERATOR WOULD SEE IN A HEAP DUMP. The index is 64 hex characters
 * per entry and reads as nothing: no coordinate, no address, no credential.
 * The values are a different matter and this file will not pretend otherwise
 * -- an entry holds the `PayloadRef` the fetch returned, whose `url` is the
 * exact URL fetched, and the parsed response body. So a dump taken while the
 * cache is warm shows, in the values, the coordinates the report was built
 * for and, for AirNow and AQS, the configured credential that was in the
 * query string. That is the same thing a dump taken during an in-flight
 * request shows; what the cache changes is the window, from milliseconds to
 * the TTL. The digest is still worth having: the enumerable part of the
 * structure, the part a debugging aid prints when someone types
 * `[...cache.keys()]`, is a list of digests and not a list of searches.
 *
 * AND WHAT IT WOULD NOT SEE. No user identifier, session identifier, IP,
 * cookie, or browser fingerprint, in any entry, in any field -- there is no
 * code path by which one could arrive. No address either: the one request in
 * this codebase that carries an address is the geocoder, and the geocoder is
 * not in the table below (B9: "geocoder none"). The report route is also the
 * only route that wraps its io in this decorator; `app/api/geocode/route.ts`
 * uses the bare fetch io. Two independent reasons, both of which would have
 * to be undone.
 *
 * WHAT IS NEVER CACHED. A `SourceFailure`. A timeout or a refusal propagates
 * and is forgotten, so a source that was down a minute ago is asked again
 * rather than being reported down for the next hour.
 *
 * THE CLOCK IS NOT FROZEN. `now` is the inner io's `now`, passed straight
 * through, because the kernel stamps every outcome with it. And a served
 * entry's `payload` is returned byte for byte as the fetch produced it, so a
 * record's `retrievedAt` is when the bytes arrived and never when they were
 * handed out of this map. B9's "expired data never renders as current"
 * depends on that: the trace panel shows the retrieval time, and a cache that
 * restamped it would make an hour-old answer claim to be new.
 *
 * BYTE FOR BYTE, AND A COPY EACH. Which is why nothing stored here is ever
 * handed to a caller, and nothing a caller holds is ever stored: `remember`
 * copies what the fetch returned before keeping it, and a hit copies what it
 * kept before parsing it. Both directions matter and they fail differently.
 *
 *   - Storing the caller's own object would let that caller edit the map.
 *     `fetched.raw` is the object the miss just returned; one `delete
 *     row.QueryID` in an adapter and every later request in the process is
 *     served the edited body, for the whole TTL, with the digest still
 *     claiming the original bytes.
 *   - Serving the stored object would let every caller edit each other. The
 *     `PayloadRef` is the sharper half: it is three strings, it is small
 *     enough to look harmless to pass around, and `retrievedAt` is the field
 *     the paragraph above depends on. Handing one instance to every concurrent
 *     report means one restamp rewrites the retrieval time on all of them.
 *
 * No adapter mutates a `Fetched` today, so this is a hazard closed rather than
 * a bug fixed -- and the reason to close it here is that a decorator is the
 * wrong place to find out. An adapter that mutates its own fetch result is
 * correct in isolation and correct against the bare fetch io; it becomes wrong
 * only once a cache is behind it, in some other adapter's card, on the second
 * report. `structuredClone` costs one walk of a body this file already parses
 * in full on every hit, which is the smaller price by a long way.
 */

import { createHash } from "node:crypto";
import type { Fetched, JsonValue, PayloadRef, SourceIo } from "@/lib/evidence";
import type { z } from "zod";

const MINUTE_MS = 60_000;

/** The sources B9 gives a cache lifetime. The geocoder is deliberately not one of them. */
export type CachedSource = "echo" | "frs" | "sems" | "aqs" | "airnow" | "fema";

/**
 * B9, verbatim: "AirNow 10 minutes; geocoder none; ECHO, FRS, SEMS, AQS, FEMA
 * 60 minutes." AirNow's is short because it reports a current observation;
 * everything else answers about a facility, a site, or a polygon, which do not
 * change within the hour.
 */
export const TTL_MS: { readonly [S in CachedSource]: number } = {
	airnow: 10 * MINUTE_MS,
	echo: 60 * MINUTE_MS,
	frs: 60 * MINUTE_MS,
	sems: 60 * MINUTE_MS,
	aqs: 60 * MINUTE_MS,
	fema: 60 * MINUTE_MS,
};

/**
 * The allowlist. A URL is cacheable only if it matches one of these exactly --
 * HTTPS, that host, and a path under that prefix. Three of the entries share a
 * host (`services.arcgis.com` serves FRS, SEMS and FEMA's Esri copy), which is
 * why the prefix is part of the rule and not decoration.
 *
 * Fail-closed on purpose. An endpoint an adapter moves to, or a host nobody
 * anticipated, is simply not cached: the report gets slower, never wronger,
 * and never remembers something this table did not authorize it to remember.
 */
type Endpoint = {
	readonly host: string;
	readonly path: string;
	readonly source: CachedSource;
};

const ENDPOINTS: readonly Endpoint[] = [
	// lib/adapters/airnow.ts ENDPOINT. Both spellings: the bare host answers 301
	// to `www.` (checked 2026-09-16; the header is quoted in the adapter and in
	// tests/fixtures/README.md). The adapter cites `www.`, so the bare host is
	// listed for the redirect an io that followed one would arrive from, and so
	// that an adapter moved back to the bare spelling is not silently uncached.
	{ host: "www.airnowapi.org", path: "/aq/", source: "airnow" },
	{ host: "airnowapi.org", path: "/aq/", source: "airnow" },
	// lib/adapters/echo.ts BASE.
	{ host: "echodata.epa.gov", path: "/echo/", source: "echo" },
	// lib/adapters/aqs.ts ENDPOINT.
	{ host: "aqs.epa.gov", path: "/data/api/", source: "aqs" },
	// lib/adapters/sems.ts LAYER_URL and ENVIROFACTS_URL.
	{ host: "services.arcgis.com", path: "/cJ9YHowT8TU7DUyn/arcgis/rest/services/FRS_INTERESTS_SEMS/", source: "sems" },
	{ host: "data.epa.gov", path: "/efservice/", source: "sems" },
	// lib/adapters/frs.ts LAYER_URL. The trailing slash keeps this off FRS_INTERESTS_SEMS.
	{ host: "services.arcgis.com", path: "/cJ9YHowT8TU7DUyn/arcgis/rest/services/FRS_INTERESTS/", source: "frs" },
	// lib/adapters/fema.ts FEMA_DATASETS: the NFHL layer and the Esri reduced set.
	{ host: "hazards.fema.gov", path: "/arcgis/rest/services/public/NFHL/", source: "fema" },
	{
		host: "services.arcgis.com",
		path: "/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Flood_Hazard_Reduced_Set_gdb/",
		source: "fema",
	},
];

/** How long this URL's bytes may be reused, or `null` for a URL that is never cached. */
export function cacheTtlMs(url: URL): number | null {
	if (url.protocol !== "https:") return null;
	const endpoint = ENDPOINTS.find((e) => e.host === url.host && url.pathname.startsWith(e.path));
	return endpoint === undefined ? null : TTL_MS[endpoint.source];
}

/** The entire key. A digest of the request, derived from the request and nothing else. */
export function cacheKey(url: URL): string {
	return createHash("sha256").update(url.toString(), "utf8").digest("hex");
}

/**
 * The bound, and what happens at it: the 257th distinct live request evicts
 * the oldest entry, in insertion order. A report makes roughly twenty
 * requests, so this holds about a dozen concurrent reports and is a hard
 * ceiling on how many distinct searches the process can be holding at any
 * instant. Insertion order rather than least-recently-used, deliberately: a
 * repeatedly-read entry must not be able to keep itself alive past the cohort
 * it arrived with.
 */
export const MAX_ENTRIES = 256;

type Entry = {
	readonly raw: JsonValue;
	readonly payload: PayloadRef;
	/** Derived once, from the retrieval time the fetch stamped. `NaN` for an unparseable stamp, which reads as expired. */
	readonly expiresAtMs: number;
};

export type CacheSourceIoOptions = {
	/** Overridable so a test can reach the bound without making 257 requests. */
	readonly maxEntries?: number;
};

/**
 * Wraps `inner` with the B9 cache. The state is one `Map` in this closure: no
 * file, no external store, nothing hung off `globalThis`, so it dies with the
 * process and a dev reload starts empty.
 */
export function createCacheSourceIo(inner: SourceIo, options: CacheSourceIoOptions = {}): SourceIo {
	const maxEntries = options.maxEntries ?? MAX_ENTRIES;
	const entries = new Map<string, Entry>();

	/** Expiry is measured on the same clock that stamped `retrievedAt`, so the two cannot disagree. */
	function nowMs(): number {
		return Date.parse(inner.now());
	}

	/** `NaN` on either side makes this false, so an unparseable stamp is expired rather than immortal. */
	function live(entry: Entry, atMs: number): boolean {
		return atMs < entry.expiresAtMs;
	}

	/**
	 * Nothing older than its own TTL survives a request passing through. It is
	 * not a sweep on a timer -- a timer would be process state of a different
	 * kind -- so on a process that goes idle, entries do sit until the next
	 * request or until exit.
	 */
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
			// Copies, not the caller's objects: `fetched` was handed to the caller
			// that caused this miss, and the map may not share an object with it.
			raw: structuredClone(fetched.raw),
			payload: structuredClone(fetched.payload),
			expiresAtMs: Date.parse(fetched.payload.retrievedAt) + ttlMs,
		});
		while (entries.size > maxEntries) evictOldest();
	}

	async function get<Raw extends JsonValue>(url: URL, schema: z.ZodType<Raw>): Promise<Fetched<Raw>> {
		const ttlMs = cacheTtlMs(url);
		if (ttlMs === null) return inner.get(url, schema);

		const key = cacheKey(url);
		const atMs = nowMs();
		dropExpired(atMs);

		const entry = entries.get(key);
		if (entry !== undefined) {
			// Re-read through the caller's own schema rather than trusting that
			// the stored value has the type this caller asked for. It costs a
			// parse, it is the reason this file needs no type assertion, and it
			// makes a second caller with a different schema for the same URL a
			// miss instead of a lie.
			//
			// The copy is taken before the parse rather than after, so the caller's
			// body is its own whatever the schema does with what it is given. A
			// `z.object` builds a new object and would have hidden this; a schema
			// that validates without rebuilding hands back the input it was passed,
			// and nothing stops an adapter from writing one.
			const parsed = schema.safeParse(structuredClone(entry.raw));
			if (parsed.success) return { raw: parsed.data, payload: structuredClone(entry.payload) };
			entries.delete(key);
		}

		// A throw from here propagates and is not remembered.
		const fetched = await inner.get(url, schema);
		remember(key, fetched, ttlMs);
		return fetched;
	}

	return { get, query: inner.query, now: inner.now };
}
