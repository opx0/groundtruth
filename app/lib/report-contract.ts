import { z } from "zod";
import type { JsonValue } from "@/lib/evidence";

const SECRET_PARAMETERS: ReadonlySet<string> = new Set([
	"key",
	"api_key",
	"api-key",
	"apikey",
	"token",
	"access_token",
	"auth",
	"authorization",
	"secret",
	"password",
	"signature",
	"email",
]);

export const REDACTED = "REDACTED";

export function withoutKeys(text: string): string {
	let url: URL;
	try {
		url = new URL(text);
	} catch {
		return text;
	}
	let redacted = false;
	for (const name of [...url.searchParams.keys()]) {
		if (!SECRET_PARAMETERS.has(name.toLowerCase())) continue;
		url.searchParams.set(name, REDACTED);
		redacted = true;
	}
	return redacted ? url.toString() : text;
}

export function withoutSecretValues(line: string): string {
	let out = line;
	for (const secret of secretValues()) {
		out = out.split(secret).join(REDACTED);
		out = out.split(encodeURIComponent(secret)).join(REDACTED);
	}
	return out;
}

function secretValues(): readonly string[] {
	return [process.env["AQS_KEY"], process.env["AQS_EMAIL"], process.env["AIRNOW_KEY"]]
		.filter((value): value is string => typeof value === "string" && value.length >= 8)
		.sort((a, b) => b.length - a.length);
}

const RedactedText = z.string().transform(withoutKeys);

const RedactedJson: z.ZodType<JsonValue> = z.lazy(() =>
	z.union([z.null(), z.boolean(), z.number(), RedactedText, z.array(RedactedJson).readonly(), z.record(z.string(), RedactedJson)]),
);

export type WirePayloadRef = {
	readonly url: string;
	readonly sha256: string;
	readonly retrievedAt: string;
};

export type WireProvenance =
	| {
			readonly kind: "field";
			readonly dataset: string;
			readonly sourceField: string;
			readonly rawValue: JsonValue;
			readonly transform: string;
			readonly adapterVersion: string;
			readonly payload: WirePayloadRef;
	  }
	| {
			readonly kind: "absent";
			readonly dataset: string;
			readonly sourceField: string;
			readonly adapterVersion: string;
			readonly payload: WirePayloadRef;
	  }
	| {
			readonly kind: "query";
			readonly parameter: string;
			readonly value: JsonValue;
			readonly adapterVersion: string;
			readonly payload: WirePayloadRef;
	  }
	| {
			readonly kind: "computation";
			readonly formula: string;
			readonly computedBy: string;
			readonly inputs: readonly WireComputationInput[];
	  };

export type WireComputationInput = {
	readonly name: string;
	readonly value: JsonValue;
	readonly provenance: readonly WireProvenance[];
};

const PayloadRefSchema = z.object({
	url: RedactedText,
	sha256: z.string(),
	retrievedAt: z.string(),
});

const QueryProvenanceSchema = z.object({
	kind: z.literal("query"),
	parameter: z.string(),
	value: RedactedJson,
	adapterVersion: z.string(),
	payload: PayloadRefSchema,
});

const ProvenanceSchema: z.ZodType<WireProvenance> = z.lazy(() =>
	z.union([
		z.object({
			kind: z.literal("field"),
			dataset: z.string(),
			sourceField: z.string(),
			rawValue: RedactedJson,
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
		QueryProvenanceSchema,
		z.object({
			kind: z.literal("computation"),
			formula: z.string(),
			computedBy: z.string(),
			inputs: z.array(
				z.object({
					name: z.string(),
					value: RedactedJson,
					provenance: z.array(ProvenanceSchema).readonly(),
				}),
			).readonly(),
		}),
	]),
);

const RecordIdSchema = z.object({ kind: z.string(), sourceRecordId: z.string() });

const ValueTraceSchema = z.object({
	field: z.string(),
	displayed: RedactedText.nullable(),
	normalized: RedactedJson,
	provenance: z.array(ProvenanceSchema).readonly(),
});

const RecordTraceSchema = z.object({
	kind: z.string(),
	source: z.string(),
	agency: z.string(),
	sourceRecordId: z.string(),
	sourceUrl: ValueTraceSchema,
	payloads: z.array(PayloadRefSchema).readonly(),
	caveats: z.array(RedactedText).readonly(),
	effectiveAt: ValueTraceSchema,
	sourceUpdatedAt: ValueTraceSchema,
});

const SectionTraceSchema = z.object({
	kind: z.string(),
	source: z.string(),
	agency: z.string(),
	boundary: z.string(),
	query: QueryProvenanceSchema.nullable(),
	counted: z.array(RecordIdSchema).readonly(),
});

const SourceTraceSchema = z.object({
	source: z.string(),
	agency: z.string(),
	status: z.enum(["ok", "no-data", "unavailable"]),
	retrievedAt: z.string().nullable(),
	cause: z.string().nullable(),
	rawCode: RedactedJson,
	retryAfter: z.string().nullable(),
});

const GroupTraceSchema = z.object({
	members: z.array(RecordIdSchema).readonly(),
	groupedBy: z.string().nullable(),
});

export const SentenceTraceSchema = z.discriminatedUnion("scope", [
	z.object({ scope: z.literal("record"), record: RecordTraceSchema, values: z.array(ValueTraceSchema).readonly() }),
	z.object({ scope: z.literal("section"), section: SectionTraceSchema, values: z.array(ValueTraceSchema).readonly() }),
	z.object({ scope: z.literal("source"), source: SourceTraceSchema, values: z.array(ValueTraceSchema).readonly() }),
	z.object({ scope: z.literal("group"), group: GroupTraceSchema, values: z.array(ValueTraceSchema).readonly() }),
]);

export type WireSentenceTrace = z.infer<typeof SentenceTraceSchema>;

const SpanSchema = z.object({
	text: RedactedText,
	slot: z.object({ field: z.string(), display: z.string() }).nullable(),
});

export const SentenceViewSchema = z.object({
	templateId: z.string(),
	spans: z.array(SpanSchema).min(1).readonly(),
	trace: SentenceTraceSchema.nullable(),
});

export type SentenceViewMessage = z.infer<typeof SentenceViewSchema>;

export const ReportSourceSchema = z.enum(["sems", "fema", "aqs", "airnow", "echo", "frs"]);

export type ReportSourceId = z.infer<typeof ReportSourceSchema>;

const EntryViewSchema = z.object({
	recordId: RecordIdSchema,
	sentences: z.array(SentenceViewSchema).readonly(),
});

const ListingViewSchema = z.object({
	kind: z.string(),
	boundary: z.string(),
	ordering: z.string(),
	total: z.number().int().nonnegative(),
	carried: z.number().int().nonnegative(),
	shown: z.array(EntryViewSchema).readonly(),
	rest: z.array(EntryViewSchema).readonly(),
});

export const CardViewSchema = z.object({
	source: ReportSourceSchema,
	agency: z.string(),
	state: z.enum(["asked", "not-asked"]),
	status: SentenceViewSchema.nullable(),
	priorAttempts: z.array(SentenceViewSchema).readonly(),
	headlines: z.array(SentenceViewSchema).readonly(),
	listings: z.array(ListingViewSchema).readonly(),
});

export type CardView = z.infer<typeof CardViewSchema>;

const CardGroupsViewSchema = z.object({
	source: ReportSourceSchema,
	groups: z.array(SentenceViewSchema).readonly(),
	crossReferences: z.array(SentenceViewSchema).readonly(),
});

export const ReportEventSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("card"), card: CardViewSchema }),
	z.object({ type: z.literal("groups"), cards: z.array(CardGroupsViewSchema).readonly() }),
	z.object({ type: z.literal("end"), status: z.enum(["complete", "failed"]) }),
]);

export type ReportEvent = z.infer<typeof ReportEventSchema>;

export const NDJSON_CONTENT_TYPE = "application/x-ndjson";

export const ReportRequestSchema = z.strictObject({
	latitude: z.number().min(-90).max(90),
	longitude: z.number().min(-180).max(180),
});

export type ReportRequest = z.infer<typeof ReportRequestSchema>;

export const ReportErrorSchema = z.object({ status: z.literal("invalid") });

export type ReportError = z.infer<typeof ReportErrorSchema>;
