/**
 * The wire contract between the browser and `app/api/report/route.ts`.
 *
 * The report is a stream of newline-delimited JSON events, one per line. Every
 * event is a member of `ReportEventSchema`, and `app/api/report/handler.ts`
 * parses each one through that schema before the line goes out, exactly as
 * `respond()` does in `app/api/geocode/handler.ts`. A zod object schema strips
 * keys it was not told about, so a field someone attaches to an event object by
 * mistake later cannot reach the wire: the schema it is parsed through does not
 * know that field exists.
 *
 * THREE EVENTS AND NO MORE.
 *
 *   {"type":"card","card":{...}}      one source's card, as that source settles
 *   {"type":"groups","cards":[...]}   docs/BRIEF.md B6 groups, once all settled
 *   {"type":"end","status":...}       the terminal event, complete or failed
 *
 * The order of `card` events is the order the sources settle. Each one carries
 * its own `source`, so the browser places it; nothing here implies a position.
 * The `groups` event is separate because grouping needs records from more than
 * one source, so it cannot be part of any one card.
 *
 * WHAT A SENTENCE IS ON THE WIRE. `SentenceViewSchema` mirrors
 * `lib/report/sentence-view.ts`, which is the seam and carries the argument in
 * full: one trace per sentence rather than one per span, because only `clicked`
 * differs between the spans of a sentence and the browser can find the clicked
 * value in `trace.values` by the span's own `slot.field`; and no
 * `Sentence.subject`, because for an origin sentence the subject is the whole
 * `GeocodeMatch`, address and payload included.
 *
 * THE ORIGIN SCOPE IS ABSENT FROM `SentenceTraceSchema`, deliberately. The
 * kernel's `Trace` has five arms and this has four. `OriginTrace` carries
 * `matchedAddress`, and this route never renders an origin placement -- the
 * origin sentences reach the browser from the geocode route, which is the only
 * place a `GeocodeMatch` exists. Leaving the arm out means the report stream
 * cannot carry a matched address even if a future edit placed an origin
 * sentence on a card by mistake: the parse would fail and the event would not
 * be sent.
 *
 * A PAYLOAD URL MAY NEVER CARRY A KEY. AQS and AirNow take their keys as query
 * parameters, and a payload URL ends up in the trace panel, on screen. Those
 * adapters own their own redaction (`.dev/briefs/U1.6-U1.7-air.md`); this is a
 * second, independent check, applied by the same parse that strips unknown
 * keys, so it cannot be forgotten at a call site. `withoutKeys` rewrites the
 * value of any sensitive query parameter wherever a string crosses the wire --
 * a payload URL, a raw value, a rendered span -- and leaves every other string
 * byte for byte alone.
 *
 * The wire types below relax the kernel's non-empty tuples to plain arrays.
 * That is the only difference: a tuple guarantees something to a compiler that
 * has the kernel, and the browser does not have the kernel.
 */

import { z } from "zod";
import type { JsonValue } from "@/lib/evidence";

/* -------------------------------------------------------------------------- */
/* The key check                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Query parameters that carry a credential. AQS takes `email` and `key`;
 * AirNow takes `API_KEY`. The rest are here because a parameter named `token`
 * or `secret` is never a thing this report needs to show a reader, and the
 * cost of listing it is nothing.
 */
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

/**
 * The same string, with the value of every credential-bearing query parameter
 * replaced.
 *
 * A string that is not a URL comes back unchanged, and so does a URL that
 * carries no such parameter -- returning `url.toString()` unconditionally would
 * re-encode URLs nobody asked us to touch, and a payload URL is a citation: it
 * has to stay the bytes we requested.
 */
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

/**
 * The same string with every configured credential's own value replaced,
 * wherever it sits.
 *
 * `withoutKeys` above redacts by shape: it parses the string as a URL and
 * rewrites the parameters it recognises. That catches a payload URL, which is
 * where a key most plausibly ends up, and it catches nothing else. A source's
 * own error text is not a URL, and both air adapters forward it verbatim into
 * `SourceFailure.rawCode`, which `lib/templates/sources.ts` renders as
 * "It answered {rawCode}." -- on the card, not only in the trace. An audit
 * drove a failing source whose message was
 * `Request not authenticated for https://...?API_KEY=<key>` and the key
 * reached the wire through both checks: a URL inside a sentence, a key in a
 * path, a key in a fragment and `Invalid API key: <key>` all survive a
 * shape-based redaction.
 *
 * So this one redacts by value. It is the check that cannot be defeated by
 * spelling, and the two are kept together because they fail differently: this
 * one only knows the credentials this process was configured with, and
 * `withoutKeys` still catches one it was not.
 *
 * Server-only, and deliberately reads the environment at call time rather than
 * at module load, so a key rotated into the process is redacted from the next
 * line rather than from the next deploy.
 */
export function withoutSecretValues(line: string): string {
	let out = line;
	for (const secret of secretValues()) {
		out = out.split(secret).join(REDACTED);
		// A key in a URL arrives percent-encoded; the raw pass would miss it.
		out = out.split(encodeURIComponent(secret)).join(REDACTED);
	}
	return out;
}

/**
 * Longest first, so a credential that contains another is replaced whole
 * rather than leaving a fragment of itself behind. Anything shorter than eight
 * characters is ignored: a short or empty value would match ordinary report
 * text and redact a sentence instead of a secret.
 */
function secretValues(): readonly string[] {
	return [process.env["AQS_KEY"], process.env["AQS_EMAIL"], process.env["AIRNOW_KEY"]]
		.filter((value): value is string => typeof value === "string" && value.length >= 8)
		.sort((a, b) => b.length - a.length);
}

/** Every string that crosses the wire goes through the key check. */
const RedactedText = z.string().transform(withoutKeys);

/** Any JSON value, with the key check applied at every string leaf. */
const RedactedJson: z.ZodType<JsonValue> = z.lazy(() =>
	z.union([z.null(), z.boolean(), z.number(), RedactedText, z.array(RedactedJson).readonly(), z.record(z.string(), RedactedJson)]),
);

/* -------------------------------------------------------------------------- */
/* Provenance                                                                 */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* Traces                                                                     */
/* -------------------------------------------------------------------------- */

const RecordIdSchema = z.object({ kind: z.string(), sourceRecordId: z.string() });

const ValueTraceSchema = z.object({
	field: z.string(),
	/** As shown, after the slot's display format; null when this value is not on screen in the sentence. */
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

/** Four arms, not the kernel's five. See the module comment for why `origin` is not one of them. */
export const SentenceTraceSchema = z.discriminatedUnion("scope", [
	z.object({ scope: z.literal("record"), record: RecordTraceSchema, values: z.array(ValueTraceSchema).readonly() }),
	z.object({ scope: z.literal("section"), section: SectionTraceSchema, values: z.array(ValueTraceSchema).readonly() }),
	z.object({ scope: z.literal("source"), source: SourceTraceSchema, values: z.array(ValueTraceSchema).readonly() }),
	z.object({ scope: z.literal("group"), group: GroupTraceSchema, values: z.array(ValueTraceSchema).readonly() }),
]);

export type WireSentenceTrace = z.infer<typeof SentenceTraceSchema>;

/* -------------------------------------------------------------------------- */
/* Sentences                                                                  */
/* -------------------------------------------------------------------------- */

const SpanSchema = z.object({
	text: RedactedText,
	/** null: connective text the template wrote, with no field behind it. */
	slot: z.object({ field: z.string(), display: z.string() }).nullable(),
});

export const SentenceViewSchema = z.object({
	templateId: z.string(),
	spans: z.array(SpanSchema).min(1).readonly(),
	trace: SentenceTraceSchema.nullable(),
});

export type SentenceViewMessage = z.infer<typeof SentenceViewSchema>;

/* -------------------------------------------------------------------------- */
/* Cards                                                                      */
/* -------------------------------------------------------------------------- */

/** Every source that answers about a point. Census is the geocoder and has no card. */
export const ReportSourceSchema = z.enum(["sems", "fema", "aqs", "airnow", "echo", "frs"]);

export type ReportSourceId = z.infer<typeof ReportSourceSchema>;

const EntryViewSchema = z.object({
	recordId: RecordIdSchema,
	/** Every sentence this one record renders. A FEMA polygon needs several; B7's "up to five records" counts records, not sentences. */
	sentences: z.array(SentenceViewSchema).readonly(),
});

/**
 * One list on a card, with the two numbers B7's "View all when a section holds
 * more" needs.
 *
 * `total` is the section's whole ordering and `carried` is what this report
 * carries of it, both recomputed from the live store beside the entries, never
 * lengths written down at plan time. `shown.length + rest.length` equals
 * `carried` by construction, and `rest.length > 0` is what puts "View all" on
 * screen. A card also places `section/not-shown@1`, which states the same gap
 * as a sentence with a trace, so these two are a convenience beside a sentence
 * that already says it rather than the only place the reader learns it.
 */
const ListingViewSchema = z.object({
	kind: z.string(),
	/** How the boundary reads on screen, e.g. "5 miles". */
	boundary: z.string(),
	/** Which of B7's named orders the entries are in. */
	ordering: z.string(),
	total: z.number().int().nonnegative(),
	carried: z.number().int().nonnegative(),
	shown: z.array(EntryViewSchema).readonly(),
	rest: z.array(EntryViewSchema).readonly(),
});

export const CardViewSchema = z.object({
	source: ReportSourceSchema,
	/**
	 * What the card is about, in the words the status sentence uses. FEMA is
	 * one source and two layers, so this is the dataset's own label when Esri's
	 * copy answered, and the agency's name otherwise.
	 */
	agency: z.string(),
	/**
	 * `not-asked`: no request was made for this source, so it has no status
	 * sentence. Two things put a source here and neither is a failure -- no
	 * adapter is registered for it yet, or nothing named an identifier for an
	 * identity lookup to resolve. A source nobody asked is not a source that
	 * answered with nothing and not one that refused, and saying so is the only
	 * honest state available.
	 */
	state: z.enum(["asked", "not-asked"]),
	status: SentenceViewSchema.nullable(),
	/** A source outcome this card owes the reader beside its own status: today, the NFHL failure that forced the Esri fallback. */
	priorAttempts: z.array(SentenceViewSchema).readonly(),
	/** The section-scoped counts, the not-shown sentence and the no-data notes, in reading order, before any record. */
	headlines: z.array(SentenceViewSchema).readonly(),
	listings: z.array(ListingViewSchema).readonly(),
});

export type CardView = z.infer<typeof CardViewSchema>;

/** What the B6 groups put on one card: the group sentences, and what the identifier they end on resolves to. */
const CardGroupsViewSchema = z.object({
	source: ReportSourceSchema,
	groups: z.array(SentenceViewSchema).readonly(),
	crossReferences: z.array(SentenceViewSchema).readonly(),
});

/* -------------------------------------------------------------------------- */
/* The events                                                                 */
/* -------------------------------------------------------------------------- */

export const ReportEventSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("card"), card: CardViewSchema }),
	z.object({ type: z.literal("groups"), cards: z.array(CardGroupsViewSchema).readonly() }),
	/**
	 * The stream always ends with exactly one of these. `failed` means the
	 * report itself could not be built, not that a source could not be reached
	 * -- a source that cannot be reached is a card that says so.
	 */
	z.object({ type: z.literal("end"), status: z.enum(["complete", "failed"]) }),
]);

export type ReportEvent = z.infer<typeof ReportEventSchema>;

export const NDJSON_CONTENT_TYPE = "application/x-ndjson";

/* -------------------------------------------------------------------------- */
/* The request                                                                */
/* -------------------------------------------------------------------------- */

/**
 * docs/BRIEF.md B9 step 5 and step 6: the confirmed coordinate, and nothing
 * else. Not an address, not a matched address, not a tiger line.
 *
 * Strict rather than stripping, which is the one place in this codebase where
 * that is the stronger rule: a body carrying an address is a client that has
 * misunderstood what this route is, and continuing with the two numbers off it
 * would hide that. It is refused, with the same response shape the geocode
 * route uses for an invalid body.
 */
export const ReportRequestSchema = z.strictObject({
	latitude: z.number().min(-90).max(90),
	longitude: z.number().min(-180).max(180),
});

export type ReportRequest = z.infer<typeof ReportRequestSchema>;

/** The only non-stream response: a request this route will not act on. Same shape as the geocode route's. */
export const ReportErrorSchema = z.object({ status: z.literal("invalid") });

export type ReportError = z.infer<typeof ReportErrorSchema>;
