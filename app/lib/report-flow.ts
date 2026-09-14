/**
 * The report screen's state machine, kept out of any component so it is
 * testable without rendering anything -- the same split
 * `app/lib/geocode-flow.ts` makes, for the same reason.
 *
 * WHAT THE SHAPE SAYS THAT PROSE WOULD NOT.
 *
 * **`cards` is a list, not a record keyed by source.** The stream sends a card
 * as its source settles and carries no position (`app/lib/report-contract.ts`),
 * so arrival order is the only order this screen has, and a list is the only
 * structure that keeps it. A map from source to card would silently impose the
 * enum's order on the screen and lose the one fact the stream actually states.
 *
 * **A card that has not arrived has no entry at all.** There is no placeholder
 * `CardView` with empty listings anywhere in this file, because an empty card
 * is a source that answered with nothing and that is a different fact. What has
 * not arrived is the difference between `waitingSources` and `cards`, and the
 * screen renders that difference as its own fourth thing.
 *
 * **Nothing derived is stored.** `cardStateOf`, `waitingSources` and
 * `caveatsOf` are functions of the events that arrived, not fields, so no
 * reducer branch can leave a count disagreeing with the cards beside it. That
 * is the rule `lib/report/selection.ts` holds on the server, applied to the
 * one piece of state the browser owns.
 *
 * THE SEAM THE TRACE PANEL CROSSES. `OpenTrace` is what a slotted span calls
 * and `TraceSelection` is what the panel is handed: one sentence and the index
 * of the span the reader clicked. Not a trace per span -- `SentenceViewMessage`
 * carries one trace for the whole sentence and the clicked value is found in
 * `trace.values` by the span's own `slot.field`, which is what
 * `clickedValue` below does and the only reason the contract could drop the
 * kernel's `clicked` field (`lib/report/sentence-view.ts`).
 */

import { ReportSourceSchema, type CardView, type ReportEvent, type ReportSourceId, type SentenceViewMessage } from "@/app/lib/report-contract";

/* -------------------------------------------------------------------------- */
/* Wire types this screen needs a name for                                    */
/* -------------------------------------------------------------------------- */

/** The B6 groups for one card. Derived from the event rather than re-declared, so the wire stays the single definition. */
export type CardGroupsView = Extract<ReportEvent, { readonly type: "groups" }>["cards"][number];

export type WireTrace = NonNullable<SentenceViewMessage["trace"]>;

/** One value behind a sentence: what it is called, what it showed, what it was, and where it came from. */
export type WireValueTrace = WireTrace["values"][number];

/** Every source the report can carry a card for. The wire's own enum: the browser has no other list and must not write one. */
export const REPORT_SOURCES: readonly ReportSourceId[] = ReportSourceSchema.options;

/* -------------------------------------------------------------------------- */
/* The trace seam                                                             */
/* -------------------------------------------------------------------------- */

/** What the reader clicked: the sentence, and which of its spans. */
export type TraceSelection = {
	readonly sentence: SentenceViewMessage;
	readonly spanIndex: number;
};

/**
 * What a slotted span calls. `app/components/report-card.tsx` passes it to
 * every span that carries a slot, and `app/components/trace-panel.tsx` is what
 * the selection ends up in.
 */
export type OpenTrace = (sentence: SentenceViewMessage, spanIndex: number) => void;

/**
 * The value behind the clicked span, or null when the span is the template's
 * own connective text, when the sentence's subject has left the store, or when
 * the field is not among the subject's values.
 *
 * Every status and every count sentence resolves to a value whose `provenance`
 * is empty: their grounding is the scope header -- `SourceTrace`, or
 * `SectionTrace` with its `counted` list -- and not the value. A panel that
 * rendered only this would show an empty citation on 27 of the demo report's
 * 172 spans, which is why it is `clickedValue` *and* the header, never this
 * alone.
 */
export function clickedValue(selection: TraceSelection): WireValueTrace | null {
	const span = selection.sentence.spans[selection.spanIndex];
	if (span === undefined || span.slot === null) return null;
	const field = span.slot.field;
	const trace = selection.sentence.trace;
	if (trace === null) return null;
	return trace.values.find((value) => value.field === field) ?? null;
}

/* -------------------------------------------------------------------------- */
/* The state                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Where the stream is, which is a fact about this browser's own request and
 * never about a source: a source that could not be reached is a card that says
 * so, and leaves the stream `complete`.
 *
 * `unavailable` is the stream that never opened or that broke mid-line;
 * `failed` is the route's own terminal event, which means the report could not
 * be built.
 */
export type ReportStatus = "streaming" | "complete" | "failed" | "unavailable";

export type ReportFlowState = {
	readonly status: ReportStatus;
	/** In arrival order, which is settle order. One entry per source that has settled. */
	readonly cards: readonly CardView[];
	readonly groups: readonly CardGroupsView[];
	/** Listing keys the reader has opened past the first five records. */
	readonly expanded: readonly string[];
	readonly trace: TraceSelection | null;
	/** Bumped by `retry`, so the screen's effect opens a new stream rather than resuming a dead one. */
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

/**
 * Arrival order, with one entry per source.
 *
 * The route sends one card per source, so the replacement branch is the type
 * being honest rather than a case anyone has seen; when it does happen the
 * later card wins in the earlier one's place, because a card moving down the
 * page under the reader is worse than a card that updated where it sat.
 */
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
			// Every card is dropped: they are answers about one point at one
			// moment, and a retry asks again. Keeping the ones that arrived would
			// mix two retrievals under one retrieval time.
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

/* -------------------------------------------------------------------------- */
/* What the screen reads off the state                                        */
/* -------------------------------------------------------------------------- */

/**
 * The four states a card can be in, which docs/BRIEF.md B10 keeps apart and
 * this screen has to keep visibly apart.
 *
 * Every one of them is read off the wire, not guessed from the text: the
 * status sentence's trace is source-scoped and carries `status`, so
 * `unavailable` is the source's own classification and `no-records` is its
 * own "answered with nothing". A card is `records` when it is showing at least
 * one, which is a fact about this card rather than about the source.
 */
export type CardState = "records" | "no-records" | "unavailable" | "not-asked";

/** The source's own outcome, from the status sentence's trace. Null when the card has no source-scoped status. */
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

/**
 * The sources with no card yet.
 *
 * NOTHING ON THE WIRE SAYS THIS. The stream names a source only when it
 * settles, so the browser's only list of what was asked is the contract's own
 * enum, and a source in it with no card is either still running or was never
 * registered -- this cannot tell which, and so the screen does not say which.
 * It says how many are outstanding, which is a fact about our own requests.
 * The report notes what the wire would have to carry for the screen to name
 * them.
 */
export function waitingSources(state: ReportFlowState): readonly ReportSourceId[] {
	if (state.status !== "streaming") return [];
	return REPORT_SOURCES.filter((source) => !state.cards.some((card) => card.source === source));
}

/** A listing's identity within the report. Two listings on one card can share a kind and a boundary, so the index is part of it. */
export function listingKey(source: ReportSourceId, index: number): string {
	return `${source}:${index}`;
}

/**
 * The card's own limits, deduplicated, in the order the records state them.
 *
 * docs/BRIEF.md A5: every limit goes on the card it limits. Caveats sit on a
 * record trace, every record of a source carries the same ones, and they are
 * the adapter's words rather than this screen's -- for AQS and AirNow they
 * include that the response shape has never been checked against a real
 * response.
 */
export function caveatsOf(card: CardView): readonly string[] {
	const out: string[] = [];
	for (const sentence of sentencesOf(card)) {
		const trace = sentence.trace;
		if (trace === null || trace.scope !== "record") continue;
		for (const caveat of trace.record.caveats) if (!out.includes(caveat)) out.push(caveat);
	}
	return out;
}

/** Every sentence on a card, in reading order: status, prior attempts, headlines, then every record's own. */
export function sentencesOf(card: CardView): readonly SentenceViewMessage[] {
	const out: SentenceViewMessage[] = [];
	if (card.status !== null) out.push(card.status);
	out.push(...card.priorAttempts, ...card.headlines);
	for (const entry of entriesOf(card)) out.push(...entry.sentences);
	return out;
}
