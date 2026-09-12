/**
 * The wire contract between the browser and `app/api/geocode/route.ts`, and
 * the pieces of product copy that are built from real fields rather than
 * hardcoded.
 *
 * `GeocodeMatchView` is deliberately smaller than the kernel's `GeocodeMatch`:
 * it carries only the values these two screens display, read once on the
 * server with `.value` (see `toMatchView` in `handler.ts`), never the
 * `Sourced` provenance or the payload. Screen 4 (trace) is a later unit's
 * job; until it exists, the browser has no use for provenance, and not
 * sending it is one less place a redaction mistake could matter.
 *
 * Both sides parse every message through `GeocodeApiResponseSchema`. A zod
 * object schema strips keys it was not told about, so even if a future edit
 * accidentally attached an extra field to a response object on the server --
 * a raw address, a payload URL -- `respond()` in `handler.ts` cannot put it
 * on the wire: the schema it parses through does not know that field exists.
 */

import { z } from "zod";

export const GeocodeMatchViewSchema = z.object({
	matchedAddress: z.string(),
	latitude: z.number(),
	longitude: z.number(),
	addressRange: z.object({ from: z.string(), to: z.string() }),
	streetSide: z.string(),
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

/** "L" -> "left", "R" -> "right". Anything else is shown verbatim rather than guessed at. */
function sideWord(side: string): string {
	if (side === "L") return "left";
	if (side === "R") return "right";
	return side;
}

/**
 * `docs/BRIEF.md` A2's precision sentence, built from the match's own
 * address-range and street-side fields rather than written as a fixed
 * string. Delete either field from the match and this function has nothing
 * to build the sentence from; that is what "not hardcoded" has to mean.
 */
export function buildPrecisionSentence(match: GeocodeMatchView): string {
	const { from, to } = match.addressRange;
	return `The point sits on the ${from} to ${to} block, ${sideWord(match.streetSide)} side of the street segment, interpolated by the Census Geocoder. It marks the block, not the parcel.`;
}
