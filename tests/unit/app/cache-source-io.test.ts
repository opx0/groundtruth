/**
 * The B9 coordinate cache.
 *
 * Every test here names the sentence of `.dev/BRIEF.md` B9 it proves, and the
 * privacy ones assert the key rather than the intention: the digest itself,
 * what a second request with one byte changed does, and what the module's own
 * source text is allowed to mention.
 *
 * The inner io is a stub with a clock a test can move, because expiry is
 * measured on the same clock that stamps `retrievedAt` -- that is the whole
 * reason a served record's retrieval time can be checked at all.
 *
 * The TTL table is checked against the adapters' own exported URL builders,
 * not against URLs typed into this file, so an endpoint that moves fails here
 * instead of silently turning caching off.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SourceFailure } from "@/lib/evidence";
import type { Fetched, JsonValue, PayloadRef, SourceIo } from "@/lib/evidence";
import {
	cacheKey,
	cacheTtlMs,
	createCacheSourceIo,
	MAX_ENTRIES,
	TTL_MS,
	type CachedSource,
} from "@/lib/io/cache-source-io";
import { facilitiesUrl, qidUrl } from "@/lib/adapters/echo";
import { registryQueryUrl } from "@/lib/adapters/frs";
import { layerUrl, statusUrl } from "@/lib/adapters/sems";
import { annualSummaryQueryUrl } from "@/lib/adapters/aqs";
import { observationQueryUrl } from "@/lib/adapters/airnow";
import { floodZoneQueryUrl } from "@/lib/adapters/fema";
import { geocode } from "@/lib/adapters/census";
import { houstonLocus } from "../evidence/helpers/sems-fixtures";

const TEN_MINUTES_MS = 10 * 60_000;
const SIXTY_MINUTES_MS = 60 * 60_000;

/** An ECHO URL, which the table says is cacheable for sixty minutes. */
const LOCUS = houstonLocus();
const CACHEABLE = facilitiesUrl(LOCUS);

const BODY = z.object({ value: z.number() });

/* -------------------------------------------------------------------------- */
/* The stub io: one clock, a request log, and a scripted answer per URL        */
/* -------------------------------------------------------------------------- */

type Answer = JsonValue | SourceFailure;

type Stub = {
	readonly io: SourceIo;
	/** Every URL the cache actually let through to the network, in order. */
	readonly asked: string[];
	/** Moves the one clock that stamps `retrievedAt` and measures expiry. */
	advance(ms: number): void;
	at(): string;
};

const START_MS = Date.parse("2026-09-16T09:00:00.000Z");

function stubIo(answerFor: (url: URL) => Answer = () => ({ value: 1 })): Stub {
	const asked: string[] = [];
	let clockMs = START_MS;
	const at = (): string => new Date(clockMs).toISOString();

	async function get<Raw extends JsonValue>(url: URL, schema: z.ZodType<Raw>): Promise<Fetched<Raw>> {
		asked.push(url.toString());
		const answer = answerFor(url);
		if (answer instanceof SourceFailure) throw answer;
		const parsed = schema.safeParse(answer);
		if (!parsed.success) throw new SourceFailure("malformed", null);
		const sha256 = createHash("sha256").update(JSON.stringify(answer), "utf8").digest("hex");
		const payload: PayloadRef = { url: url.toString(), sha256, retrievedAt: at() };
		return { raw: parsed.data, payload };
	}

	const io: SourceIo = {
		get,
		query: (parameter, value, adapterVersion, payload) => ({
			kind: "query",
			parameter,
			value,
			adapterVersion,
			payload,
		}),
		now: at,
	};

	return {
		io,
		asked,
		advance: (ms: number): void => {
			clockMs += ms;
		},
		at,
	};
}

/* -------------------------------------------------------------------------- */
/* B9: the cache lifetimes                                                    */
/* -------------------------------------------------------------------------- */

describe("B9 'AirNow 10 minutes; geocoder none; ECHO, FRS, SEMS, AQS, FEMA 60 minutes'", () => {
	it("gives every URL the report's adapters build the lifetime B9 names for its source", () => {
		// Built by the adapters' own exported URL builders, so an endpoint that
		// moves fails this test rather than quietly falling out of the cache.
		const expected: readonly (readonly [string, URL, number])[] = [
			["echo facilities", facilitiesUrl(LOCUS), SIXTY_MINUTES_MS],
			["echo qid page", qidUrl("q-1", 1), SIXTY_MINUTES_MS],
			["frs registry lookup", registryQueryUrl("110000350772"), SIXTY_MINUTES_MS],
			["sems layer", layerUrl(LOCUS), SIXTY_MINUTES_MS],
			["sems envirofacts status", statusUrl("TXD980864649"), SIXTY_MINUTES_MS],
			["aqs annual summary", annualSummaryQueryUrl(LOCUS, 2024), SIXTY_MINUTES_MS],
			["airnow current observation", observationQueryUrl(LOCUS), TEN_MINUTES_MS],
			["fema NFHL", floodZoneQueryUrl("NFHL", LOCUS), SIXTY_MINUTES_MS],
			["fema Esri reduced set", floodZoneQueryUrl("ESRI_REDUCED_SET", LOCUS), SIXTY_MINUTES_MS],
		];

		expect(expected.map(([what, url]) => [what, cacheTtlMs(url)])).toEqual(
			expected.map(([what, , ttl]) => [what, ttl]),
		);
	});

	it("holds one lifetime per source, and the AirNow one is the short one", () => {
		const table: { readonly [S in CachedSource]: number } = {
			airnow: TEN_MINUTES_MS,
			echo: SIXTY_MINUTES_MS,
			frs: SIXTY_MINUTES_MS,
			sems: SIXTY_MINUTES_MS,
			aqs: SIXTY_MINUTES_MS,
			fema: SIXTY_MINUTES_MS,
		};
		expect(TTL_MS).toEqual(table);
	});

	it("caches nothing it was not told to cache: an unlisted host, an unlisted path, and plain HTTP are all misses", async () => {
		const stub = stubIo();
		const io = createCacheSourceIo(stub.io);

		const strangers = [
			new URL("https://example.test/data"),
			// Right host, wrong service: the ArcGIS host serves three of our
			// sources and every other ArcGIS customer's layers too.
			new URL("https://services.arcgis.com/someoneElse/arcgis/rest/services/Whatever/FeatureServer/0/query"),
			// Right host and path, downgraded scheme.
			new URL(CACHEABLE.toString().replace("https:", "http:")),
		];

		for (const url of strangers) {
			expect(cacheTtlMs(url)).toBeNull();
			await io.get(url, BODY);
			await io.get(url, BODY);
		}

		expect(stub.asked.length).toBe(strangers.length * 2);
	});
});

/* -------------------------------------------------------------------------- */
/* B9: 'geocoder none' -- the one request that carries an address             */
/* -------------------------------------------------------------------------- */

describe("B9 'geocoder none'", () => {
	it("never caches the Census geocoder URL the real adapter builds, address and all", async () => {
		// The URL is taken from `geocode` itself rather than typed here, so this
		// is the exact string that would have been keyed.
		const seen: URL[] = [];
		const capturing: SourceIo = {
			get: (url) => {
				seen.push(url);
				return Promise.reject(new SourceFailure("refused"));
			},
			query: stubIo().io.query,
			now: () => "2026-09-16T09:00:00.000Z",
		};

		await expect(geocode("9311 E Ave P, Houston, TX 77012", capturing)).rejects.toBeInstanceOf(SourceFailure);

		const requested = seen[0];
		if (requested === undefined) throw new Error("the census adapter asked for no URL");
		expect(requested.searchParams.get("address")).toBe("9311 E Ave P, Houston, TX 77012");
		expect(cacheTtlMs(requested)).toBeNull();
	});

	it("asks again every time for a URL with no lifetime, so an address is never held in the map", async () => {
		const stub = stubIo();
		const io = createCacheSourceIo(stub.io);
		const geocoderUrl = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=9311+E+Ave+P");

		await io.get(geocoderUrl, BODY);
		await io.get(geocoderUrl, BODY);
		await io.get(geocoderUrl, BODY);

		expect(stub.asked).toEqual([geocoderUrl.toString(), geocoderUrl.toString(), geocoderUrl.toString()]);
	});
});

/* -------------------------------------------------------------------------- */
/* B9: 'Expired data never renders as current'                                */
/* -------------------------------------------------------------------------- */

describe("B9 'Expired data never renders as current'", () => {
	it("serves a hit inside the TTL without making the request", async () => {
		const stub = stubIo();
		const io = createCacheSourceIo(stub.io);

		const first = await io.get(CACHEABLE, BODY);
		stub.advance(SIXTY_MINUTES_MS - 1);
		const second = await io.get(CACHEABLE, BODY);

		expect(stub.asked).toEqual([CACHEABLE.toString()]);
		expect(second.raw).toEqual(first.raw);
		expect(second.payload).toEqual(first.payload);
	});

	it("treats a hit past the TTL as a miss and makes the request", async () => {
		const stub = stubIo();
		const io = createCacheSourceIo(stub.io);

		await io.get(CACHEABLE, BODY);
		// Exactly at the TTL is already expired: the window is half-open.
		stub.advance(SIXTY_MINUTES_MS);
		await io.get(CACHEABLE, BODY);

		expect(stub.asked).toEqual([CACHEABLE.toString(), CACHEABLE.toString()]);
	});

	it("expires AirNow at ten minutes while a sixty-minute source is still live", async () => {
		const stub = stubIo();
		const io = createCacheSourceIo(stub.io);
		const airnow = observationQueryUrl(LOCUS);

		await io.get(airnow, BODY);
		await io.get(CACHEABLE, BODY);
		stub.advance(TEN_MINUTES_MS);
		await io.get(airnow, BODY);
		await io.get(CACHEABLE, BODY);

		expect(stub.asked).toEqual([airnow.toString(), CACHEABLE.toString(), airnow.toString()]);
	});

	it("gives a served record the time the bytes arrived, never the time it was served", async () => {
		const stub = stubIo();
		const io = createCacheSourceIo(stub.io);

		const fetched = await io.get(CACHEABLE, BODY);
		expect(fetched.payload.retrievedAt).toBe("2026-09-16T09:00:00.000Z");

		stub.advance(45 * 60_000);
		const served = await io.get(CACHEABLE, BODY);

		// What the trace panel shows: 09:00, when the bytes arrived.
		expect(served.payload.retrievedAt).toBe("2026-09-16T09:00:00.000Z");
		expect(served.payload.sha256).toBe(fetched.payload.sha256);
		expect(served.payload.url).toBe(fetched.payload.url);
		// And the clock the kernel stamps outcomes with is not frozen with it.
		expect(io.now()).toBe("2026-09-16T09:45:00.000Z");
		expect(io.now()).toBe(stub.at());
	});

	it("never caches a failure, so a source that was down is asked again", async () => {
		const stub = stubIo(() => new SourceFailure("timeout"));
		const io = createCacheSourceIo(stub.io);

		await expect(io.get(CACHEABLE, BODY)).rejects.toBeInstanceOf(SourceFailure);
		await expect(io.get(CACHEABLE, BODY)).rejects.toBeInstanceOf(SourceFailure);

		expect(stub.asked.length).toBe(2);
	});

	it("re-reads a hit through the caller's own schema, so a stored value that does not fit is a miss", async () => {
		const stub = stubIo();
		const io = createCacheSourceIo(stub.io);

		await io.get(CACHEABLE, BODY);
		const other = z.object({ value: z.string() });
		await expect(io.get(CACHEABLE, other)).rejects.toBeInstanceOf(SourceFailure);

		expect(stub.asked.length).toBe(2);
	});
});

/* -------------------------------------------------------------------------- */
/* B9: 'returned byte for byte as the fetch produced it' -- and to each        */
/*     caller its own copy of them                                            */
/* -------------------------------------------------------------------------- */

describe("the served bytes belong to the caller, not to the map", () => {
	// The hazard these three close: this decorator's contract is that a served
	// entry is the fetch's own bytes, and the cheapest way to honour it is to
	// hand out the stored object. Then one caller's mutation is every later
	// caller's answer, for the life of the process and across concurrent
	// reports. No adapter mutates a `Fetched` today; these tests are what
	// notices when one starts, on the first call rather than on the hundredth
	// report that reads a rewritten `retrievedAt`.

	it("does not let a caller that mutates a miss's body write into the map", async () => {
		const stub = stubIo();
		const io = createCacheSourceIo(stub.io);

		const miss = await io.get(CACHEABLE, BODY);
		expect(miss.raw.value).toBe(1);
		miss.raw.value = 999;

		const hit = await io.get(CACHEABLE, BODY);

		// One request: the second call was served from the map, and what it was
		// served is what the fetch produced.
		expect(stub.asked.length).toBe(1);
		expect(hit.raw.value).toBe(1);
	});

	it("hands every caller its own body, even through a schema that returns its input unchanged", async () => {
		// `z.object` builds a new object on every parse, which hides the sharing.
		// A schema that validates without rebuilding does not, and nothing stops
		// an adapter from writing one.
		const passthrough = z.custom<{ value: number }>(
			(value) => typeof value === "object" && value !== null && "value" in value,
		);
		const stub = stubIo();
		const io = createCacheSourceIo(stub.io);

		const miss = await io.get(CACHEABLE, passthrough);
		const first = await io.get(CACHEABLE, passthrough);
		const second = await io.get(CACHEABLE, passthrough);

		expect(stub.asked.length).toBe(1);
		expect(first.raw).not.toBe(second.raw);
		expect(first.raw).not.toBe(miss.raw);

		first.raw.value = 999;
		const later = await io.get(CACHEABLE, passthrough);
		expect(later.raw.value).toBe(1);
		expect(stub.asked.length).toBe(1);
	});

	it("hands every caller its own PayloadRef, so one rewritten retrievedAt is not everyone's", async () => {
		const stub = stubIo();
		const io = createCacheSourceIo(stub.io);

		const miss = await io.get(CACHEABLE, BODY);
		const first = await io.get(CACHEABLE, BODY);
		const second = await io.get(CACHEABLE, BODY);

		expect(stub.asked.length).toBe(1);
		expect(first.payload).not.toBe(miss.payload);
		expect(first.payload).not.toBe(second.payload);

		// A caller restamps what it was handed -- the one mutation B9's "expired
		// data never renders as current" cannot survive, because the trace panel
		// prints this field.
		Object.assign(first.payload, { retrievedAt: "1999-01-01T00:00:00.000Z" });

		const later = await io.get(CACHEABLE, BODY);
		expect(later.payload.retrievedAt).toBe("2026-09-16T09:00:00.000Z");
		expect(miss.payload.retrievedAt).toBe("2026-09-16T09:00:00.000Z");
		expect(second.payload.retrievedAt).toBe("2026-09-16T09:00:00.000Z");
	});
});

/* -------------------------------------------------------------------------- */
/* B9: 'No cache key tied to a user, session, IP, or browser'                 */
/* -------------------------------------------------------------------------- */

describe("B9 'No cache key tied to a user, session, IP, or browser'", () => {
	it("keys on a SHA-256 of the exact URL and nothing else", () => {
		const url = observationQueryUrl(LOCUS);
		expect(cacheKey(url)).toBe(createHash("sha256").update(url.toString(), "utf8").digest("hex"));
		expect(cacheKey(url)).toMatch(/^[0-9a-f]{64}$/);
	});

	it("puts no coordinate, no address and no credential into the key, in any spelling", () => {
		const url = new URL(observationQueryUrl(LOCUS).toString());
		url.searchParams.set("API_KEY", "SUPERSECRETKEY");
		url.searchParams.set("address", "9311 E Ave P");
		const key = cacheKey(url);

		for (const forbidden of [
			"SUPERSECRETKEY",
			"9311",
			"Ave",
			String(LOCUS.point.latitude.value),
			String(LOCUS.point.longitude.value),
			// The whole coordinate, and each half of it to five places.
			String(LOCUS.point.latitude.value).slice(0, 8),
			String(LOCUS.point.longitude.value).slice(0, 8),
			"airnowapi",
		]) {
			expect(key).not.toContain(forbidden);
		}
		expect(key).toMatch(/^[0-9a-f]{64}$/);
	});

	it("keys on the whole URL: a different coordinate, radius or parameter is a different entry", async () => {
		const stub = stubIo();
		const io = createCacheSourceIo(stub.io);

		const neighbour = new URL(CACHEABLE.toString());
		neighbour.searchParams.set("p_lat", String(LOCUS.point.latitude.value + 0.0001));
		const wider = new URL(CACHEABLE.toString());
		wider.searchParams.set("p_radius", "10");

		expect(new Set([cacheKey(CACHEABLE), cacheKey(neighbour), cacheKey(wider)]).size).toBe(3);

		await io.get(CACHEABLE, BODY);
		await io.get(neighbour, BODY);
		await io.get(wider, BODY);
		await io.get(CACHEABLE, BODY);

		// Three requests, and the fourth call -- a repeat of the first -- made none.
		expect(stub.asked).toEqual([CACHEABLE.toString(), neighbour.toString(), wider.toString()]);
	});

	it("reads nothing request-scoped: the module's own code names no header, cookie, session, IP or global store", () => {
		const source = readFileSync(fileURLToPath(new URL("../../../lib/io/cache-source-io.ts", import.meta.url)), "utf8");
		// Comments are stripped first, because the comments discuss exactly these
		// words: the claim is about what the code does, not what it says.
		const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

		// The stripper did not eat the file.
		expect(code).toContain("createCacheSourceIo");
		expect(code).toContain("MAX_ENTRIES");

		for (const forbidden of [
			"headers",
			"cookie",
			"session",
			"remoteAddress",
			"user-agent",
			"userAgent",
			"forwarded",
			"globalThis",
			"process.env",
			"localStorage",
			"node:fs",
			"require(",
		]) {
			expect(code.toLowerCase()).not.toContain(forbidden.toLowerCase());
		}
	});

	it("is two independent caches when it is created twice, so nothing is shared through module state", async () => {
		const first = stubIo();
		const second = stubIo();

		await createCacheSourceIo(first.io).get(CACHEABLE, BODY);
		await createCacheSourceIo(second.io).get(CACHEABLE, BODY);

		expect(first.asked.length).toBe(1);
		expect(second.asked.length).toBe(1);
	});
});

/* -------------------------------------------------------------------------- */
/* B9: 'Bounded in-memory coordinate cache'                                   */
/* -------------------------------------------------------------------------- */

describe("B9 'Bounded in-memory coordinate cache'", () => {
	it("names a bound", () => {
		expect(MAX_ENTRIES).toBe(256);
	});

	it("evicts the oldest entry at the bound, and keeps the newer ones", async () => {
		const stub = stubIo();
		const io = createCacheSourceIo(stub.io, { maxEntries: 2 });

		const urls = [0, 1, 2].map((n) => {
			const url = new URL(CACHEABLE.toString());
			url.searchParams.set("p_lat", String(LOCUS.point.latitude.value + n / 1000));
			return url;
		});
		const [oldest, middle, newest] = urls;
		if (oldest === undefined || middle === undefined || newest === undefined) throw new Error("three urls");

		for (const url of urls) await io.get(url, BODY);
		expect(stub.asked.length).toBe(3);

		// The two newest are still held; the oldest was evicted and is asked again.
		await io.get(middle, BODY);
		await io.get(newest, BODY);
		expect(stub.asked.length).toBe(3);

		await io.get(oldest, BODY);
		expect(stub.asked.length).toBe(4);
	});

	it("drops every expired entry when any request passes through, not only the one asked for", async () => {
		const stub = stubIo();
		const io = createCacheSourceIo(stub.io, { maxEntries: 2 });

		const airnow = observationQueryUrl(LOCUS);
		await io.get(airnow, BODY);
		stub.advance(TEN_MINUTES_MS);

		// A request for a different URL. If the expired AirNow entry were still
		// held, it would occupy one of the two slots and evict this one.
		await io.get(CACHEABLE, BODY);
		const second = new URL(CACHEABLE.toString());
		second.searchParams.set("p_radius", "3");
		await io.get(second, BODY);

		expect(stub.asked.length).toBe(3);
		await io.get(CACHEABLE, BODY);
		await io.get(second, BODY);
		expect(stub.asked.length).toBe(3);
	});
});
