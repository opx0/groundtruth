/**
 * FEMA flood zone at the mapped point. Server-only.
 *
 * One record kind, two datasets, and the difference between them is a
 * correctness problem rather than a fallback detail.
 *
 * The authoritative source is FEMA's National Flood Hazard Layer (NFHL), layer
 * 28, S_Fld_Haz_Ar. It holds every mapped polygon, including unshaded zone X,
 * which FEMA uses to mean "mapped, and minimal hazard". An empty answer from
 * it therefore means something close to "not mapped". Its host refuses
 * connections from outside the US, so no response from it has been recorded.
 * The parse below follows FEMA's published field names and is unverified
 * against real bytes; every record it produces says so in its caveats.
 *
 * The fallback is Esri's reduced-set redistribution of the same layer. Same
 * field names, reachable, fixtured, and missing unshaded zone X entirely. An
 * empty answer from it is ambiguous between "minimal hazard" and "never
 * mapped". docs/BRIEF.md B10 gives the two datasets deliberately different
 * no-polygon wordings, and the product must never show the NFHL sentence for
 * an Esri result.
 *
 * So this module never blends the two. Each dataset is its own `Adapter`, so a
 * caller that runs one knows which one answered. Each adapter declares its
 * dataset's B10 wording as its `noDataNote`, so the kernel's no-data outcome
 * already says which dataset answered empty. `floodZoneOutcome` runs NFHL
 * first, falls back to Esri only when NFHL is unavailable (never when NFHL
 * answers empty), and returns the dataset beside the outcome. Every record
 * carries the dataset as a `Sourced` field whose provenance is the request we
 * made.
 *
 * No type assertions, no non-null assertions, no `any`. Lint enforces it.
 */

import { z } from "zod";
import type {
	Adapter,
	AdapterVersion,
	Built,
	Fetched,
	Locus,
	QueryProvenance,
	SourceIo,
	SourceOutcome,
	SourcePolicy,
	SourceUnavailable,
} from "@/lib/evidence";
import { DEFAULT_POLICY, fieldsOf, fromQuery, runSource, SourceFailure, urlFrom } from "@/lib/evidence";

export type FemaDataset = "NFHL" | "ESRI_REDUCED_SET";

export const FEMA_VERSION: AdapterVersion = "fema@1";

/** The fields both layers share. STATIC_BFE is requested and validated but has no record field yet. */
const OUT_FIELDS = "FLD_ZONE,ZONE_SUBTY,SFHA_TF,DFIRM_ID,FLD_AR_ID,STATIC_BFE,SOURCE_CIT";

const POINT_CAVEAT = "The mapped point is a street-segment interpolation, not the parcel boundary.";

type DatasetSpec = {
	/** The layer's REST URL, without `/query`. */
	readonly layer: string;
	/** The `dataset` string stamped on every field's provenance. */
	readonly provenanceName: string;
	/** docs/BRIEF.md B10, verbatim. The two differ on purpose. */
	readonly noPolygonNote: string;
	readonly caveats: readonly string[];
};

export const FEMA_DATASETS: { readonly [D in FemaDataset]: DatasetSpec } = {
	NFHL: {
		layer: "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28",
		provenanceName: "nfhl_s_fld_haz_ar",
		noPolygonNote: "No digital FEMA designation was available at this point.",
		caveats: [
			"Read from FEMA's National Flood Hazard Layer, the authoritative source.",
			"No response from this layer has been recorded yet. The parse follows FEMA's published field names and is unverified against real bytes.",
			POINT_CAVEAT,
		],
	},
	ESRI_REDUCED_SET: {
		layer:
			"https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Flood_Hazard_Reduced_Set_gdb/FeatureServer/0",
		provenanceName: "esri_usa_flood_hazard_reduced_set",
		noPolygonNote:
			"No 1% or 0.2% flood hazard polygon intersects this point in the Esri copy of FEMA's layer, dated 2026-03-11. This copy omits minimal-hazard areas, so it cannot tell minimal hazard from an unmapped area.",
		caveats: [
			"Read from Esri's reduced-set copy of FEMA's National Flood Hazard Layer, dated 2026-03-11, not from FEMA's own service.",
			POINT_CAVEAT,
		],
	},
};

/** The layer's own REST page for one flood area, keyed by FEMA's primary key for S_Fld_Haz_Ar. */
function recordUrlTemplate(dataset: FemaDataset): string {
	return `${FEMA_DATASETS[dataset].layer}/query?where=FLD_AR_ID%3D%27{id}%27&outFields=*&f=html`;
}

/**
 * Point intersection. The URL carries the coordinate and nothing else about
 * the person; it becomes the payload's `url` in the trace.
 */
export function floodZoneQueryUrl(dataset: FemaDataset, locus: Locus): URL {
	const url = new URL(`${FEMA_DATASETS[dataset].layer}/query`);
	url.searchParams.set("geometry", `${locus.point.longitude.value},${locus.point.latitude.value}`);
	url.searchParams.set("geometryType", "esriGeometryPoint");
	url.searchParams.set("inSR", "4326");
	url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
	url.searchParams.set("outFields", OUT_FIELDS);
	url.searchParams.set("returnGeometry", "false");
	url.searchParams.set("f", "json");
	return url;
}

/**
 * One S_Fld_Haz_Ar row. Zone and subtype are `z.string()`, never an enum: a
 * zone code this file has never seen reaches the screen unchanged. SFHA_TF is
 * the letter "T" or "F", not a boolean. FLD_AR_ID is the table's primary key
 * and is the one field required to be present; every other string is nullable
 * because ArcGIS declares every string nullable and the fixtures prove it.
 */
export const FloodAreaAttrs = z.object({
	FLD_ZONE: z.string(),
	ZONE_SUBTY: z.string().nullable(),
	SFHA_TF: z.string().nullable(),
	DFIRM_ID: z.string().nullable(),
	FLD_AR_ID: z.string(),
	STATIC_BFE: z.number().nullable(),
	SOURCE_CIT: z.string().nullable(),
});
export type FloodAreaAttrs = z.infer<typeof FloodAreaAttrs>;

/** ArcGIS delivers a failed query as HTTP 200 with an `error` object. The body is checked, not the status. */
const ArcgisError = z.object({
	error: z.object({ code: z.number(), message: z.string() }),
});

const ArcgisFeatures = z.object({
	features: z.array(z.object({ attributes: FloodAreaAttrs })),
});

export const ArcgisQueryBody = z.union([ArcgisError, ArcgisFeatures]);

/**
 * One record from one row. `service` is the provenance of the request that
 * produced the row, so the `dataset` field traces to the endpoint we chose
 * rather than to a value the adapter typed in.
 */
export function floodZoneBuilt(
	row: Fetched<FloodAreaAttrs>,
	dataset: FemaDataset,
	service: QueryProvenance,
): Built<"fema-flood-zone"> {
	const spec = FEMA_DATASETS[dataset];
	const fields = fieldsOf(row, spec.provenanceName, FEMA_VERSION);
	return {
		kind: "fema-flood-zone",
		source: "fema",
		sourceRecordId: row.raw.FLD_AR_ID,
		sourceUrl: urlFrom(recordUrlTemplate(dataset), fields.text("FLD_AR_ID")),
		subject: fields.text("FLD_ZONE"),
		// A polygon has no point of its own; it contains the locus. Distance would be zero by construction, so none is claimed.
		location: null,
		// The FIRM effective date lives on the panel layer, not on S_Fld_Haz_Ar, and neither layer exposes an update date here.
		effectiveAt: fields.absent("EFF_DATE"),
		sourceUpdatedAt: fields.absent("UPDATE_DATE"),
		caveats: spec.caveats,
		dataset: fromQuery(service, dataset),
		zoneCode: fields.text("FLD_ZONE"),
		zoneSubtype: fields.text("ZONE_SUBTY"),
		specialFloodHazardArea: fields.flag("SFHA_TF", { T: true, F: false }),
		firmPanelId: fields.text("DFIRM_ID"),
		floodAreaId: fields.text("FLD_AR_ID"),
		sourceCitation: fields.text("SOURCE_CIT"),
	};
}

export type FemaAdapter = Adapter<"fema-flood-zone"> & { readonly dataset: FemaDataset };

/** One adapter per dataset, so whoever runs it knows which dataset answered, including when the answer is empty. */
export function femaAdapter(dataset: FemaDataset): FemaAdapter {
	const spec = FEMA_DATASETS[dataset];
	return {
		kind: "fema-flood-zone",
		source: "fema",
		version: FEMA_VERSION,
		dataset,
		noDataNote: spec.noPolygonNote,
		async run(locus: Locus, io: SourceIo): Promise<readonly Built<"fema-flood-zone">[]> {
			const fetched = await io.get(floodZoneQueryUrl(dataset, locus), ArcgisQueryBody);
			const body = fetched.raw;
			if ("error" in body) throw new SourceFailure("http", body.error.code);
			const service = io.query("service", `${spec.layer}/query`, FEMA_VERSION, fetched.payload);
			return body.features.map((feature) =>
				floodZoneBuilt({ raw: feature.attributes, payload: fetched.payload }, dataset, service),
			);
		},
	};
}

export const nfhlAdapter: FemaAdapter = femaAdapter("NFHL");
export const esriReducedSetAdapter: FemaAdapter = femaAdapter("ESRI_REDUCED_SET");

export type FloodZoneResult = {
	/** Which dataset produced `outcome`. Present on every status, so an empty answer is never anonymous. */
	readonly dataset: FemaDataset;
	/** A no-data outcome carries the dataset's own B10 wording, declared on the adapter that answered. */
	readonly outcome: SourceOutcome<"fema-flood-zone">;
	/** The NFHL failure that forced the fallback. Null when NFHL itself answered, with or without a polygon. */
	readonly nfhl: SourceUnavailable | null;
};

/**
 * NFHL first. Esri only when NFHL is unavailable. An empty NFHL answer is an
 * answer, and is never retried against the copy that cannot distinguish it.
 */
export async function floodZoneOutcome(
	locus: Locus,
	io: SourceIo,
	policy: SourcePolicy = DEFAULT_POLICY,
): Promise<FloodZoneResult> {
	const nfhl = await runSource(locus, nfhlAdapter, io, policy);
	if (nfhl.status !== "unavailable") {
		return { dataset: "NFHL", outcome: nfhl, nfhl: null };
	}
	const esri = await runSource(locus, esriReducedSetAdapter, io, policy);
	return { dataset: "ESRI_REDUCED_SET", outcome: esri, nfhl };
}
