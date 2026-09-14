/**
 * The report screen's state machine, driven by a real NDJSON stream built from
 * the committed fixtures through the real route handler
 * (`tests/unit/app/helpers/report-stream-fixtures.ts`). No card in this file
 * was invented: every one of them came off the wire.
 *
 * The rendering half of this unit is in `report-screen.test.ts`. What is here
 * is everything the screen decides before it draws anything: what order cards
 * are in, which of B10's states a card is in, what is still outstanding, and
 * what a clicked span resolves to.
 */

import { describe, expect, it } from "vitest";
import type { CardView, ReportEvent, SentenceViewMessage } from "@/app/lib/report-contract";
import {
	cardStateOf,
	caveatsOf,
	clickedValue,
	initialReportState,
	listingKey,
	REPORT_SOURCES,
	reportReducer,
	sentencesOf,
	sourceStatusOf,
	waitingSources,
	type CardState,
	type ReportFlowState,
} from "@/app/lib/report-flow";
import { DEMO, FOUR_STATES, reportEvents, stateOf } from "./helpers/report-stream-fixtures";

const demo: readonly ReportEvent[] = await reportEvents(DEMO);
const fourStates: readonly ReportEvent[] = await reportEvents(FOUR_STATES);

function cardOf(state: ReportFlowState, source: string): CardView {
	const card = state.cards.find((one) => one.source === source);
	if (card === undefined) throw new Error(`no card for ${source}`);
	return card;
}

/** The order the route wrote the card lines in, which is the order the sources settled. */
function settleOrder(events: readonly ReportEvent[]): readonly string[] {
	return events.flatMap((event) => (event.type === "card" ? [event.card.source] : []));
}

describe("the stream folds into one state, in arrival order", () => {
	it("keeps the cards in the order the sources settled, not the order of the source enum", () => {
		const state = stateOf(demo);
		expect(state.cards.map((card) => card.source)).toEqual(settleOrder(demo));
		// The enum's order is a different order, so the assertion above has teeth.
		expect(settleOrder(demo)).not.toEqual(REPORT_SOURCES);
	});

	it("shows a card the moment its event arrives, with no card for a source that has not settled", () => {
		let state = initialReportState;
		const seen: string[] = [];
		for (const event of demo) {
			state = reportReducer(state, { type: "event", event });
			if (event.type !== "card") continue;
			seen.push(event.card.source);
			expect(state.cards.map((card) => card.source)).toEqual(seen);
			// Every source not yet settled is outstanding, and none of them has an
			// entry in `cards`: a card that has not arrived is not an empty card.
			expect([...seen, ...waitingSources(state)].sort()).toEqual([...REPORT_SOURCES].sort());
		}
		expect(state.status).toBe("complete");
		expect(waitingSources(state)).toEqual([]);
	});

	it("carries the groups the route sent after every source settled", () => {
		const state = stateOf(demo);
		const sems = state.groups.find((card) => card.source === "sems");
		expect(sems?.groups.map((one) => one.spans.map((span) => span.text).join(""))).toContain(
			"VALERO PLUME and HOUSTON REFINERY share one EPA facility registry ID, 110000460885.",
		);
	});

	it("ends unavailable when the stream itself broke, which is not a source failing", () => {
		const state = reportReducer(stateOf(demo.slice(0, 3)), { type: "stream-failed" });
		expect(state.status).toBe("unavailable");
		expect(state.cards.length).toBe(3);
	});

	it("ends failed when the route said the report itself could not be built", () => {
		const state = reportReducer(initialReportState, { type: "event", event: { type: "end", status: "failed" } });
		expect(state.status).toBe("failed");
	});

	it("drops every card on a retry, because a retry is a new retrieval", () => {
		const state = reportReducer(stateOf(demo), { type: "retry" });
		expect(state.cards).toEqual([]);
		expect(state.groups).toEqual([]);
		expect(state.status).toBe("streaming");
		expect(state.attempt).toBe(1);
	});
});

/* -------------------------------------------------------------------------- */
/* B10's four states                                                          */
/* -------------------------------------------------------------------------- */

describe("the four states a card can be in are four different states", () => {
	it("reads each one off the wire rather than off the sentence text", () => {
		const state = stateOf(fourStates);
		const states: { readonly [source: string]: CardState } = Object.fromEntries(
			state.cards.map((card) => [card.source, cardStateOf(card)]),
		);
		expect(states).toEqual({
			sems: "records",
			frs: "records",
			echo: "no-records",
			fema: "unavailable",
			aqs: "not-asked",
			airnow: "not-asked",
		});
	});

	it("keeps 'answered with nothing' and 'could not be reached' apart, as B10 does", () => {
		const state = stateOf(fourStates);
		expect(sourceStatusOf(cardOf(state, "echo"))).toBe("no-data");
		expect(sourceStatusOf(cardOf(state, "fema"))).toBe("unavailable");
		// A source nobody asked has no status sentence at all: no template speaks
		// for a request that was never made.
		expect(cardOf(state, "aqs").status).toBeNull();
		expect(sourceStatusOf(cardOf(state, "aqs"))).toBeNull();
	});

	it("puts the source's own limits on the card that made the claim, deduplicated", () => {
		const state = stateOf(demo);
		const sems = caveatsOf(cardOf(state, "sems"));
		expect(sems).toEqual([
			"A SEMS record can mean assessment, proposed action, active cleanup, or completed work.",
			"The coordinate is a reference point, not a boundary.",
		]);
		// Fifteen records carry the same two caveats; the card states them once.
		expect(new Set(sems).size).toBe(sems.length);
		expect(caveatsOf(cardOf(state, "aqs"))).toEqual([]);
	});
});

/* -------------------------------------------------------------------------- */
/* What a clicked span resolves to                                            */
/* -------------------------------------------------------------------------- */

type Span = SentenceViewMessage["spans"][number];

function slottedSpans(sentence: SentenceViewMessage): readonly { readonly span: Span; readonly index: number }[] {
	return sentence.spans.flatMap((span, index) => (span.slot === null ? [] : [{ span, index }]));
}

/**
 * Every sentence the screen puts on a card, which is every sentence on the
 * wire: the cards' own, and the group sentences the `groups` event places on
 * the card whose records lead them.
 */
function everySentence(state: ReportFlowState): readonly SentenceViewMessage[] {
	return [
		...state.cards.flatMap((card) => [...sentencesOf(card)]),
		...state.groups.flatMap((card) => [...card.groups, ...card.crossReferences]),
	];
}

describe("every slotted span of every sentence resolves to the value behind it", () => {
	it("finds the clicked value in the sentence's own trace, by the span's field", () => {
		const state = stateOf(demo);
		let walked = 0;
		for (const sentence of everySentence(state)) {
			for (const { span, index } of slottedSpans(sentence)) {
				const value = clickedValue({ sentence, spanIndex: index });
				expect(value, `${sentence.templateId} span ${index}`).not.toBeNull();
				expect(value?.field).toBe(span.slot?.field);
				// What the panel shows as the clicked value is what the card shows
				// as the span: the same string, not a second rendering of it.
				expect(value?.displayed).toBe(span.text);
				walked += 1;
			}
		}
		// Not a sample. Every slotted span of every sentence of every card of the
		// demo report, which the brief's own audit counted at 172.
		expect(walked).toBe(172);
	});

	it("resolves nothing for the template's own connective text", () => {
		const state = stateOf(demo);
		const sentence = sentencesOf(cardOf(state, "sems"))[0];
		if (sentence === undefined) throw new Error("no sentence on the Superfund card");
		const plain = sentence.spans.findIndex((span) => span.slot === null);
		expect(plain).toBeGreaterThan(-1);
		expect(clickedValue({ sentence, spanIndex: plain })).toBeNull();
		expect(clickedValue({ sentence, spanIndex: sentence.spans.length })).toBeNull();
	});

	it("grounds a value with no provenance of its own on the scope header instead", () => {
		const state = stateOf(demo);
		let empty = 0;
		for (const sentence of everySentence(state)) {
			for (const { index } of slottedSpans(sentence)) {
				const value = clickedValue({ sentence, spanIndex: index });
				if (value === null || value.provenance.length > 0) continue;
				empty += 1;
				const trace = sentence.trace;
				// Every one of them is a status or a count: the grounding is the
				// source outcome, or the section's `counted` list, on the header.
				// A panel rendering only `values[].provenance` would show an empty
				// citation on all 27 of them.
				expect(trace?.scope === "source" || trace?.scope === "section").toBe(true);
				if (trace?.scope === "source") expect(trace.source.agency.length).toBeGreaterThan(0);
				if (trace?.scope === "section") expect(trace.section.agency.length).toBeGreaterThan(0);
			}
		}
		expect(empty).toBe(27);
	});
});

/* -------------------------------------------------------------------------- */
/* What the reader can open                                                   */
/* -------------------------------------------------------------------------- */

describe("what the reader opens and closes", () => {
	it("holds the clicked sentence and span, and lets go of it", () => {
		const state = stateOf(demo);
		const sentence = sentencesOf(cardOf(state, "sems"))[0];
		if (sentence === undefined) throw new Error("no sentence on the Superfund card");
		const opened = reportReducer(state, { type: "open-trace", sentence, spanIndex: 0 });
		expect(opened.trace).toEqual({ sentence, spanIndex: 0 });
		expect(reportReducer(opened, { type: "close-trace" }).trace).toBeNull();
	});

	it("opens and closes one list at a time, keyed so two lists on one card stay apart", () => {
		const state = stateOf(demo);
		const sems = cardOf(state, "sems");
		// The Superfund card carries two listings of the same kind and boundary.
		expect(sems.listings.length).toBe(2);
		const first = listingKey("sems", 0);
		const second = listingKey("sems", 1);
		expect(first).not.toBe(second);
		const open = reportReducer(state, { type: "toggle-listing", key: first });
		expect(open.expanded).toEqual([first]);
		expect(reportReducer(open, { type: "toggle-listing", key: second }).expanded).toEqual([first, second]);
		expect(reportReducer(open, { type: "toggle-listing", key: first }).expanded).toEqual([]);
	});
});
