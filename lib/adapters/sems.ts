import { z } from "zod";
import type {
	Adapter,
	AdapterVersion,
	Built,
	Fetched,
	Locus,
	SourceIo,
	SourceUnavailable,
	StatusRowOutcome,
} from "@/lib/evidence";
import { coalesce, fieldsOf, SourceFailure, unavailableOf, urlFrom } from "@/lib/evidence";

export const SEMS_VERSION: AdapterVersion = "sems@1";

const FRS_DATASET = "frs_program_facility";
const ENVIROFACTS_DATASET = "envirofacts_site";

const LAYER_URL =
	"https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/FRS_INTERESTS_SEMS/FeatureServer/0/query";
const ENVIROFACTS_URL = "https://data.epa.gov/efservice/envirofacts_site/epa_id";

export const SEMS_SITE_URL = "https://cumulis.epa.gov/supercpad/cursites/csitinfo.cfm?id={id}";

export const SEMS_CAVEATS: readonly string[] = [
	"A SEMS record can mean assessment, proposed action, active cleanup, or completed work.",
	"The coordinate is a reference point, not a boundary.",
];

export const STATUS_CONCURRENCY = 4;

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
	archived_date: z.string().nullable(),
});
type EnvirofactsSite = z.infer<typeof EnvirofactsSite>;

const EnvirofactsRows = z.array(EnvirofactsSite);

export type StatusAnswer =
	| { readonly status: "joined"; readonly row: Fetched<EnvirofactsSite> }
	| { readonly status: "no-row" }
	| SourceUnavailable;

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

function statusRowOf(answer: StatusAnswer): StatusRowOutcome {
	switch (answer.status) {
		case "joined":
			return { status: "joined" };
		case "no-row":
			return { status: "no-row" };
		case "unavailable":
			return answer;
	}
}

export function semsSite(frsRow: Fetched<FrsAttrs>, answer: StatusAnswer): Built<"sems-site"> {
	const frs = fieldsOf(frsRow, FRS_DATASET, SEMS_VERSION);
	const site = answer.status === "joined" ? fieldsOf(answer.row, ENVIROFACTS_DATASET, SEMS_VERSION) : null;
	return {
		kind: "sems-site",
		source: "sems",
		sourceRecordId: frsRow.raw.PGM_SYS_ID,
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
		statusRow: statusRowOf(answer),
		semsNplStatus: site === null ? null : site.text("npl_status_name"),
		frsActiveStatus: frs.text("ACTIVE_STATUS"),
		nonNplStatus: site === null ? null : site.text("non_npl_status_name"),
		statusDate: site === null ? null : site.date("non_npl_status_date"),
		archived: site === null ? null : site.flag("archived_ind", { Y: true, N: false }),
		archivedLabel: site === null ? null : site.map("archived_ind", { Y: "archived" }),
		archivedDate: site === null ? null : site.date("archived_date"),
		semsCoordinate:
			site === null ? null : site.point("primary_latitude_decimal_val", "primary_longitude_decimal_val", {}),
	};
}

async function statusFor(io: SourceIo, epaId: string): Promise<StatusAnswer> {
	try {
		const fetched = await io.get(statusUrl(epaId), EnvirofactsRows);
		const row = fetched.raw[0];
		return row === undefined ? { status: "no-row" } : { status: "joined", row: { raw: row, payload: fetched.payload } };
	} catch (error) {
		return unavailableOf(error);
	}
}

async function statusRows(io: SourceIo, epaIds: readonly string[]): Promise<ReadonlyMap<string, StatusAnswer>> {
	const answers = new Map<string, StatusAnswer>();
	const queue = [...epaIds];
	const worker = async (): Promise<void> => {
		for (let epaId = queue.shift(); epaId !== undefined; epaId = queue.shift()) {
			answers.set(epaId, await statusFor(io, epaId));
		}
	};
	await Promise.all(Array.from({ length: Math.min(STATUS_CONCURRENCY, queue.length) }, worker));
	return answers;
}

async function run(locus: Locus, io: SourceIo): Promise<readonly Built<"sems-site">[]> {
	const layer = await io.get(layerUrl(locus), ArcgisResponse);
	const body = layer.raw;
	if ("error" in body) throw new SourceFailure("http", body.error.code);
	const features = body.features;
	const answers = await statusRows(io, [...new Set(features.map((feature) => feature.attributes.PGM_SYS_ID))]);
	return features.map((feature) =>
		semsSite(
			{ raw: feature.attributes, payload: layer.payload },
			answers.get(feature.attributes.PGM_SYS_ID) ?? { status: "no-row" },
		),
	);
}

export const semsAdapter: Adapter<"sems-site"> = {
	kind: "sems-site",
	source: "sems",
	version: SEMS_VERSION,
	run,
};

export type { EnvirofactsSite, FrsAttrs };
