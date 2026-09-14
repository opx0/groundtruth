/**
 * The search flow's state machine, kept separate from any component so it is
 * testable without rendering anything.
 *
 * The privacy rule shows up in the shape of `FlowState`, not just in prose:
 * only the `search` and `no-match` screens carry the address the reader
 * typed, because those are the only two screens where it is still needed --
 * to send with the next request, or to let the reader extend it. `candidates`
 * and `confirm` have no `address` field at all, so a match or a candidate
 * list cannot carry the raw address forward even by accident; the compiler
 * rejects an attempt to read one, the same way `GeocodeOutcome` in
 * `lib/adapters/census.ts` rejects reading `.match` off an ambiguous outcome.
 *
 * A `GeocodeMatchView` now carries the origin sentences the server rendered
 * from that match, so nothing here changed shape when they were added: a
 * candidate carries its own sentences, and `choose-candidate` moves them to
 * the confirm screen along with the match they describe. They are rendered
 * from Census's reply -- the matched address, the block range, the street
 * side, the TIGER line -- and not from the string the reader typed, so the
 * rule above still holds with them on board.
 *
 * "Several candidates require a choice and must not auto-select" is also a
 * shape fact: the only action that produces a `confirm` state from a
 * `candidates` state is `choose-candidate`, and it takes the chosen match as
 * an argument. There is no code path from `submit-result` with an ambiguous
 * response to `confirm`.
 */

import type { GeocodeApiResponse, GeocodeMatchView } from "./geocode-contract";

export type SearchError = "invalid" | "unavailable";

export type FlowState =
	| { readonly screen: "search"; readonly address: string; readonly pending: boolean; readonly error: SearchError | null }
	| { readonly screen: "no-match"; readonly address: string }
	| { readonly screen: "candidates"; readonly candidates: readonly GeocodeMatchView[] }
	| { readonly screen: "confirm"; readonly match: GeocodeMatchView };

export type FlowAction =
	| { readonly type: "edit"; readonly address: string }
	| { readonly type: "submit-start" }
	| { readonly type: "submit-result"; readonly response: GeocodeApiResponse }
	| { readonly type: "submit-failed" }
	| { readonly type: "choose-candidate"; readonly match: GeocodeMatchView }
	| { readonly type: "edit-no-match" }
	| { readonly type: "start-over" };

export const initialFlowState: FlowState = { screen: "search", address: "", pending: false, error: null };

function assertNever(x: never): never {
	throw new Error(`geocode-flow: unhandled action ${JSON.stringify(x)}`);
}

export function flowReducer(state: FlowState, action: FlowAction): FlowState {
	switch (action.type) {
		case "edit":
			return state.screen === "search" ? { ...state, address: action.address, error: null } : state;

		case "submit-start":
			return state.screen === "search" ? { ...state, pending: true, error: null } : state;

		case "submit-result": {
			const { response } = action;
			if (response.status === "matched") return { screen: "confirm", match: response.match };
			if (response.status === "ambiguous") return { screen: "candidates", candidates: response.candidates };
			const address = state.screen === "search" ? state.address : "";
			if (response.status === "no-match") return { screen: "no-match", address };
			return { screen: "search", address, pending: false, error: response.status };
		}

		case "submit-failed": {
			const address = state.screen === "search" ? state.address : "";
			return { screen: "search", address, pending: false, error: "unavailable" };
		}

		case "choose-candidate":
			return { screen: "confirm", match: action.match };

		case "edit-no-match":
			return state.screen === "no-match" ? { screen: "search", address: state.address, pending: false, error: null } : state;

		case "start-over":
			return { screen: "search", address: "", pending: false, error: null };

		default:
			return assertNever(action);
	}
}
