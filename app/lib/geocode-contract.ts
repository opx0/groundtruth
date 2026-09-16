/**
 * The wire contract between the browser and `app/api/geocode/route.ts`.
 *
 * `GeocodeMatchView` is deliberately smaller than the kernel's `GeocodeMatch`:
 * the coordinate, which the report route will be asked for next, the matched
 * address, which the candidates screen uses as a label, and the sentences the
 * server rendered from the match. It carries no `Sourced` value and no raw
 * address.
 *
 * **Why the sentences ride on the match rather than beside it.** Every match
 * view -- the single match, and each of the several candidates -- carries the
 * sentences rendered from that match. An ambiguous outcome has several
 * matches, and the confirm screen is reached by choosing one of them, so
 * sentences hung beside the response would have to be re-associated with
 * whichever candidate the reader picked. Rendered from the match, they travel
 * with it: `flowReducer`'s `choose-candidate` needs no new field and
 * `search-flow.tsx` needs no edit.
 *
 * **What a rendered sentence is.** `lib/report/sentence-view.ts` flattens a
 * `Sentence` into `{templateId, spans, trace}` -- read its module comment for
 * why the trace is one per sentence and why `Sentence.subject` is never on it.
 * The schemas below are that shape, narrowed to the one scope this route can
 * produce: a geocode match is an `origin` subject, so a record-, section-,
 * source- or group-scoped trace is rejected here rather than merely unexpected.
 *
 * Both sides parse every message through `GeocodeApiResponseSchema`. A zod
 * object schema strips keys it was not told about, so an extra field attached
 * to a response object by mistake -- a raw address, an unredacted payload URL
 * -- cannot reach the wire through `respond()`. The one place that backstop
 * does not reach is `ValueTrace.normalized` and `FieldProvenance.rawValue`,
 * which are `JsonValue` by definition and pass through whatever an agency
 * sent. That is why the privacy proof in
 * `tests/unit/app/geocode-route-privacy.test.ts` greps the serialised response
 * for a marker planted in the caller's address instead of trusting the schema.
 */

import { z } from "zod";
import { DISPLAY_FORMATS } from "@/lib/evidence";
import type { JsonValue } from "@/lib/evidence";

/* -------------------------------------------------------------------------- */
/* A rendered sentence, on the wire                                           */
/* -------------------------------------------------------------------------- */

/**
 * `JsonValue` is recursive, so the schema is too. Annotated rather than
 * inferred because a `z.lazy` cannot infer its own result.
 */
const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
	z.union([
		z.null(),
		z.boolean(),
		z.number(),
		z.string(),
		z.array(JsonValueSchema).readonly(),
		z.record(z.string(), JsonValueSchema),
	]),
);

export const PayloadRefSchema = z.object({
	/** `lib/adapters/census.ts` rebuilds this with `address` deleted before it is ever attached to a match. */
	url: z.string(),
	sha256: z.string(),
	retrievedAt: z.string(),
});

/**
 * The wire's own view of the kernel's `Provenance`. The enums the kernel
 * declares -- `TransformName`, `Formula`, `AdapterVersion` -- arrive here as
 * strings: the browser prints them, and pinning the list in a second place
 * would make adding a transform a two-file change for no guarantee this
 * schema is here to give. What the schema is here to give is the set of
 * *keys*, which is what a stray field would arrive as.
 */
export type ProvenanceView =
	| {
			readonly kind: "field";
			readonly dataset: string;
			readonly sourceField: string;
			readonly rawValue: JsonValue;
			readonly transform: string;
			readonly adapterVersion: string;
			readonly payload: z.infer<typeof PayloadRefSchema>;
	  }
	| {
			readonly kind: "absent";
			readonly dataset: string;
			readonly sourceField: string;
			readonly adapterVersion: string;
			readonly payload: z.infer<typeof PayloadRefSchema>;
	  }
	| {
			readonly kind: "query";
			readonly parameter: string;
			readonly value: JsonValue;
			readonly adapterVersion: string;
			readonly payload: z.infer<typeof PayloadRefSchema>;
	  }
	| {
			readonly kind: "computation";
			readonly formula: string;
			readonly computedBy: string;
			readonly inputs: readonly ComputationInputView[];
	  };

export type ComputationInputView = {
	readonly name: string;
	readonly value: JsonValue;
	readonly provenance: readonly ProvenanceView[];
};

const ComputationInputSchema: z.ZodType<ComputationInputView> = z.lazy(() =>
	z.object({
		name: z.string(),
		value: JsonValueSchema,
		provenance: z.array(ProvenanceSchema).readonly(),
	}),
);

export const ProvenanceSchema: z.ZodType<ProvenanceView> = z.lazy(() =>
	z.discriminatedUnion("kind", [
		z.object({
			kind: z.literal("field"),
			dataset: z.string(),
			sourceField: z.string(),
			rawValue: JsonValueSchema,
			transform: z.string(),
			adapterVersion: z.string(),
			payload: PayloadRefSchema,
		}),
		z.object({
			kind: z.literal("absent"),
			dataset: z.string(),
			sourceField: z.string(),
			adapterVersion: z.string(),
			payload: PayloadRefSchema,
		}),
		z.object({
			kind: z.literal("query"),
			parameter: z.string(),
			value: JsonValueSchema,
			adapterVersion: z.string(),
			payload: PayloadRefSchema,
		}),
		z.object({
			kind: z.literal("computation"),
			formula: z.string(),
			computedBy: z.string(),
			inputs: z.array(ComputationInputSchema).readonly(),
		}),
	]),
);

/** One value behind a sentence: what it is called, what it showed, what it was, and where it came from. */
export const ValueTraceSchema = z.object({
	field: z.string(),
	/** Null when the value is not on screen in this sentence. */
	displayed: z.string().nullable(),
	normalized: JsonValueSchema,
	provenance: z.array(ProvenanceSchema).readonly(),
});

/** A rendered span. `slot` is null for the template's own connective text, which has no field behind it. */
export const SpanSchema = z.object({
	text: z.string(),
	// `DISPLAY_FORMATS` rather than the three members spelled out again. This
	// line held its own copy of the union until 2026-09-17, and adding a
	// fourth format to `lib/evidence/templates.ts` broke the typecheck here,
	// three modules from the change.
	slot: z.object({ field: z.string(), display: z.enum(DISPLAY_FORMATS) }).nullable(),
});

/**
 * The `origin` arm of the kernel's `Trace`, without `clicked` -- the browser
 * finds the clicked value in `values` by the span's own `slot.field`. The
 * other four arms are not declared, so a trace of any other scope is a parse
 * failure on the way out rather than a surprise on screen.
 */
export const OriginTraceViewSchema = z.object({
	scope: z.literal("origin"),
	origin: z.object({ matchedAddress: z.string(), payload: PayloadRefSchema }),
	values: z.array(ValueTraceSchema).readonly(),
});

export const OriginSentenceSchema = z.object({
	templateId: z.string(),
	spans: z.array(SpanSchema).readonly(),
	/** Null only when the subject has left the store, which an origin subject cannot do: it is the match itself. */
	trace: OriginTraceViewSchema.nullable(),
});

export type OriginSentence = z.infer<typeof OriginSentenceSchema>;

/* -------------------------------------------------------------------------- */
/* The response                                                               */
/* -------------------------------------------------------------------------- */

export const GeocodeMatchViewSchema = z.object({
	matchedAddress: z.string(),
	latitude: z.number(),
	longitude: z.number(),
	/**
	 * `docs/BRIEF.md` A2 screen 2, rendered by `lib/templates/origin.ts` on the
	 * server. There is no field here for the block range or the street side:
	 * their only consumer was a hand-written template string, and they now
	 * reach the screen as spans of `origin/match@1` with the Census field
	 * behind each one.
	 */
	origin: z.array(OriginSentenceSchema).readonly(),
});

export type GeocodeMatchView = z.infer<typeof GeocodeMatchViewSchema>;

export const GeocodeApiResponseSchema = z.discriminatedUnion("status", [
	z.object({ status: z.literal("matched"), match: GeocodeMatchViewSchema }),
	z.object({ status: z.literal("ambiguous"), candidates: z.array(GeocodeMatchViewSchema).min(2) }),
	z.object({ status: z.literal("no-match") }),
	z.object({ status: z.literal("unavailable") }),
	z.object({ status: z.literal("invalid") }),
]);

export type GeocodeApiResponse = z.infer<typeof GeocodeApiResponseSchema>;

/** What the browser sends. Validated again on the server; this is the client's own guard against submitting nothing. */
export const GeocodeRequestSchema = z.object({ address: z.string().trim().min(1).max(240) });

/**
 * The three curated examples for the search screen, `docs/BRIEF.md` A6 rows
 * 1-3: public, non-residential addresses that each confirm to a clean match
 * and each demonstrate a different source. The no-match and ambiguous rows
 * of A6 are fixtures for the failure-state screens, not buttons here --
 * putting them next to "try one of these" would read as inviting the reader
 * to expect a match.
 */
export type CuratedExample = { readonly address: string; readonly note: string };

export const CURATED_EXAMPLES: readonly [CuratedExample, CuratedExample, CuratedExample] = [
	{ address: "9311 E Ave P, Houston, TX 77012", note: "Several Superfund sites are on record nearby." },
	{ address: "400 N Richey St, Pasadena, TX 77506", note: "A Superfund site and a mapped flood zone are on record nearby." },
	{ address: "1300 Perdido St, New Orleans, LA 70112", note: "A mapped flood zone with a levee is on record nearby." },
];
