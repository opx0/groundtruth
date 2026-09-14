/**
 * What the geocode route puts on the wire, driven end to end from the
 * recorded Census bytes.
 *
 * The sentences on screen 2 are not asserted against a string this file made
 * up: the handler renders them with `lib/templates/origin.ts` from the
 * `GeocodeMatch` the adapter built out of `tests/fixtures/census/*.json`, and
 * every span is resolved back to the Census field behind it through the trace
 * that crosses the wire beside it. A test that only compared text would pass
 * over a sentence with no provenance at all, which is the exact failure the
 * deleted `buildPrecisionSentence` was.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { CensusResponse } from "@/lib/adapters/census";
import { SourceFailure } from "@/lib/evidence";
import type { SourceIo } from "@/lib/evidence";
import { createGeocodeHandler } from "@/app/api/geocode/handler";
import {
	CURATED_EXAMPLES,
	GeocodeApiResponseSchema,
	type GeocodeMatchView,
	type OriginSentence,
} from "@/app/lib/geocode-contract";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const fixturesDir = `${repoRoot}tests/fixtures/`;
const RETRIEVED_AT = "2026-09-16T12:00:00Z";

/** The census fixture bytes, unedited, as `geocode()` would receive them. */
function fixtureBytes(fixture: string): Buffer {
	return readFileSync(`${fixturesDir}${fixture}`);
}

/**
 * Mirrors `lib/io/fetch-source-io.ts`: it `safeParse`s and turns a refusal
 * into `SourceFailure("malformed")` rather than letting a zod error out, so a
 * test that mangles a payload sees what production would see.
 */
function fakeIo(json: unknown, sha256: string): SourceIo {
	return {
		get(url, schema) {
			const parsed = schema.safeParse(json);
			if (!parsed.success) return Promise.reject(new SourceFailure("malformed", null));
			return Promise.resolve({
				raw: parsed.data,
				payload: { url: url.toString(), sha256, retrievedAt: RETRIEVED_AT },
			});
		},
		query(parameter, value, adapterVersion, payload) {
			return { kind: "query", parameter, value, adapterVersion, payload };
		},
		now: () => RETRIEVED_AT,
	};
}

function ioFor(fixture: string): SourceIo {
	const bytes = fixtureBytes(fixture);
	return fakeIo(JSON.parse(bytes.toString("utf8")), createHash("sha256").update(bytes).digest("hex"));
}

async function post(io: SourceIo, address: string): Promise<{ readonly status: number; readonly body: unknown }> {
	const handler = createGeocodeHandler(io);
	const response = await handler(
		new Request("http://localhost/api/geocode", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ address }),
		}),
	);
	return { status: response.status, body: await response.json() };
}

/** The response as the browser would hold it: parsed through the shared schema, never cast. */
async function matchFrom(fixture: string, address: string): Promise<GeocodeMatchView> {
	const { body } = await post(ioFor(fixture), address);
	const parsed = GeocodeApiResponseSchema.parse(body);
	if (parsed.status !== "matched") throw new Error(`expected a match, got ${parsed.status}`);
	return parsed.match;
}

async function candidatesFrom(fixture: string, address: string): Promise<readonly GeocodeMatchView[]> {
	const { body } = await post(ioFor(fixture), address);
	const parsed = GeocodeApiResponseSchema.parse(body);
	if (parsed.status !== "ambiguous") throw new Error(`expected candidates, got ${parsed.status}`);
	return parsed.candidates;
}

function textOf(sentence: OriginSentence): string {
	return sentence.spans.map((span) => span.text).join("");
}

function sentenceWith(match: GeocodeMatchView, templateId: string): OriginSentence {
	const found = match.origin.find((sentence) => sentence.templateId === templateId);
	if (found === undefined) throw new Error(`no ${templateId} sentence on the wire`);
	return found;
}

const HOUSTON = "9311 E Avenue P, Houston, TX 77012";

/* -------------------------------------------------------------------------- */
/* The sentences on screen 2                                                  */
/* -------------------------------------------------------------------------- */

describe("the origin sentences are rendered by lib/templates/origin.ts, from the match", () => {
	it("puts both origin templates on the wire, in the order the templates module declares them", async () => {
		const match = await matchFrom("census/match-9311-e-ave-p.json", HOUSTON);
		expect(match.origin.map((sentence) => sentence.templateId)).toEqual(["origin/match@1", "origin/point@1"]);
	});

	it("renders docs/BRIEF.md A2's precision sentence from the recorded Census fields", async () => {
		const match = await matchFrom("census/match-9311-e-ave-p.json", HOUSTON);
		expect(textOf(sentenceWith(match, "origin/match@1"))).toBe(
			"Matched: 9311 E AVE P, HOUSTON, TX, 77012." +
				" The point sits on the 9301 to 9399 block, street side L," +
				" interpolated by the Census Geocoder along TIGER line 96085986." +
				" It marks the block, not the parcel.",
		);
		expect(textOf(sentenceWith(match, "origin/point@1"))).toBe(
			"Mapped point: 29.720658823001, -95.261995884462.",
		);
	});

	it("prints the street side as the Census sent it, rather than inventing a word for it", async () => {
		const match = await matchFrom("census/match-9311-e-ave-p.json", HOUSTON);
		const text = textOf(sentenceWith(match, "origin/match@1"));
		expect(text).toContain("street side L");
		// The deleted hand-written sentence said "left side of the street
		// segment". The Census says "L"; the report says "L".
		expect(text).not.toContain("left");
	});

	it("answers what field is behind every span that carries one, from the trace beside it", async () => {
		const match = await matchFrom("census/match-9311-e-ave-p.json", HOUSTON);
		for (const sentence of match.origin) {
			const { trace } = sentence;
			if (trace === null) throw new Error(`${sentence.templateId} arrived with no trace`);
			const slotted = sentence.spans.filter((span) => span.slot !== null);
			expect(slotted.length).toBeGreaterThan(0);
			for (const span of slotted) {
				const value = trace.values.find((one) => one.field === span.slot?.field);
				expect(value, `no trace value for ${span.slot?.field ?? "?"}`).toBeDefined();
				expect(value?.displayed).toBe(span.text);
				expect(value?.provenance.length ?? 0).toBeGreaterThan(0);
			}
		}
	});

	it("names the Census field each end of the block range was read from", async () => {
		const match = await matchFrom("census/match-9311-e-ave-p.json", HOUSTON);
		const { trace } = sentenceWith(match, "origin/match@1");
		const fields = new Map((trace?.values ?? []).map((value) => [value.field, value]));
		const sourceFieldOf = (field: string): readonly (string | null)[] =>
			(fields.get(field)?.provenance ?? []).map((one) =>
				one.kind === "field" ? `${one.dataset}.${one.sourceField}` : null,
			);

		expect(sourceFieldOf("blockFrom")).toEqual(["census_geocoder.fromAddress"]);
		expect(sourceFieldOf("blockTo")).toEqual(["census_geocoder.toAddress"]);
		expect(sourceFieldOf("streetSide")).toEqual(["census_geocoder.side"]);
		expect(sourceFieldOf("tigerLineId")).toEqual(["census_geocoder.tigerLineId"]);
		expect(trace?.origin.matchedAddress).toBe("9311 E AVE P, HOUSTON, TX, 77012");
	});

	it("renders every candidate's own sentences, so choosing one carries the sentences about it", async () => {
		const candidates = await candidatesFrom("census/ambiguous-100-main-st.json", "100 Main St, Springfield");
		expect(candidates).toHaveLength(7);
		const vermont = candidates.find((one) => one.matchedAddress.includes(", VT, "));
		if (vermont === undefined) throw new Error("expected the Vermont candidate");
		// The recorded Vermont row's range descends, 198 to 70, and is printed
		// as recorded rather than reordered.
		expect(textOf(sentenceWith(vermont, "origin/match@1"))).toBe(
			"Matched: 100 MAIN ST, SPRINGFIELD, VT, 05156." +
				" The point sits on the 198 to 70 block, street side R," +
				" interpolated by the Census Geocoder along TIGER line 139275180." +
				" It marks the block, not the parcel.",
		);
		for (const candidate of candidates) {
			expect(candidate.origin.map((sentence) => sentence.templateId)).toEqual([
				"origin/match@1",
				"origin/point@1",
			]);
		}
	});
});

/* -------------------------------------------------------------------------- */
/* A match with no block range                                                */
/* -------------------------------------------------------------------------- */

/**
 * `origin/match@1` is two clauses. The block range, the street side and the
 * TIGER line are all in the second, so if any of them were missing that clause
 * would drop whole and the first, "Matched: ...", would survive -- the kernel
 * drops clauses, not sentences, and
 * `tests/unit/evidence/render.test.ts:253` pins that behaviour. Screen 2 would
 * then show one paragraph shorter, with nothing written in its place;
 * `tests/unit/app/screens.test.ts` holds that half.
 *
 * The question this block answers is whether that state can arrive at all,
 * asked of the real bytes rather than of an invented payload. It cannot. The
 * benchmark the adapter queries is `Public_AR_Current` -- Public Address
 * Ranges -- so a match on it is an interpolation along a range, and a range is
 * what every recorded match has. Probed live against
 * `geocoding.geo.census.gov` on 2026-09-16 across twenty-odd addresses
 * (highways, PO boxes, rural routes, Puerto Rico, tribal land): every address
 * either matched with a full range or returned no match at all. A response
 * that did somehow arrive without one would not render half a sentence, it
 * would not parse: `CensusResponse` requires both ends.
 */
describe("a match with no block range", () => {
	const censusFixtures = readdirSync(`${fixturesDir}census`).filter((name) => name.endsWith(".json"));

	it("is not something the recorded Census responses contain: every real match carries one", () => {
		expect(censusFixtures.length).toBeGreaterThan(0);
		let matchesSeen = 0;
		for (const name of censusFixtures) {
			const parsed = CensusResponse.parse(JSON.parse(fixtureBytes(`census/${name}`).toString("utf8")));
			for (const match of parsed.result.addressMatches) {
				matchesSeen += 1;
				expect(match.addressComponents.fromAddress, `${name} fromAddress`).not.toBe("");
				expect(match.addressComponents.toAddress, `${name} toAddress`).not.toBe("");
				expect(match.tigerLine.side, `${name} side`).not.toBe("");
				expect(match.tigerLine.tigerLineId, `${name} tigerLineId`).not.toBe("");
			}
		}
		// One matched fixture plus seven candidates in the ambiguous one.
		expect(matchesSeen).toBe(8);
	});

	it("so every match the fixtures hold renders the block-not-parcel clause, not just the demo one", async () => {
		const all = [
			await matchFrom("census/match-9311-e-ave-p.json", HOUSTON),
			...(await candidatesFrom("census/ambiguous-100-main-st.json", "100 Main St, Springfield")),
		];
		expect(all).toHaveLength(8);
		for (const match of all) {
			expect(textOf(sentenceWith(match, "origin/match@1"))).toContain("It marks the block, not the parcel.");
		}
	});

	it("and a response that lost the range is a source failure, never a half-rendered sentence", async () => {
		const bytes = fixtureBytes("census/match-9311-e-ave-p.json");
		const recorded: unknown = JSON.parse(bytes.toString("utf8"));
		const withoutRange = JSON.parse(
			JSON.stringify(recorded, (key, value: unknown) =>
				key === "fromAddress" || key === "toAddress" ? undefined : value,
			),
		);
		// The handler logs its one fixed line on this path; captured so the run's
		// output stays about the assertions.
		const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
		try {
			const { status, body } = await post(fakeIo(withoutRange, "sha"), HOUSTON);
			expect(status).toBe(503);
			expect(body).toEqual({ status: "unavailable" });
			expect(logged.mock.calls).toEqual([["geocode: source unavailable", { reason: "malformed" }]]);
		} finally {
			logged.mockRestore();
		}
	});
});

/* -------------------------------------------------------------------------- */
/* buildPrecisionSentence is gone                                             */
/* -------------------------------------------------------------------------- */

function sourceFiles(dir: string): readonly string[] {
	const out: string[] = [];
	for (const entry of readdirSync(`${repoRoot}${dir}`, { withFileTypes: true })) {
		const path = `${dir}/${entry.name}`;
		if (entry.isDirectory()) out.push(...sourceFiles(path));
		else if (path.endsWith(".ts") || path.endsWith(".tsx")) out.push(path);
	}
	return out;
}

describe("no sentence on screen is written by hand any more", () => {
	it("has no buildPrecisionSentence, and nothing under app/ or lib/ writes the precision sentence as a string", () => {
		const files = [...sourceFiles("app"), ...sourceFiles("lib")];
		expect(files.length).toBeGreaterThan(10);
		// The name, and the clause only the hand-written version ever said --
		// `lib/adapters/census.ts` describes "which side of the street segment"
		// in prose about the endpoint, which is not this.
		const offenders = files.filter((path) => {
			const source = readFileSync(`${repoRoot}${path}`, "utf8");
			return (
				source.includes("buildPrecisionSentence") ||
				source.includes("side of the street segment, interpolated by the Census Geocoder")
			);
		});
		expect(offenders).toEqual([]);
	});

	it("leaves lib/templates/origin.ts as the only place that text exists", () => {
		const origin = readFileSync(`${repoRoot}lib/templates/origin.ts`, "utf8");
		expect(origin).toContain("It marks the block, not the parcel.");
		const others = sourceFiles("app").filter((path) =>
			readFileSync(`${repoRoot}${path}`, "utf8").includes("It marks the block, not the parcel."),
		);
		expect(others).toEqual([]);
	});
});

/* -------------------------------------------------------------------------- */
/* The schema                                                                 */
/* -------------------------------------------------------------------------- */

describe("GeocodeApiResponseSchema", () => {
	async function matchedBody(): Promise<{ status: "matched"; match: GeocodeMatchView }> {
		return { status: "matched", match: await matchFrom("census/match-9311-e-ave-p.json", HOUSTON) };
	}

	it("strips a field not declared on the branch's schema, even inside a nested match", async () => {
		const clean = await matchedBody();
		const withExtra = { status: "matched", match: { ...clean.match, rawAddress: "123 Secret St, Nowhere" } };
		const parsed = GeocodeApiResponseSchema.parse(withExtra);
		expect(parsed).toEqual(clean);
		expect(JSON.stringify(parsed)).not.toContain("Secret");
	});

	it("strips a field someone attached to a span or to a value of the trace", async () => {
		const clean = await matchedBody();
		const [first, ...rest] = clean.match.origin;
		if (first === undefined || first.trace === null) throw new Error("expected a traced sentence");
		const smuggled = {
			status: "matched",
			match: {
				...clean.match,
				origin: [
					{
						...first,
						spans: first.spans.map((span) => ({ ...span, rawAddress: "123 Secret St" })),
						trace: {
							...first.trace,
							requestedAddress: "123 Secret St",
							values: first.trace.values.map((value) => ({ ...value, typedByReader: "123 Secret St" })),
						},
					},
					...rest,
				],
			},
		};
		const parsed = GeocodeApiResponseSchema.parse(smuggled);
		expect(parsed).toEqual(clean);
		expect(JSON.stringify(parsed)).not.toContain("Secret");
	});

	it("refuses a trace of any scope but origin, so a record's provenance cannot ride this wire", async () => {
		const clean = await matchedBody();
		const [first] = clean.match.origin;
		if (first === undefined) throw new Error("expected a sentence");
		const recordScoped = {
			status: "matched",
			match: {
				...clean.match,
				origin: [{ ...first, trace: { scope: "record", record: { sourceRecordId: "TXN000622182" }, values: [] } }],
			},
		};
		expect(() => GeocodeApiResponseSchema.parse(recordScoped)).toThrow();
	});

	it("rejects an ambiguous body with fewer than two candidates", async () => {
		const clean = await matchedBody();
		expect(() => GeocodeApiResponseSchema.parse({ status: "ambiguous", candidates: [clean.match] })).toThrow();
	});

	it("accepts each of the five statuses with their own shape", () => {
		expect(GeocodeApiResponseSchema.parse({ status: "no-match" })).toEqual({ status: "no-match" });
		expect(GeocodeApiResponseSchema.parse({ status: "unavailable" })).toEqual({ status: "unavailable" });
		expect(GeocodeApiResponseSchema.parse({ status: "invalid" })).toEqual({ status: "invalid" });
	});
});

/* -------------------------------------------------------------------------- */
/* Curated examples                                                           */
/* -------------------------------------------------------------------------- */

describe("CURATED_EXAMPLES", () => {
	it("is exactly the three curated addresses from docs/BRIEF.md A6, rows 1-3", () => {
		expect(CURATED_EXAMPLES).toHaveLength(3);
		expect(CURATED_EXAMPLES.map((e) => e.address)).toEqual([
			"9311 E Ave P, Houston, TX 77012",
			"400 N Richey St, Pasadena, TX 77506",
			"1300 Perdido St, New Orleans, LA 70112",
		]);
	});

	it("never uses the words the renderer is forbidden to use anywhere in the product (docs/BRIEF.md C2)", () => {
		for (const example of CURATED_EXAMPLES) {
			expect(example.note.toLowerCase()).not.toMatch(/\bsafe\b/);
			expect(example.note.toLowerCase()).not.toMatch(/\brisk\b/);
		}
	});

	it("does not include the no-match or ambiguous demo addresses as buttons", () => {
		const addresses = CURATED_EXAMPLES.map((e) => e.address);
		expect(addresses).not.toContain("9400 Clinton Dr, Houston, TX 77029");
		expect(addresses.some((a) => a.includes("Springfield"))).toBe(false);
	});
});
