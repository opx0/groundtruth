"use client";

import { useEffect, useReducer, type ReactNode } from "react";
import type { GeocodeMatchView, OriginSentence } from "@/app/lib/geocode-contract";
import {
	initialReportState,
	REPORT_SOURCES,
	reportReducer,
	waitingSources,
	type CardGroupsView,
	type ReportFlowAction,
	type ReportFlowState,
	type TraceSelection,
} from "@/app/lib/report-flow";
import { readReportEvents, requestReport } from "@/app/lib/report-stream";
import { ReportCard } from "./report-card";

export type TraceRenderer = (selection: TraceSelection, close: () => void) => ReactNode;

type ReportViewProps = {
	readonly match: GeocodeMatchView;
	readonly state: ReportFlowState;
	readonly dispatch: (action: ReportFlowAction) => void;
	readonly onStartOver: () => void;
	readonly renderTrace: TraceRenderer | null;
};

function originNode(sentence: OriginSentence, key: string): ReactNode {
	return (
		<p key={key} className="text-xs leading-relaxed opacity-75">
			{sentence.spans.map((span, index) => (
				<span key={`${key}:${index}`} data-field={span.slot?.field}>
					{span.text}
				</span>
			))}
		</p>
	);
}

function groupsFor(state: ReportFlowState, source: string): CardGroupsView | null {
	return state.groups.find((card) => card.source === source) ?? null;
}

export function ReportView({ match, state, dispatch, onStartOver, renderTrace }: ReportViewProps) {
	const waiting = waitingSources(state);
	const selection = state.trace;
	return (
		<div className="mx-auto max-w-2xl px-4 py-10 sm:py-14">
			<h1 className="text-2xl font-semibold">Report</h1>

			<div className="mt-3 flex flex-col gap-1">
				{match.origin.map((sentence, index) => originNode(sentence, `origin:${index}`))}
			</div>

			<p data-settled className="mt-4 text-xs opacity-60">
				Sources settled: {state.cards.length} of {REPORT_SOURCES.length}.
			</p>

			{state.status === "failed" || state.status === "unavailable" ? (
				<div data-stream-state={state.status} className="mt-4 flex items-center gap-3">
					<p className="text-sm">
						{state.status === "failed"
							? "This report stopped before every source settled."
							: "This report could not be loaded."}
					</p>
					<button
						type="button"
						data-retry="report"
						onClick={() => dispatch({ type: "retry" })}
						className="rounded-md border border-black/15 px-3 py-1 text-xs font-medium dark:border-white/20"
					>
						Retry
					</button>
				</div>
			) : null}

			<div className="mt-6 flex flex-col gap-4">
				{state.cards.map((card) => (
					<ReportCard
						key={card.source}
						card={card}
						groups={groupsFor(state, card.source)}
						expanded={state.expanded}
						onToggleListing={(key) => dispatch({ type: "toggle-listing", key })}
						onOpenTrace={(sentence, spanIndex) => dispatch({ type: "open-trace", sentence, spanIndex })}
						onRetry={() => dispatch({ type: "retry" })}
					/>
				))}

				{waiting.map((source) => (
					<div
						key={`waiting:${source}`}
						data-card-state="waiting"
						className="rounded-lg border border-black/10 p-4 text-sm opacity-50 dark:border-white/12"
					>
						<p>Waiting for a source.</p>
					</div>
				))}
			</div>

			<button
				type="button"
				onClick={onStartOver}
				className="mt-8 rounded-md border border-black/15 px-4 py-2 text-sm font-medium dark:border-white/20"
			>
				Search another address
			</button>

			{selection === null || renderTrace === null ? null : renderTrace(selection, () => dispatch({ type: "close-trace" }))}
		</div>
	);
}

type ReportScreenProps = {
	readonly match: GeocodeMatchView;
	readonly onStartOver: () => void;
	readonly renderTrace?: TraceRenderer;
};

export function ReportScreen({ match, onStartOver, renderTrace }: ReportScreenProps) {
	const [state, dispatch] = useReducer(reportReducer, initialReportState);
	const { latitude, longitude } = match;
	const attempt = state.attempt;

	useEffect(() => {
		const controller = new AbortController();
		let live = true;
		const run = async (): Promise<void> => {
			try {
				const body = await requestReport({ latitude, longitude }, controller.signal);
				for await (const event of readReportEvents(body)) {
					if (!live) return;
					dispatch({ type: "event", event });
				}
			} catch {
				if (live) dispatch({ type: "stream-failed" });
			}
		};
		void run();
		return () => {
			live = false;
			controller.abort();
		};
	}, [latitude, longitude, attempt]);

	return (
		<ReportView match={match} state={state} dispatch={dispatch} onStartOver={onStartOver} renderTrace={renderTrace ?? null} />
	);
}
