"use client";

import { useCallback, useEffect, useReducer, useState } from "react";
import { CURATED_GROUPS, GeocodeApiResponseSchema, type GeocodeMatchView } from "@/app/lib/geocode-contract";
import { flowReducer, initialFlowState } from "@/app/lib/geocode-flow";
import { CandidatesScreen } from "./candidates-screen";
import { ConfirmScreen } from "./confirm-screen";
import { NoMatchScreen } from "./no-match-screen";
import { ReportScreen } from "./report-screen";
import { renderTracePanel } from "./trace-panel";
import { SearchScreen } from "./search-screen";

async function requestGeocode(address: string, signal?: AbortSignal) {
	const res = await fetch("/api/geocode", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ address }),
		signal: signal ?? null,
	});
	const body: unknown = await res.json();
	return GeocodeApiResponseSchema.parse(body);
}

export function SearchFlow() {
	const [state, dispatch] = useReducer(flowReducer, initialFlowState);
	const [confirmed, setConfirmed] = useState(false);

	const screen = confirmed && state.screen === "confirm" ? "report" : state.screen;

	useEffect(() => {
		if (screen === "search") return;
		const want = `#${screen}`;
		if (window.location.hash !== want) window.history.pushState(null, "", want);
	}, [screen]);

	useEffect(() => {
		const back = (): void => {
			const hash = window.location.hash;
			if (hash === "#report") {
				setConfirmed(true);
				return;
			}
			if (hash === "#confirm" || hash === "#candidates" || hash === "#no-match") {
				setConfirmed(false);
				return;
			}
			setConfirmed(false);
			dispatch({ type: "start-over" });
		};
		window.addEventListener("popstate", back);
		return () => window.removeEventListener("popstate", back);
	}, []);

	useEffect(() => {
		document.documentElement.setAttribute("data-hydrated", "true");
	}, []);

	const restart = useCallback((action: { readonly type: "start-over" } | { readonly type: "edit-no-match" }) => {
		setConfirmed(false);
		dispatch(action);
		if (window.location.hash !== "") window.history.pushState(null, "", window.location.pathname);
	}, []);

	const submit = useCallback((address: string) => {
		if (address.trim().length === 0) {
			dispatch({ type: "submit-result", response: { status: "invalid" } });
			return;
		}
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
			groups={CURATED_GROUPS}
			lookup={requestGeocode}
			onAddressChange={(address) => dispatch({ type: "edit", address })}
			onSubmit={() => submit(state.address)}
			onExampleSelect={(address) => {
				dispatch({ type: "edit", address });
				submit(address);
			}}
		/>
	);
}
