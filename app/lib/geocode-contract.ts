import { z } from "zod";
import { DISPLAY_FORMATS } from "@/lib/evidence";
import type { JsonValue } from "@/lib/evidence";

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
	url: z.string(),
	sha256: z.string(),
	retrievedAt: z.string(),
});

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

export const ValueTraceSchema = z.object({
	field: z.string(),
	displayed: z.string().nullable(),
	normalized: JsonValueSchema,
	provenance: z.array(ProvenanceSchema).readonly(),
});

export const SpanSchema = z.object({
	text: z.string(),
	slot: z.object({ field: z.string(), display: z.enum(DISPLAY_FORMATS) }).nullable(),
});

export const OriginTraceViewSchema = z.object({
	scope: z.literal("origin"),
	origin: z.object({ matchedAddress: z.string(), payload: PayloadRefSchema }),
	values: z.array(ValueTraceSchema).readonly(),
});

export const OriginSentenceSchema = z.object({
	templateId: z.string(),
	spans: z.array(SpanSchema).readonly(),
	trace: OriginTraceViewSchema.nullable(),
});

export type OriginSentence = z.infer<typeof OriginSentenceSchema>;

export const GeocodeMatchViewSchema = z.object({
	matchedAddress: z.string(),
	latitude: z.number(),
	longitude: z.number(),
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

export const GeocodeRequestSchema = z.object({ address: z.string().trim().min(1).max(240) });

export type CuratedExample = { readonly address: string; readonly note: string };

export const CURATED_EXAMPLES: readonly [CuratedExample, CuratedExample, CuratedExample] = [
	{ address: "9311 E Ave P, Houston, TX 77012", note: "Several Superfund sites are on record nearby." },
	{ address: "400 N Richey St, Pasadena, TX 77506", note: "A Superfund site and a mapped flood zone are on record nearby." },
	{ address: "1300 Perdido St, New Orleans, LA 70112", note: "A mapped flood zone with a levee is on record nearby." },
];
