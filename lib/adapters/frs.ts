/**
 * EPA FRS (Facility Registry Service): an identity lookup, not a list.
 *
 * The ArcGIS `FRS_INTERESTS` layer answers one row per programme interest, not
 * one row per facility. Registry `110000460885` comes back as 38 rows spanning
 * 15 programmes, and a five-mile radius query around the demo point answers
 * 6,915 interest rows. Nobody should ever try to render that as a list, so this
 * adapter's job is narrower than the other sources': given a registry ID that
 * another adapter (ECHO, SEMS) already found, answer what the facility is, how
 * good its coordinate is, and which programme IDs it carries. The entry point
 * therefore takes that registry ID directly, not a point and a radius.
 *
 * Every row for one registry ID is collapsed into a single record. The rows
 * are expected to agree on the facility's identity — its name and its
 * coordinate, including the coordinate's own quality fields, ACCURACY_VALUE,
 * COLLECT_MTH_DESC, and REF_POINT_DESC, which are null on plenty of real rows.
 * When the rows disagree on identity, that is surfaced as a caveat rather than
 * silently resolved by taking the first row and saying nothing.
 */

import { z } from "zod";
import type { AdapterVersion, Built, FrsProgramInterest, PayloadRef, SourceIo } from "@/lib/evidence";
import { fieldsOf, SourceFailure, urlFrom } from "@/lib/evidence";

export const FRS_VERSION: AdapterVersion = "frs@1";

const DATASET = "frs_interests";

const LAYER_URL =
	"https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/FRS_INTERESTS/FeatureServer/0/query";

/** EPA's own facility page, the same one ECHO links to for the same registry ID. */
export const FACILITY_PAGE_URL = "https://echo.epa.gov/detailed-facility-report?fid={id}";

export const FRS_CAVEATS: readonly string[] = [
	"FRS is an identity record: the facility's name, its coordinate, and the programme systems that track it. It is not a compliance or enforcement history.",
	"The coordinate's accuracy and collection method are FRS's own metadata about how the point was placed, and are null on plenty of real facilities.",
];

/**
 * One programme-interest row. `PGM_SYS_ACRNM` and `PGM_SYS_ID` are required
 * because every real row carries them and the record's `program`/`programId`
 * fields are non-nullable. `INTEREST_TYPE` and `ACTIVE_STATUS` are `z.string()`
 * nullable, never `z.enum()`: FRS carries codes such as `***UNCHANGED***` this
 * file has never catalogued, and they must reach the screen unchanged.
 */
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

/** The facility-identity fields every programme-interest row for one registry ID is expected to agree on. */
const IDENTITY_FIELDS: readonly IdentityField[] = [
	"REGISTRY_ID",
	"PRIMARY_NAME",
	"LATITUDE83",
	"LONGITUDE83",
	"ACCURACY_VALUE",
	"COLLECT_MTH_DESC",
	"REF_POINT_DESC",
];

/** The identity fields, if any, on which the rows being collapsed disagree. */
export function identityMismatches(rows: readonly FrsAttrs[]): readonly IdentityField[] {
	const [first, ...rest] = rows;
	if (first === undefined) return [];
	return IDENTITY_FIELDS.filter((field) => rest.some((row) => row[field] !== first[field]));
}

/** The row whose UPDATE_DATE is most recent. A null date never beats a real one, and ties keep the earlier row. */
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

/** One programme-interest row, each of its four fields a leaf that traces to that row's column. */
function programInterest(feature: FrsFeature, payload: PayloadRef): FrsProgramInterest {
	return fieldsOf({ raw: feature.attributes, payload }, DATASET, FRS_VERSION).pick({
		program: "PGM_SYS_ACRNM",
		programId: "PGM_SYS_ID",
		interestType: "INTEREST_TYPE",
		activeStatus: "ACTIVE_STATUS",
	});
}

/**
 * One FRS facility, collapsed from every programme-interest row the registry
 * ID carries. The identity fields come from the first row; `programInterests`
 * is every row, picked the same way, so the trace can name the row and column
 * behind any one programme's status.
 */
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
		// FRS's identity layer has no as-of concept distinct from UPDATE_DATE.
		effectiveAt: frs.absent("EFFECTIVE_DATE"),
		sourceUpdatedAt: latestReader.epochMs("UPDATE_DATE"),
		caveats,
		registryId: frs.text("REGISTRY_ID"),
		programInterests: features.map((feature) => programInterest(feature, payload)),
	};
}

/**
 * The adapter's entry point: a registry ID, not a locus. Answers zero or one
 * built facility — zero when FRS holds no programme-interest row for that
 * registry ID, which is a real answer and not a failure.
 *
 * The caller seals the result with the kernel's `complete`, against whatever
 * locus the surrounding report is centred on. An identity record's distance
 * from that point is not a fact a reader is shown; `complete` still needs a
 * locus because it is the only way to obtain a sealed record.
 */
export async function lookupFrsFacility(registryId: string, io: SourceIo): Promise<readonly Built<"frs-facility">[]> {
	const fetched = await io.get(registryQueryUrl(registryId), ArcgisResponse);
	const body = fetched.raw;
	if ("error" in body) throw new SourceFailure("http", body.error.code);
	const [first, ...rest] = body.features;
	if (first === undefined) return [];
	return [frsFacility([first, ...rest], fetched.payload)];
}
