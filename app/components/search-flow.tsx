"use client";

import { useCallback, useReducer } from "react";
import { CURATED_EXAMPLES, GeocodeApiResponseSchema, type GeocodeMatchView } from "@/app/lib/geocode-contract";
import { flowReducer, initialFlowState } from "@/app/lib/geocode-flow";
import { CandidatesScreen } from "./candidates-screen";
import { ConfirmScreen } from "./confirm-screen";
import { NoMatchScreen } from "./no-match-screen";
import { SearchScreen } from "./search-screen";

/**
 * Calls the geocode route and parses the response through the shared zod
 * schema before it ever becomes a typed value in this component -- no `any`,
 * no assertion on `res.json()`'s result.
 */
async function requestGeocode(address: string) {
	const res = await fetch("/api/geocode", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ address }),
	});
	const body: unknown = await res.json();
	return GeocodeApiResponseSchema.parse(body);
}

/** The whole search-to-confirmation flow. The only client component in this unit; every screen below it is a plain function of props. */
export function SearchFlow() {
	const [state, dispatch] = useReducer(flowReducer, initialFlowState);

	const submit = useCallback((address: string) => {
		dispatch({ type: "submit-start" });
		requestGeocode(address).then(
			(response) => dispatch({ type: "submit-result", response }),
			() => dispatch({ type: "submit-failed" }),
		);
	}, []);

	const chooseCandidate = useCallback((match: GeocodeMatchView) => {
		dispatch({ type: "choose-candidate", match });
	}, []);

	if (state.screen === "confirm") {
		return <ConfirmScreen match={state.match} onStartOver={() => dispatch({ type: "start-over" })} />;
	}

	if (state.screen === "candidates") {
		return (
			<CandidatesScreen
				candidates={state.candidates}
				onChoose={chooseCandidate}
				onStartOver={() => dispatch({ type: "start-over" })}
			/>
		);
	}

	if (state.screen === "no-match") {
		return <NoMatchScreen onEdit={() => dispatch({ type: "edit-no-match" })} />;
	}

	return (
		<SearchScreen
			address={state.address}
			pending={state.pending}
			error={state.error}
			examples={CURATED_EXAMPLES}
			onAddressChange={(address) => dispatch({ type: "edit", address })}
			onSubmit={() => submit(state.address)}
			onExampleSelect={(address) => {
				dispatch({ type: "edit", address });
				submit(address);
			}}
		/>
	);
}
