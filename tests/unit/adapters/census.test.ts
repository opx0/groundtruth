import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { GeocodeMatch, SourceIo } from "@/lib/evidence";
import { SourceFailure } from "@/lib/evidence";
import { geocode, type GeocodeOutcome } from "@/lib/adapters/census";

const fixturesDir = fileURLToPath(new URL("../../fixtures/", import.meta.url));
const RETRIEVED_AT = "2026-09-16T12:00:00Z";

/**
 * A fake `SourceIo` backed by a committed fixture. It parses through the same
 * schema the adapter passes in, exactly as a real fetch-and-validate
 * implementation would, and stamps the payload's `url` with the *exact* URL
 * the adapter requested -- address and all -- so the privacy tests below are
 * proving something real: that `geocode` itself redacts it, not that the io
 * layer happened to.
 */
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

const MATCH_FIXTURE = "census/match-9311-e-ave-p.json";
const AMBIGUOUS_FIXTURE = "census/ambiguous-100-main-st.json";
const NO_MATCH_FIXTURE = "census/no-match-9400-clinton.json";

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
 * Type-level: `tsc --noEmit` (part of `pnpm verify`) fails if either access
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
		const refusing: SourceIo = {
			get() {
				return Promise.reject(new SourceFailure("refused"));
			},
			query(parameter, value, adapterVersion, payload) {
				return { kind: "query", parameter, value, adapterVersion, payload };
			},
			now: () => RETRIEVED_AT,
		};
		await expect(geocode(address, refusing)).rejects.toThrow();
		try {
			await geocode(address, refusing);
			throw new Error("expected geocode to reject");
		} catch (error) {
			expect(error).toBeInstanceOf(SourceFailure);
			const message = error instanceof Error ? error.message : String(error);
			expect(message).not.toContain(SECRET_MARKER);
			assertNoLeak({ message, ...(error instanceof SourceFailure ? { reason: error.reason, rawCode: error.rawCode } : {}) });
		}
	});
});
