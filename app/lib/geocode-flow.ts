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
