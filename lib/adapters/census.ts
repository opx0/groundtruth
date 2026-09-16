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
