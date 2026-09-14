/**
 * The reducer never reads inside a match view, so the shape of one is not what
 * these tests are about -- but they use a real one, produced by the route from
 * the recorded Census bytes, so that "the confirm state carries the sentences
 * about the match the reader chose" is an assertion about real sentences.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SourceIo } from "@/lib/evidence";
import { createGeocodeHandler } from "@/app/api/geocode/handler";
import { flowReducer, initialFlowState, type FlowState } from "@/app/lib/geocode-flow";
import { GeocodeApiResponseSchema, type GeocodeMatchView } from "@/app/lib/geocode-contract";

const fixturesDir = fileURLToPath(new URL("../../fixtures/", import.meta.url));
const RETRIEVED_AT = "2026-09-16T12:00:00Z";

function fixtureIo(fixture: string): SourceIo {
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

async function candidateViews(): Promise<readonly GeocodeMatchView[]> {
	const handler = createGeocodeHandler(fixtureIo("census/ambiguous-100-main-st.json"));
	const response = await handler(
		new Request("http://localhost/api/geocode", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ address: "100 Main St, Springfield" }),
		}),
	);
	const parsed = GeocodeApiResponseSchema.parse(await response.json());
	if (parsed.status !== "ambiguous") throw new Error(`expected candidates, got ${parsed.status}`);
	return parsed.candidates;
}

const CANDIDATES = await candidateViews();

function nth(index: number): GeocodeMatchView {
	const view = CANDIDATES[index];
	if (view === undefined) throw new Error(`no candidate ${index}`);
	return view;
}

const MATCH: GeocodeMatchView = nth(0);
const CANDIDATE_A: GeocodeMatchView = nth(1);
const CANDIDATE_B: GeocodeMatchView = nth(2);

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

	it("carries the sentences rendered about the chosen candidate, and only those", () => {
		const candidates: FlowState = { screen: "candidates", candidates: [CANDIDATE_A, CANDIDATE_B] };
		const state = flowReducer(candidates, { type: "choose-candidate", match: CANDIDATE_B });
		if (state.screen !== "confirm") throw new Error("expected confirm");
		const text = state.match.origin.map((sentence) => sentence.spans.map((span) => span.text).join("")).join(" ");
		expect(text).toContain(CANDIDATE_B.matchedAddress);
		expect(text).not.toContain(CANDIDATE_A.matchedAddress);
		expect(text).toContain("It marks the block, not the parcel.");
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
