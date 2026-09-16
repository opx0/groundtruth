import { z } from "zod";
import type { AdapterVersion, Built, FrsProgramInterest, PayloadRef, SourceIo } from "@/lib/evidence";
import { fieldsOf, SourceFailure, urlFrom } from "@/lib/evidence";

export const FRS_VERSION: AdapterVersion = "frs@1";

const DATASET = "frs_interests";

const LAYER_URL =
	"https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/FRS_INTERESTS/FeatureServer/0/query";

export const FACILITY_PAGE_URL = "https://echo.epa.gov/detailed-facility-report?fid={id}";

export const FRS_CAVEATS: readonly string[] = [
	"FRS is an identity record: the facility's name, its coordinate, and the programme systems that track it. It is not a compliance or enforcement history.",
	"The coordinate's accuracy and collection method are FRS's own metadata about how the point was placed, and are null on plenty of real facilities.",
];

const FrsAttrs = z.object({
	REGISTRY_ID: z.string(),
	PRIMARY_NAME: z.string(),
	PGM_SYS_ID: z.string(),
	PGM_SYS_ACRNM: z.string(),
	INTEREST_TYPE: z.string().nullable(),
	ACTIVE_STATUS: z.string().nullable(),
	LATITUDE83: z.number().nullable(),
	LONGITUDE83: z.number().nullable(),
	ACCURACY_VALUE: z.number().nullable(),
	COLLECT_MTH_DESC: z.string().nullable(),
	REF_POINT_DESC: z.string().nullable(),
	UPDATE_DATE: z.number().nullable(),
});
export type FrsAttrs = z.infer<typeof FrsAttrs>;

type FrsFeature = { readonly attributes: FrsAttrs };

const ArcgisLayer = z.object({ features: z.array(z.object({ attributes: FrsAttrs })) });

/** ArcGIS answers a failed query with HTTP 200 and this body, so the status code proves nothing. */
const ArcgisError = z.object({ error: z.object({ code: z.number(), message: z.string() }) });

export const ArcgisResponse = z.union([ArcgisError, ArcgisLayer]);

/** `where=REGISTRY_ID='<id>'`, with an embedded quote doubled the way ArcGIS's SQL-like `where` clause escapes a literal. */
export function registryQueryUrl(registryId: string): URL {
	const url = new URL(LAYER_URL);
	url.searchParams.set("where", `REGISTRY_ID='${registryId.replace(/'/g, "''")}'`);
	url.searchParams.set("outFields", "*");
	url.searchParams.set("returnGeometry", "false");
	url.searchParams.set("f", "json");
	return url;
}

type IdentityField =
	| "REGISTRY_ID"
	| "PRIMARY_NAME"
	| "LATITUDE83"
	| "LONGITUDE83"
	| "ACCURACY_VALUE"
	| "COLLECT_MTH_DESC"
	| "REF_POINT_DESC";

const IDENTITY_FIELDS: readonly IdentityField[] = [
	"REGISTRY_ID",
	"PRIMARY_NAME",
	"LATITUDE83",
	"LONGITUDE83",
	"ACCURACY_VALUE",
	"COLLECT_MTH_DESC",
	"REF_POINT_DESC",
];

export function identityMismatches(rows: readonly FrsAttrs[]): readonly IdentityField[] {
	const [first, ...rest] = rows;
	if (first === undefined) return [];
	return IDENTITY_FIELDS.filter((field) => rest.some((row) => row[field] !== first[field]));
}

function mostRecentlyUpdated(features: readonly [FrsFeature, ...FrsFeature[]]): FrsFeature {
	let best = features[0];
	for (const feature of features) {
		const value = feature.attributes.UPDATE_DATE;
		if (value !== null && (best.attributes.UPDATE_DATE === null || value > best.attributes.UPDATE_DATE)) {
			best = feature;
		}
	}
	return best;
}

function programInterest(feature: FrsFeature, payload: PayloadRef): FrsProgramInterest {
	return fieldsOf({ raw: feature.attributes, payload }, DATASET, FRS_VERSION).pick({
		program: "PGM_SYS_ACRNM",
		programId: "PGM_SYS_ID",
		interestType: "INTEREST_TYPE",
		activeStatus: "ACTIVE_STATUS",
	});
}

export function frsFacility(
	features: readonly [FrsFeature, ...FrsFeature[]],
	payload: PayloadRef,
): Built<"frs-facility"> {
	const [first] = features;
	const frs = fieldsOf({ raw: first.attributes, payload }, DATASET, FRS_VERSION);
	const latest = mostRecentlyUpdated(features);
	const latestReader = fieldsOf({ raw: latest.attributes, payload }, DATASET, FRS_VERSION);

	const mismatches = identityMismatches(features.map((feature) => feature.attributes));
	const caveats: readonly string[] =
		mismatches.length === 0
			? FRS_CAVEATS
			: [
					...FRS_CAVEATS,
					`FRS's own programme-interest rows disagree on ${mismatches.join(", ")} for this registry ID; the first row's values are shown.`,
				];

	return {
		kind: "frs-facility",
		source: "frs",
		sourceRecordId: first.attributes.REGISTRY_ID,
		sourceUrl: urlFrom(FACILITY_PAGE_URL, frs.text("REGISTRY_ID")),
		subject: frs.text("PRIMARY_NAME"),
		location: frs.point("LATITUDE83", "LONGITUDE83", {
			accuracy: "ACCURACY_VALUE",
			method: "COLLECT_MTH_DESC",
			referencePoint: "REF_POINT_DESC",
		}),
		effectiveAt: frs.absent("EFFECTIVE_DATE"),
		sourceUpdatedAt: latestReader.epochMs("UPDATE_DATE"),
		caveats,
		registryId: frs.text("REGISTRY_ID"),
		programInterests: features.map((feature) => programInterest(feature, payload)),
	};
}

export async function lookupFrsFacility(registryId: string, io: SourceIo): Promise<readonly Built<"frs-facility">[]> {
	const fetched = await io.get(registryQueryUrl(registryId), ArcgisResponse);
	const body = fetched.raw;
	if ("error" in body) throw new SourceFailure("http", body.error.code);
	const [first, ...rest] = body.features;
	if (first === undefined) return [];
	return [frsFacility([first, ...rest], fetched.payload)];
}
