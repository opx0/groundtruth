/**
 * EPA Superfund (SEMS), which is two endpoints joined.
 *
 * There is no radius query over the Superfund inventory itself, so the search
 * runs against the FRS `FRS_INTERESTS_SEMS` ArcGIS layer, and each site found
 * there is joined to its Envirofacts `envirofacts_site` row by EPA site ID.
 *
 * The two systems are two agencies' views of one site and they disagree in two
 * ways this adapter is careful never to paper over:
 *
 *   - The names differ. `HOUSTON REFINERY` in FRS is `VALERO PLUME` in
 *     Envirofacts. `subject` coalesces the Superfund name over the registry
 *     name, so the trace carries both and neither is lost.
 *   - The coordinates differ, and sometimes one of them is null. `location`,
 *     which is what the kernel measures the distance from, is always the FRS
 *     coordinate; the Envirofacts coordinate stays visible as
 *     `semsCoordinate` rather than being reconciled away.
 *
 * THE STATUSES ARE NOT THE THIRD OF THOSE, and this comment said they were
 * until 2026-09-16: "the statuses differ, in vocabulary as well as value". They
 * do not. `lib/evidence/records.ts` corrects it on `frsActiveStatus` by name and
 * by date, and the committed bytes settle it — on all fifteen sites of
 * `tests/fixtures/sems/arcgis-5mi-houston.json`, FRS `ACTIVE_STATUS` is that
 * site's Envirofacts `npl_status_name` upper-cased, differing on none. The FRS
 * layer's own field description calls `ACTIVE_STATUS` "the status of the
 * environmental interest at the facility or site", and the interest on every
 * row of `FRS_INTERESTS_SEMS` is Superfund, so it is not a second agency's
 * vocabulary for the same thing. `sems-site/disagreement@1` was deleted for
 * this, and a template that prints the FRS status must say whose interest it is
 * the status of.
 *
 * What stays true is narrower: the two land in separate fields and neither
 * fills the other. `frsActiveStatus` survives a failed Envirofacts join and
 * `semsNplStatus` does not, which is the whole reason they are two fields.
 * Both are passed through verbatim; a status string this code has never seen
 * reaches the screen unchanged.
 *
 * A site with no Envirofacts row at all is rare rather than common, which this
 * comment also had backwards until 2026-09-16 — `docs/BRIEF.md` B14 and
 * `tests/fixtures/README.md` were both written as corrections of the word
 * "common", and both record 15 of 15 Houston sites having a row. It is still a
 * real case (the call answers `[]`, which
 * `tests/fixtures/sems/envirofacts-no-row.json` holds). Such a record keeps
 * every Superfund-side field null, which is what `sems-site/registry-only@1`
 * prints. That is a different fact from a status the inventory could not be
 * asked for, and the record's `statusRow` keeps the two apart: `no-row` when
 * the inventory answered empty, `unavailable` with the kernel's own
 * classification when the request failed. One failed join therefore costs one
 * site its status, never the other fourteen their records, and never lets a
 * fetch error pose as "no status row".
 *
 * The status joins run at most `STATUS_CONCURRENCY` at a time. Fifteen sites
 * in the demo radius would otherwise be fifteen simultaneous requests to one
 * government endpoint per report.
 */

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

/** The public profile page for a site, keyed by the Envirofacts site ID, not the EPA ID. */
export const SEMS_SITE_URL = "https://cumulis.epa.gov/supercpad/cursites/csitinfo.cfm?id={id}";

export const SEMS_CAVEATS: readonly string[] = [
	"A SEMS record can mean assessment, proposed action, active cleanup, or completed work.",
	"The coordinate is a reference point, not a boundary.",
];

/** How many Envirofacts status requests may be in flight at once for one report. */
export const STATUS_CONCURRENCY = 4;

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
	// Read for the first time in this pass. Every recorded Envirofacts row
	// carries the column, and on the archived fixture it is twelve years later
	// than `non_npl_status_date`, which is the whole reason the card shows it.
	archived_date: z.string().nullable(),
});
type EnvirofactsSite = z.infer<typeof EnvirofactsSite>;

/** Envirofacts answers with a top-level JSON array: zero rows or one, for an EPA ID. */
const EnvirofactsRows = z.array(EnvirofactsSite);

/**
 * What one status request produced: the row, no row, or the failure that
 * stopped us finding out. Only the middle one means the inventory holds
 * nothing for the site.
 */
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

/** The record's join state, which carries the failure verbatim and nothing else. */
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

/**
 * One SEMS site: the FRS layer row, joined to its Envirofacts row when the
 * inventory has one. Every value is read through a kernel reader, so the two
 * payloads and the two dataset names stay attached to the fields they fed.
 * Whether the join happened, found nothing, or failed is `statusRow`; the
 * Envirofacts-side fields are null in the last two cases alike, and only
 * `statusRow` says which.
 */
export function semsSite(frsRow: Fetched<FrsAttrs>, answer: StatusAnswer): Built<"sems-site"> {
	const frs = fieldsOf(frsRow, FRS_DATASET, SEMS_VERSION);
	const site = answer.status === "joined" ? fieldsOf(answer.row, ENVIROFACTS_DATASET, SEMS_VERSION) : null;
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
		statusRow: statusRowOf(answer),
		semsNplStatus: site === null ? null : site.text("npl_status_name"),
		frsActiveStatus: frs.text("ACTIVE_STATUS"),
		nonNplStatus: site === null ? null : site.text("non_npl_status_name"),
		statusDate: site === null ? null : site.date("non_npl_status_date"),
		archived: site === null ? null : site.flag("archived_ind", { Y: true, N: false }),
		// The same column read a second time, as words, because a boolean cannot
		// be printed -- `lib/adapters/fema.ts` reads `SFHA_TF` twice for exactly
		// this. `Y` alone is mapped: `N` and anything else leave this null, and
		// `lib/templates/sems.ts` argues why an unarchived site says nothing
		// rather than saying "not archived".
		archivedLabel: site === null ? null : site.map("archived_ind", { Y: "archived" }),
		archivedDate: site === null ? null : site.date("archived_date"),
		// Kept beside the FRS one, never merged with it: the two systems place
		// some sites kilometres apart and that disagreement is the fact.
		semsCoordinate:
			site === null ? null : site.point("primary_latitude_decimal_val", "primary_longitude_decimal_val", {}),
	};
}

/**
 * One status request. A failure is classified by the kernel, exactly as a
 * failed source would be, and returned rather than thrown: it belongs to this
 * site, not to the source.
 */
async function statusFor(io: SourceIo, epaId: string): Promise<StatusAnswer> {
	try {
		const fetched = await io.get(statusUrl(epaId), EnvirofactsRows);
		const row = fetched.raw[0];
		// An empty array is the inventory saying it holds no row for this EPA ID.
		return row === undefined ? { status: "no-row" } : { status: "joined", row: { raw: row, payload: fetched.payload } };
	} catch (error) {
		return unavailableOf(error);
	}
}

/** Every distinct EPA ID's status, at most `STATUS_CONCURRENCY` requests in flight. */
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
	// No features is no-data, which `runSource` reads off an empty return. It is
	// not a failure and must never be reported as one.
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
