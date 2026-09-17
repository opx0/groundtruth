"use client";

import { useEffect, useReducer, type ReactNode } from "react";
import type { GeocodeMatchView, OriginSentence } from "@/app/lib/geocode-contract";
import {
	initialReportState,
	REPORT_SECTIONS,
	REPORT_SOURCES,
	reportReducer,
	waitingSources,
	type CardGroupsView,
	type ReportFlowAction,
	type ReportFlowState,
	type TraceSelection,
} from "@/app/lib/report-flow";
import { readReportEvents, requestReport } from "@/app/lib/report-stream";
import { eventsOf } from "@/app/lib/timeline";
import { BandHeading } from "./band-heading";
import { Timeline } from "./timeline";
import { SectionRail } from "./section-rail";
import { TopBar } from "./top-bar";
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
		<p key={key} className="mt-3 text-sm leading-relaxed">
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
	const timeline = eventsOf(state.cards);
	const selection = state.trace;
	return (
		<div className="mx-auto w-full max-w-4xl px-5 pb-24 pt-6 sm:px-8 sm:pt-10 xl:mx-0 xl:ml-[15.5rem] xl:max-w-[min(72rem,calc(100vw-19rem))] xl:pr-12">
			<TopBar>
				<button type="button" onClick={onStartOver} className="gt-ghost">
					Search another address
				</button>
			</TopBar>

			<h1 className="gt-display mt-14 text-5xl sm:text-7xl">Report</h1>

			<ol className="gt-steps mt-8">
				{match.origin[0] === undefined ? null : (
					<li className="gt-step gt-card">
						<span className="gt-index">01</span>
						<span className="gt-label mt-2 block text-[var(--on-muted)]">The address</span>
						{originNode(match.origin[0], "origin:0")}
					</li>
				)}

				{match.origin[1] === undefined ? null : (
					<li className="gt-step gt-card gt-card-dark">
						<span className="gt-index">02</span>
						<span className="gt-label mt-2 block text-[var(--on-muted)]">The point</span>
						{originNode(match.origin[1], "origin:1")}
					</li>
				)}

				<li className="gt-step gt-card gt-card-sand">
					<span className="gt-index">03</span>
					<span className="gt-label mt-2 block text-[var(--on-muted)]">The record</span>
					<div className="gt-meter mt-4" aria-hidden="true">
						{REPORT_SOURCES.map((source, index) => (
							<i key={source} data-on={index < state.cards.length} />
						))}
					</div>
					<p data-settled className="mt-3 text-sm">
						Sources settled: {state.cards.length} of {REPORT_SOURCES.length}.
					</p>
				</li>
			</ol>

			{state.status === "failed" || state.status === "unavailable" ? (
				<div data-stream-state={state.status} className="mt-5 flex flex-wrap items-center gap-3">
					<p className="text-sm">
						{state.status === "failed"
							? "This report stopped before every source settled."
							: "This report could not be loaded."}
					</p>
					<button
						type="button"
						data-retry="report"
						onClick={() => dispatch({ type: "retry" })}
						className="gt-ghost"
					>
						Retry
					</button>
				</div>
			) : null}

			<nav aria-label="Report" className="gt-signpost mt-8 flex flex-col items-start gap-2 xl:hidden">
				{REPORT_SECTIONS.map((section) => {
					const ready = state.cards.some((card) => section.sources.includes(card.source));
					return (
						<a key={section.id} href={`#${section.id}`} className={`gt-sign ${ready ? "" : "gt-sign-quiet"}`}>
							{section.heading}
						</a>
					);
				})}
			</nav>

			{timeline.length > 0 ? (
				<div className="gt-rule mt-10 pt-8">
					<Timeline
						events={timeline}
						lanes={REPORT_SECTIONS.map((section) => ({ id: section.id, heading: section.heading }))}
					/>
				</div>
			) : null}

			{REPORT_SECTIONS.map((section, index) => {
				const settled = state.cards.filter((card) => section.sources.includes(card.source));
				const pending = waiting.filter((source) => section.sources.includes(source));
				if (settled.length === 0 && pending.length === 0) return null;
				return (
					<section key={section.id} id={section.id} data-section={section.id} className="mt-14 scroll-mt-8">
						<BandHeading index={index + 1} heading={section.heading} />
						<div className="gt-spine mt-7 flex flex-col gap-4">
							{settled.map((card) => (
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
							{pending.map((source) => (
								<div
									key={`waiting:${source}`}
									data-card-state="waiting"
									className="gt-card gt-node gt-card-idle text-sm"
								>
									<p>Waiting for a source.</p>
								</div>
							))}
						</div>
					</section>
				);
			})}

			<button
				type="button"
				onClick={onStartOver}
				className="gt-ghost mt-10"
			>
				Search another address
			</button>

			<SectionRail
				sections={REPORT_SECTIONS.map((section) => ({ id: section.id, heading: section.heading }))}
				ready={REPORT_SECTIONS.filter((section) =>
					state.cards.some((card) => section.sources.includes(card.source)),
				).map((section) => section.id)}
			/>

			{selection === null || renderTrace === null ? null : (
				<div className="fixed inset-x-0 bottom-0 z-40 h-[72vh] border-t border-[var(--edge)] shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:h-auto sm:w-[34rem] sm:border-l sm:border-t-0">
					{renderTrace(selection, () => dispatch({ type: "close-trace" }))}
				</div>
			)}
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
