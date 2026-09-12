/**
 * The privacy proof the unit brief asks for, one level up from
 * `tests/unit/adapters/census.test.ts`: that a raw address cannot be
 * recovered from the geocode route's response, from its error response, or
 * from anything it logs.
 *
 * The fake `SourceIo` below stamps every payload's `url` with the *exact*
 * URL `geocode()` requested -- address and all -- exactly as
 * `census.test.ts`'s `fakeIo` does. That is what makes a passing test mean
 * something: `lib/adapters/census.ts` redacts before this handler ever sees
 * a value, and `handler.ts` only reads `.value`s off the result, so this
 * proves the whole chain, not just one link the fixture happened to help.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SourceFailure } from "@/lib/evidence";
import type { SourceIo } from "@/lib/evidence";
import { createGeocodeHandler } from "@/app/api/geocode/handler";

const fixturesDir = fileURLToPath(new URL("../../fixtures/", import.meta.url));
const RETRIEVED_AT = "2026-09-16T12:00:00Z";
const SECRET_MARKER = "APT-9Z-DO-NOT-LEAK";

function fakeIo(fixture: string): SourceIo {
	const bytes = readFileSync(`${fixturesDir}${fixture}`);
	const json: unknown = JSON.parse(bytes.toString("utf8"));
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	return {
		get(url, schema) {
			return Promise.resolve({
				raw: schema.parse(json),
				payload: { url: url.toString(), sha256, retrievedAt: RETRIEVED_AT },
			});
		},
		query(parameter, value, adapterVersion, payload) {
			return { kind: "query", parameter, value, adapterVersion, payload };
		},
		now: () => RETRIEVED_AT,
	};
}

const refusingIo: SourceIo = {
	get() {
		return Promise.reject(new SourceFailure("refused", null, null));
	},
	query(parameter, value, adapterVersion, payload) {
		return { kind: "query", parameter, value, adapterVersion, payload };
	},
	now: () => RETRIEVED_AT,
};

function postRequest(address: unknown): Request {
	return new Request("http://localhost/api/geocode", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ address }),
	});
}

const CONSOLE_METHODS: readonly ["log", "info", "warn", "error", "debug"] = ["log", "info", "warn", "error", "debug"];

let consoleSpies: Array<ReturnType<typeof vi.spyOn>>;
let loggedArgs: unknown[];

beforeEach(() => {
	loggedArgs = [];
	const capture =
		(): ((...args: unknown[]) => void) =>
		(...args: unknown[]) => {
			loggedArgs.push(args);
		};
	consoleSpies = CONSOLE_METHODS.map((method) => vi.spyOn(console, method).mockImplementation(capture()));
});

afterEach(() => {
	for (const spy of consoleSpies) spy.mockRestore();
});

function assertNoLeak(haystack: unknown): void {
	const serialized = JSON.stringify(haystack, (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value));
	expect(serialized ?? "").not.toContain(SECRET_MARKER);
	expect(serialized ?? "").not.toContain("address=");
}

describe("the raw address cannot be recovered from a matched response", () => {
	it("is absent from the JSON body and from the payload url a naive implementation might have echoed", async () => {
		const address = `9311 E Avenue P, ${SECRET_MARKER}, Houston, TX 77012`;
		const handler = createGeocodeHandler(fakeIo("census/match-9311-e-ave-p.json"));
		const response = await handler(postRequest(address));
		const body: unknown = await response.json();
		expect(response.status).toBe(200);
		assertNoLeak(body);
		assertNoLeak(loggedArgs);
	});
});

describe("the raw address cannot be recovered from an ambiguous response", () => {
	it("is absent from every candidate in the body", async () => {
		const address = `100 Main St, ${SECRET_MARKER}, Springfield`;
		const handler = createGeocodeHandler(fakeIo("census/ambiguous-100-main-st.json"));
		const response = await handler(postRequest(address));
		const body: unknown = await response.json();
		expect(response.status).toBe(200);
		assertNoLeak(body);
		assertNoLeak(loggedArgs);
	});
});

describe("the raw address cannot be recovered from a no-match response", () => {
	it("is absent from the body for the real EPA-listed address that has no geocoder match", async () => {
		const address = `9400 Clinton Dr, ${SECRET_MARKER}, Houston, TX 77029`;
		const handler = createGeocodeHandler(fakeIo("census/no-match-9400-clinton.json"));
		const response = await handler(postRequest(address));
		const body: unknown = await response.json();
		expect(response.status).toBe(200);
		expect(body).toEqual({ status: "no-match" });
		assertNoLeak(body);
		assertNoLeak(loggedArgs);
	});
});

describe("the raw address cannot be recovered from an error response, or from anything logged while producing it", () => {
	it("returns a generic unavailable body with no address, and logs only a fixed reason", async () => {
		const address = `9311 E Avenue P, ${SECRET_MARKER}, Houston, TX 77012`;
		const handler = createGeocodeHandler(refusingIo);
		const response = await handler(postRequest(address));
		const body: unknown = await response.json();

		expect(response.status).toBe(503);
		expect(body).toEqual({ status: "unavailable" });
		assertNoLeak(body);

		expect(loggedArgs.length).toBeGreaterThan(0);
		assertNoLeak(loggedArgs);
		// The one thing logged is a fixed string and the failure's own enum
		// reason -- nothing derived from the request.
		expect(loggedArgs).toEqual([["geocode: source unavailable", { reason: "refused" }]]);
	});
});

describe("the raw address cannot be recovered from an invalid-request response", () => {
	it("rejects a non-string address without echoing anything about what was sent", async () => {
		const handler = createGeocodeHandler(fakeIo("census/match-9311-e-ave-p.json"));
		const response = await handler(postRequest(123456789));
		const body: unknown = await response.json();
		expect(response.status).toBe(400);
		expect(body).toEqual({ status: "invalid" });
		assertNoLeak(loggedArgs);
	});

	it("rejects malformed JSON without logging the body it failed to parse", async () => {
		const handler = createGeocodeHandler(fakeIo("census/match-9311-e-ave-p.json"));
		const request = new Request("http://localhost/api/geocode", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: `{"address": "9311 E Avenue P, ${SECRET_MARKER}, Houston, TX 77012"`, // truncated: invalid JSON
		});
		const response = await handler(request);
		const body: unknown = await response.json();
		expect(response.status).toBe(400);
		expect(body).toEqual({ status: "invalid" });
		assertNoLeak(loggedArgs);
	});
});
