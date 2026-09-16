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

const OUT_FIELDS = "FLD_ZONE,ZONE_SUBTY,SFHA_TF,DFIRM_ID,FLD_AR_ID,STATIC_BFE,SOURCE_CIT";

const POINT_CAVEAT = "The mapped point is a street-segment interpolation, not the parcel boundary.";

type DatasetSpec = {
	readonly layer: string;
	readonly provenanceName: string;
	readonly label: string;
	readonly noPolygonNote: string;
	readonly caveats: readonly string[];
};

export const FEMA_DATASETS: { readonly [D in FemaDataset]: DatasetSpec } = {
	NFHL: {
		layer: "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28",
		provenanceName: "nfhl_s_fld_haz_ar",
		label: "FEMA's National Flood Hazard Layer",
		noPolygonNote:
			"FEMA's own National Flood Hazard Layer answered with no polygon. No digital FEMA designation was available at this point.",
		caveats: [
			"Read from FEMA's National Flood Hazard Layer, the authoritative source.",
			POINT_CAVEAT,
		],
	},
	ESRI_REDUCED_SET: {
		layer:
			"https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Flood_Hazard_Reduced_Set_gdb/FeatureServer/0",
		provenanceName: "esri_usa_flood_hazard_reduced_set",
		label: "Esri's reduced-set copy of FEMA's National Flood Hazard Layer",
		noPolygonNote:
			"No 1% or 0.2% flood hazard polygon intersects this point in the Esri copy of FEMA's layer, dated 2026-03-11. This copy omits minimal-hazard areas, so it cannot tell minimal hazard from an unmapped area.",
		caveats: [
			"Read from Esri's reduced-set copy of FEMA's National Flood Hazard Layer, not from FEMA's own service. Esri's item page gave 2026-03-11 as the copy's date when it was checked on 2026-09-15; no response this adapter parses states it.",
			POINT_CAVEAT,
		],
	},
};

function recordUrlTemplate(dataset: FemaDataset): string {
	return `${FEMA_DATASETS[dataset].layer}/query?where=FLD_AR_ID%3D%27{id}%27&outFields=*&f=html`;
}

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
		location: null,
		effectiveAt: fields.absent("EFF_DATE"),
		sourceUpdatedAt: fields.absent("UPDATE_DATE"),
		caveats: spec.caveats,
		dataset: fromQuery(service, dataset),
		datasetLabel: fromQuery(service, spec.label),
		zoneCode: fields.text("FLD_ZONE"),
		zoneSubtype: fields.text("ZONE_SUBTY"),
		specialFloodHazardArea: fields.flag("SFHA_TF", { T: true, F: false }),
		sfhaLabel: fields.map("SFHA_TF", {
			T: "inside the Special Flood Hazard Area",
			F: "outside the Special Flood Hazard Area",
		}),
		sfhaFlag: fields.text("SFHA_TF"),
		firmStudyId: fields.text("DFIRM_ID"),
		floodAreaId: fields.text("FLD_AR_ID"),
		sourceCitation: fields.text("SOURCE_CIT"),
	};
}

export type FemaAdapter = Adapter<"fema-flood-zone"> & { readonly dataset: FemaDataset };

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
	readonly dataset: FemaDataset;
	readonly outcome: SourceOutcome<"fema-flood-zone">;
	readonly nfhl: SourceUnavailable | null;
};

const NFHL_BUDGET_SHARE = 0.4;

export function nfhlPolicy(policy: SourcePolicy): SourcePolicy {
	return { ...policy, timeoutMs: Math.round(policy.timeoutMs * NFHL_BUDGET_SHARE) };
}

// hazards.fema.gov refuses connections from outside the US, so on a non-US
// host the authoritative leg always fails and Esri's copy answers instead.
export async function floodZoneOutcome(
	locus: Locus,
	io: SourceIo,
	policy: SourcePolicy = DEFAULT_POLICY,
	signal?: AbortSignal,
): Promise<FloodZoneResult> {
	const nfhl = await runSource(locus, nfhlAdapter, io, nfhlPolicy(policy), signal);
	if (nfhl.status !== "unavailable") {
		return { dataset: "NFHL", outcome: nfhl, nfhl: null };
	}
	if (nfhl.cause === "cancelled") {
		return { dataset: "NFHL", outcome: nfhl, nfhl: null };
	}
	const esri = await runSource(locus, esriReducedSetAdapter, io, policy, signal);
	return { dataset: "ESRI_REDUCED_SET", outcome: esri, nfhl };
}
