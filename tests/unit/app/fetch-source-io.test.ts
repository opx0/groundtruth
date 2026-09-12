import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { SourceFailure } from "@/lib/evidence";
import { createFetchSourceIo } from "@/lib/io/fetch-source-io";

afterEach(() => {
	vi.unstubAllGlobals();
});

const SCHEMA = z.object({ value: z.number() });

describe("createFetchSourceIo, get", () => {
	it("hashes the exact response bytes, not a re-serialization of the parsed JSON", async () => {
		// Deliberately irregular whitespace: re-serializing the parsed value with
		// JSON.stringify before hashing would normalize this away and produce a
		// different digest, which is exactly the bug this test exists to catch.
		const body = '{"value":    1}';
		const bytes = new TextEncoder().encode(body);
		const expectedSha256 = createHash("sha256").update(bytes).digest("hex");

		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(bytes, { status: 200 })),
		);

		const io = createFetchSourceIo({ clock: () => "2026-09-16T00:00:00.000Z" });
		const url = new URL("https://example.test/data");
		const fetched = await io.get(url, SCHEMA);

		expect(fetched.raw).toEqual({ value: 1 });
		expect(fetched.payload.sha256).toBe(expectedSha256);
		expect(fetched.payload.url).toBe(url.toString());
		expect(fetched.payload.retrievedAt).toBe("2026-09-16T00:00:00.000Z");
	});

	it("passes an AbortController's signal to fetch and aborts once the timeout elapses", async () => {
		let capturedSignal: AbortSignal | undefined;
		vi.stubGlobal(
			"fetch",
			vi.fn((_url: string | URL, init?: RequestInit) => {
				capturedSignal = init?.signal ?? undefined;
				return new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => {
						reject(new DOMException("The operation was aborted.", "AbortError"));
					});
				});
			}),
		);

		const io = createFetchSourceIo({ timeoutMs: 15 });
		const promise = io.get(new URL("https://example.test/slow"), SCHEMA);

		await expect(promise).rejects.toBeInstanceOf(SourceFailure);
		await promise.catch((error: unknown) => {
			expect(error).toBeInstanceOf(SourceFailure);
			if (error instanceof SourceFailure) expect(error.reason).toBe("timeout");
		});
		expect(capturedSignal?.aborted).toBe(true);
	});

	it("never puts the request URL or the underlying error into a thrown SourceFailure", async () => {
		const sensitiveUrl = "https://example.test/geocoder?address=123+Secret+St";
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new TypeError(`fetch failed: could not reach ${sensitiveUrl}`);
			}),
		);

		const io = createFetchSourceIo();
		try {
			await io.get(new URL(sensitiveUrl), SCHEMA);
			throw new Error("expected io.get to reject");
		} catch (error) {
			expect(error).toBeInstanceOf(SourceFailure);
			if (error instanceof SourceFailure) {
				expect(error.reason).toBe("refused");
				expect(JSON.stringify({ message: error.message, rawCode: error.rawCode })).not.toContain("Secret");
			}
		}
	});

	it("classifies a non-OK HTTP response as a source failure, without the response body", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("<html>not json</html>", { status: 500 })),
		);
		const io = createFetchSourceIo();
		await expect(io.get(new URL("https://example.test/broken"), SCHEMA)).rejects.toMatchObject({
			reason: "http",
			rawCode: 500,
		});
	});

	it("classifies a malformed body (fails the schema) as a source failure", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(JSON.stringify({ value: "not a number" }), { status: 200 })),
		);
		const io = createFetchSourceIo();
		await expect(io.get(new URL("https://example.test/wrong-shape"), SCHEMA)).rejects.toMatchObject({
			reason: "malformed",
		});
	});

	it("classifies HTTP 429 as rate-limited and keeps the Retry-After header", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("{}", { status: 429, headers: { "retry-after": "30" } })),
		);
		const io = createFetchSourceIo();
		await expect(io.get(new URL("https://example.test/limited"), SCHEMA)).rejects.toMatchObject({
			reason: "rate-limited",
			retryAfter: "30",
		});
	});
});

describe("createFetchSourceIo, query and now", () => {
	it("builds a QueryProvenance verbatim from its arguments", () => {
		const io = createFetchSourceIo({ clock: () => "2026-09-16T00:00:00.000Z" });
		const payload = { url: "https://example.test/x", sha256: "abc", retrievedAt: "2026-09-16T00:00:00.000Z" };
		expect(io.query("p_radius", 5, "sems@1", payload)).toEqual({
			kind: "query",
			parameter: "p_radius",
			value: 5,
			adapterVersion: "sems@1",
			payload,
		});
	});

	it("now() reads the same clock get() stamps payloads with", () => {
		const io = createFetchSourceIo({ clock: () => "2026-09-16T09:30:00.000Z" });
		expect(io.now()).toBe("2026-09-16T09:30:00.000Z");
	});
});
