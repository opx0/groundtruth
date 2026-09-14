/**
 * The geocode route's logic, factored out of `route.ts` so a test can inject
 * a fixture-backed `SourceIo` instead of the real network implementation --
 * the same shape of substitution `tests/unit/adapters/census.test.ts` makes
 * for `geocode()` itself.
 *
 * It is also where `docs/BRIEF.md` A2 screen 2's sentences are rendered. They
 * cannot be rendered anywhere else: a `GeocodeMatch` holds `Sourced` values,
 * the kernel exports no way to build one, and this is the only place in the
 * codebase that ever holds one. The report route is given a coordinate and
 * nothing else, so it could not reconstruct the match even if it tried -- and
 * that is the property, not a limitation.
 *
 * PRIVACY: this is the one server boundary that ever holds a raw address.
 * `geocode()` (see `lib/adapters/census.ts`) already guarantees the address
 * cannot appear in anything it returns or throws; this file's own added
 * obligation is not to undo that. Three rules, held everywhere below:
 *
 * 1. Every response is built by `respond()`, which parses the body through
 *    `GeocodeApiResponseSchema` before it goes on the wire. That schema has
 *    no field for a raw address on any branch, so even a body object built
 *    with an extra field by mistake cannot carry one out -- zod strips keys
 *    a schema does not declare.
 * 2. This route now puts provenance on the wire, which the version that
 *    hand-wrote its precision sentence did not, so "it never looks at
 *    `.payload`" is no longer the argument. The argument is where the
 *    provenance comes from: every slot of an origin subject is a leaf of the
 *    `GeocodeMatch`, and `lib/adapters/census.ts` builds every one of those
 *    from a payload whose URL it rebuilt with `address` deleted, never from
 *    the URL it fetched and never from whatever `SourceIo.get` recorded. The
 *    origin trace's own header is `match.matchedAddress` and `match.payload`,
 *    the same two. `tests/unit/app/geocode-route-privacy.test.ts` proves the
 *    whole chain by planting a marker in the caller's address and grepping
 *    the serialised response for it, rather than by reading this comment.
 * 3. Nothing caught here is logged by its own message or forwarded as a
 *    response body. The one log line this file writes carries a fixed
 *    string and a `FailureCause` enum value, nothing derived from the
 *    request or from an error's own `.message`.
 */

import { NextResponse } from "next/server";
import { geocode } from "@/lib/adapters/census";
import { emptyStore, render, SourceFailure } from "@/lib/evidence";
import type { GeocodeMatch, SourceIo } from "@/lib/evidence";
import { sentenceView } from "@/lib/report/sentence-view";
import type { SentenceView } from "@/lib/report/sentence-view";
import { originTemplates } from "@/lib/templates/origin";
import {
	GeocodeApiResponseSchema,
	GeocodeRequestSchema,
	type GeocodeApiResponse,
	type GeocodeMatchView,
	type OriginSentence,
} from "@/app/lib/geocode-contract";

/**
 * An origin subject is the match itself, so `render` and `trace` never reach
 * the store for one -- see the `origin` arms of both in
 * `lib/evidence/sentence.ts`. Passing the empty store says that in code: this
 * route holds no records and renders nothing that depends on one.
 */
const NO_RECORDS = emptyStore;

/**
 * Narrows what `sentenceView` returns to the one arm this route can produce.
 * A geocode match is an `origin` subject, so the trace of a sentence rendered
 * from one is origin-scoped; the throw is a typed check on a union, not an
 * assertion, and it lands in the same `catch` as any other failure below, so
 * it answers 503 rather than leaking anything.
 */
function toOriginSentence(view: SentenceView): OriginSentence {
	const { templateId, spans, trace } = view;
	if (trace === null) return { templateId, spans, trace: null };
	if (trace.scope !== "origin") {
		throw new Error("geocode handler: an origin sentence produced a trace of another scope");
	}
	return { templateId, spans, trace: { scope: trace.scope, origin: trace.origin, values: trace.values } };
}

/**
 * Every origin template there is, in the order `lib/templates/origin.ts`
 * declares them, which is the order `selectReport` places them in
 * `lib/report/selection.ts`. The list rather than the two names, so a third
 * origin template reaches this screen by being written, not by being wired.
 *
 * A template whose clauses all dropped renders null and is simply absent --
 * see `renderAll`, which this mirrors. There is no substitute text: a
 * hand-written stand-in for a sentence the fields could not support is the
 * thing this route just stopped doing.
 */
function originSentences(match: GeocodeMatch): readonly OriginSentence[] {
	const out: OriginSentence[] = [];
	for (const template of originTemplates) {
		const sentence = render(NO_RECORDS, { scope: "origin", match, template });
		if (sentence === null) continue;
		out.push(toOriginSentence(sentenceView(NO_RECORDS, sentence)));
	}
	return out;
}

function toMatchView(match: GeocodeMatch): GeocodeMatchView {
	return {
		matchedAddress: match.matchedAddress.value,
		latitude: match.point.latitude.value,
		longitude: match.point.longitude.value,
		origin: originSentences(match),
	};
}

function respond(body: GeocodeApiResponse, init?: ResponseInit): Response {
	return NextResponse.json(GeocodeApiResponseSchema.parse(body), init);
}

/** A `SourceFailure`'s own enum reason, or "unknown" for anything else. Never the error's message or any raw code. */
function failureReason(error: unknown): string {
	return error instanceof SourceFailure ? error.reason : "unknown";
}

/**
 * Builds the route's `POST` handler against whatever `SourceIo` it is given.
 * `route.ts` supplies the real, network-touching one; tests supply a fixture
 * or a failing double.
 */
export function createGeocodeHandler(io: SourceIo) {
	return async function POST(request: Request): Promise<Response> {
		let address: string;
		try {
			const json: unknown = await request.json();
			({ address } = GeocodeRequestSchema.parse(json));
		} catch {
			// The parse error is never read: a malformed-JSON message can echo a
			// fragment of the body it failed on, and a zod issue can carry a
			// received value for the wrong-shaped cases. Neither is logged or
			// returned.
			return respond({ status: "invalid" }, { status: 400 });
		}

		try {
			const outcome = await geocode(address, io);
			if (outcome.status === "matched") {
				return respond({ status: "matched", match: toMatchView(outcome.match) });
			}
			if (outcome.status === "ambiguous") {
				const [first, second, ...rest] = outcome.candidates.map(toMatchView);
				// `.map` widens the tuple `GeocodeOutcome` guarantees (at least two
				// candidates) back to a plain array, so `noUncheckedIndexedAccess`
				// makes `first`/`second` nullable again. They cannot actually be
				// absent; this is a typed check, not a non-null assertion.
				if (first === undefined || second === undefined) {
					throw new Error("geocode handler: an ambiguous outcome lost its tuple shape");
				}
				return respond({ status: "ambiguous", candidates: [first, second, ...rest] });
			}
			return respond({ status: "no-match" });
		} catch (error) {
			console.error("geocode: source unavailable", { reason: failureReason(error) });
			return respond({ status: "unavailable" }, { status: 503 });
		}
	};
}
