"use client";

import { useCallback, useReducer, useState } from "react";
import { CURATED_EXAMPLES, GeocodeApiResponseSchema, type GeocodeMatchView } from "@/app/lib/geocode-contract";
import { flowReducer, initialFlowState } from "@/app/lib/geocode-flow";
import { CandidatesScreen } from "./candidates-screen";
import { ConfirmScreen } from "./confirm-screen";
import { NoMatchScreen } from "./no-match-screen";
import { ReportScreen } from "./report-screen";
import { renderTracePanel } from "./trace-panel";
import { SearchScreen } from "./search-screen";

async function requestGeocode(address: string) {
	const res = await fetch("/api/geocode", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ address }),
	});
	const body: unknown = await res.json();
	return GeocodeApiResponseSchema.parse(body);
}

export function SearchFlow() {
	const [state, dispatch] = useReducer(flowReducer, initialFlowState);
	const [confirmed, setConfirmed] = useState(false);

	const restart = useCallback((action: { readonly type: "start-over" } | { readonly type: "edit-no-match" }) => {
		setConfirmed(false);
		dispatch(action);
	}, []);

	const submit = useCallback((address: string) => {
		dispatch({ type: "submit-start" });
		requestGeocode(address).then(
			(response) => dispatch({ type: "submit-result", response }),
			() => dispatch({ type: "submit-failed" }),
		);
	}, []);

	const chooseCandidate = useCallback((match: GeocodeMatchView) => {
		setConfirmed(false);
		dispatch({ type: "choose-candidate", match });
	}, []);

	if (state.screen === "confirm") {
		if (confirmed) {
			return (
				<ReportScreen
					match={state.match}
					onStartOver={() => restart({ type: "start-over" })}
					renderTrace={renderTracePanel}
				/>
			);
		}
		return (
			<ConfirmScreen
				match={state.match}
				onSeeReport={() => setConfirmed(true)}
				onStartOver={() => restart({ type: "start-over" })}
			/>
		);
	}

	if (state.screen === "candidates") {
		return (
			<CandidatesScreen
				candidates={state.candidates}
				onChoose={chooseCandidate}
				onStartOver={() => restart({ type: "start-over" })}
			/>
		);
	}

	if (state.screen === "no-match") {
		return <NoMatchScreen onEdit={() => restart({ type: "edit-no-match" })} />;
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
