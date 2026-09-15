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
 * connections from outside the US; on 2026-09-17 a host inside the US asked it
 * and it answered, for the first time in this project's life, and the two
 * point responses are recorded in `tests/fixtures/fema/`. The parse below was
 * written from FEMA's published field names before either of them existed and
 * reads both rows with no change, so no record it produces calls itself a
 * guess any more. The egress block is unchanged and is a fact about where this
 * process runs rather than about the parse: from a machine that cannot reach
 * the layer, the flood card still says the authoritative attempt failed and
 * that the copy below answered in its place.
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
	/**
	 * What the card says answered. The enum is a machine identifier and
	 * telling a reader "ESRI_REDUCED_SET" tells them nothing; worse, the
	 * other clauses on the flood card attribute their values to FEMA, and
	 * for this dataset that is Esri's copy rather than FEMA's own service.
	 */
	readonly label: string;
	/** docs/BRIEF.md B10, verbatim. The two differ on purpose. */
	readonly noPolygonNote: string;
	readonly caveats: readonly string[];
};

export const FEMA_DATASETS: { readonly [D in FemaDataset]: DatasetSpec } = {
	NFHL: {
		layer: "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28",
		provenanceName: "nfhl_s_fld_haz_ar",
		label: "FEMA's National Flood Hazard Layer",
		// B10's wording, prefixed with the dataset that answered: B12 requires a
		// no-polygon state to name its dataset, and a no-data note is the only
		// place a `section` subject can carry it.
		noPolygonNote:
			"FEMA's own National Flood Hazard Layer answered with no polygon. No digital FEMA designation was available at this point.",
		// A second caveat stood between these two until 2026-09-17 and is gone.
		// It said no response from this layer had been recorded yet and that
		// the parse was unverified against real bytes. One has now been
		// recorded: `hazards.fema.gov` resets the connection from this machine
		// and from `asia-southeast1`, and answered HTTP 200 in 0.26 s from
		// `us-central1`, so the refusal is on egress and not on the request.
		// `tests/fixtures/fema/nfhl-minimal-hazard.json` and
		// `nfhl-zone-ae-pasadena.json` are what it sent.
		//
		// Printing the hedge on every card is what made the trip worth taking,
		// and unlike the air sources this bet came in: `FloodAreaAttrs` parses
		// both real rows unchanged, where the same exercise against AQS on
		// 2026-09-16 falsified three of thirteen column names. Leaving the
		// caveat in place now would tell a reader that bytes nobody had seen
		// stood behind their flood zone, and two of them have been seen.
		//
		// What is still true is that this deployment may be unable to reach the
		// layer at all, and that is said where it belongs: `floodZoneOutcome`
		// falls back to Esri's copy and the card carries the failed attempt.
		caveats: [
			"Read from FEMA's National Flood Hazard Layer, the authoritative source.",
			POINT_CAVEAT,
		],
	},
	ESRI_REDUCED_SET: {
		layer:
			"https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Flood_Hazard_Reduced_Set_gdb/FeatureServer/0",
		provenanceName: "esri_usa_flood_hazard_reduced_set",
		// No date here, deliberately. `datasetLabel` is a `fromQuery` value and
		// its provenance is the layer URL we requested, which states which
		// service answered and nothing about the vintage of its contents. The
		// 2026-03-11 date was checked against Esri's item page out of band on
		// 2026-09-15, not read from any response this code parses, so a clause
		// printing it would hand the reader a trace that does not support it
		// and would go stale silently when Esri republishes. It stays in the
		// caveats, which are disclosures rather than clickable values, and in
		// the B10 no-polygon note, whose wording docs/BRIEF.md fixes verbatim.
		label: "Esri's reduced-set copy of FEMA's National Flood Hazard Layer",
		noPolygonNote:
			"No 1% or 0.2% flood hazard polygon intersects this point in the Esri copy of FEMA's layer, dated 2026-03-11. This copy omits minimal-hazard areas, so it cannot tell minimal hazard from an unmapped area.",
		caveats: [
			"Read from Esri's reduced-set copy of FEMA's National Flood Hazard Layer, not from FEMA's own service. Esri's item page gave 2026-03-11 as the copy's date when it was checked on 2026-09-15; no response this adapter parses states it.",
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
		datasetLabel: fromQuery(service, spec.label),
		zoneCode: fields.text("FLD_ZONE"),
		zoneSubtype: fields.text("ZONE_SUBTY"),
		specialFloodHazardArea: fields.flag("SFHA_TF", { T: true, F: false }),
		// The same column read twice: a boolean for filters and template
		// requirements, and the words FEMA's field description gives the
		// letters, because the phrase on the card has to be a value with a
		// trace rather than connective text.
		sfhaLabel: fields.map("SFHA_TF", {
			T: "inside the Special Flood Hazard Area",
			F: "outside the Special Flood Hazard Area",
		}),
		// And a third read, verbatim: B10 shows an unknown status as sent.
		sfhaFlag: fields.text("SFHA_TF"),
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
