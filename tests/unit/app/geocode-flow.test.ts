import { describe, expect, it } from "vitest";
import { flowReducer, initialFlowState, type FlowState } from "@/app/lib/geocode-flow";
import type { GeocodeMatchView } from "@/app/lib/geocode-contract";

const MATCH: GeocodeMatchView = {
	matchedAddress: "9311 E AVE P, HOUSTON, TX, 77012",
	latitude: 29.72,
	longitude: -95.26,
	addressRange: { from: "9301", to: "9399" },
	streetSide: "L",
};

const CANDIDATE_A: GeocodeMatchView = { ...MATCH, matchedAddress: "100 MAIN ST, SPRINGFIELD, MA, 01105" };
const CANDIDATE_B: GeocodeMatchView = { ...MATCH, matchedAddress: "100 MAIN ST, SPRINGFIELD, VT, 05156" };

describe("the three outcomes each reach their own, distinct screen", () => {
	it("a matched response goes straight to confirm", () => {
		const state = flowReducer(initialFlowState, { type: "submit-result", response: { status: "matched", match: MATCH } });
		expect(state.screen).toBe("confirm");
	});

	it("an ambiguous response goes to candidates, never confirm", () => {
		const state = flowReducer(initialFlowState, {
			type: "submit-result",
			response: { status: "ambiguous", candidates: [CANDIDATE_A, CANDIDATE_B] },
		});
		expect(state.screen).toBe("candidates");
	});

	it("a no-match response goes to its own no-match screen", () => {
		const state = flowReducer(
			{ screen: "search", address: "9400 Clinton Dr, Houston, TX 77029", pending: true, error: null },
			{ type: "submit-result", response: { status: "no-match" } },
		);
		expect(state.screen).toBe("no-match");
	});
});

describe("an ambiguous outcome must not auto-select", () => {
	it("stays on candidates no matter how many are offered, until choose-candidate fires", () => {
		const many = [CANDIDATE_A, CANDIDATE_B, MATCH];
		const state = flowReducer(initialFlowState, { type: "submit-result", response: { status: "ambiguous", candidates: many } });
		expect(state.screen).toBe("candidates");
		if (state.screen !== "candidates") throw new Error("expected candidates");
		expect(state.candidates).toEqual(many);
	});

	it("only an explicit choose-candidate action, naming the chosen match, reaches confirm", () => {
		const candidates: FlowState = { screen: "candidates", candidates: [CANDIDATE_A, CANDIDATE_B] };
		const state = flowReducer(candidates, { type: "choose-candidate", match: CANDIDATE_B });
		expect(state.screen).toBe("confirm");
		if (state.screen !== "confirm") throw new Error("expected confirm");
		expect(state.match).toEqual(CANDIDATE_B);
	});
});

describe("the raw address does not survive past the search and no-match screens, by shape", () => {
	it("a confirm state has no address field at all", () => {
		const state = flowReducer(initialFlowState, { type: "submit-result", response: { status: "matched", match: MATCH } });
		expect("address" in state).toBe(false);
	});

	it("a candidates state has no address field at all", () => {
		const state = flowReducer(initialFlowState, {
			type: "submit-result",
			response: { status: "ambiguous", candidates: [CANDIDATE_A, CANDIDATE_B] },
		});
		expect("address" in state).toBe(false);
	});

	it("a no-match state keeps the typed address, so the reader can extend it instead of retyping", () => {
		const typed = "9400 Clinton Dr, Houston, TX 77029";
		const state = flowReducer(
			{ screen: "search", address: typed, pending: true, error: null },
			{ type: "submit-result", response: { status: "no-match" } },
		);
		expect(state.screen).toBe("no-match");
		if (state.screen !== "no-match") throw new Error("expected no-match");
		expect(state.address).toBe(typed);
	});
});

/**
 * Type-level, mirroring `tests/unit/adapters/census.test.ts`'s
 * `mustNotCompile`: `tsc --noEmit`, part of `pnpm verify`, fails if either
 * access below starts compiling.
 */
function mustNotCompile(state: FlowState): void {
	if (state.screen === "confirm") {
		// @ts-expect-error -- a confirm state has no address to read
		void state.address;
	}
	if (state.screen === "candidates") {
		// @ts-expect-error -- a candidates state has no address to read
		void state.address;
	}
}

describe("address absence on confirm and candidates is checked by tsc, not by convention", () => {
	it("compiles only because the ts-expect-error comments above are load-bearing", () => {
		expect(typeof mustNotCompile).toBe("function");
	});
});

describe("start-over and edit-no-match clear state back to a plain search screen", () => {
	it("start-over drops any typed address", () => {
		const confirmed: FlowState = { screen: "confirm", match: MATCH };
		const state = flowReducer(confirmed, { type: "start-over" });
		expect(state).toEqual({ screen: "search", address: "", pending: false, error: null });
	});

	it("edit-no-match returns to search with the previously typed address kept for editing", () => {
		const noMatch: FlowState = { screen: "no-match", address: "9400 Clinton Dr, Houston, TX 77029" };
		const state = flowReducer(noMatch, { type: "edit-no-match" });
		expect(state).toEqual({
			screen: "search",
			address: "9400 Clinton Dr, Houston, TX 77029",
			pending: false,
			error: null,
		});
	});
});

describe("unavailable and invalid responses surface as an inline error on the search screen, not a new screen", () => {
	it("unavailable keeps the typed address and sets error", () => {
		const state = flowReducer(
			{ screen: "search", address: "9311 E Ave P, Houston, TX 77012", pending: true, error: null },
			{ type: "submit-result", response: { status: "unavailable" } },
		);
		expect(state).toEqual({
			screen: "search",
			address: "9311 E Ave P, Houston, TX 77012",
			pending: false,
			error: "unavailable",
		});
	});

	it("a network-level failure (submit-failed) also surfaces as unavailable", () => {
		const state = flowReducer(
			{ screen: "search", address: "9311 E Ave P, Houston, TX 77012", pending: true, error: null },
			{ type: "submit-failed" },
		);
		expect(state.screen).toBe("search");
		if (state.screen !== "search") throw new Error("expected search");
		expect(state.error).toBe("unavailable");
	});
});
