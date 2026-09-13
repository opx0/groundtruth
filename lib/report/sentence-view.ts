/**
 * One rendered sentence, flattened for the wire.
 *
 * The trace panel (docs/BRIEF.md A3, screen 4) has to answer "what field is
 * behind this span" for any span the reader clicks, and the browser holds no
 * store, no kernel and no records. So the server sends what it rendered plus
 * what stands behind it.
 *
 * Two shapes this deliberately is not.
 *
 * **Not a trace per span.** `trace(store, sentence, i)` returns
 * `{scope, <the scope's own header>, clicked, values}`, and only `clicked`
 * differs between the spans of one sentence -- the header and `values` are
 * identical, because both are read from the same subject. A trace per span
 * would ship the same payload once per span. This ships it once, and the
 * browser finds the clicked value in `values` by the span's own field name,
 * which is the only thing `clicked` was.
 *
 * **Not `Sentence.subject`.** For an `origin` sentence the subject is the whole
 * `GeocodeMatch`, provenance and payload included, and
 * `app/api/geocode/handler.ts` goes to some trouble never to put that on the
 * wire. `verify()` is what would need the subject, and verification is a
 * server-side property with tests on it, not something the browser does. What
 * the browser needs is the text and its provenance, and that is all this is.
 *
 * Nothing here caches or holds a record. `sentenceView` is a pure read of the
 * store at the moment it is called, exactly like `render` and `trace`, so a
 * view built from a store that has lost a record cannot describe that record.
 */

import { trace } from "@/lib/evidence";
import type { EvidenceStore, Sentence, Span, Trace } from "@/lib/evidence";

/** Every arm of `Trace` without its `clicked` field. Distributes over the union rather than collapsing it. */
type WithoutClicked<T> = T extends unknown ? Omit<T, "clicked"> : never;

export type SentenceTrace = WithoutClicked<Trace>;

export type SentenceView = {
	readonly templateId: string;
	readonly spans: readonly Span[];
	/**
	 * What the trace panel shows for every span of this sentence. Null only when
	 * the subject has left the store, which also makes the sentence
	 * unrenderable -- a view with a null trace is a view of something that is no
	 * longer there.
	 */
	readonly trace: SentenceTrace | null;
};

/**
 * Rebuilt arm by arm rather than by destructuring `clicked` away, so adding a
 * scope to `Trace` is a compile error here instead of a field that silently
 * stops crossing the wire.
 */
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

/**
 * The index of any span that carries a slot. Every clause of a template holds
 * at least one reference and a rendered span for a reference always carries its
 * slot, so a rendered sentence always has one; the null is the type being
 * honest rather than a case anyone has seen.
 */
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
