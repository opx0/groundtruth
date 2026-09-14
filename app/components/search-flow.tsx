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

/** The whole search-to-report flow. The screens below it are plain functions of props; `ReportScreen` owns the stream and its own state. */
export function SearchFlow() {
	const [state, dispatch] = useReducer(flowReducer, initialFlowState);
	/**
	 * Whether the reader has asked for the report on the match they are looking
	 * at. Local to this component rather than a screen in `geocode-flow.ts`,
	 * because that reducer's state shape is where the privacy rule lives: a
	 * `confirm` state carries the match and no address, and the report is that
	 * same state with the reader's confirmation on it, per docs/BRIEF.md B9
	 * steps 4 and 5. It is reset by every action that changes which match is on
	 * screen, so a new match is never already-confirmed.
	 */
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
			// The panel is passed in rather than imported by the screen, so the
			// screen has no opinion about what a trace looks like and its tests
			// need no panel. This is the one place the two halves meet.
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
