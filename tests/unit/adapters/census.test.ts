import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { GeocodeMatch, SourceIo } from "@/lib/evidence";
import { SourceFailure } from "@/lib/evidence";
import { CensusResponse, geocode, type GeocodeOutcome } from "@/lib/adapters/census";

const fixturesDir = fileURLToPath(new URL("../../fixtures/", import.meta.url));
const RETRIEVED_AT = "2026-09-16T12:00:00Z";

/**
 * A fake `SourceIo` backed by bytes. It does to them exactly what
 * `lib/io/fetch-source-io.ts` does to a response body -- hash the bytes,
 * `JSON.parse`, then `safeParse` through the schema the adapter passed in,
 * and raise `SourceFailure("malformed", null)` at either step -- so the
 * malformed cases below fail the way the real io fails rather than the way a
 * test double chose to. It stamps the payload's `url` with the *exact* URL
 * the adapter requested -- address and all -- so the privacy tests are
 * proving something real: that `geocode` itself redacts it, not that the io
 * layer happened to.
 */
function ioFromBytes(bytes: Buffer): SourceIo {
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	return {
		get(url, schema) {
			const payload = { url: url.toString(), sha256, retrievedAt: RETRIEVED_AT };
			let json: unknown;
			try {
				json = JSON.parse(bytes.toString("utf8"));
			} catch {
				return Promise.reject(new SourceFailure("malformed", null));
			}
			const parsed = schema.safeParse(json);
			if (!parsed.success) return Promise.reject(new SourceFailure("malformed", null));
			return Promise.resolve({ raw: parsed.data, payload });
		},
		query(parameter, value, adapterVersion, payload) {
			return { kind: "query", parameter, value, adapterVersion, payload };
		},
		now: () => RETRIEVED_AT,
	};
}

function fakeIo(fixture: string): SourceIo {
	return ioFromBytes(readFileSync(`${fixturesDir}${fixture}`));
}

/**
 * The transport half of the seven cases. Census has never rate-limited or
 * timed out on this repository -- the only recorded 429 anywhere here is
 * `tests/fixtures/aqs/rate-limited.json`, and it is AQS's -- so the failure
 * is raised where the real io raises it, before any body exists to record,
 * and what is under test is what `geocode` does with it.
 */
function ioThatFails(failure: SourceFailure): SourceIo {
	return {
		get() {
			return Promise.reject(failure);
		},
		query(parameter, value, adapterVersion, payload) {
			return { kind: "query", parameter, value, adapterVersion, payload };
		},
		now: () => RETRIEVED_AT,
	};
}

/** The failure a call raised, or a test failure naming the outcome it returned instead. */
async function failureFrom(call: Promise<GeocodeOutcome>): Promise<SourceFailure> {
	try {
		const outcome = await call;
		throw new Error(`expected a rejection; geocode returned status "${outcome.status}"`);
	} catch (error) {
		if (error instanceof SourceFailure) return error;
		throw error;
	}
}

const MATCH_FIXTURE = "census/match-9311-e-ave-p.json";
const AMBIGUOUS_FIXTURE = "census/ambiguous-100-main-st.json";
const NO_MATCH_FIXTURE = "census/no-match-9400-clinton.json";

/**
 * The privacy boundary. A distinctive marker is folded into the address on
 * every call here -- something Census's own fixtures would never echo back --
 * so a passing test means the input string genuinely cannot be recovered from
 * what `geocode` hands back, not merely that the marker happens to differ
 * from the fixture's matched address.
 */
const SECRET_MARKER = "APT-9Z-DO-NOT-LEAK";

function assertNoLeak(haystack: unknown): void {
	const serialized = JSON.stringify(haystack, (_key, value: unknown) =>
		typeof value === "bigint" ? value.toString() : value,
	);
	expect(serialized ?? "").not.toContain(SECRET_MARKER);
	expect(serialized ?? "").not.toContain("address=");
}

describe("a clean single match", () => {
	it("carries the matched address, point, TIGER line, side, and range -- literally", async () => {
		const outcome = await geocode("9311 E Avenue P, Houston, TX 77012", fakeIo(MATCH_FIXTURE));
		if (outcome.status !== "matched") throw new Error(outcome.status);
		const { match } = outcome;

		expect(match.matchedAddress.value).toBe("9311 E AVE P, HOUSTON, TX, 77012");
		expect(match.point.latitude.value).toBe(29.720658823001);
		expect(match.point.longitude.value).toBe(-95.261995884462);
		expect(match.point.accuracyMeters.value).toBeNull();
		expect(match.tigerLineId.value).toBe("96085986");
		expect(match.streetSide.value).toBe("L");
		expect(match.addressRange.from.value).toBe("9301");
		expect(match.addressRange.to.value).toBe("9399");
	});

	it("traces every field back to the field it came from, dataset and raw value included", async () => {
		const outcome = await geocode("9311 E Avenue P, Houston, TX 77012", fakeIo(MATCH_FIXTURE));
		if (outcome.status !== "matched") throw new Error(outcome.status);
		const { match } = outcome;

		const [addrProv] = match.matchedAddress.provenance;
		if (addrProv?.kind !== "field") throw new Error("expected field provenance");
		expect(addrProv).toMatchObject({ dataset: "census_geocoder", sourceField: "matchedAddress", rawValue: "9311 E AVE P, HOUSTON, TX, 77012" });

		const [tigerProv] = match.tigerLineId.provenance;
		if (tigerProv?.kind !== "field") throw new Error("expected field provenance");
		expect(tigerProv).toMatchObject({ dataset: "census_geocoder", sourceField: "tigerLineId", rawValue: "96085986" });

		const [fromProv] = match.addressRange.from.provenance;
		if (fromProv?.kind !== "field") throw new Error("expected field provenance");
		expect(fromProv).toMatchObject({ dataset: "census_geocoder", sourceField: "fromAddress", rawValue: "9301" });
		const [toProv] = match.addressRange.to.provenance;
		if (toProv?.kind !== "field") throw new Error("expected field provenance");
		expect(toProv).toMatchObject({ dataset: "census_geocoder", sourceField: "toAddress", rawValue: "9399" });
		// Each end of the range is its own leaf; the pair is a frozen container, not one Sourced wrapping an object.
		expect(Object.isFrozen(match.addressRange)).toBe(true);

		const [latProv] = match.point.latitude.provenance;
		if (latProv?.kind !== "field") throw new Error("expected field provenance");
		expect(latProv).toMatchObject({ dataset: "census_geocoder", sourceField: "y", rawValue: 29.720658823001 });
	});
});

/**
 * The seven cases, case 3: a null where a null is allowed, from the committed
 * recording rather than from an authored row.
 *
 * `GeoPoint` has five leaves and Census fills two of them. The endpoint sends
 * no accuracy, no collection method and no reference point -- the same absence
 * that leaves this source with no confidence score, documented at the top of
 * `lib/adapters/census.ts`. What matters is the shape of the three nulls: they
 * carry `kind: "absent"` naming the field the dataset does not have, so the
 * trace can say "Census has no such field" instead of showing a null with no
 * origin, and they carry no `rawValue`, so nothing can read them as a value
 * Census sent.
 */
describe("the point fields Census does not send", () => {
	it("are null with absent provenance naming them, not a null the source is pretended to have sent", async () => {
		const outcome = await geocode("9311 E Avenue P, Houston, TX 77012", fakeIo(MATCH_FIXTURE));
		if (outcome.status !== "matched") throw new Error(outcome.status);
		const { point } = outcome.match;

		expect(point.accuracyMeters.value).toBeNull();
		const [accuracyProv] = point.accuracyMeters.provenance;
		if (accuracyProv?.kind !== "absent") throw new Error(`expected absent provenance, got ${String(accuracyProv?.kind)}`);
		expect(accuracyProv).toMatchObject({ dataset: "census_geocoder", sourceField: "accuracy", adapterVersion: "census@1" });
		expect("rawValue" in accuracyProv).toBe(false);
		// Absence is cited too: the trace entry names the same redacted payload the values do.
		expect(accuracyProv.payload.url).not.toContain("address=");
		expect(accuracyProv.payload.retrievedAt).toBe(RETRIEVED_AT);

		expect(point.collectionMethod.value).toBeNull();
		const [methodProv] = point.collectionMethod.provenance;
		if (methodProv?.kind !== "absent") throw new Error(`expected absent provenance, got ${String(methodProv?.kind)}`);
		expect(methodProv).toMatchObject({ dataset: "census_geocoder", sourceField: "collectionMethod", adapterVersion: "census@1" });

		expect(point.referencePoint.value).toBeNull();
		const [referenceProv] = point.referencePoint.provenance;
		if (referenceProv?.kind !== "absent") throw new Error(`expected absent provenance, got ${String(referenceProv?.kind)}`);
		expect(referenceProv).toMatchObject({ dataset: "census_geocoder", sourceField: "referencePoint", adapterVersion: "census@1" });
	});

	it("is the only optional there is: every field this adapter reads is required, in the schema and in the bytes", () => {
		// `fromAddress`, `toAddress`, `side`, `tigerLineId`, `matchedAddress` and
		// both coordinates are non-optional in `CensusResponse`, so a match that
		// lost one is the malformed case below, never a null here.
		for (const fixture of [MATCH_FIXTURE, AMBIGUOUS_FIXTURE]) {
			const json: unknown = JSON.parse(readFileSync(`${fixturesDir}${fixture}`, "utf8"));
			for (const match of CensusResponse.parse(json).result.addressMatches) {
				expect(match.matchedAddress).not.toBe("");
				expect(match.addressComponents.fromAddress).not.toBe("");
				expect(match.addressComponents.toAddress).not.toBe("");
				expect(match.tigerLine.side).not.toBe("");
				expect(match.tigerLine.tigerLineId).not.toBe("");
				expect(typeof match.coordinates.x).toBe("number");
				expect(typeof match.coordinates.y).toBe("number");
			}
		}
	});
});

describe("an ambiguous match", () => {
	it("returns every candidate across states, not a chosen one, with the raw string range kept verbatim (even reversed)", async () => {
		const outcome = await geocode("100 Main St, Springfield", fakeIo(AMBIGUOUS_FIXTURE));
		if (outcome.status !== "ambiguous") throw new Error(outcome.status);

		expect(outcome.candidates).toHaveLength(7);
		const addresses = outcome.candidates.map((c) => c.matchedAddress.value);
		expect(addresses).toEqual([
			"100 MAIN ST, SPRINGFIELD, MA, 01105",
			"100 MAIN ST, SPRINGFIELD, MA, 01151",
			"100 MAIN ST, SPRINGFIELD, VT, 05156",
			"100 MAIN ST, SPRINGFIELD, OH, 45502",
			"100 MAIN ST, SPRINGFIELD, CO, 81073",
			"100 MAIN ST, SPRINGFIELD, NE, 68059",
			"100 MAIN ST, SPRINGFIELD, OR, 97477",
		]);

		// The Vermont and Colorado rows carry a "range" with `to` < `from`. That is
		// the real TIGER data: a range is not guaranteed ascending, and nothing in
		// this adapter may sort or otherwise "fix" the strings it is handed.
		const vermont = outcome.candidates[2];
		if (vermont === undefined) throw new Error("expected a third candidate");
		expect(vermont.addressRange.from.value).toBe("198");
		expect(vermont.addressRange.to.value).toBe("70");
		expect(vermont.streetSide.value).toBe("R");
		expect(vermont.tigerLineId.value).toBe("139275180");

		const oregon = outcome.candidates[6];
		if (oregon === undefined) throw new Error("expected a seventh candidate");
		expect(oregon.point.latitude.value).toBe(44.046265369386);
		expect(oregon.point.longitude.value).toBe(-123.024628603458);
	});

	it("cannot be read as a single match: the type has no `match` field and the value has no such key", async () => {
		const outcome = await geocode("100 Main St, Springfield", fakeIo(AMBIGUOUS_FIXTURE));
		if (outcome.status !== "ambiguous") throw new Error(outcome.status);
		expect("match" in outcome).toBe(false);
	});
});

describe("no match, for an address that genuinely exists", () => {
	it("is its own outcome, not an empty success and not a thrown failure", async () => {
		const outcome = await geocode("9400 Clinton Dr, Houston, TX 77029", fakeIo(NO_MATCH_FIXTURE));
		expect(outcome.status).toBe("no-match");
		if (outcome.status !== "no-match") throw new Error(outcome.status);
		expect(outcome.retrievedAt).toBe(RETRIEVED_AT);
		expect("match" in outcome).toBe(false);
		expect("candidates" in outcome).toBe(false);
	});
});

/**
 * The seven cases, case 4: **this source does not have it.**
 *
 * "Unknown status" means a status string the code has never catalogued,
 * passed through verbatim. The Census geocoder sends no such string to pass
 * through. `lib/adapters/census.ts` says so at the top -- "The response
 * carries no match-type field and no confidence score" -- and the recorded
 * bytes agree: no key anywhere in any of the three responses is a status, a
 * match type, a confidence, a score or a grade. What decides the outcome is
 * the *shape* of `result.addressMatches`: empty is no-match, one is matched,
 * more is ambiguous. There is no vocabulary to be unfamiliar with, so no
 * fixture is authored to invent one.
 *
 * The test below is what keeps that from being a comment that rots. If Census
 * ever starts sending a status-shaped field, or a future recording carries
 * one, this fails and the case stops being hypothetical.
 */
describe("unknown status, a case this source does not have", () => {
	const recorded = [MATCH_FIXTURE, AMBIGUOUS_FIXTURE, NO_MATCH_FIXTURE];
	const statusShaped = /status|match[_-]?type|confidence|score|quality|grade/i;

	it("has no status-shaped field anywhere in any recorded response", () => {
		for (const fixture of recorded) {
			const keys = new Set<string>();
			const json: unknown = JSON.parse(readFileSync(`${fixturesDir}${fixture}`, "utf8"), (key: string, value: unknown) => {
				if (key !== "") keys.add(key);
				return value;
			});
			expect(json).not.toBeNull();
			expect(keys.size).toBeGreaterThan(5);
			expect([...keys].filter((key) => statusShaped.test(key)), fixture).toEqual([]);
		}
	});

	it("and the parsed response is an array of matches and nothing else, so there is nothing else to branch on", () => {
		const json: unknown = JSON.parse(readFileSync(`${fixturesDir}${MATCH_FIXTURE}`, "utf8"));
		const parsed = CensusResponse.parse(json);
		expect(Object.keys(parsed.result)).toEqual(["addressMatches"]);
		const [first] = parsed.result.addressMatches;
		if (first === undefined) throw new Error("expected one match");
		expect(Object.keys(first).sort()).toEqual(["addressComponents", "coordinates", "matchedAddress", "tigerLine"]);
	});
});

/**
 * The seven cases, case 5. Both bodies below are made in this file from the
 * committed recording, never stored: a `.json` file under
 * `tests/fixtures/census/` that the schema rejects would break
 * `tests/unit/app/geocode-contract.test.ts`, which parses every `.json` in
 * that directory and counts the matches it finds.
 */
describe("malformed response", () => {
	it("a match that lost a required field is rejected by the schema, with the path said out loud", () => {
		const text = readFileSync(`${fixturesDir}${MATCH_FIXTURE}`, "utf8");
		const withoutCoordinates: unknown = JSON.parse(text, (key: string, value: unknown) =>
			key === "coordinates" ? undefined : value,
		);
		const parsed = CensusResponse.safeParse(withoutCoordinates);
		if (parsed.success) throw new Error("expected the schema to reject a match with no coordinates");
		expect(parsed.error.issues).toHaveLength(1);
		expect(parsed.error.issues[0]?.path).toEqual(["result", "addressMatches", 0, "coordinates"]);
	});

	it("and reaches the caller as SourceFailure(\"malformed\"), not as an empty result", async () => {
		const text = readFileSync(`${fixturesDir}${MATCH_FIXTURE}`, "utf8");
		const withoutCoordinates: unknown = JSON.parse(text, (key: string, value: unknown) =>
			key === "coordinates" ? undefined : value,
		);
		const address = `9311 E Avenue P, ${SECRET_MARKER}, Houston, TX 77012`;
		const io = ioFromBytes(Buffer.from(JSON.stringify(withoutCoordinates), "utf8"));
		const failure = await failureFrom(geocode(address, io));

		expect(failure.reason).toBe("malformed");
		expect(failure.rawCode).toBeNull();
		expect(failure.retryAfter).toBeNull();
		expect(failure.message).toBe("source malformed");
		assertNoLeak({ message: failure.message, reason: failure.reason, rawCode: failure.rawCode, retryAfter: failure.retryAfter });
	});

	it("as does a body that is not JSON at all", async () => {
		// Not a recording. No non-JSON body has been captured from this endpoint;
		// any bytes that are not JSON drive the same `JSON.parse` failure in
		// `lib/io/fetch-source-io.ts`, which is the step under test.
		const notJson = Buffer.from("these bytes were written by this test file and are not JSON", "utf8");
		const address = `9311 E Avenue P, ${SECRET_MARKER}, Houston, TX 77012`;
		const failure = await failureFrom(geocode(address, ioFromBytes(notJson)));

		expect(failure.reason).toBe("malformed");
		expect(failure.rawCode).toBeNull();
		expect(failure.retryAfter).toBeNull();
		assertNoLeak({ message: failure.message, reason: failure.reason, rawCode: failure.rawCode });
	});
});

/**
 * The seven cases, case 6. No Census 429 has ever been recorded here, so the
 * shape is the one `lib/io/fetch-source-io.ts` raises from a real one:
 * `response.status` as the raw code and the `Retry-After` header verbatim,
 * both before the body is parsed. What is asserted is that the geocoder hands
 * the caller the source's own code and hint rather than flattening them into
 * "unknown" with nothing attached.
 */
describe("rate limit", () => {
	it("reaches the caller with the source's own status and Retry-After intact", async () => {
		const address = `9311 E Avenue P, ${SECRET_MARKER}, Houston, TX 77012`;
		const io = ioThatFails(new SourceFailure("rate-limited", 429, "3600"));
		const failure = await failureFrom(geocode(address, io));

		expect(failure.reason).toBe("rate-limited");
		expect(failure.rawCode).toBe(429);
		expect(failure.retryAfter).toBe("3600");
		expect(failure.message).toBe("source rate-limited");
		assertNoLeak({ message: failure.message, reason: failure.reason, rawCode: failure.rawCode, retryAfter: failure.retryAfter });
	});

	it("is never softened into a no-match: a refused answer is not an answer", async () => {
		const io = ioThatFails(new SourceFailure("rate-limited", 429, "3600"));
		await expect(geocode("9311 E Avenue P, Houston, TX 77012", io)).rejects.toBeInstanceOf(SourceFailure);
	});
});

/**
 * The seven cases, case 7. The thing worth asserting is not that it fails; it
 * is that it fails as unavailable and never as an empty result. "No records"
 * and "we could not ask" are the distinction the whole product rests on, and
 * for this source they are two different kinds of thing -- a `no-match`
 * outcome and a rejection -- not two values of one field.
 */
describe("timeout", () => {
	it("rejects with the timeout cause and no invented code or hint", async () => {
		const address = `9311 E Avenue P, ${SECRET_MARKER}, Houston, TX 77012`;
		const failure = await failureFrom(geocode(address, ioThatFails(new SourceFailure("timeout"))));

		expect(failure.reason).toBe("timeout");
		expect(failure.rawCode).toBeNull();
		expect(failure.retryAfter).toBeNull();
		expect(failure.message).toBe("source timeout");
		assertNoLeak({ message: failure.message, reason: failure.reason, rawCode: failure.rawCode, retryAfter: failure.retryAfter });
	});

	it("cannot be confused with the same address genuinely having no match", async () => {
		const address = "9400 Clinton Dr, Houston, TX 77029";
		const answered = await geocode(address, fakeIo(NO_MATCH_FIXTURE));
		expect(answered.status).toBe("no-match");

		const unanswered = await failureFrom(geocode(address, ioThatFails(new SourceFailure("timeout"))));
		expect(unanswered.reason).toBe("timeout");
		// There is no third value of `status` to check: the failure never became
		// a `GeocodeOutcome` at all.
		expect(unanswered).toBeInstanceOf(SourceFailure);
		expect("status" in unanswered).toBe(false);
	});
});

/**
 * Type-level: `tsc --noEmit` (part of `pnpm verify`) fails if any access
 * below ever starts compiling. This is the "not by inspecting an array
 * length" requirement enforced at the type checker, not by convention.
 */
function mustNotCompile(outcome: GeocodeOutcome): void {
	if (outcome.status === "ambiguous") {
		// @ts-expect-error -- an ambiguous outcome has no single `match`; the caller must choose from `candidates`
		void outcome.match;
	}
	if (outcome.status === "matched") {
		// @ts-expect-error -- a matched outcome has no `candidates` to enumerate
		void outcome.candidates;
	}
	if (outcome.status === "no-match") {
		// @ts-expect-error -- a no-match outcome has no `match`
		void outcome.match;
		// @ts-expect-error -- a no-match outcome has no `candidates`
		void outcome.candidates;
	}
	// @ts-expect-error -- there is no failed outcome to check for: rate limit, timeout and a malformed body reject the promise instead
	void (outcome.status === "unavailable");
}

/** The match the adapter builds is the kernel's own `GeocodeMatch`, not a local near-copy of it. */
function isKernelMatch(outcome: GeocodeOutcome): GeocodeMatch | null {
	return outcome.status === "matched" ? outcome.match : null;
}

describe("the three outcomes are distinguishable by type", () => {
	it("is checked by tsc, not at runtime", () => {
		expect(typeof mustNotCompile).toBe("function");
		expect(typeof isKernelMatch).toBe("function");
	});
});

describe("the raw address cannot be recovered from anything this file returns or throws", () => {
	it("does not appear in a successful match, including its own payload url", async () => {
		const address = `9311 E Avenue P, ${SECRET_MARKER}, Houston, TX 77012`;
		const outcome = await geocode(address, fakeIo(MATCH_FIXTURE));
		if (outcome.status !== "matched") throw new Error(outcome.status);
		assertNoLeak(outcome);
		expect(outcome.match.payload.url).not.toContain(SECRET_MARKER);
		expect(outcome.match.payload.url).not.toContain("address=");
		expect(outcome.match.payload.url).toContain("benchmark=Public_AR_Current");
	});

	it("does not appear in an ambiguous outcome", async () => {
		const address = `100 Main St, ${SECRET_MARKER}, Springfield`;
		const outcome = await geocode(address, fakeIo(AMBIGUOUS_FIXTURE));
		assertNoLeak(outcome);
	});

	it("does not appear in a no-match outcome, including its payload url", async () => {
		const address = `9400 Clinton Dr, ${SECRET_MARKER}, Houston, TX 77029`;
		const outcome = await geocode(address, fakeIo(NO_MATCH_FIXTURE));
		if (outcome.status !== "no-match") throw new Error(outcome.status);
		assertNoLeak(outcome);
		expect(outcome.payload.url).not.toContain(SECRET_MARKER);
		expect(outcome.payload.url).not.toContain("address=");
	});

	it("does not appear in a thrown error when the source refuses the request", async () => {
		const address = `9311 E Avenue P, ${SECRET_MARKER}, Houston, TX 77012`;
		const refusing = ioThatFails(new SourceFailure("refused"));
		await expect(geocode(address, refusing)).rejects.toThrow();
		const failure = await failureFrom(geocode(address, refusing));
		expect(failure.reason).toBe("refused");
		expect(failure.message).not.toContain(SECRET_MARKER);
		assertNoLeak({ message: failure.message, reason: failure.reason, rawCode: failure.rawCode });
	});

	it("is echoed back by Census and dropped by the schema before the adapter can read it", () => {
		const text = readFileSync(`${fixturesDir}${MATCH_FIXTURE}`, "utf8");
		// The recorded bytes really do carry the submitted address, at
		// `result.input.address.address`.
		expect(text).toContain('"address":"9311 E Avenue P, Houston, TX 77012"');
		const parsed = CensusResponse.parse(JSON.parse(text));
		expect(Object.keys(parsed.result)).toEqual(["addressMatches"]);
		expect(JSON.stringify(parsed)).not.toContain("9311 E Avenue P");
	});
});
