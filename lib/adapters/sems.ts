/**
 * EPA Superfund (SEMS), which is two endpoints joined.
 *
 * There is no radius query over the Superfund inventory itself, so the search
 * runs against the FRS `FRS_INTERESTS_SEMS` ArcGIS layer, and each site found
 * there is joined to its Envirofacts `envirofacts_site` row by EPA site ID.
 *
 * The two systems are two agencies' views of one site and they disagree in
 * three ways this adapter is careful never to paper over:
 *
 *   - The names differ. `HOUSTON REFINERY` in FRS is `VALERO PLUME` in
 *     Envirofacts. `subject` coalesces the Superfund name over the registry
 *     name, so the trace carries both and neither is lost.
 *   - The statuses differ, in vocabulary as well as value. FRS `ACTIVE_STATUS`
 *     and Envirofacts `npl_status_name` land in separate fields and one is
 *     never a stand-in for the other. Both are passed through verbatim; a
 *     status string this code has never seen reaches the screen unchanged.
 *   - The coordinates differ, and sometimes one of them is null. `location`,
 *     which is what the kernel measures the distance from, is always the FRS
 *     coordinate; the Envirofacts coordinate stays visible as
 *     `semsCoordinate` rather than being reconciled away.
 *
 * A site with no Envirofacts row at all is a real and common case (the call
 * answers `[]`). Such a record keeps every Superfund-side field null, which is
 * what `sems-site/registry-only@1` prints, and is distinct from a status the
 * inventory failed to answer for: if the join call fails, this adapter fails
 * the whole source rather than let a fetch error pose as "no status row".
 */

import { z } from "zod";
import type { Adapter, AdapterVersion, Built, Fetched, Locus, SourceIo } from "@/lib/evidence";
import { coalesce, fieldsOf, SourceFailure, urlFrom } from "@/lib/evidence";

export const SEMS_VERSION: AdapterVersion = "sems@1";

const FRS_DATASET = "frs_program_facility";
const ENVIROFACTS_DATASET = "envirofacts_site";

const LAYER_URL =
	"https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/FRS_INTERESTS_SEMS/FeatureServer/0/query";
const ENVIROFACTS_URL = "https://data.epa.gov/efservice/envirofacts_site/epa_id";

/** The public profile page for a site, keyed by the Envirofacts site ID, not the EPA ID. */
export const SEMS_SITE_URL = "https://cumulis.epa.gov/supercpad/cursites/csitinfo.cfm?id={id}";

export const SEMS_CAVEATS: readonly string[] = [
	"A SEMS record can mean assessment, proposed action, active cleanup, or completed work.",
	"The coordinate is a reference point, not a boundary.",
];

/**
 * Status and interest fields are `z.string()`, never `z.enum()`. The inventory
 * answers in sentences ("NFRAP-Site does not qualify for the NPL based on
 * existing information") and adds new ones without telling us.
 */
const FrsAttrs = z.object({
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
type FrsAttrs = z.infer<typeof FrsAttrs>;

const ArcgisLayer = z.object({
	features: z.array(z.object({ attributes: FrsAttrs })),
});

/** ArcGIS answers a failed query with HTTP 200 and this body, so the status code proves nothing. */
const ArcgisError = z.object({
	error: z.object({ code: z.number(), message: z.string() }),
});

const ArcgisResponse = z.union([ArcgisError, ArcgisLayer]);

const EnvirofactsSite = z.object({
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
type EnvirofactsSite = z.infer<typeof EnvirofactsSite>;

/**
 * Envirofacts answers with a top-level JSON array, which `SourceIo.get` cannot
 * name because its raw type is a `JsonObject`. The rows are wrapped into one
 * during validation; the payload is still hashed over the bytes as sent.
 */
const EnvirofactsRows: z.ZodType<{ readonly rows: readonly EnvirofactsSite[] }> = z
	.array(EnvirofactsSite)
	.transform((rows) => ({ rows }));

export function layerUrl(locus: Locus): URL {
	const url = new URL(LAYER_URL);
	url.searchParams.set("geometry", `${locus.point.longitude.value},${locus.point.latitude.value}`);
	url.searchParams.set("geometryType", "esriGeometryPoint");
	url.searchParams.set("inSR", "4326");
	url.searchParams.set("distance", String(locus.radiusMeters));
	url.searchParams.set("units", "esriSRUnit_Meter");
	url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
	url.searchParams.set("outFields", "*");
	url.searchParams.set("returnGeometry", "false");
	url.searchParams.set("f", "json");
	return url;
}

export function statusUrl(epaId: string): URL {
	return new URL(`${ENVIROFACTS_URL}/${encodeURIComponent(epaId)}/JSON`);
}

/**
 * One SEMS site: the FRS layer row, joined to its Envirofacts row when the
 * inventory has one. Every value is read through a kernel reader, so the two
 * payloads and the two dataset names stay attached to the fields they fed.
 */
export function semsSite(
	frsRow: Fetched<FrsAttrs>,
	efRow: Fetched<EnvirofactsSite> | null,
): Built<"sems-site"> {
	const frs = fieldsOf(frsRow, FRS_DATASET, SEMS_VERSION);
	const site = efRow === null ? null : fieldsOf(efRow, ENVIROFACTS_DATASET, SEMS_VERSION);
	return {
		kind: "sems-site",
		source: "sems",
		sourceRecordId: frsRow.raw.PGM_SYS_ID,
		// Derived, never asserted: the SEMS profile page when Envirofacts gave us
		// the site ID it interpolates, and the layer's own registry link otherwise.
		sourceUrl: site === null ? frs.text("FAC_URL") : urlFrom(SEMS_SITE_URL, site.text("site_id")),
		subject: coalesce(site === null ? null : site.text("name"), frs.text("PRIMARY_NAME")),
		// The FRS coordinate, always: it is the one the radius search matched on.
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
		semsNplStatus: site === null ? null : site.text("npl_status_name"),
		frsActiveStatus: frs.text("ACTIVE_STATUS"),
		nonNplStatus: site === null ? null : site.text("non_npl_status_name"),
		statusDate: site === null ? null : site.date("non_npl_status_date"),
		archived: site === null ? null : site.flag("archived_ind", { Y: true, N: false }),
		// Kept beside the FRS one, never merged with it: the two systems place
		// some sites kilometres apart and that disagreement is the fact.
		semsCoordinate:
			site === null ? null : site.point("primary_latitude_decimal_val", "primary_longitude_decimal_val", {}),
	};
}

async function statusFor(io: SourceIo, epaId: string): Promise<Fetched<EnvirofactsSite> | null> {
	const fetched = await io.get(statusUrl(epaId), EnvirofactsRows);
	const row = fetched.raw.rows[0];
	// An empty array is the inventory saying it holds no row for this EPA ID.
	return row === undefined ? null : { raw: row, payload: fetched.payload };
}

async function run(locus: Locus, io: SourceIo): Promise<readonly Built<"sems-site">[]> {
	const layer = await io.get(layerUrl(locus), ArcgisResponse);
	const body = layer.raw;
	if ("error" in body) throw new SourceFailure("http", body.error.code);
	// No features is no-data, which `runSource` reads off an empty return. It is
	// not a failure and must never be reported as one.
	const features = body.features;
	const rows = new Map<string, Fetched<EnvirofactsSite> | null>();
	const epaIds = [...new Set(features.map((feature) => feature.attributes.PGM_SYS_ID))];
	await Promise.all(
		epaIds.map(async (epaId) => {
			rows.set(epaId, await statusFor(io, epaId));
		}),
	);
	return features.map((feature) =>
		semsSite({ raw: feature.attributes, payload: layer.payload }, rows.get(feature.attributes.PGM_SYS_ID) ?? null),
	);
}

export const semsAdapter: Adapter<"sems-site"> = {
	kind: "sems-site",
	source: "sems",
	version: SEMS_VERSION,
	run,
};

export type { EnvirofactsSite, FrsAttrs };
