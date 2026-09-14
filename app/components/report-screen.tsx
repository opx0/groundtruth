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

/**
 * Screen 3. One card per source, each rendered the moment its source settles.
 *
 * FOUR STATES ON THE WIRE, AND A FIFTH THAT IS OURS. docs/BRIEF.md B10 keeps
 * three apart -- answered with records, answered with nothing, could not be
 * reached -- and `app/lib/report-contract.ts` adds the fourth, a source nobody
 * asked. All four are cards and `app/components/report-card.tsx` renders them.
 * The fifth is *not yet arrived*, and it is this screen's own: it is not a card
 * at all, because an empty card is a source that answered with nothing. It is a
 * placeholder that carries no agency name, because the stream names a source
 * only when it settles and this screen may not guess which one is missing.
 *
 * WHAT THE SCREEN SHOWS IN THE GAP BEFORE THE END. Five cards land in about
 * 120 ms and then the stream can stay open and silent for ECHO's 45-second
 * budget. Nothing on the wire says which sources are outstanding, so the screen
 * says how many: "Sources settled: 4 of 6", from the contract's own enum and
 * the cards that arrived, plus one placeholder per outstanding source. Naming
 * them would need a new event -- the report notes it.
 *
 * WHAT THIS SCREEN WRITES. A heading, that counter, two failure lines, a retry
 * and a way back. Every other string on this page is a span the server
 * rendered. The origin sentences at the top come from the geocode route with
 * the match, which is the only place a `GeocodeMatch` exists; the report wire
 * has no origin arm at all (`app/lib/report-contract.ts`), so those spans carry
 * their `data-field` but do not open the panel. See the report.
 *
 * THE REPORT LIVES IN THIS COMPONENT'S STATE AND NOWHERE ELSE, which is
 * docs/BRIEF.md B9 step 7: no storage, no cache, no upload. Leave the page and
 * the report is gone.
 */

/** What the trace panel is rendered by. `app/components/trace-panel.tsx` supplies one; this screen only decides where it goes. */
export type TraceRenderer = (selection: TraceSelection, close: () => void) => ReactNode;

type ReportViewProps = {
	readonly match: GeocodeMatchView;
	readonly state: ReportFlowState;
	readonly dispatch: (action: ReportFlowAction) => void;
	readonly onStartOver: () => void;
	readonly renderTrace: TraceRenderer | null;
};

/** The origin sentences the geocode route rendered from this match: the block range, the street side, the TIGER line, the point. */
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

/**
 * The whole screen as a function of what has arrived.
 *
 * Separate from `ReportScreen` below so that a test can fold a real stream into
 * a real state and render the result without a network, a DOM or a fake timer.
 * Everything here is a read of `state`; nothing is stored twice.
 */
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
					// Not a card: a card is an answer, and this is the absence of one.
					// It carries no agency name because nothing has told us which
					// source this is waiting for.
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
	/** Supplied once `app/components/trace-panel.tsx` exists; the screen holds the selection either way. */
	readonly renderTrace?: TraceRenderer;
};

/**
 * The connected screen: it opens the stream for the confirmed point and folds
 * every event into the reducer as the line arrives.
 *
 * `attempt` is in the dependency list, so "Retry" is a new stream rather than a
 * resumed one. The abort on cleanup is what tells the route the client has gone
 * -- it checks before it builds another event, and an unwatched 45-second ECHO
 * query is work nobody is waiting for.
 *
 * Nothing in the catch is derived from the response or from the point: the
 * coordinate is in scope here and no error message may carry it.
 */
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
				// The stream never opened, broke mid-line, or sent a line that is
				// not a report event. docs/BRIEF.md B10: unavailable, with a retry.
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
