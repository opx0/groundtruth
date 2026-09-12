/**
 * Reads the committed SEMS and Census fixture bytes and builds records through
 * the kernel exactly as the live adapter will. This is a test helper, not the
 * adapter: nothing here fetches.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Built, EvidenceStore, GeoPoint, Locus, PayloadRef, RecordId, Sealed, SemsSiteRecord } from "@/lib/evidence";
import { coalesce, complete, fieldsOf, recordId, storeOf, urlFrom } from "@/lib/evidence";
import type { Fetched, JsonValue } from "@/lib/evidence";

const fixturesDir = fileURLToPath(new URL("../../../fixtures/", import.meta.url));

export const RETRIEVED_AT = "2026-09-15T18:00:00Z";
export const SEMS_VERSION = "sems@1";
export const CENSUS_VERSION = "census@1";

export function loadFixture<Raw extends JsonValue>(
	relative: string,
	schema: z.ZodType<Raw>,
): { readonly raw: Raw; readonly payload: PayloadRef } {
	const bytes = readFileSync(`${fixturesDir}${relative}`);
	const payload: PayloadRef = {
		url: `fixture:${relative}`,
		sha256: createHash("sha256").update(bytes).digest("hex"),
		retrievedAt: RETRIEVED_AT,
	};
	return { raw: schema.parse(JSON.parse(bytes.toString("utf8"))), payload };
}

/** Status fields are z.string(), never z.enum(): unknown codes survive verbatim. */
export const FrsAttrs = z.object({
	REGISTRY_ID: z.string(),
	PRIMARY_NAME: z.string(),
	PGM_SYS_ID: z.string(),
	INTEREST_TYPE: z.string(),
	ACTIVE_STATUS: z.string().nullable(),
	LATITUDE83: z.number().nullable(),
	LONGITUDE83: z.number().nullable(),
	ACCURACY_VALUE: z.number().nullable(),
	COLLECT_MTH_DESC: z.string().nullable(),
	REF_POINT_DESC: z.string().nullable(),
	UPDATE_DATE: z.number().nullable(),
	FAC_URL: z.string(),
});
export type FrsAttrs = z.infer<typeof FrsAttrs>;

export const ArcgisLayer = z.object({
	features: z.array(z.object({ attributes: FrsAttrs })),
});

export const EnvirofactsSite = z.object({
	site_id: z.string(),
	name: z.string(),
	epa_id: z.string(),
	primary_latitude_decimal_val: z.string().nullable(),
	primary_longitude_decimal_val: z.string().nullable(),
	npl_status_name: z.string(),
	non_npl_status_name: z.string().nullable(),
	non_npl_status_date: z.string().nullable(),
	archived_ind: z.string().nullable(),
});
export type EnvirofactsSite = z.infer<typeof EnvirofactsSite>;
export const EnvirofactsResponse = z.array(EnvirofactsSite);

const CensusMatch = z.object({
	result: z.object({
		addressMatches: z.array(
			z.object({
				coordinates: z.object({ x: z.number(), y: z.number() }),
			}),
		),
	}),
});

/** The mapped point for 9311 E Ave P, from the Census fixture, as a GeoPoint with provenance. */
export function censusOrigin(): GeoPoint {
	const fetched = loadFixture("census/match-9311-e-ave-p.json", CensusMatch);
	const match = fetched.raw.result.addressMatches[0];
	if (match === undefined) throw new Error("census fixture has no match");
	const point = fieldsOf({ raw: match.coordinates, payload: fetched.payload }, "census_geocoder", CENSUS_VERSION).point(
		"y",
		"x",
		{},
	);
	if (point === null) throw new Error("census fixture coordinate is null");
	return point;
}

export function houstonLocus(): Locus {
	return { point: censusOrigin(), radiusMeters: 8047 };
}

export const SEMS_SITE_URL = "https://cumulis.epa.gov/supercpad/cursites/csitinfo.cfm?id={id}";

export const SEMS_CAVEATS: readonly string[] = [
	"A SEMS record can mean assessment, proposed action, active cleanup, or completed work.",
	"The coordinate is a reference point, not a boundary.",
];

export function frsLayer() {
	return loadFixture("sems/arcgis-5mi-houston.json", ArcgisLayer);
}

export function envirofactsFor(epaId: string): Fetched<EnvirofactsSite> | null {
	try {
		const fetched = loadFixture(`sems/envirofacts-${epaId}.json`, EnvirofactsResponse);
		const row = fetched.raw[0];
		return row === undefined ? null : { raw: row, payload: fetched.payload };
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return null;
		throw error;
	}
}

export function fieldsOfEnvirofacts(row: Fetched<EnvirofactsSite>) {
	return fieldsOf(row, "envirofacts_site", SEMS_VERSION);
}

export function frsRowFor(epaId: string): Fetched<FrsAttrs> {
	const layer = frsLayer();
	const feature = layer.raw.features.find((f) => f.attributes.PGM_SYS_ID === epaId);
	if (feature === undefined) throw new Error(`${epaId} is not in the ArcGIS fixture`);
	return { raw: feature.attributes, payload: layer.payload };
}

/** One SEMS site, the way the adapter will build it: FRS layer row joined to its Envirofacts row when one exists. */
export function semsBuilt(
	frsRow: Fetched<FrsAttrs>,
	efRow: Fetched<EnvirofactsSite> | null,
): Built<"sems-site"> {
	const frs = fieldsOf(frsRow, "frs_program_facility", SEMS_VERSION);
	const site = efRow === null ? null : fieldsOf(efRow, "envirofacts_site", SEMS_VERSION);
	const epaId = frsRow.raw.PGM_SYS_ID;
	return {
		kind: "sems-site",
		source: "sems",
		sourceRecordId: epaId,
		// The link is derived, not asserted: either the FRS layer's own URL field,
		// or the SEMS site page built from the Envirofacts site_id it interpolates.
		sourceUrl: site === null ? frs.text("FAC_URL") : urlFrom(SEMS_SITE_URL, site.text("site_id")),
		subject: coalesce(site === null ? null : site.text("name"), frs.text("PRIMARY_NAME")),
		location: frs.point("LATITUDE83", "LONGITUDE83", {
			accuracy: "ACCURACY_VALUE",
			method: "COLLECT_MTH_DESC",
			referencePoint: "REF_POINT_DESC",
		}),
		effectiveAt: site === null ? frs.absent("non_npl_status_date") : site.date("non_npl_status_date"),
		sourceUpdatedAt: frs.epochMs("UPDATE_DATE"),
		caveats: SEMS_CAVEATS,
		epaSiteId: frs.text("PGM_SYS_ID"),
		semsSiteId: site === null ? null : site.text("site_id"),
		frsRegistryId: frs.text("REGISTRY_ID"),
		frsName: frs.text("PRIMARY_NAME"),
		semsName: site === null ? null : site.text("name"),
		interestType: frs.text("INTEREST_TYPE"),
		statusRow: { status: site === null ? "no-row" : "joined" },
		semsNplStatus: site === null ? null : site.text("npl_status_name"),
		frsActiveStatus: frs.text("ACTIVE_STATUS"),
		nonNplStatus: site === null ? null : site.text("non_npl_status_name"),
		statusDate: site === null ? null : site.date("non_npl_status_date"),
		archived: site === null ? null : site.flag("archived_ind", { Y: true, N: false }),
		semsCoordinate:
			site === null ? null : site.point("primary_latitude_decimal_val", "primary_longitude_decimal_val", {}),
	};
}

export function semsRecord(locus: Locus, epaId: string): Sealed<SemsSiteRecord> {
	return complete(locus, semsBuilt(frsRowFor(epaId), envirofactsFor(epaId)));
}

export function semsId(epaId: string): RecordId<"sems-site"> {
	return recordId("sems-site", epaId);
}

/** Every SEMS record in the 5-mile fixture, joined to Envirofacts where a fixture exists. */
export function semsStore(locus: Locus): EvidenceStore {
	const layer = frsLayer();
	return storeOf(
		layer.raw.features.map((feature) =>
			complete(
				locus,
				semsBuilt({ raw: feature.attributes, payload: layer.payload }, envirofactsFor(feature.attributes.PGM_SYS_ID)),
			),
		),
	);
}

export const NEAREST_EPA_ID = "TXN000622182";
