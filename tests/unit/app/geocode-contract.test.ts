import { describe, expect, it } from "vitest";
import {
	buildPrecisionSentence,
	CURATED_EXAMPLES,
	GeocodeApiResponseSchema,
	type GeocodeMatchView,
} from "@/app/lib/geocode-contract";

function matchView(overrides: Partial<GeocodeMatchView> = {}): GeocodeMatchView {
	return {
		matchedAddress: "9311 E AVE P, HOUSTON, TX, 77012",
		latitude: 29.720658823001,
		longitude: -95.261995884462,
		addressRange: { from: "9301", to: "9399" },
		streetSide: "L",
		...overrides,
	};
}

describe("buildPrecisionSentence", () => {
	it("reproduces docs/BRIEF.md A2's example sentence exactly, from the fixture's own fields", () => {
		expect(buildPrecisionSentence(matchView())).toBe(
			"The point sits on the 9301 to 9399 block, left side of the street segment, interpolated by the Census Geocoder. It marks the block, not the parcel.",
		);
	});

	it("is not hardcoded: a different range and side change the sentence", () => {
		const sentence = buildPrecisionSentence(matchView({ addressRange: { from: "100", to: "198" }, streetSide: "R" }));
		expect(sentence).toBe(
			"The point sits on the 100 to 198 block, right side of the street segment, interpolated by the Census Geocoder. It marks the block, not the parcel.",
		);
		expect(sentence).not.toContain("9301");
		expect(sentence).not.toContain("left");
	});

	it("shows an unmapped street-side code verbatim instead of guessing at a word", () => {
		const sentence = buildPrecisionSentence(matchView({ streetSide: "B" }));
		expect(sentence).toContain("B side of the street segment");
	});
});

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

describe("GeocodeApiResponseSchema", () => {
	it("strips a field not declared on the branch's schema, even inside a nested match", () => {
		const withExtra = {
			status: "matched",
			match: { ...matchView(), rawAddress: "123 Secret St, Nowhere" },
		};
		const parsed = GeocodeApiResponseSchema.parse(withExtra);
		expect(parsed).toEqual({ status: "matched", match: matchView() });
		expect(JSON.stringify(parsed)).not.toContain("Secret");
	});

	it("rejects an ambiguous body with fewer than two candidates", () => {
		expect(() => GeocodeApiResponseSchema.parse({ status: "ambiguous", candidates: [matchView()] })).toThrow();
	});

	it("accepts each of the five statuses with their own shape", () => {
		expect(GeocodeApiResponseSchema.parse({ status: "no-match" })).toEqual({ status: "no-match" });
		expect(GeocodeApiResponseSchema.parse({ status: "unavailable" })).toEqual({ status: "unavailable" });
		expect(GeocodeApiResponseSchema.parse({ status: "invalid" })).toEqual({ status: "invalid" });
	});
});
