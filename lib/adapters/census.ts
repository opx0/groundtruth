/**
 * The Census geocoder: address in, mapped point out.
 *
 * This is not an evidence adapter. It has no `Kind`, produces no
 * `EvidenceRecord`, and never goes through `complete`/`seal`. Every other
 * source in this codebase is queried with coordinates and a radius; this file
 * is where that boundary begins. It is the only place a raw street address
 * exists at all.
 *
 * Endpoint: `geocoding.geo.census.gov/geocoder/locations/onelineaddress`,
 * `benchmark=Public_AR_Current`, `format=json`. The response carries no
 * match-type field and no confidence score, so precision is expressed from
 * what is actually there: the matched address, the interpolated point, the
 * TIGER line id, which side of the street segment, and the address range
 * (`addressComponents.fromAddress`/`toAddress`) the point was interpolated
 * along. That range is the honest signal: the point locates a block, not a
 * parcel.
 *
 * PRIVACY: the address must reach Census and nowhere else. It must never
 * appear in a returned value, a thrown error, a log line, or any object that
 * could reach another source. The only place `address` is read below is the
 * request line in `geocode`; every payload this file hands back is stamped
 * with a URL rebuilt from the request with `address` stripped, never with
 * whatever `SourceIo.get` recorded, because we do not control that
 * implementation and must not trust it to have redacted anything.
 *
 * The match is the kernel's own `GeocodeMatch`. Its address range is a
 * container of two leaves built by the `pick` reader, the same shape as
 * `GeoPoint`, so each end of the range traces to the Census field it came
 * from.
 */

import { z } from "zod";
import { fieldsOf, ReaderInvariant } from "@/lib/evidence";
import type { AdapterVersion, GeocodeMatch, PayloadRef, SourceIo } from "@/lib/evidence";

export const CENSUS_VERSION: AdapterVersion = "census@1";

const DATASET = "census_geocoder";
const ENDPOINT = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const BENCHMARK = "Public_AR_Current";

const CensusCoordinates = z.object({
	x: z.number(),
	y: z.number(),
});

const CensusTigerLine = z.object({
	side: z.string(),
	tigerLineId: z.string(),
});

const CensusAddressComponents = z.object({
	fromAddress: z.string(),
	toAddress: z.string(),
});

const CensusAddressMatch = z.object({
	matchedAddress: z.string(),
	coordinates: CensusCoordinates,
	tigerLine: CensusTigerLine,
	addressComponents: CensusAddressComponents,
});
type CensusAddressMatch = z.infer<typeof CensusAddressMatch>;

export const CensusResponse = z.object({
	result: z.object({
		addressMatches: z.array(CensusAddressMatch),
	}),
});
export type CensusResponse = z.infer<typeof CensusResponse>;

export type { GeocodeMatch };

/**
 * Three outcomes, distinguishable by shape rather than by counting an array.
 * `matched` carries one `GeocodeMatch`, never an array; `ambiguous` carries a
 * tuple that is never empty and never length 1; `no-match` carries neither
 * field, so `outcome.match` and `outcome.candidates` do not exist on it.
 * There is no fourth, failed case: a request that cannot be answered rejects
 * the promise instead, exactly as `SourceIo.get` documents.
 */
export type GeocodeOutcome =
	| { readonly status: "matched"; readonly match: GeocodeMatch }
	| { readonly status: "ambiguous"; readonly candidates: readonly [GeocodeMatch, GeocodeMatch, ...GeocodeMatch[]] }
	| { readonly status: "no-match"; readonly retrievedAt: string; readonly payload: PayloadRef };

function requestUrlFor(address: string): URL {
	const url = new URL(ENDPOINT);
	url.searchParams.set("address", address);
	url.searchParams.set("benchmark", BENCHMARK);
	url.searchParams.set("format", "json");
	return url;
}

/**
 * The privacy boundary. `requested` is the URL we actually had to fetch, the
 * only way to invoke this endpoint, and it necessarily carries the address.
 * Every payload this file hands back is built from a copy with `address`
 * removed, never from `requested` itself and never from whatever
 * `SourceIo.get` chose to record on `fetched.payload.url` (we do not control
 * that implementation, so we do not trust it to have redacted anything).
 */
function citablePayload(requested: URL, fetched: PayloadRef): PayloadRef {
	const redacted = new URL(requested.toString());
	redacted.searchParams.delete("address");
	return { url: redacted.toString(), sha256: fetched.sha256, retrievedAt: fetched.retrievedAt };
}

function buildMatch(match: CensusAddressMatch, payload: PayloadRef): GeocodeMatch {
	const top = fieldsOf({ raw: match, payload }, DATASET, CENSUS_VERSION);
	const tiger = fieldsOf({ raw: match.tigerLine, payload }, DATASET, CENSUS_VERSION);
	const range = fieldsOf({ raw: match.addressComponents, payload }, DATASET, CENSUS_VERSION);
	const coords = fieldsOf({ raw: match.coordinates, payload }, DATASET, CENSUS_VERSION);

	const point = coords.point("y", "x", {});
	if (point === null) {
		throw new ReaderInvariant(`${DATASET}: an address match carried no coordinate`);
	}

	return {
		matchedAddress: top.text("matchedAddress"),
		point,
		addressRange: range.pick({ from: "fromAddress", to: "toAddress" }),
		tigerLineId: tiger.text("tigerLineId"),
		streetSide: tiger.text("side"),
		payload,
	};
}

/**
 * Turns one address into a mapped point, or several candidates, or nothing.
 * `address` is read exactly once, to build the request URL; nothing else in
 * this function, and nothing it returns, may reference it again.
 */
export async function geocode(address: string, io: SourceIo): Promise<GeocodeOutcome> {
	const requested = requestUrlFor(address);
	const fetched = await io.get(requested, CensusResponse);
	const payload = citablePayload(requested, fetched.payload);
	const matches = fetched.raw.result.addressMatches;

	const [first, second] = matches;
	if (first === undefined) {
		return { status: "no-match", retrievedAt: io.now(), payload };
	}

	const built = matches.map((m) => buildMatch(m, payload));
	const [firstBuilt, secondBuilt, ...restBuilt] = built;
	if (firstBuilt === undefined) {
		throw new ReaderInvariant(`${DATASET}: address matches vanished while building records`);
	}
	if (second === undefined || secondBuilt === undefined) {
		return { status: "matched", match: firstBuilt };
	}
	return { status: "ambiguous", candidates: [firstBuilt, secondBuilt, ...restBuilt] };
}
