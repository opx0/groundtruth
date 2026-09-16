import { trace } from "@/lib/evidence";
import type { EvidenceStore, Sentence, Span, Trace } from "@/lib/evidence";

type WithoutClicked<T> = T extends unknown ? Omit<T, "clicked"> : never;

export type SentenceTrace = WithoutClicked<Trace>;

export type SentenceView = {
	readonly templateId: string;
	readonly spans: readonly Span[];
	readonly trace: SentenceTrace | null;
};

function withoutClicked(explained: Trace): SentenceTrace {
	switch (explained.scope) {
		case "record":
			return { scope: "record", record: explained.record, values: explained.values };
		case "section":
			return { scope: "section", section: explained.section, values: explained.values };
		case "source":
			return { scope: "source", source: explained.source, values: explained.values };
		case "origin":
			return { scope: "origin", origin: explained.origin, values: explained.values };
		case "group":
			return { scope: "group", group: explained.group, values: explained.values };
	}
}

function firstSlotSpan(sentence: Sentence): number | null {
	const index = sentence.spans.findIndex((span) => span.slot !== null);
	return index === -1 ? null : index;
}

export function sentenceView(store: EvidenceStore, sentence: Sentence): SentenceView {
	const index = firstSlotSpan(sentence);
	const explained = index === null ? null : trace(store, sentence, index);
	return {
		templateId: sentence.templateId,
		spans: sentence.spans,
		trace: explained === null ? null : withoutClicked(explained),
	};
}
