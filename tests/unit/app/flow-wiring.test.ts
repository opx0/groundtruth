/**
 * The seam between the two halves of screens 3 and 4.
 *
 * The report screen renders spans and calls back with a selection; the trace
 * panel turns a selection into A3's table. Neither imports the other, which is
 * what lets each be tested alone -- and is exactly why nothing in either half's
 * tests notices if `SearchFlow` stops passing the panel in. The panel would be
 * dead code and every one of its 23 tests would still pass.
 *
 * So this file tests the join, and only the join: that the two compose into a
 * panel carrying the raw field, and that the flow actually does the composing.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportView } from "@/app/components/report-screen";
import { renderTracePanel } from "@/app/components/trace-panel";
import { sentencesOf, type TraceSelection } from "@/app/lib/report-flow";
import { houstonMatch, reportState } from "./helpers/report-stream-fixtures";

/**
 * The first slotted span of a record-scoped sentence. The scope matters: a
 * count or a status sentence is grounded on its scope header rather than on a
 * field, so "Raw field" is legitimately absent from 27 of the demo report's
 * 172 spans. A record span is the one A3 was written for.
 */
function firstSelection(
	state: Awaited<ReturnType<typeof reportState>>,
	scope: "record" | "section" = "record",
): TraceSelection {
	for (const card of state.cards) {
		for (const sentence of sentencesOf(card)) {
			if (sentence.trace?.scope !== scope) continue;
			const index = sentence.spans.findIndex((span) => span.slot !== null);
			if (index !== -1) return { sentence, spanIndex: index };
		}
	}
	throw new Error(`no slotted ${scope} span in the demo report`);
}

describe("the report screen and the trace panel, joined", () => {
	it("renders a panel naming the raw field when the screen is given one", async () => {
		const state = await reportState();
		const match = await houstonMatch();
		const selection = firstSelection(state);

		const markup = renderToStaticMarkup(
			createElement(ReportView, {
				match,
				state: { ...state, trace: selection },
				dispatch: () => undefined,
				onStartOver: () => undefined,
				renderTrace: renderTracePanel,
			}),
		);

		// The panel's own chrome, and the thing A3 exists to show: the field the
		// clicked span was read from.
		expect(markup).toContain("Trace");
		expect(markup).toContain("Raw field");
		const clicked = selection.sentence.spans[selection.spanIndex]?.slot?.field ?? "";
		expect(clicked).not.toBe("");
		expect(markup).toContain(clicked);
	});

	it("renders no panel when the screen is given none, so neither half needs the other", async () => {
		const state = await reportState();
		const match = await houstonMatch();
		const markup = renderToStaticMarkup(
			createElement(ReportView, {
				match,
				state: { ...state, trace: firstSelection(state) },
				dispatch: () => undefined,
				onStartOver: () => undefined,
				renderTrace: null,
			}),
		);
		expect(markup).not.toContain("Raw field");
	});

	/**
	 * A structural check, because the composition above cannot see it: the two
	 * halves meet in exactly one place, and if that line goes the panel becomes
	 * unreachable without a single test failing.
	 */
	it("is actually wired: the flow hands the report screen the panel", () => {
		const flow = readFileSync(fileURLToPath(new URL("../../../app/components/search-flow.tsx", import.meta.url)), "utf8");
		expect(flow).toContain('from "./trace-panel"');
		expect(flow).toContain("renderTrace={renderTracePanel}");
	});
});
