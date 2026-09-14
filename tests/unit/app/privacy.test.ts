/**
 * The five privacy properties of `docs/BRIEF.md` B12, one describe block each,
 * each naming the line of the brief it holds:
 *
 * > Privacy tests prove: environmental adapters never receive the raw address;
 * > logs redact addresses and coordinates; client bundles contain no keys;
 * > fixtures cannot enter a production build; cache entries carry no user or
 * > session identifier.
 *
 * Every one of these was proved once by an audit that ran in a throwaway suite
 * and deleted itself, which is worth nothing to the next reader. This file is
 * the committed form. A privacy test that cannot fail is worse than none -- it
 * is a claim with evidence attached that does not hold it up -- so each test
 * below was watched failing against a deliberately broken copy of the tree
 * before it was committed, and the unit report says which mutation broke it.
 *
 * WHAT THE ASSERTIONS ARE MADE AGAINST. The response body is grepped as raw
 * text, before any parse: parsing it through `ReportEventSchema` would re-apply
 * the server's own redaction on the way in, and a test that did that would pass
 * whether or not the server had redacted anything. The same rule holds for the
 * built bundle, which is read as bytes off disk.
 *
 * TWO OF THESE TESTS READ SOURCE RATHER THAN BEHAVIOUR, through the TypeScript
 * parser rather than by grep. That is deliberate: "there are exactly three
 * console calls and none of them carries a value" and "nothing under app/ or
 * lib/ imports a fixture" are properties of the tree, and a grep over the tree
 * cannot tell code from a comment -- and these files' comments are full of the
 * very words the greps would look for, including the path `tests/fixtures/` and
 * the words cookie and header.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { SourceFailure } from "@/lib/evidence";
import type { Fetched, JsonValue, PayloadRef, SourceIo } from "@/lib/evidence";
import { createGeocodeHandler } from "@/app/api/geocode/handler";
import { createReportHandler } from "@/app/api/report/handler";
import { REDACTED } from "@/app/lib/report-contract";
import { cacheKey, cacheTtlMs, createCacheSourceIo } from "@/lib/io/cache-source-io";
import { censusOrigin } from "../evidence/helpers/sems-fixtures";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const fixturesDir = `${repoRoot}tests/fixtures/`;
const RETRIEVED_AT = "2026-09-16T09:00:00Z";

/** The demo point of docs/BRIEF.md A6 row 1, read out of the committed Census bytes rather than typed in. */
const HOUSTON = censusOrigin();
const LATITUDE = HOUSTON.latitude.value;
const LONGITUDE = HOUSTON.longitude.value;

/**
 * A string no agency would ever send back, planted in whatever a test is
 * claiming cannot travel. Finding it anywhere means the caller's own bytes
 * moved, not something a source echoed.
 */
const MARKER = "APT-9Z-DO-NOT-LEAK";

/* -------------------------------------------------------------------------- */
/* The stub io, recording every URL it is asked for                           */
/* -------------------------------------------------------------------------- */

type Answer =
	| { readonly fixture: string }
	| { readonly derived: string; readonly body: JsonValue }
	| { readonly fail: SourceFailure }
	| { readonly slow: number; readonly then: Answer };

function bytesOf(relative: string): Buffer {
	return readFileSync(`${fixturesDir}${relative}`);
}

function pause(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

type Requested = { readonly urls: string[]; readonly io: SourceIo };

function ioOf(answerFor: (url: URL) => Answer): Requested {
	const urls: string[] = [];
	const io: SourceIo = {
		async get<Raw extends JsonValue>(url: URL, schema: z.ZodType<Raw>): Promise<Fetched<Raw>> {
			urls.push(url.toString());
			let answer = answerFor(url);
			while ("slow" in answer) {
				await pause(answer.slow);
				answer = answer.then;
			}
			if ("fail" in answer) throw answer.fail;
			const bytes = "fixture" in answer ? bytesOf(answer.fixture) : Buffer.from(JSON.stringify(answer.body), "utf8");
			const label = "fixture" in answer ? `fixture:${answer.fixture}` : answer.derived;
			const payload: PayloadRef = {
				url: label,
				sha256: createHash("sha256").update(bytes).digest("hex"),
				retrievedAt: RETRIEVED_AT,
			};
			const parsed = schema.safeParse(JSON.parse(bytes.toString("utf8")));
			if (!parsed.success) throw new SourceFailure("malformed", null);
			return { raw: parsed.data, payload };
		},
		query(parameter, value, adapterVersion, payload) {
			return { kind: "query", parameter, value, adapterVersion, payload };
		},
		now: () => RETRIEVED_AT,
	};
	return { urls, io };
}

const SEMS_LAYER = "sems/arcgis-5mi-houston.json";

const FRS_FIXTURES: ReadonlyMap<string, string> = new Map([
	["110000460885", "frs/arcgis-registry-110000460885.json"],
	["110000462703", "frs/arcgis-registry-110000462703-two-ids.json"],
]);

const NO_FEATURES: JsonValue = { features: [] };

type Plan = {
	readonly echoSummary: Answer;
	readonly echoPage: Answer;
	readonly semsLayer: Answer;
	readonly status: (epaId: string) => Answer;
	readonly frs: (registryId: string) => Answer;
	readonly nfhl: Answer;
	readonly esri: Answer;
};

/** The EPA ID out of `.../efservice/envirofacts_site/epa_id/<EPA_ID>/JSON`. */
function epaIdOf(url: URL): string {
	const segments = url.pathname.split("/");
	return segments[segments.length - 2] ?? "";
}

/** The registry ID out of ArcGIS's `where=REGISTRY_ID='<id>'`. */
function registryIdOf(url: URL): string {
	return /REGISTRY_ID='([^']*)'/.exec(url.searchParams.get("where") ?? "")?.[1] ?? "";
}

/** NFHL's host refuses non-US traffic and nothing from it has ever been recorded, so Esri's recorded copy answers. */
const DEMO: Plan = {
	echoSummary: { fixture: "echo/facilities-quarter-mi.json" },
	echoPage: { fixture: "echo/facilities-page-quarter-mi.json" },
	semsLayer: { fixture: SEMS_LAYER },
	status: (epaId) => ({ fixture: `sems/envirofacts-${epaId}.json` }),
	frs: (registryId) => {
		const fixture = FRS_FIXTURES.get(registryId);
		return fixture === undefined ? { derived: `derived:frs-no-rows-${registryId}`, body: NO_FEATURES } : { fixture };
	},
	nfhl: { fail: new SourceFailure("refused") },
	esri: { fixture: "fema/esri-no-polygon-houston.json" },
};

function planned(plan: Plan): Requested {
	let echoCalls = 0;
	return ioOf((url) => {
		if (url.host === "echodata.epa.gov") {
			echoCalls += 1;
			return echoCalls === 1 ? plan.echoSummary : plan.echoPage;
		}
		if (url.host === "data.epa.gov") return plan.status(epaIdOf(url));
		if (url.host === "hazards.fema.gov") return plan.nfhl;
		if (url.pathname.includes("FRS_INTERESTS_SEMS")) return plan.semsLayer;
		if (url.pathname.includes("/FRS_INTERESTS/")) return plan.frs(registryIdOf(url));
		if (url.pathname.includes("USA_Flood_Hazard_Reduced_Set")) return plan.esri;
		throw new Error(`the stub io was asked for an unrouted URL: ${url.host}${url.pathname}`);
	});
}

/* -------------------------------------------------------------------------- */
/* Driving the route                                                          */
/* -------------------------------------------------------------------------- */

const ROUTE = "http://localhost/api/report";
const CONFIRMED_POINT = JSON.stringify({ latitude: LATITUDE, longitude: LONGITUDE });

type Sent = {
	readonly url?: string;
	readonly headers?: Readonly<Record<string, string>>;
	readonly body?: string;
};

function postRequest(sent: Sent = {}): Request {
	return new Request(sent.url ?? ROUTE, {
		method: "POST",
		headers: { "content-type": "application/json", ...(sent.headers ?? {}) },
		body: sent.body ?? CONFIRMED_POINT,
	});
}

type Run = { readonly response: Response; readonly raw: string; readonly urls: readonly string[] };

async function report(
	plan: Plan = DEMO,
	sent: Sent = {},
	timeouts: Record<string, { readonly timeoutMs: number }> = {},
): Promise<Run> {
	const { urls, io } = planned(plan);
	const handler = createReportHandler(io, timeouts);
	const response = await handler(postRequest(sent));
	return { response, raw: await response.text(), urls };
}

/* -------------------------------------------------------------------------- */
/* A captured console, for every test in this file                            */
/* -------------------------------------------------------------------------- */

const CONSOLE_METHODS: readonly ["log", "info", "warn", "error", "debug"] = ["log", "info", "warn", "error", "debug"];

let consoleSpies: Array<ReturnType<typeof vi.spyOn>>;
let logged: unknown[];

beforeEach(() => {
	logged = [];
	const capture =
		(): ((...args: unknown[]) => void) =>
		(...args: unknown[]) => {
			logged.push(args);
		};
	consoleSpies = CONSOLE_METHODS.map((method) => vi.spyOn(console, method).mockImplementation(capture()));
});

afterEach(() => {
	for (const spy of consoleSpies) spy.mockRestore();
});

function serialize(value: unknown): string {
	return JSON.stringify(value) ?? "";
}

/**
 * The three credential names the two air adapters read, cleared before every
 * test here and restored after. A developer with a real `AQS_KEY` exported
 * would otherwise run a different report from CI's, with different cards, and
 * the redaction tests below would each pass only on one machine.
 */
const AIR_ENV: readonly string[] = ["AQS_EMAIL", "AQS_KEY", "AIRNOW_KEY"];

let airEnv: readonly { readonly name: string; readonly value: string | undefined }[];

beforeEach(() => {
	airEnv = AIR_ENV.map((name) => ({ name, value: process.env[name] }));
	for (const name of AIR_ENV) delete process.env[name];
});

afterEach(() => {
	for (const { name, value } of airEnv) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
});

/* -------------------------------------------------------------------------- */
/* Reading the tree, through the parser rather than by grep                   */
/* -------------------------------------------------------------------------- */

/** Every `.ts` and `.tsx` file under a directory, recursively. */
function sourceFilesUnder(directory: string): readonly string[] {
	const out: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) out.push(...sourceFilesUnder(path));
		else if (path.endsWith(".ts") || path.endsWith(".tsx")) out.push(path);
	}
	return out;
}

/** Everything that is built into the running application: the server routes and the browser screens. */
const PRODUCTION_FILES: readonly string[] = [
	...sourceFilesUnder(`${repoRoot}app`),
	...sourceFilesUnder(`${repoRoot}lib`),
];

function parsed(path: string): ts.SourceFile {
	return ts.createSourceFile(
		path,
		readFileSync(path, "utf8"),
		ts.ScriptTarget.ESNext,
		true,
		path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	);
}

function relative(path: string): string {
	return path.startsWith(repoRoot) ? path.slice(repoRoot.length) : path;
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
	visit(node);
	ts.forEachChild(node, (child) => walk(child, visit));
}

/* -------------------------------------------------------------------------- */
/* B12, line 1: environmental adapters never receive the raw address          */
/* -------------------------------------------------------------------------- */

/**
 * The twelve shapes. Written as raw request bodies rather than as objects,
 * because two of them cannot be produced by `JSON.stringify`: a `__proto__` key
 * survives `JSON.parse` as an own enumerable property but is dropped on the way
 * out, and a truncated body is not a value at all.
 */
const ADDRESS_BEARING_BODIES: readonly { readonly what: string; readonly body: string }[] = [
	{ what: "an address and nothing else", body: `{"address":"9311 E Ave P, ${MARKER}, Houston, TX 77012"}` },
	{
		what: "the confirmed coordinate with the address beside it",
		body: `{"latitude":${LATITUDE},"longitude":${LONGITUDE},"address":"9311 E Ave P, ${MARKER}"}`,
	},
	{
		what: "the coordinate with the Census matched address",
		body: `{"latitude":${LATITUDE},"longitude":${LONGITUDE},"matchedAddress":"9311 E AVE P, ${MARKER}, TX"}`,
	},
	{
		what: "the coordinate with the tiger line and street side that identify the block",
		body: `{"latitude":${LATITUDE},"longitude":${LONGITUDE},"tigerLineId":"${MARKER}","streetSide":"L"}`,
	},
	{
		what: "an address smuggled on __proto__",
		body: `{"latitude":${LATITUDE},"longitude":${LONGITUDE},"__proto__":{"address":"${MARKER}"}}`,
	},
	{
		what: "the coordinate nested under a point, with the address at the top level",
		body: `{"point":{"latitude":${LATITUDE},"longitude":${LONGITUDE}},"address":"${MARKER}"}`,
	},
	{
		what: "the coordinate as strings, which a form post would send",
		body: `{"latitude":"${LATITUDE}","longitude":"${LONGITUDE}"}`,
	},
	{ what: "the coordinate with a free-text query beside it", body: `{"latitude":${LATITUDE},"longitude":${LONGITUDE},"q":"${MARKER}"}` },
	{
		what: "the coordinate with a session cookie copied into the body",
		body: `{"latitude":${LATITUDE},"longitude":${LONGITUDE},"cookie":"session=${MARKER}"}`,
	},
	{ what: "an array carrying the coordinate and the address", body: `[{"latitude":${LATITUDE},"longitude":${LONGITUDE}},"${MARKER}"]` },
	{ what: "an out-of-range coordinate with an address", body: `{"latitude":91,"longitude":${LONGITUDE},"address":"${MARKER}"}` },
	{ what: "a truncated body the JSON parser cannot finish", body: `{"latitude":${LATITUDE},"address":"${MARKER}"` },
];

describe("B12: environmental adapters never receive the raw address", () => {
	it("refuses all twelve address-bearing request shapes, asks no source and writes no log", async () => {
		expect(ADDRESS_BEARING_BODIES).toHaveLength(12);
		for (const { what, body } of ADDRESS_BEARING_BODIES) {
			const { urls, io } = planned(DEMO);
			const handler = createReportHandler(io);
			const response = await handler(postRequest({ body }));
			const text = await response.text();

			expect(response.status, what).toBe(400);
			expect(text, what).toBe(JSON.stringify({ status: "invalid" }));
			// The strongest form of "no adapter received it": no adapter was asked
			// anything at all. `ReportRequestSchema` is a strict object of two
			// numbers, so a body carrying an address is refused rather than
			// stripped and acted on.
			expect(urls, what).toEqual([]);
			expect(text, what).not.toContain(MARKER);
			expect(serialize(logged), what).not.toContain(MARKER);
			expect(logged, what).toEqual([]);
		}
	});

	it("asks every source for a coordinate and a radius, and for nothing that could carry an address", async () => {
		const { urls, raw } = await report(DEMO);
		// Not vacuous: sources really were asked.
		expect(urls.length).toBeGreaterThan(5);
		expect(raw).toContain("VALERO PLUME");
		for (const url of urls) {
			expect(url).not.toContain(MARKER);
			expect(url.toLowerCase()).not.toContain("address");
			expect(url.toLowerCase()).not.toContain("9311");
			expect(url.toLowerCase()).not.toContain("houston");
		}
	});

	it("reads nothing off the request but its body: a cookie, a forwarded IP and a query string change neither the stream nor one outbound request", async () => {
		const plain = await report(DEMO);
		const dressed = await report(DEMO, {
			// A coordinate in a query string would land in an access log, which is
			// why the route is POST-only; this proves the route would not read one
			// even if a client put it there.
			url: `${ROUTE}?lat=${LATITUDE}&lon=${LONGITUDE}&address=${MARKER}&session=${MARKER}`,
			headers: {
				cookie: `session=${MARKER}`,
				"x-forwarded-for": "203.0.113.7",
				"user-agent": `Mozilla/5.0 (${MARKER})`,
				referer: `https://example.test/listing/${MARKER}`,
				authorization: `Bearer ${MARKER}`,
			},
		});

		const lines = (raw: string): readonly string[] => [...raw.split("\n").filter((line) => line.length > 0)].sort();
		// Card order is settle order and settle order is not fixed, so the streams
		// are compared as sets of lines. Everything inside a line -- every
		// sentence, every payload, the SHA-256 of the request body itself -- is
		// asserted byte for byte.
		expect(lines(dressed.raw)).toEqual(lines(plain.raw));
		expect([...dressed.urls].sort()).toEqual([...plain.urls].sort());
		expect(dressed.raw).not.toContain(MARKER);
		expect(dressed.raw).not.toContain("203.0.113.7");
		expect(serialize(dressed.urls)).not.toContain(MARKER);
		expect(logged).toEqual([]);
	});
});

/* -------------------------------------------------------------------------- */
/* B12, line 2: logs redact addresses and coordinates                        */
/* -------------------------------------------------------------------------- */

describe("B12: logs redact addresses and coordinates", () => {
	it("writes nothing at all on a timeout", async () => {
		const slow: Plan = { ...DEMO, semsLayer: { slow: 80, then: { fixture: SEMS_LAYER } } };
		const { raw } = await report(slow, {}, { sems: { timeoutMs: 10 } });
		expect(raw).toContain("the request timed out");
		expect(logged).toEqual([]);
	});

	it("writes nothing at all on a refusal", async () => {
		const refused: Plan = { ...DEMO, semsLayer: { fail: new SourceFailure("refused") } };
		const { raw } = await report(refused);
		expect(raw).toContain("refused the connection");
		expect(logged).toEqual([]);
	});

	it("writes nothing at all on a malformed body, and does not quote the body it failed to parse", async () => {
		const { response, raw } = await report(DEMO, { body: `{"latitude":${LATITUDE},"longitude":${LONGITUDE}` });
		expect(response.status).toBe(400);
		expect(raw).toBe(JSON.stringify({ status: "invalid" }));
		expect(logged).toEqual([]);
		expect(serialize(logged)).not.toContain(String(LATITUDE));
	});

	it("writes nothing at all on an invalid request, and does not echo the received value", async () => {
		const { response, raw } = await report(DEMO, { body: `{"latitude":91,"longitude":${LONGITUDE}}` });
		expect(response.status).toBe(400);
		expect(raw).toBe(JSON.stringify({ status: "invalid" }));
		expect(logged).toEqual([]);
		expect(serialize(logged)).not.toContain(String(LONGITUDE));
	});

	/**
	 * The sharp one. The whole-report failure path is reached by a throw, and
	 * the thing that throws there -- the clock the confirmed point's payload is
	 * stamped from -- can carry anything in its message. Here it carries the
	 * coordinate and the marker, which is exactly what a runtime's own error
	 * does when it repeats the request it failed on. What is logged must be the
	 * fixed string and nothing else.
	 */
	it("writes one fixed line on a whole-report failure, and not the coordinate the error carried in its message", async () => {
		const { io } = planned(DEMO);
		const broken: SourceIo = {
			get: io.get.bind(io),
			query: io.query.bind(io),
			now: () => {
				throw new Error(`the clock failed at ${LATITUDE},${LONGITUDE} for ${MARKER}`);
			},
		};
		const handler = createReportHandler(broken);
		const response = await handler(postRequest());
		const raw = await response.text();

		expect(raw).toBe(`${JSON.stringify({ type: "end", status: "failed" })}\n`);
		expect(logged).toEqual([["report: run failed"]]);
		expect(serialize(logged)).not.toContain(String(LATITUDE));
		expect(serialize(logged)).not.toContain(String(LONGITUDE));
		expect(serialize(logged)).not.toContain(MARKER);
		expect(raw).not.toContain(String(LATITUDE));
		expect(raw).not.toContain(MARKER);
	});

	it("writes one fixed line and a failure enum, never the address, when the geocode source refuses", async () => {
		const refusing: SourceIo = {
			get: () => Promise.reject(new SourceFailure("refused", null, null)),
			query: (parameter, value, adapterVersion, payload) => ({ kind: "query", parameter, value, adapterVersion, payload }),
			now: () => RETRIEVED_AT,
		};
		const handler = createGeocodeHandler(refusing);
		const response = await handler(
			new Request("http://localhost/api/geocode", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ address: `9311 E Avenue P, ${MARKER}, Houston, TX 77012` }),
			}),
		);

		expect(response.status).toBe(503);
		expect(await response.text()).toBe(JSON.stringify({ status: "unavailable" }));
		expect(logged).toEqual([["geocode: source unavailable", { reason: "refused" }]]);
		expect(serialize(logged)).not.toContain(MARKER);
	});

	/**
	 * Behaviour proves what the five paths above write. This proves there is no
	 * sixth path: every `console` call in the built application, read out of the
	 * parser rather than grepped, is a fixed string with nothing derived from a
	 * request anywhere in its arguments.
	 *
	 * `failureReason(error)` is the one call allowed inside a log argument. It
	 * is the kernel's error-to-enum reader: it returns one of a closed set of
	 * `FailureCause` members and cannot return anything the error carried. A
	 * second redactor may be added to this list, deliberately, by a reader who
	 * has checked that it has the same property.
	 */
	const REDACTORS: ReadonlySet<string> = new Set(["failureReason"]);

	type LogCall = { readonly file: string; readonly text: string; readonly args: readonly ts.Node[] };

	function consoleCalls(): readonly LogCall[] {
		const calls: LogCall[] = [];
		for (const path of PRODUCTION_FILES) {
			const source = parsed(path);
			walk(source, (node) => {
				if (!ts.isCallExpression(node)) return;
				const callee = node.expression;
				if (!ts.isPropertyAccessExpression(callee)) return;
				if (!ts.isIdentifier(callee.expression) || callee.expression.text !== "console") return;
				calls.push({ file: relative(path), text: node.getText(source), args: node.arguments });
			});
		}
		return calls;
	}

	it("has exactly three console calls in the built application, each a fixed string", () => {
		const calls = consoleCalls();
		expect(calls.map((call) => `${call.file} | ${call.text}`).sort()).toEqual([
			'app/api/geocode/handler.ts | console.error("geocode: source unavailable", { reason: failureReason(error) })',
			'app/api/report/handler.ts | console.error("report: a source card could not be built")',
			'app/api/report/handler.ts | console.error("report: run failed")',
		]);
	});

	it("passes no console call a value derived from the request, in any argument, at any depth", () => {
		const offences: string[] = [];
		for (const call of consoleCalls()) {
			const check = (node: ts.Node): void => {
				if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && REDACTORS.has(node.expression.text)) {
					// A closed enum reader. Its argument is not inspected because its
					// return value cannot carry one.
					return;
				}
				if (ts.isStringLiteral(node)) return;
				if (ts.isObjectLiteralExpression(node)) {
					for (const property of node.properties) check(property);
					return;
				}
				if (ts.isPropertyAssignment(node)) {
					check(node.initializer);
					return;
				}
				offences.push(`${call.file} | ${call.text} | ${ts.SyntaxKind[node.kind]} ${node.getText()}`);
			};
			for (const argument of call.args) check(argument);
		}
		// Anything a reader could not have written as a literal -- an identifier,
		// a template, a concatenation, an `error.message` -- lands here.
		expect(offences).toEqual([]);
	});
});

/* -------------------------------------------------------------------------- */
/* B12, line 3: client bundles contain no keys                               */
/* -------------------------------------------------------------------------- */

/**
 * Sentinel credentials, configured for the build only. They are what makes the
 * grep mean something: a build run with no key configured proves nothing,
 * because there is nothing in the process for the bundler to have inlined.
 *
 * `app/lib/report-contract.ts` reads all three names and is imported by the
 * report screen, which is a client component -- so this is not a hypothetical
 * boundary. What keeps the values out of the browser is that Next inlines only
 * `NEXT_PUBLIC_*`, and these three are read as `process.env["AQS_KEY"]` and its
 * siblings, which is a property read no bundler can resolve at build time.
 */
const KEY_SENTINELS: Readonly<Record<string, string>> = {
	AQS_KEY: "SENTINEL-AQS-KEY-DO-NOT-SHIP",
	AQS_EMAIL: "sentinel-aqs-email@do-not-ship.test",
	AIRNOW_KEY: "SENTINEL-AIRNOW-KEY-DO-NOT-SHIP",
};

/** A fixture value that appears in `tests/fixtures/` and in no file under app/ or lib/. Asserted, not assumed. */
const FIXTURE_PROBE = "KELLOGG TIRE FIRE";

/**
 * The one test in this file that shells out, and it runs by default: a warm
 * `next build` here takes about five seconds, which is less than the suite
 * spends on the report route, and a privacy property proved only when someone
 * remembers to export a variable is a property nobody proves. `PRIVACY_SKIP_BUNDLE_SCAN=1`
 * turns it off for a cold machine or an offline one.
 */
const SKIP_BUNDLE_SCAN = process.env["PRIVACY_SKIP_BUNDLE_SCAN"] === "1";

type Scanned = { readonly files: number; readonly bytes: number; readonly hits: readonly string[] };

/** Every file under a directory, searched for each needle, as text. */
function scanTree(directory: string, needles: readonly string[]): Scanned {
	let files = 0;
	let bytes = 0;
	const hits: string[] = [];
	const visit = (path: string): void => {
		for (const entry of readdirSync(path, { withFileTypes: true })) {
			const child = join(path, entry.name);
			if (entry.isDirectory()) {
				visit(child);
				continue;
			}
			files += 1;
			bytes += statSync(child).size;
			const text = readFileSync(child, "utf8");
			for (const needle of needles) {
				if (text.includes(needle)) hits.push(`${relative(child)} :: ${needle}`);
			}
		}
	};
	visit(directory);
	return { files, bytes, hits };
}

type BuiltTrees = { readonly staticTree: string; readonly serverTree: string };

let built: BuiltTrees | null = null;

function bufferOrString(value: unknown): string {
	if (typeof value === "string") return value;
	if (value instanceof Buffer) return value.toString("utf8");
	return "";
}

/** Whatever a failed `execFileSync` can tell us, without reaching for a type assertion. */
function outputOf(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	if (typeof error !== "object" || error === null) return message;
	const fields: Record<string, unknown> = { ...error };
	return [message, bufferOrString(fields["stdout"]), bufferOrString(fields["stderr"])].join("\n");
}

/**
 * One build, shared by the two tests that read it.
 *
 * `next build` takes a lock on `.next`, and this repository is worked on by
 * more than one process at a time, so a lock held by somebody else's build is
 * waited out rather than reported as a privacy failure. Anything else the build
 * says is re-thrown with its own output attached, so a broken build never reads
 * as a leak.
 */
function productionBuild(): BuiltTrees {
	if (built !== null) return built;
	const attempts = 6;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			execFileSync(`${repoRoot}node_modules/.bin/next`, ["build"], {
				cwd: repoRoot,
				env: { ...process.env, ...KEY_SENTINELS },
				encoding: "utf8",
				timeout: 240_000,
			});
			built = { staticTree: `${repoRoot}.next/static`, serverTree: `${repoRoot}.next/server` };
			return built;
		} catch (error) {
			const output = outputOf(error);
			if (attempt < attempts && output.includes("Another next build process is already running")) {
				execFileSync("sleep", ["5"]);
				continue;
			}
			throw new Error(`next build failed, so the bundle could not be scanned:\n${output.slice(-2_000)}`);
		}
	}
	throw new Error("next build never got the lock on .next");
}

describe("B12: client bundles contain no keys", () => {
	it.skipIf(SKIP_BUNDLE_SCAN)(
		"builds the application with all three credentials configured and finds none of them in what the browser is served",
		() => {
			const { staticTree, serverTree } = productionBuild();
			const sentinels = Object.values(KEY_SENTINELS);

			const client = scanTree(staticTree, sentinels);
			expect(client.hits).toEqual([]);
			// Not vacuous: a real bundle was scanned, not an empty directory.
			expect(client.files).toBeGreaterThan(3);
			expect(client.bytes).toBeGreaterThan(100_000);

			// The server bundle holds no key either. It has no reason to: the
			// adapters read `process.env` at the point of use, so the value
			// belongs to the running process and never to the artefact.
			expect(scanTree(serverTree, sentinels).hits).toEqual([]);

			// The scanner itself finds a planted key, so a clean result above is
			// the bundle's property and not the scanner's.
			const control = mkdtempSync(join(tmpdir(), "privacy-control-"));
			try {
				writeFileSync(join(control, "chunk.js"), `const k=${JSON.stringify(KEY_SENTINELS["AQS_KEY"])};`);
				expect(scanTree(control, sentinels).hits).toHaveLength(1);
			} finally {
				rmSync(control, { recursive: true, force: true });
			}
		},
		300_000,
	);
});

/* -------------------------------------------------------------------------- */
/* B12, line 4: fixtures cannot enter a production build                     */
/* -------------------------------------------------------------------------- */

/** Every module specifier a file imports, however it spells the import. */
function specifiersIn(path: string): readonly string[] {
	const source = parsed(path);
	const found: string[] = [];
	walk(source, (node) => {
		if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined) {
			if (ts.isStringLiteral(node.moduleSpecifier)) found.push(node.moduleSpecifier.text);
			return;
		}
		if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
			const reference = node.moduleReference.expression;
			if (ts.isStringLiteral(reference)) found.push(reference.text);
			return;
		}
		if (!ts.isCallExpression(node)) return;
		// `import("...")` and `require("...")`, which no lint rule on
		// `no-restricted-imports` can see.
		const dynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
		const required = ts.isIdentifier(node.expression) && node.expression.text === "require";
		if (!dynamic && !required) return;
		const [first] = node.arguments;
		if (first !== undefined && ts.isStringLiteral(first)) found.push(first.text);
	});
	return found;
}

function reachesTests(specifier: string): boolean {
	return /(^|\/)tests(\/|$)/.test(specifier.replace(/^@\//, ""));
}

async function lintProbe(filePath: string, code: string): Promise<readonly (string | null)[]> {
	const eslint = new ESLint({ cwd: repoRoot, overrideConfigFile: `${repoRoot}eslint.config.mjs` });
	const [result] = await eslint.lintText(code, { filePath });
	return (result?.messages ?? []).map((message) => message.ruleId);
}

describe("B12: fixtures cannot enter a production build", () => {
	/**
	 * A lint rule rather than a test, because it fails on the line that writes
	 * the import rather than the next time someone runs the suite. This asserts
	 * the block in `eslint.config.mjs` is on, the way
	 * `tests/unit/evidence/lint.test.ts` asserts the assertion bans are.
	 */
	it("reports an import of tests/ from under lib/ and app/, in every spelling a static import has", async () => {
		const spellings: readonly { readonly file: string; readonly code: string }[] = [
			{ file: "lib/adapters/__probe__.ts", code: `import x from "@/tests/fixtures/sems/arcgis-5mi-houston.json";\nexport const y = x;\n` },
			{ file: "lib/adapters/__probe__.ts", code: `import x from "../../tests/fixtures/echo/metadata.json";\nexport const y = x;\n` },
			{ file: "lib/evidence/__probe__.ts", code: `export { censusOrigin } from "@/tests/unit/evidence/helpers/sems-fixtures";\n` },
			{ file: "app/api/report/__probe__.ts", code: `import x from "../../../tests/fixtures/fema/esri-zone-ae-pasadena.json";\nexport const y = x;\n` },
			{ file: "app/components/__probe__.tsx", code: `import x from "@/tests/fixtures/census/match-9311-e-ave-p.json";\nexport const y = x;\n` },
			{ file: "lib/report/__probe__.ts", code: `import x from "@/tests";\nexport const y = x;\n` },
		];
		for (const { file, code } of spellings) {
			expect(await lintProbe(`${repoRoot}${file}`, code), file).toEqual(["no-restricted-imports"]);
		}
	}, 60_000);

	it("leaves an ordinary import alone, and leaves the test tree free to read its own fixtures", async () => {
		expect(await lintProbe(`${repoRoot}lib/report/__probe__.ts`, `import x from "@/lib/evidence";\nexport const y = x;\n`)).toEqual(
			[],
		);
		expect(
			await lintProbe(
				`${repoRoot}tests/unit/__probe__.ts`,
				`import x from "@/tests/fixtures/echo/metadata.json";\nexport const y = x;\n`,
			),
		).toEqual([]);
	}, 60_000);

	it("finds no path from app/ or lib/ into tests/, including the spellings the lint rule cannot see", () => {
		expect(PRODUCTION_FILES.length).toBeGreaterThan(20);
		const reaching: string[] = [];
		for (const path of PRODUCTION_FILES) {
			for (const specifier of specifiersIn(path)) {
				if (reachesTests(specifier)) reaching.push(`${relative(path)} -> ${specifier}`);
			}
		}
		expect(reaching).toEqual([]);

		// And nobody has written the rule out of the way.
		const disabled = PRODUCTION_FILES.filter((path) => readFileSync(path, "utf8").includes("eslint-disable"));
		expect(disabled.map(relative)).toEqual([]);
	});

	it("proves the scan can see an import, so an empty result is the tree's property and not the scan's", () => {
		const probe = mkdtempSync(join(tmpdir(), "privacy-import-"));
		try {
			const path = join(probe, "probe.ts");
			writeFileSync(
				path,
				[
					`import a from "@/tests/fixtures/echo/metadata.json";`,
					`const b = await import("../../tests/fixtures/sems/arcgis-5mi-houston.json");`,
					`const c = require("@/tests/unit/app/helpers/report-stream-fixtures");`,
					`export { a, b, c };`,
				].join("\n"),
			);
			expect(specifiersIn(path).filter(reachesTests)).toHaveLength(3);
		} finally {
			rmSync(probe, { recursive: true, force: true });
		}
	});

	it.skipIf(SKIP_BUNDLE_SCAN)(
		"finds no recorded fixture bytes in the built output",
		() => {
			// The probe is a value out of the recorded Superfund bytes that no
			// source file quotes -- checked here, because a probe that appears in a
			// comment would be found in the source map of an innocent build and
			// this test would fail for the wrong reason.
			expect(readFileSync(`${fixturesDir}${SEMS_LAYER}`, "utf8")).toContain(FIXTURE_PROBE);
			const quoted = PRODUCTION_FILES.filter((path) => readFileSync(path, "utf8").includes(FIXTURE_PROBE));
			expect(quoted.map(relative)).toEqual([]);

			const { staticTree, serverTree } = productionBuild();
			expect(scanTree(staticTree, [FIXTURE_PROBE]).hits).toEqual([]);
			expect(scanTree(serverTree, [FIXTURE_PROBE]).hits).toEqual([]);
		},
		300_000,
	);
});

/* -------------------------------------------------------------------------- */
/* B12, line 5: cache entries carry no user or session identifier            */
/* -------------------------------------------------------------------------- */

describe("B12: cache entries carry no user or session identifier", () => {
	const SEMS_URL = new URL(
		`https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/FRS_INTERESTS_SEMS/FeatureServer/0/query?geometry=${LONGITUDE}%2C${LATITUDE}&distance=8047&f=json`,
	);

	it("keys on the URL an adapter asked for and on nothing else: the key is the digest of that string", () => {
		expect(cacheKey(SEMS_URL)).toBe(createHash("sha256").update(SEMS_URL.toString(), "utf8").digest("hex"));
		expect(cacheKey(SEMS_URL)).toMatch(/^[0-9a-f]{64}$/);
		// The key reads as nothing. What an operator sees enumerating the index is
		// a list of digests, not a list of searches.
		expect(cacheKey(SEMS_URL)).not.toContain(String(LATITUDE));
		expect(cacheKey(SEMS_URL)).not.toContain(String(LONGITUDE));
		// Complete, so one point's bytes cannot be served as another point's.
		const moved = new URL(SEMS_URL.toString().replace(String(LATITUDE), "30.1"));
		expect(cacheKey(moved)).not.toBe(cacheKey(SEMS_URL));
	});

	it("never caches the one request that carries an address", () => {
		const geocoder = new URL(
			`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=${MARKER}`,
		);
		expect(cacheTtlMs(geocoder)).toBeNull();
		expect(cacheTtlMs(SEMS_URL)).not.toBeNull();
	});

	/**
	 * The behavioural form of the same claim, and the one that would catch a key
	 * that grew a caller in it: two reports, sent by what any server would read
	 * as two different clients, share every entry. A key carrying a cookie, a
	 * session, an IP or a user agent would miss on the second report and ask the
	 * sources again.
	 */
	it("serves a second report sent by a different client entirely out of the first client's entries", async () => {
		const { urls, io } = planned(DEMO);
		const handler = createReportHandler(createCacheSourceIo(io));

		const first = await handler(postRequest({ headers: { cookie: "session=FIRST-CLIENT" } }));
		const firstRaw = await first.text();
		const asked = urls.length;
		expect(asked).toBeGreaterThan(5);
		expect(firstRaw).toContain("VALERO PLUME");

		const second = await handler(
			postRequest({
				url: `${ROUTE}?session=SECOND-CLIENT`,
				headers: {
					cookie: "session=SECOND-CLIENT",
					"x-forwarded-for": "198.51.100.22",
					"user-agent": "a different browser entirely",
				},
			}),
		);
		const secondRaw = await second.text();

		// Every request the second report repeated is one the first report never
		// got an answer to. A `SourceFailure` is not remembered -- a source that
		// was down a minute ago is asked again rather than reported down for the
		// hour -- and FEMA's NFHL host refuses this machine, so its request is
		// the one that comes round again. Everything that answered was served out
		// of the entries the first client's report filled.
		const repeated = urls.slice(asked).map((url) => new URL(url).host);
		expect(repeated).toEqual(["hazards.fema.gov"]);
		const lines = (raw: string): readonly string[] => [...raw.split("\n").filter((line) => line.length > 0)].sort();
		expect(lines(secondRaw)).toEqual(lines(firstRaw));
	});

	/**
	 * And the structural reason the key cannot grow one: there is no user,
	 * session, IP or browser identifier anywhere in the server process to key
	 * on. `SourceIo.get` takes a `URL` and a schema, so the cache never sees a
	 * request -- and nothing above it reads one either.
	 */
	it("holds no user, session, IP or browser identifier anywhere in the built application", () => {
		/** Next's own way of reading a request's headers and cookies outside a route. */
		const IDENTITY_MODULES: ReadonlySet<string> = new Set(["next/headers", "server-only/headers"]);
		/** Reads that only ever mean "something about who is asking". */
		const IDENTITY_READS: ReadonlySet<string> = new Set([
			"cookies",
			"cookie",
			"ip",
			"geo",
			"userAgent",
			"remoteAddress",
			"socket",
			"connection",
		]);
		/**
		 * Header names that can only mean "who is asking". `authorization` is not
		 * among them on purpose: `app/lib/report-contract.ts` lists it as a
		 * credential-bearing query parameter to *redact*, which is the opposite
		 * of reading one, and a ban that fired on it would push a reader to
		 * shorten that list.
		 */
		const IDENTITY_STRINGS = /^(cookie|set-cookie|x-forwarded-for|x-real-ip|user-agent)$/i;

		const offences: string[] = [];
		for (const path of PRODUCTION_FILES) {
			for (const specifier of specifiersIn(path)) {
				if (IDENTITY_MODULES.has(specifier)) offences.push(`${relative(path)} imports ${specifier}`);
			}
			const source = parsed(path);
			walk(source, (node) => {
				if (ts.isPropertyAccessExpression(node)) {
					const name = node.name.text;
					if (IDENTITY_READS.has(name)) offences.push(`${relative(path)} reads .${name}`);
					// `.headers` is how a response is read, not only how a request
					// is; what is banned is reading them off the incoming request.
					if (name === "headers" && ts.isIdentifier(node.expression) && /^req(uest)?$/.test(node.expression.text)) {
						offences.push(`${relative(path)} reads ${node.expression.text}.headers`);
					}
					return;
				}
				if (ts.isStringLiteral(node) && IDENTITY_STRINGS.test(node.text)) {
					offences.push(`${relative(path)} names "${node.text}"`);
				}
			});
		}
		expect(offences).toEqual([]);
	});
});

/* -------------------------------------------------------------------------- */
/* B9: no configured credential reaches the wire, in any spelling            */
/* -------------------------------------------------------------------------- */

/**
 * Not one of B12's five lines, but proved by the same audit and worth keeping.
 * `tests/unit/app/report-route.test.ts` covers a key in a query parameter, in a
 * payload URL and in a source's own error text. The two below are the spellings
 * a shape-based redaction cannot see at all: a key in a path segment and a key
 * in a fragment. Only `withoutSecretValues`, which redacts by value, catches
 * these, so these two are the tests that prove the second redaction is doing
 * work the first cannot.
 */
describe("B9: no configured credential reaches the wire, in a path or in a fragment", () => {
	const KEY = "SENTINEL-KEY-DO-NOT-SHIP";

	async function withKey(rawCode: string): Promise<string> {
		process.env["AIRNOW_KEY"] = KEY;
		const { raw } = await report({ ...DEMO, semsLayer: { fail: new SourceFailure("http", rawCode) } });
		return raw;
	}

	it("redacts a key that a source echoed back inside a path segment", async () => {
		const raw = await withKey(`Not authenticated for https://www.airnowapi.org/aq/key/${KEY}/observation/latLong/current`);
		expect(raw).not.toContain(KEY);
		expect(raw).toContain(REDACTED);
		// The rest of the source's own words survive: B10 shows an unknown status
		// verbatim, and the redaction takes the credential, not the text.
		expect(raw).toContain("Not authenticated for");
	});

	it("redacts a key that a source echoed back inside a fragment", async () => {
		const raw = await withKey(`Not authenticated for https://www.airnowapi.org/aq/observation/latLong/current#API_KEY=${KEY}`);
		expect(raw).not.toContain(KEY);
		expect(raw).toContain(REDACTED);
		expect(raw).toContain("Not authenticated for");
	});

	it("redacts a key that never appears in a URL at all", async () => {
		const raw = await withKey(`Invalid API key: ${KEY}`);
		expect(raw).not.toContain(KEY);
		expect(raw).toContain(REDACTED);
	});
});
