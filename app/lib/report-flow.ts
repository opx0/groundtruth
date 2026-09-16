import { ReportSourceSchema, type CardView, type ReportEvent, type ReportSourceId, type SentenceViewMessage } from "@/app/lib/report-contract";

export type CardGroupsView = Extract<ReportEvent, { readonly type: "groups" }>["cards"][number];

export type WireTrace = NonNullable<SentenceViewMessage["trace"]>;

export type WireValueTrace = WireTrace["values"][number];

export const REPORT_SOURCES: readonly ReportSourceId[] = ReportSourceSchema.options;

export type TraceSelection = {
	readonly sentence: SentenceViewMessage;
	readonly spanIndex: number;
};

export type OpenTrace = (sentence: SentenceViewMessage, spanIndex: number) => void;

export function clickedValue(selection: TraceSelection): WireValueTrace | null {
	const span = selection.sentence.spans[selection.spanIndex];
	if (span === undefined || span.slot === null) return null;
	const field = span.slot.field;
	const trace = selection.sentence.trace;
	if (trace === null) return null;
	return trace.values.find((value) => value.field === field) ?? null;
}

export type ReportStatus = "streaming" | "complete" | "failed" | "unavailable";

export type ReportFlowState = {
	readonly status: ReportStatus;
	readonly cards: readonly CardView[];
	readonly groups: readonly CardGroupsView[];
	readonly expanded: readonly string[];
	readonly trace: TraceSelection | null;
	readonly attempt: number;
};

export type ReportFlowAction =
	| { readonly type: "event"; readonly event: ReportEvent }
	| { readonly type: "stream-failed" }
	| { readonly type: "retry" }
	| { readonly type: "open-trace"; readonly sentence: SentenceViewMessage; readonly spanIndex: number }
	| { readonly type: "close-trace" }
	| { readonly type: "toggle-listing"; readonly key: string };

export const initialReportState: ReportFlowState = {
	status: "streaming",
	cards: [],
	groups: [],
	expanded: [],
	trace: null,
	attempt: 0,
};

function assertNever(x: never): never {
	throw new Error(`report-flow: unhandled action ${JSON.stringify(x)}`);
}

function withCard(cards: readonly CardView[], card: CardView): readonly CardView[] {
	const seen = cards.findIndex((one) => one.source === card.source);
	if (seen === -1) return [...cards, card];
	return cards.map((one, index) => (index === seen ? card : one));
}

function applyEvent(state: ReportFlowState, event: ReportEvent): ReportFlowState {
	switch (event.type) {
		case "card":
			return { ...state, cards: withCard(state.cards, event.card) };
		case "groups":
			return { ...state, groups: event.cards };
		case "end":
			return { ...state, status: event.status === "complete" ? "complete" : "failed" };
	}
}

export function reportReducer(state: ReportFlowState, action: ReportFlowAction): ReportFlowState {
	switch (action.type) {
		case "event":
			return applyEvent(state, action.event);

		case "stream-failed":
			return { ...state, status: "unavailable" };

		case "retry":
			return { ...initialReportState, attempt: state.attempt + 1 };

		case "open-trace":
			return { ...state, trace: { sentence: action.sentence, spanIndex: action.spanIndex } };

		case "close-trace":
			return { ...state, trace: null };

		case "toggle-listing":
			return {
				...state,
				expanded: state.expanded.includes(action.key)
					? state.expanded.filter((key) => key !== action.key)
					: [...state.expanded, action.key],
			};

		default:
			return assertNever(action);
	}
}

export type CardState = "records" | "no-records" | "unavailable" | "not-asked";

export function sourceStatusOf(card: CardView): "ok" | "no-data" | "unavailable" | null {
	const trace = card.status?.trace ?? null;
	return trace !== null && trace.scope === "source" ? trace.source.status : null;
}

function entriesOf(card: CardView): readonly CardView["listings"][number]["shown"][number][] {
	return card.listings.flatMap((listing) => [...listing.shown, ...listing.rest]);
}

export function cardStateOf(card: CardView): CardState {
	if (card.state === "not-asked") return "not-asked";
	if (sourceStatusOf(card) === "unavailable") return "unavailable";
	return entriesOf(card).length > 0 ? "records" : "no-records";
}

export function waitingSources(state: ReportFlowState): readonly ReportSourceId[] {
	if (state.status !== "streaming") return [];
	return REPORT_SOURCES.filter((source) => !state.cards.some((card) => card.source === source));
}

export function listingKey(source: ReportSourceId, index: number): string {
	return `${source}:${index}`;
}

export function caveatsOf(card: CardView): readonly string[] {
	const out: string[] = [];
	for (const sentence of sentencesOf(card)) {
		const trace = sentence.trace;
		if (trace === null || trace.scope !== "record") continue;
		for (const caveat of trace.record.caveats) if (!out.includes(caveat)) out.push(caveat);
	}
	return out;
}

export function sentencesOf(card: CardView): readonly SentenceViewMessage[] {
	const out: SentenceViewMessage[] = [];
	if (card.status !== null) out.push(card.status);
	out.push(...card.priorAttempts, ...card.headlines);
	for (const entry of entriesOf(card)) out.push(...entry.sentences);
	return out;
}
