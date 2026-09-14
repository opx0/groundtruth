/**
 * The report screen and the cards, rendered against a real NDJSON stream built
 * from the committed fixtures through the real route handler.
 *
 * `vitest.config.ts` runs in node and only collects `*.test.ts`, so this file
 * builds elements with `createElement` and renders them with
 * `renderToStaticMarkup`, exactly as `screens.test.ts` does for screens 1 and 2.
 * There is no DOM here and none is needed:
 *
 * - **Rendering** is asserted against the static markup.
 * - **Clicking** is asserted against the element tree itself. `ReportCard` is
 *   built out of intrinsic elements only, so calling it returns a tree a test
 *   can walk to find every span carrying a `data-field` and call the `onClick`
 *   it was actually given. That is the real handler, from the real card, for
 *   every span -- not a sampled one and not a stand-in.
 *
 * The strings this unit's components write are enumerated in `CHROME` below,
 * and one test subtracts every span the server sent from every text node the
 * screen produced and asserts that what is left is exactly that list. It is the
 * test to read first: it is what "no component writes a factual sentence"
 * means, mechanically.
 */

import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportCard } from "@/app/components/report-card";
import { ReportView } from "@/app/components/report-screen";
import type { GeocodeMatchView } from "@/app/lib/geocode-contract";
import type { CardView, ReportEvent, SentenceViewMessage } from "@/app/lib/report-contract";
import {
	clickedValue,
	initialReportState,
	listingKey,
	reportReducer,
	sentencesOf,
	type CardGroupsView,
	type ReportFlowAction,
	type ReportFlowState,
	type TraceSelection,
} from "@/app/lib/report-flow";
import { readReportEvents } from "@/app/lib/report-stream";
import {
	DEMO,
	FOUR_STATES,
	houstonMatch,
	reportEvents,
	reportResponse,
	stateOf,
	withSlowEcho,
} from "./helpers/report-stream-fixtures";

const match: GeocodeMatchView = await houstonMatch();
const demo: readonly ReportEvent[] = await reportEvents(DEMO);
const fourStates: readonly ReportEvent[] = await reportEvents(FOUR_STATES);

/* -------------------------------------------------------------------------- */
/* Rendering                                                                  */
/* -------------------------------------------------------------------------- */

function viewHtml(state: ReportFlowState, dispatch: (action: ReportFlowAction) => void = () => undefined): string {
	return renderToStaticMarkup(
		createElement(ReportView, { match, state, dispatch, onStartOver: () => undefined, renderTrace: null }),
	);
}

function unescapeHtml(text: string): string {
	return text
		.replaceAll("&quot;", '"')
		.replaceAll("&#x27;", "'")
		.replaceAll("&#39;", "'")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&amp;", "&");
}

/** Every text node the markup contains, in document order. */
function textNodes(html: string): readonly string[] {
	return html
		.split(/<[^>]*>/)
		.filter((text) => text.length > 0)
		.map(unescapeHtml);
}

/**
 * What a reader sees. Joined with nothing between: every span is its own
 * element, so concatenating the text nodes reassembles the sentence exactly as
 * the server rendered it, and an assertion on a whole sentence is an assertion
 * that the screen did not drop, reorder or pad a span.
 */
function visibleText(html: string): string {
	return textNodes(html).join("");
}

/** The card for one source, off the wire. */
function cardOf(state: ReportFlowState, source: string): CardView {
	const card = state.cards.find((one) => one.source === source);
	if (card === undefined) throw new Error(`no card for ${source}`);
	return card;
}

function groupsOf(state: ReportFlowState, source: string): CardGroupsView | null {
	return state.groups.find((one) => one.source === source) ?? null;
}

/** One card's markup, with every list opened, which is every sentence that card can show. */
function cardHtml(state: ReportFlowState, source: string): string {
	const card = cardOf(state, source);
	return renderToStaticMarkup(createElement(ReportCard, cardProps(card, groupsOf(state, source))));
}

function cardProps(card: CardView, groups: CardGroupsView | null, onOpenTrace: (sentence: SentenceViewMessage, spanIndex: number) => void = () => undefined) {
	return {
		card,
		groups,
		expanded: card.listings.map((_listing, index) => listingKey(card.source, index)),
		onToggleListing: () => undefined,
		onOpenTrace,
		onRetry: () => undefined,
	};
}

/* -------------------------------------------------------------------------- */
/* Walking the element tree, which is how a click is tested without a DOM     */
/* -------------------------------------------------------------------------- */

type WalkedProps = {
	readonly children?: ReactNode;
	readonly onClick?: () => void;
	readonly "data-field"?: string;
};

function walk(node: ReactNode, visit: (element: ReactElement<WalkedProps>) => void): void {
	if (Array.isArray(node)) {
		for (const child of node) walk(child, visit);
		return;
	}
	if (!isValidElement<WalkedProps>(node)) return;
	visit(node);
	walk(node.props.children, visit);
}

type Slotted = { readonly field: string; readonly click: () => void };

/** Every span the card rendered with a field behind it, in reading order, with the handler it was given. */
function slottedElements(node: ReactNode): readonly Slotted[] {
	const found: Slotted[] = [];
	walk(node, (element) => {
		const field = element.props["data-field"];
		const click = element.props.onClick;
		if (field === undefined || click === undefined) return;
		found.push({ field, click });
	});
	return found;
}

/* -------------------------------------------------------------------------- */
/* Every string this unit's components write                                  */
/* -------------------------------------------------------------------------- */

/**
 * The whole of it. A string belongs here only if it could not be made wrong by
 * a government record changing: a heading, a button, a count of our own
 * requests, a loading state. Everything else on the screen is a span the server
 * rendered from an agency's own fields.
 *
 * The count line's numbers are our own requests, not anyone's records: how many
 * sources have settled, out of the sources the wire's own enum names.
 */
const CHROME: readonly string[] = [
	"Report",
	"Sources settled: 0 of 6.",
	"Sources settled: 1 of 6.",
	"Sources settled: 2 of 6.",
	"Sources settled: 3 of 6.",
	"Sources settled: 4 of 6.",
	"Sources settled: 5 of 6.",
	"Sources settled: 6 of 6.",
	"Waiting for a source.",
	"This source was not asked.",
	"This report stopped before every source settled.",
	"This report could not be loaded.",
	"Retry",
	"Show the rest",
	"Hide the rest",
	"Limits",
	"Search another address",
];

/** Every string the screen did not write: the spans, the agency labels and the caveats the wire carried. */
function serverStrings(state: ReportFlowState): ReadonlySet<string> {
	const out = new Set<string>();
	for (const sentence of state.cards.flatMap((card) => [...sentencesOf(card)])) {
		for (const span of sentence.spans) out.add(span.text);
	}
	for (const card of state.groups.flatMap((one) => [...one.groups, ...one.crossReferences])) {
		for (const span of card.spans) out.add(span.text);
	}
	for (const card of state.cards) {
		out.add(card.agency);
		for (const sentence of sentencesOf(card)) {
			if (sentence.trace?.scope === "record") for (const caveat of sentence.trace.record.caveats) out.add(caveat);
		}
	}
	for (const sentence of match.origin) for (const span of sentence.spans) out.add(span.text);
	return out;
}

/* -------------------------------------------------------------------------- */
/* 1. Arrival order, and a slow source that holds nothing up                  */
/* -------------------------------------------------------------------------- */

describe("cards appear as their sources settle", () => {
	it("renders a fast card while a slow source is still running, in arrival order", async () => {
		// ECHO's summary answers 150 ms late. Every other source is unchanged.
		const response = await reportResponse(withSlowEcho(DEMO, 150));
		const body = response.body;
		if (body === null) throw new Error("the report stream had no body");

		let state = initialReportState;
		const arrivals: string[] = [];
		let semsSawEchoWaiting = false;

		for await (const event of readReportEvents(body)) {
			state = reportReducer(state, { type: "event", event });
			if (event.type !== "card") continue;
			arrivals.push(event.card.source);
			if (event.card.source !== "sems") continue;
			// The Superfund card is on screen with its records while ECHO has not
			// answered: a slow source delays its own card and nothing else.
			const html = viewHtml(state);
			expect(html).toContain('data-source="sems"');
			expect(html).not.toContain('data-source="echo"');
			expect(html).toContain('data-card-state="waiting"');
			expect(visibleText(html)).toContain("RHODIA INC., ACID RELEASE");
			semsSawEchoWaiting = true;
		}

		expect(semsSawEchoWaiting).toBe(true);
		expect(arrivals[arrivals.length - 1]).toBe("echo");
		expect(state.status).toBe("complete");
		// The rendered order is the arrival order, start to finish.
		const html = viewHtml(state);
		const rendered = [...html.matchAll(/data-source="([a-z]+)"/g)].map((hit) => hit[1]);
		expect(rendered).toEqual(arrivals);
	}, 30_000);

	it("says how many sources have settled, and shows one placeholder for each that has not", () => {
		const partial = stateOf(demo.slice(0, 3));
		const html = viewHtml(partial);
		expect(visibleText(html)).toContain("Sources settled: 3 of 6.");
		expect([...html.matchAll(/data-card-state="waiting"/g)].length).toBe(3);
		// A placeholder names no agency and carries no sentence: nothing on the
		// wire says which source is outstanding.
		expect(visibleText(html)).toContain("Waiting for a source.");

		const whole = viewHtml(stateOf(demo));
		expect(visibleText(whole)).toContain("Sources settled: 6 of 6.");
		expect(whole).not.toContain('data-card-state="waiting"');
	});

	it("offers a retry when the stream itself could not be read, which is not a source failing", () => {
		const broken = reportReducer(stateOf(demo.slice(0, 2)), { type: "stream-failed" });
		const actions: ReportFlowAction[] = [];
		const html = viewHtml(broken, (action) => actions.push(action));
		expect(html).toContain('data-stream-state="unavailable"');
		expect(visibleText(html)).toContain("This report could not be loaded.");
		expect(visibleText(viewHtml(reportReducer(stateOf(demo), { type: "event", event: { type: "end", status: "failed" } })))).toContain(
			"This report stopped before every source settled.",
		);
		expect(actions).toEqual([]);
	});
});

/* -------------------------------------------------------------------------- */
/* 2. The four states look like four states                                   */
/* -------------------------------------------------------------------------- */

describe("the four card states look different from each other", () => {
	const state = stateOf(fourStates);

	it("marks each card with the state the wire gave it", () => {
		const html = viewHtml(state);
		const expected: readonly (readonly [string, string])[] = [
			["echo", "records"],
			["sems", "no-records"],
			["fema", "unavailable"],
			["frs", "not-asked"],
		];
		for (const [source, cardState] of expected) {
			expect(html).toContain(`data-source="${source}"`);
			expect(cardHtml(state, source)).toContain(`data-card-state="${cardState}"`);
		}
	});

	it("shows four different things, and only one of them is this screen talking", () => {
		const records = visibleText(cardHtml(state, "echo"));
		const nothing = visibleText(cardHtml(state, "sems"));
		const unreachable = visibleText(cardHtml(state, "fema"));
		const unasked = visibleText(cardHtml(state, "frs"));

		// Answered with records: the count sentence and the records themselves.
		expect(records).toContain("Regulated facilities EPA ECHO lists within 5 miles of the mapped point: 7.");
		expect(records).toContain("SOUTH COAST TERMINALS PTF");

		// Answered with nothing: B10's own wording, from the server, and no record.
		expect(nothing).toContain("answered with no matching records");
		expect(nothing).toContain("No matching records within the stated boundary.");
		expect(nothing).not.toContain("could not be reached");

		// Could not be reached: B10's wording, and a retry.
		expect(unreachable).toContain("could not be reached");
		expect(unreachable).toContain("Retry");
		expect(unreachable).not.toContain("No matching records within the stated boundary.");

		// Never asked: no status sentence exists for a request nobody made, so the
		// screen says what it did, and says nothing about what the source holds.
		// The registry is the card that reaches this state: it is asked about a
		// registry ID, and the Superfund layer with no rows in it named none.
		expect(unasked).toContain("EPA Facility Registry Service");
		expect(unasked).toContain("This source was not asked.");
		expect(unasked).not.toContain("No matching records");
		expect(unasked).not.toContain("could not be reached");
		expect(unasked).not.toContain("Retry");

		// And none of the four is any other of the four.
		const all = [records, nothing, unreachable, unasked];
		expect(new Set(all).size).toBe(4);
	});

	it("puts each card's limits on that card, in the words of the adapter that carried them", () => {
		// The demo stream, because a limit is carried by a record and the four-state
		// stream's Superfund layer has no rows in it: a card with nothing on it
		// states no limits, which is the point of the state above, not of this one.
		const whole = stateOf(demo);
		const sems = visibleText(cardHtml(whole, "sems"));
		expect(sems).toContain("Limits");
		expect(sems).toContain("A SEMS record can mean assessment, proposed action, active cleanup, or completed work.");
		expect(sems).toContain("The coordinate is a reference point, not a boundary.");
		// The flood card's limit is a sentence with a trace, not a caveat, and it
		// names the dataset that answered.
		const fema = visibleText(cardHtml(whole, "fema"));
		expect(fema).toContain("This copy omits minimal-hazard areas, so it cannot tell minimal hazard from an unmapped area.");
		expect(fema).toContain("FEMA's National Flood Hazard Layer could not be reached");
	});

	it("renders the same shape for every source: no severity, no ranking, no order but arrival", () => {
		const whole = stateOf(demo);
		const frames = ["sems", "echo", "fema", "frs"].map((source) => {
			const html = cardHtml(whole, source);
			return /<article[^>]*class="([^"]*)"/.exec(html)?.[1] ?? "";
		});
		// A Superfund card and a flood card are framed identically; only a card
		// that could not be reached or was never asked is drawn differently, and
		// that says how the retrieval went, not how bad the answer is.
		expect(new Set(frames).size).toBe(1);
	});
});

/* -------------------------------------------------------------------------- */
/* 3. Every slotted span opens what stands behind it                          */
/* -------------------------------------------------------------------------- */

describe("clicking any slotted span of any sentence in any card", () => {
	it("hands the panel the sentence and the span, for every span on every card", () => {
		const state = stateOf(demo);
		let clicked = 0;
		// The spans of the two cards this deployment holds no credential for,
		// counted apart: they are the whole of the difference between the 172 the
		// brief's audit took, when those two were `not-asked` and carried no
		// sentence, and the 173 below -- which is five short of 178 for the two
		// claims the report withdrew: the registry card's boundary and retrieval
		// time over a lookup that searched no area, and a group sentence naming
		// the registry's own record of an identifier as a sharer of it.
		let onNotConfigured = 0;

		for (const card of state.cards) {
			const groups = groupsOf(state, card.source);
			const opened: TraceSelection[] = [];
			// The component is a function: called, it returns the very tree React
			// would render, handlers and all.
			const slotted = slottedElements(
				ReportCard(cardProps(card, groups, (sentence, spanIndex) => opened.push({ sentence, spanIndex }))),
			);

			const expected = [
				...sentencesOf(card),
				...(groups === null ? [] : [...groups.groups, ...groups.crossReferences]),
			].flatMap((sentence) =>
				sentence.spans.flatMap((span, spanIndex) => (span.slot === null ? [] : [{ sentence, spanIndex, field: span.slot.field }])),
			);

			expect(slotted.map((one) => one.field)).toEqual(expected.map((one) => one.field));

			for (const [index, one] of slotted.entries()) {
				one.click();
				const selection = opened[index];
				const want = expected[index];
				if (selection === undefined || want === undefined) throw new Error(`no click at ${index}`);
				expect(selection.sentence).toBe(want.sentence);
				expect(selection.spanIndex).toBe(want.spanIndex);

				// Everything docs/BRIEF.md A3 asks the panel for is reachable from
				// what the click carried: the value, the field it is called, and the
				// scope header that says whose record it is.
				const value = clickedValue(selection);
				expect(value?.field).toBe(want.field);
				const trace = selection.sentence.trace;
				if (trace === null) throw new Error("a rendered sentence with no trace");
				if (trace.scope === "record") {
					expect(trace.record.agency.length).toBeGreaterThan(0);
					expect(trace.record.sourceRecordId.length).toBeGreaterThan(0);
					expect(trace.record.sourceUrl.normalized).not.toBeNull();
				}
				if (trace.scope === "source" && trace.source.cause === "not-configured") onNotConfigured += 1;
				clicked += 1;
			}
		}

		// The same 173 the state machine walks, through the rendered card this
		// time.
		expect(onNotConfigured).toBe(6);
		expect(clicked).toBe(173);
	});

	it("gives a slotted span its field name and leaves connective text alone", () => {
		const state = stateOf(demo);
		const html = cardHtml(state, "sems");
		const fields = [...html.matchAll(/data-field="([^"]+)"/g)].map((hit) => hit[1]);
		// The fields `lib/templates/sems.ts` named, not fields this test wishes for.
		expect(fields).toContain("subject");
		expect(fields).toContain("epaSiteId");
		expect(fields).toContain("distanceMeters");
		expect(fields).toContain("statusDate");
		// Connective text is a span with no hook, because nothing stands behind it.
		expect(html).toContain("<span>, EPA ID </span>");
	});
});

/* -------------------------------------------------------------------------- */
/* 4. No component wrote a factual sentence                                   */
/* -------------------------------------------------------------------------- */

describe("every string on the screen is either a span the server sent or enumerated chrome", () => {
	it("leaves nothing over once the server's own strings are subtracted", () => {
		const state = stateOf(demo);
		const expanded = state.cards.flatMap((card) => card.listings.map((_listing, index) => listingKey(card.source, index)));
		const html = viewHtml({ ...state, expanded });
		const server = serverStrings(state);
		const written = textNodes(html).filter((text) => !server.has(text));

		// Every string on the finished Houston report that no agency produced.
		// Six of them, and the sixth is the retry the two air cards offer. "This
		// source was not asked." is no longer among them: every source on this
		// stream was asked, the two air ones included, and what they answered --
		// that this deployment holds no credential for them -- is a sentence the
		// server rendered, above a Retry, not a line this screen wrote. Add a
		// string to a component and this list stops matching.
		expect([...new Set(written)].sort()).toEqual(
			["Hide the rest", "Limits", "Report", "Retry", "Search another address", "Sources settled: 6 of 6."].sort(),
		);
		for (const text of written) expect(CHROME).toContain(text);
	});

	it("leaves nothing over in the states that have their own chrome either", () => {
		// Mid-stream: cards, placeholders for what has not settled, and the line
		// for a source nobody asked. Cut at the registry's card rather than at a
		// fixed index, because that card is the one carrying the line and nothing
		// pins the settle order; the two assertions below fail loudly if that cut
		// leaves nothing outstanding after it.
		const registry = fourStates.findIndex((event) => event.type === "card" && event.card.source === "frs");
		expect(registry).toBeGreaterThan(-1);
		const partial = stateOf(fourStates.slice(0, registry + 1));
		const midStream = textNodes(viewHtml(partial)).filter((text) => !serverStrings(partial).has(text));
		for (const text of midStream) expect(CHROME).toContain(text);
		expect(midStream).toContain("This source was not asked.");
		expect(midStream).toContain("Waiting for a source.");

		// Settled, with a source that could not be reached, and a stream that
		// could not be read: both offer a retry and neither writes a claim.
		const broken = reportReducer(stateOf(fourStates), { type: "stream-failed" });
		const failed = textNodes(viewHtml(broken)).filter((text) => !serverStrings(broken).has(text));
		for (const text of failed) expect(CHROME).toContain(text);
		expect(failed).toContain("Retry");
		expect(failed).toContain("This report could not be loaded.");
	});
});

/* -------------------------------------------------------------------------- */
/* 5. docs/BRIEF.md C2                                                        */
/* -------------------------------------------------------------------------- */

/** docs/BRIEF.md C2, every phrase of it, plus the words those phrases are built from. */
const C2_PHRASES: readonly string[] = [
	"operating polluters near your home",
	"any us address",
	"parcel-level flood risk",
	"no records means safe",
	"the ai cannot hallucinate",
	"personal exposure",
	"real-time environmental history",
	"every source is complete and correct",
	"likely cause",
	"risk score",
	"cumulative risk",
	"judging score",
];

/** The words of C2, which may not appear in anything a component wrote even out of their phrase. */
const C2_WORDS: readonly string[] = [
	"polluter",
	"safe",
	"unsafe",
	"risk",
	"score",
	"hallucinate",
	"exposure",
	"real-time",
	"cumulative",
	"severity",
	"danger",
];

describe("the words of docs/BRIEF.md C2 appear nowhere", () => {
	it("greps the whole rendered report for every phrase", () => {
		const state = stateOf(demo);
		const expanded = state.cards.flatMap((card) => card.listings.map((_listing, index) => listingKey(card.source, index)));
		const rendered = [
			viewHtml({ ...state, expanded }),
			viewHtml(reportReducer(stateOf(fourStates), { type: "stream-failed" })),
			viewHtml(initialReportState),
		].join(" ");
		const text = visibleText(rendered).toLowerCase();
		for (const phrase of C2_PHRASES) expect(text).not.toContain(phrase);
	});

	it("greps every string a component wrote for every word", () => {
		// The phrases above are checked against the whole screen; the words are
		// checked against what this unit wrote, because an agency's own field can
		// legitimately carry one -- FEMA's "Area With Reduced Flood Risk Due To
		// Levee" is a zone subtype, shown verbatim, and is not this screen
		// speaking.
		const chrome = CHROME.join(" ").toLowerCase();
		for (const word of C2_WORDS) expect(chrome).not.toContain(word);
		// And no colour, weight or border in the card is chosen by what a record
		// says: the card's class comes from the retrieval state, nothing else.
		const state = stateOf(demo);
		expect(cardHtml(state, "sems")).not.toMatch(/class="[^"]*(red|amber|green|danger|warning)/);
	});
});
