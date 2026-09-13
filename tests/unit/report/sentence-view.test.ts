/**
 * The wire shape of a rendered sentence.
 *
 * The property that matters: whatever the reader clicks, the view answers
 * "what field is behind this" without a second request and without the
 * browser holding a store. The test walks every span of every sentence a real
 * record produces and resolves each one, because a trace that answers for the
 * first span and not the fourth is the failure this shape exists to prevent.
 */

import { describe, expect, it } from "vitest";
import { render, storeOf } from "@/lib/evidence";
import type { Placement, Sentence } from "@/lib/evidence";
import { semsSiteSummary } from "@/lib/templates/sems";
import { sentenceView } from "@/lib/report/sentence-view";
import { houstonLocus, NEAREST_EPA_ID, semsId, semsRecord, semsStore } from "../evidence/helpers/sems-fixtures";

const locus = houstonLocus();
const store = semsStore(locus);

function sentenceFor(placement: Placement): Sentence {
	const sentence = render(store, placement);
	if (sentence === null) throw new Error("expected a sentence");
	return sentence;
}

const nearest: Placement = {
	scope: "record",
	recordId: semsId(NEAREST_EPA_ID),
	template: semsSiteSummary,
};

describe("sentenceView", () => {
	it("carries the text it rendered, span for span", () => {
		const sentence = sentenceFor(nearest);
		const view = sentenceView(store, sentence);
		expect(view.templateId).toBe("sems-site/summary@1");
		expect(view.spans.map((span) => span.text).join("")).toBe(
			"VALERO PLUME, EPA ID TXN000622182. 0.76 km from the mapped point." +
				" NPL status: Not on the NPL." +
				" Non-NPL status: Removal Only Site (No Site Assessment Work Needed)." +
				" Non-NPL status date: 2022-02-08.",
		);
	});

	it("answers what field is behind every span that carries one, from one trace", () => {
		const sentence = sentenceFor(nearest);
		const view = sentenceView(store, sentence);
		if (view.trace === null) throw new Error("expected a trace");

		const slotted = view.spans.filter((span) => span.slot !== null);
		expect(slotted.length).toBeGreaterThan(1);
		for (const span of slotted) {
			const field = span.slot?.field ?? "";
			const value = view.trace.values.find((one) => one.field === field);
			// The clicked span's own entry, which is what `Trace.clicked` was.
			expect(value, `no trace value for ${field}`).toBeDefined();
			expect(value?.displayed).toBe(span.text);
			expect(value?.provenance.length ?? 0).toBeGreaterThan(0);
		}
	});

	it("reaches the record's identity and payloads, which the A3 panel heads with", () => {
		const view = sentenceView(store, sentenceFor(nearest));
		if (view.trace === null || view.trace.scope !== "record") throw new Error("expected a record trace");
		expect(view.trace.record.sourceRecordId).toBe(NEAREST_EPA_ID);
		expect(view.trace.record.agency).toBe("EPA Superfund Enterprise Management System");
		expect(view.trace.record.payloads.length).toBeGreaterThan(0);
	});

	it("does not carry the sentence's subject", () => {
		const view = sentenceView(store, sentenceFor(nearest));
		// `Sentence.subject` for an origin sentence is the whole GeocodeMatch,
		// payload included. Nothing on the wire may carry a subject, so the shape
		// has no field for one on any scope.
		expect(Object.keys(view).sort()).toEqual(["spans", "templateId", "trace"]);
	});

	it("describes nothing once the record has left the store", () => {
		const record = semsRecord(locus, NEAREST_EPA_ID);
		const sentence = sentenceFor(nearest);
		const emptied = storeOf([]).without(record.id);
		expect(render(emptied, nearest)).toBeNull();
		expect(sentenceView(emptied, sentence).trace).toBeNull();
	});
});
