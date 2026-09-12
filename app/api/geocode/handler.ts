/**
 * The geocode route's logic, factored out of `route.ts` so a test can inject
 * a fixture-backed `SourceIo` instead of the real network implementation --
 * the same shape of substitution `tests/unit/adapters/census.test.ts` makes
 * for `geocode()` itself.
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
 * 2. `toMatchView` reads only `.value`s off the kernel's `GeocodeMatch`,
 *    never `.payload` or `.provenance`, so nothing here needs to reason
 *    about whether a nested payload URL was redacted -- it never looks.
 * 3. Nothing caught here is logged by its own message or forwarded as a
 *    response body. The one log line this file writes carries a fixed
 *    string and a `FailureCause` enum value, nothing derived from the
 *    request or from an error's own `.message`.
 */

import { NextResponse } from "next/server";
import { geocode } from "@/lib/adapters/census";
import { SourceFailure } from "@/lib/evidence";
import type { GeocodeMatch, SourceIo } from "@/lib/evidence";
import {
	GeocodeApiResponseSchema,
	GeocodeRequestSchema,
	type GeocodeApiResponse,
	type GeocodeMatchView,
} from "@/app/lib/geocode-contract";

function toMatchView(match: GeocodeMatch): GeocodeMatchView {
	return {
		matchedAddress: match.matchedAddress.value,
		latitude: match.point.latitude.value,
		longitude: match.point.longitude.value,
		addressRange: { from: match.addressRange.from.value, to: match.addressRange.to.value },
		streetSide: match.streetSide.value,
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

