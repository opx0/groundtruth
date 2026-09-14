/**
 * The SEMS adapter against the committed fixture bytes.
 *
 * `tests/unit/evidence/helpers/sems-fixtures.ts` builds SEMS records by hand
 * for the kernel's own tests. This suite runs the live adapter over the same
 * bytes through a `SourceIo` that serves fixtures instead of the network, and
 * asserts the two agree record for record, provenance included. If the adapter
 * ever drifts from the shape the kernel's tests assume, these fail.
 *
 * `docs/BRIEF.md` B12's seven cases, for a source that is two endpoints joined:
 *
 *   success            | "a site that exists in both systems", "the whole layer"
 *   no records         | zero features is no-data; zero Envirofacts rows is `no-row`
 *   missing optional   | the nulls on the real Houston rows, each with its own provenance
 *   unknown status     | both vocabularies, uncatalogued and verbatim, from the recordings
 *   malformed          | the ArcGIS error at HTTP 200, and a body that is not JSON at all
 *   rate limit         | 429 on the layer, and 429 on one status join
 *   timeout            | the policy on the layer, and one join's own request budget
 *
 * The last three have two halves each, and the halves are different facts. A
 * layer that fails costs the source every record; a status join that fails
 * costs one site its status and nothing else, and `statusRow` is the only
 * field that tells that site apart from one the inventory genuinely holds no
 * row for. Both halves are asserted, and so is the pair's difference.
 *
 * Neither endpoint has ever rate-limited or timed out on this repository, so
 * there is nothing to record for those two. They are driven through the io
 * instead, and what is asserted is that the source's own code and retry hint
 * reach the outcome rather than being flattened into "unknown", and that a
 * failure never arrives as an empty answer.
 *
 * No test here touches the network unless GROUND_TRUTH_LIVE is set.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { layerUrl, semsAdapter, statusUrl } from "@/lib/adapters/sems";
import type { Locus, PayloadRef, Provenance, Sealed, SemsSiteRecord, SourceIo, SourceOutcome } from "@/lib/evidence";
import { runSource, SourceFailure } from "@/lib/evidence";
import {
	houstonLocus,
	NEAREST_EPA_ID,
	RETRIEVED_AT,
	frsLayer,
	semsRecord,
} from "@/tests/unit/evidence/helpers/sems-fixtures";

const fixturesDir = fileURLToPath(new URL("../../fixtures/", import.meta.url));

const LAYER_5MI = "sems/arcgis-5mi-houston.json";
const LAYER_NONE = "sems/arcgis-no-records-nevada.json";
const LAYER_ERROR = "fema/esri-error-bad-geometry.json";

/**
 * Envirofacts answers an EPA ID it holds no row for with exactly these two
 * bytes, recorded in `sems/envirofacts-no-row.json` from a well-formed EPA ID
 * the inventory has nothing for. All fifteen real sites do have a row, checked
 * against the live endpoint, so this branch is reached deliberately rather than
 * by picking a site.
 */
const NO_ROW_FIXTURE = "sems/envirofacts-no-row.json";

/**
 * Every EPA ID in the 5-mile layer that has a recorded Envirofacts row, which
 * is all fifteen of them. Built by reading the layer rather than by listing
 * them, so adding a fixture cannot leave this map stale.
 */
const JOINED: Readonly<Record<string, string>> = Object.fromEntries(
	frsLayer()
		.raw.features.map((feature) => feature.attributes.PGM_SYS_ID)
		.filter((epaId) => existsSync(`${fixturesDir}sems/envirofacts-${epaId}.json`))
		.map((epaId) => [epaId, `sems/envirofacts-${epaId}.json`]),
);

const locus: Locus = houstonLocus();
const policy = { timeoutMs: 5000 };

/** The registry page the layer carries for the nearest site, which is what a failed or rowless join falls back to. */
const NEAREST_FAC_URL = "https://ofmpub.epa.gov/frs_public2/fii_query_detail.disp_program_facility?p_registry_id=110000460885";

function payloadFor(url: string, bytes: Buffer): PayloadRef {
	return { url, sha256: createHash("sha256").update(bytes).digest("hex"), retrievedAt: RETRIEVED_AT };
}

/** The payload a fixture-served response carries, so a provenance entry can be asserted whole. */
function fixturePayload(relative: string): PayloadRef {
	return payloadFor(`fixture:${relative}`, readFileSync(`${fixturesDir}${relative}`));
}

/** The EPA ID out of `.../efservice/envirofacts_site/epa_id/<EPA_ID>/JSON`. */
function epaIdOf(url: URL): string | null {
	const segments = url.pathname.split("/");
	const id = segments[segments.length - 2];
	return url.host === "data.epa.gov" && id !== undefined ? id : null;
}

/** What one endpoint does with one request. */
type Route =
	/** HTTP 200, from committed bytes. */
	| { readonly fixture: string }
	/**
	 * HTTP 200, from bytes a test wrote inline. Never a claim about what either
	 * endpoint sends, and never filed as a fixture for that reason.
	 */
	| { readonly body: string }
	/** A non-200, with whatever body arrived alongside it. */
	| { readonly status: number; readonly body: string }
	| { readonly status: number; readonly body: string; readonly retryAfter: string }
	/** This one request's `AbortController` firing in `lib/io/fetch-source-io.ts`. The run continues. */
	| { readonly aborted: true }
	/** A request that never settles, so the kernel's own policy is what ends the run. */
	| { readonly hang: true };

type Served = { readonly io: SourceIo; readonly requested: string[] };

/**
 * A `SourceIo` that answers the radius query from `layer` and each status join
 * from `joins[epaId]`, falling back to `rest` for an EPA ID with no route.
 *
 * `get` mirrors `lib/io/fetch-source-io.ts` deliberately: hash the bytes, check
 * 429 and then the status, then `JSON.parse`, then `safeParse`, and throw a
 * `SourceFailure` carrying no URL and no body. A double that parsed more
 * forgivingly than the real io would prove nothing about the malformed case.
 * Payload URLs match the helper's `fixture:<path>` so records compare equal.
 */
function driving(
	layer: Route,
	joins: Readonly<Record<string, Route>> = {},
	rest: Route = { fixture: NO_ROW_FIXTURE },
): Served {
	const requested: string[] = [];
	const io: SourceIo = {
		async get(url, schema) {
			requested.push(url.toString());
			const epaId = epaIdOf(url);
			const route = epaId === null ? layer : (joins[epaId] ?? rest);
			if ("hang" in route) return new Promise<never>(() => undefined);
			if ("aborted" in route) throw new SourceFailure("timeout");

			const inline = "fixture" in route;
			const bytes = inline ? readFileSync(`${fixturesDir}${route.fixture}`) : Buffer.from(route.body, "utf8");
			const payload = payloadFor(inline ? `fixture:${route.fixture}` : url.toString(), bytes);

			const code = "status" in route ? route.status : 200;
			if (code === 429) throw new SourceFailure("rate-limited", code, "retryAfter" in route ? route.retryAfter : null);
			if (code !== 200) throw new SourceFailure("http", code);

			let json: unknown;
			try {
				json = JSON.parse(bytes.toString("utf8"));
			} catch {
				throw new SourceFailure("malformed", null);
			}
			const parsed = schema.safeParse(json);
			if (!parsed.success) throw new SourceFailure("malformed", null);
			return { raw: parsed.data, payload };
		},
		query(parameter, value, adapterVersion, payload) {
			return { kind: "query", parameter, value, adapterVersion, payload };
		},
		now: () => RETRIEVED_AT,
	};
	return { io, requested };
}

function routesOf(fixtures: Readonly<Record<string, string>>): Record<string, Route> {
	const routes: Record<string, Route> = {};
	for (const [epaId, fixture] of Object.entries(fixtures)) routes[epaId] = { fixture };
	return routes;
}

/** The fifteen recorded joins, with one EPA ID's answer replaced by something that fails. */
function joinsExcept(epaId: string, route: Route): Record<string, Route> {
	return { ...routesOf(JOINED), [epaId]: route };
}

/** The whole layer, every join answered from its recording. */
function serving(layer: string, status: Readonly<Record<string, string>> = {}): Served {
	return driving({ fixture: layer }, routesOf(status));
}

function ok(outcome: SourceOutcome<"sems-site">) {
	if (outcome.status !== "ok") throw new Error(`expected ok, got ${outcome.status}`);
	return outcome.records;
}

async function run(served: Served): Promise<SourceOutcome<"sems-site">> {
	return runSource(locus, semsAdapter, served.io, policy);
}

function sited(records: readonly Sealed<SemsSiteRecord>[], epaId: string): Sealed<SemsSiteRecord> {
	const found = records.find((r) => r.id.sourceRecordId === epaId);
	if (found === undefined) throw new Error(`${epaId} is not in the outcome`);
	return found;
}

function label(p: Provenance): string {
	return p.kind === "field" || p.kind === "absent" ? `${p.dataset}.${p.sourceField}` : p.kind;
}

describe("the request", () => {
	it("asks ArcGIS for a radius in metres around the locus, with no geometry returned", () => {
		expect(layerUrl(locus).toString()).toBe(
			"https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/FRS_INTERESTS_SEMS/FeatureServer/0/query" +
				"?geometry=-95.261995884462%2C29.720658823001&geometryType=esriGeometryPoint&inSR=4326&distance=8047" +
				"&units=esriSRUnit_Meter&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=false&f=json",
		);
	});

	it("asks Envirofacts for the status row by EPA site ID", () => {
		expect(statusUrl("TXN000622182").toString()).toBe(
			"https://data.epa.gov/efservice/envirofacts_site/epa_id/TXN000622182/JSON",
		);
	});
});

describe("success: a site that exists in both systems", () => {
	it("builds the nearest site from the two responses joined", async () => {
		const records = ok(await run(serving(LAYER_5MI, JOINED)));
		const record = sited(records, NEAREST_EPA_ID);

		expect(record.subject.value).toBe("VALERO PLUME");
		expect(record.frsName.value).toBe("HOUSTON REFINERY");
		expect(record.semsName?.value).toBe("VALERO PLUME");
		expect(record.epaSiteId.value).toBe("TXN000622182");
		expect(record.semsSiteId?.value).toBe("0622182");
		expect(record.frsRegistryId.value).toBe("110000460885");
		expect(record.interestType.value).toBe("SUPERFUND (NON-NPL)");
		expect(record.sourceUrl.value).toBe("https://cumulis.epa.gov/supercpad/cursites/csitinfo.cfm?id=0622182");
		expect(record.distanceMeters?.value).toBe(755);
		expect(record.location?.latitude.value).toBe(29.722274);
		expect(record.location?.longitude.value).toBe(-95.254401);
		expect(record.statusDate?.value).toBe("2022-02-08");
		expect(record.effectiveAt.value).toBe("2022-02-08");
		expect(record.sourceUpdatedAt.value).toBe("2024-03-14T10:51:51Z");
		expect(record.archived?.value).toBe(false);
		expect(record.statusRow).toEqual({ status: "joined" });
		expect(record.payloads.map((p) => p.url)).toEqual([
			"fixture:sems/arcgis-5mi-houston.json",
			"fixture:sems/envirofacts-TXN000622182.json",
		]);
	});

	it("keeps the two systems' statuses in separate fields, each verbatim", async () => {
		const record = sited(ok(await run(serving(LAYER_5MI, JOINED))), NEAREST_EPA_ID);
		expect(record.semsNplStatus?.value).toBe("Not on the NPL");
		expect(record.frsActiveStatus.value).toBe("NOT ON THE NPL");
		expect(record.nonNplStatus?.value).toBe("Removal Only Site (No Site Assessment Work Needed)");
		expect(record.semsNplStatus?.provenance.map(label)).toEqual(["envirofacts_site.npl_status_name"]);
		expect(record.frsActiveStatus.provenance.map(label)).toEqual(["frs_program_facility.ACTIVE_STATUS"]);
	});

	it("keeps both names in the trace, the Superfund one chosen and the registry one passed over", async () => {
		const record = sited(ok(await run(serving(LAYER_5MI, JOINED))), NEAREST_EPA_ID);
		const [computation] = record.subject.provenance;
		if (computation.kind !== "computation") throw new Error("subject is not a coalesce");
		expect(computation.formula).toBe("coalesce");
		expect(computation.inputs.map((i) => i.value)).toEqual(["VALERO PLUME", "HOUSTON REFINERY"]);
		expect(computation.inputs.flatMap((i) => i.provenance.map(label))).toEqual([
			"envirofacts_site.name",
			"frs_program_facility.PRIMARY_NAME",
		]);
	});

	it("measures the distance from the ArcGIS coordinate and still shows the Envirofacts one", async () => {
		const record = sited(ok(await run(serving(LAYER_5MI, JOINED))), "TXN000607093");
		// The two systems put U.S. OIL RECOVERY in slightly different places.
		expect(record.location?.longitude.value).toBe(-95.22152799999999);
		expect(record.semsCoordinate?.longitude.value).toBe(-95.221528);
		expect(record.semsCoordinate?.latitude.value).toBe(29.718389);
		expect(record.distanceMeters?.value).toBe(3916);
		expect(record.location?.longitude.provenance.map(label)).toEqual(["frs_program_facility.LONGITUDE83"]);
		// Envirofacts sends its coordinates as strings, so the reader parses them.
		expect(record.semsCoordinate?.longitude.provenance.map((p) => (p.kind === "field" ? p.transform : p.kind))).toEqual([
			"parse-number",
		]);
	});
});

describe("no records", () => {
	it("reports zero features as no-data, and never calls the status endpoint", async () => {
		const served = serving(LAYER_NONE);
		const outcome = await run(served);
		expect(outcome).toEqual({
			status: "no-data",
			note: "No matching records within the stated boundary.",
			retrievedAt: RETRIEVED_AT,
		});
		expect(served.requested).toHaveLength(1);
	});

	it("is a bare [] at HTTP 200 on the other endpoint, which is a row the inventory does not hold", () => {
		expect(readFileSync(`${fixturesDir}${NO_ROW_FIXTURE}`).toString("utf8").trim()).toBe("[]");
	});
});

/**
 * All fifteen real sites have an inventory row, so this branch is reached by
 * serving the recorded empty response for one of them rather than by finding a
 * site without one. `WITHOUT_ROW` drops that site from the joined map.
 */
const WITHOUT_ROW: Readonly<Record<string, string>> = Object.fromEntries(
	Object.entries(JOINED).filter(([epaId]) => epaId !== "TXN000607155"),
);

describe("a site the Superfund inventory has no row for", () => {
	it("keeps every Envirofacts-side field null and links to the registry instead", async () => {
		const record = sited(ok(await run(serving(LAYER_5MI, WITHOUT_ROW))), "TXN000607155");
		expect(record.statusRow).toEqual({ status: "no-row" });
		expect(record.semsSiteId).toBeNull();
		expect(record.semsName).toBeNull();
		expect(record.semsNplStatus).toBeNull();
		expect(record.nonNplStatus).toBeNull();
		expect(record.statusDate).toBeNull();
		expect(record.archived).toBeNull();
		expect(record.semsCoordinate).toBeNull();
		expect(record.subject.value).toBe("MCC RECYCLING");
		expect(record.sourceUrl.value).toBe(
			"https://ofmpub.epa.gov/frs_public2/fii_query_detail.disp_program_facility?p_registry_id=110071101301",
		);
		expect(record.payloads.map((p) => p.url)).toEqual(["fixture:sems/arcgis-5mi-houston.json"]);
		// The gap is recorded as an absence, not as a value that came from nowhere.
		expect(record.effectiveAt.value).toBeNull();
		expect(record.effectiveAt.provenance.map((p) => p.kind)).toEqual(["absent"]);
	});
});

describe("missing optional fields", () => {
	it("leaves a null on a real row null, rather than inventing a value for it", async () => {
		const records = ok(await run(serving(LAYER_5MI, JOINED)));
		const valero = sited(records, NEAREST_EPA_ID);
		// ACCURACY_VALUE and COLLECT_MTH_DESC are null on this row; REF_POINT_DESC is not.
		expect(valero.location?.accuracyMeters.value).toBeNull();
		expect(valero.location?.collectionMethod.value).toBeNull();
		expect(valero.location?.referencePoint.value).toBe("CENTER OF A FACILITY OR STATION");
		// Envirofacts holds no coordinate for this site at all.
		expect(valero.semsCoordinate).toBeNull();
		expect(sited(records, "TXN000607093").nonNplStatus?.value).toBeNull();
	});

	it("gives each null its own field provenance, so the trace says which row the null came from", async () => {
		const record = sited(ok(await run(serving(LAYER_5MI, JOINED))), "TXN000607093");
		expect(record.nonNplStatus?.provenance).toEqual([
			{
				kind: "field",
				dataset: "envirofacts_site",
				sourceField: "non_npl_status_name",
				rawValue: null,
				transform: "identity",
				adapterVersion: "sems@1",
				payload: fixturePayload("sems/envirofacts-TXN000607093.json"),
			},
		]);
		expect(record.location?.accuracyMeters.provenance).toEqual([
			{
				kind: "field",
				dataset: "frs_program_facility",
				sourceField: "ACCURACY_VALUE",
				rawValue: null,
				transform: "parse-number",
				adapterVersion: "sems@1",
				payload: fixturePayload(LAYER_5MI),
			},
		]);
	});

	it("keeps a site whose Envirofacts row carries no status date, with the null dated to nothing", async () => {
		const record = sited(ok(await run(serving(LAYER_5MI, JOINED))), "TXD980748453");
		expect(record.statusDate?.value).toBeNull();
		expect(record.effectiveAt.value).toBeNull();
		expect(record.effectiveAt.provenance.map(label)).toEqual(["envirofacts_site.non_npl_status_date"]);
		expect(record.semsNplStatus?.value).toBe("Currently on the Final NPL");
	});
});

describe("unknown status", () => {
	it("passes a registry status string the code has never catalogued through verbatim", async () => {
		const record = sited(ok(await run(serving(LAYER_5MI, WITHOUT_ROW))), "TXN000607155");
		expect(record.frsActiveStatus.value).toBe("SITE IS PART OF NPL SITE");
		expect(record.frsActiveStatus.provenance).toEqual([
			{
				kind: "field",
				dataset: "frs_program_facility",
				sourceField: "ACTIVE_STATUS",
				rawValue: "SITE IS PART OF NPL SITE",
				transform: "identity",
				adapterVersion: "sems@1",
				payload: fixturePayload(LAYER_5MI),
			},
		]);
	});

	it("passes the Superfund vocabulary's own uncatalogued sentence through the other field, unmapped", async () => {
		const record = sited(ok(await run(serving(LAYER_5MI, JOINED))), "TXN000607155");
		// Neither "Site is Part of NPL Site" nor its upper-case registry twin appears
		// anywhere in this codebase: both fields are z.string(), never z.enum().
		expect(record.semsNplStatus?.value).toBe("Site is Part of NPL Site");
		expect(record.semsNplStatus?.provenance).toEqual([
			{
				kind: "field",
				dataset: "envirofacts_site",
				sourceField: "npl_status_name",
				rawValue: "Site is Part of NPL Site",
				transform: "identity",
				adapterVersion: "sems@1",
				payload: fixturePayload("sems/envirofacts-TXN000607155.json"),
			},
		]);
		// An unknown status costs the record nothing: no extra caveat, no dropped field.
		expect(record.caveats).toEqual([
			"A SEMS record can mean assessment, proposed action, active cleanup, or completed work.",
			"The coordinate is a reference point, not a boundary.",
		]);
		expect(record.statusRow).toEqual({ status: "joined" });
	});

	it("passes an archived NFRAP-style status and its Y flag through unmapped", async () => {
		const served = serving(LAYER_5MI, { TXN000622182: "sems/envirofacts-archived.json" });
		const record = sited(ok(await run(served)), NEAREST_EPA_ID);
		expect(record.semsNplStatus?.value).toBe("Not on the NPL");
		expect(record.nonNplStatus?.value).toBe("Deferred to RCRA (Subtitle C)");
		expect(record.statusDate?.value).toBe("1984-09-01");
		expect(record.archived?.value).toBe(true);
		expect(record.semsName?.value).toBe("CT RESOURCE RECOVERY AUTHORITY");
		expect(record.sourceUrl.value).toBe("https://cumulis.epa.gov/supercpad/cursites/csitinfo.cfm?id=0100001");
		// That fixture holds a second row. The adapter takes `raw[0]` and drops the
		// rest in silence -- no caveat says a row was chosen. Recorded here as the
		// behaviour, not endorsed: see the report on this file.
		expect(JSON.stringify(record)).not.toContain("MODOC TOWN DUMP");
	});
});

describe("malformed response", () => {
	it("reads the ArcGIS error body that arrives with HTTP 200 and reports the source's own code", async () => {
		const outcome = await run(serving(LAYER_ERROR));
		expect(outcome).toEqual({ status: "unavailable", cause: "http", rawCode: 400, retryAfter: null });
	});

	it("rejects a layer body that is not JSON at all rather than reading it as no features", async () => {
		const served = driving({ body: "<html><head><title>502 Bad Gateway</title></head><body>nginx</body></html>" });
		const outcome = await run(served);
		expect(outcome).toEqual({ status: "unavailable", cause: "malformed", rawCode: null, retryAfter: null });
		// The distinction the product rests on: this is not "no matching records".
		expect(outcome.status).not.toBe("no-data");
		expect(served.requested).toHaveLength(1);
	});

	it("rejects a layer whose feature attributes are the wrong shape", async () => {
		const body = JSON.stringify({ features: [{ attributes: { PGM_SYS_ID: "TXN000622182" } }] });
		expect(await run(driving({ body }))).toEqual({
			status: "unavailable",
			cause: "malformed",
			rawCode: null,
			retryAfter: null,
		});
	});

	it("costs one site its status when the inventory answers with something that is not JSON", async () => {
		const html = { body: "<html><body>Oracle REST Data Services</body></html>" };
		const records = ok(await run(driving({ fixture: LAYER_5MI }, joinsExcept(NEAREST_EPA_ID, html))));
		expect(records).toHaveLength(15);
		const record = sited(records, NEAREST_EPA_ID);
		expect(record.statusRow).toEqual({ status: "unavailable", cause: "malformed", rawCode: null, retryAfter: null });
		expect(record.semsNplStatus).toBeNull();
		expect(record.frsActiveStatus.value).toBe("NOT ON THE NPL");
		expect(sited(records, "TXN000607093").statusRow).toEqual({ status: "joined" });
	});
});

describe("rate limit", () => {
	it("on the layer costs the source every record, with ArcGIS's own code and retry hint kept", async () => {
		const served = driving({ status: 429, body: '{"error":"Too Many Requests"}', retryAfter: "120" });
		const outcome = await run(served);
		// Not flattened into "unknown", and not an empty answer: 429 and 120 are
		// what the source said, and they are what the card has to print.
		expect(outcome).toEqual({ status: "unavailable", cause: "rate-limited", rawCode: 429, retryAfter: "120" });
		// Nothing was joined: a spent rate limit is not spent again, fifteen times.
		expect(served.requested).toHaveLength(1);
	});

	it("on one status join costs that one site its status, never the other fourteen their records", async () => {
		const limited = { status: 429, body: '{"error":"Too Many Requests"}', retryAfter: "60" };
		const served = driving({ fixture: LAYER_5MI }, joinsExcept(NEAREST_EPA_ID, limited));
		const records = ok(await run(served));

		expect(records).toHaveLength(15);
		const record = sited(records, NEAREST_EPA_ID);
		expect(record.statusRow).toEqual({ status: "unavailable", cause: "rate-limited", rawCode: 429, retryAfter: "60" });
		// A failed request is not an empty answer, and `statusRow` is what says so.
		expect(record.statusRow).not.toEqual({ status: "no-row" });
		expect(record.semsNplStatus).toBeNull();
		expect(record.semsSiteId).toBeNull();
		// The registry half of this site is untouched, value, link and distance.
		expect(record.subject.value).toBe("HOUSTON REFINERY");
		expect(record.frsActiveStatus.value).toBe("NOT ON THE NPL");
		expect(record.sourceUrl.value).toBe(NEAREST_FAC_URL);
		expect(record.distanceMeters?.value).toBe(755);
		expect(record.payloads.map((p) => p.url)).toEqual(["fixture:sems/arcgis-5mi-houston.json"]);
		// And the other fourteen joined exactly as they do when nothing fails.
		const other = sited(records, "TXN000607093");
		expect(other.statusRow).toEqual({ status: "joined" });
		expect(other.semsNplStatus?.value).toBe("Currently on the Final NPL");
		expect(other.semsNplStatus?.provenance).toEqual([
			{
				kind: "field",
				dataset: "envirofacts_site",
				sourceField: "npl_status_name",
				rawValue: "Currently on the Final NPL",
				transform: "identity",
				adapterVersion: "sems@1",
				payload: fixturePayload("sems/envirofacts-TXN000607093.json"),
			},
		]);
		expect(other.payloads.map((p) => p.url)).toEqual([
			"fixture:sems/arcgis-5mi-houston.json",
			"fixture:sems/envirofacts-TXN000607093.json",
		]);
		expect(records.filter((r) => r.statusRow.status === "joined")).toHaveLength(14);
	});
});

describe("timeout", () => {
	it("on the layer is unavailable, ended by the source's own policy, and never an empty answer", async () => {
		const served = driving({ hang: true });
		const outcome = await runSource(locus, semsAdapter, served.io, { timeoutMs: 20 });
		expect(outcome).toEqual({ status: "unavailable", cause: "timeout", rawCode: null, retryAfter: null });
		expect(outcome.status).not.toBe("no-data");
		expect(served.requested).toHaveLength(1);
	});

	it("on the layer's own request budget is the same outcome, reached before the policy", async () => {
		expect(await run(driving({ aborted: true }))).toEqual({
			status: "unavailable",
			cause: "timeout",
			rawCode: null,
			retryAfter: null,
		});
	});

	it("on one status join costs that one site its status and the run nothing", async () => {
		const served = driving({ fixture: LAYER_5MI }, joinsExcept("TXN000607093", { aborted: true }));
		const records = ok(await run(served));

		expect(records).toHaveLength(15);
		const record = sited(records, "TXN000607093");
		expect(record.statusRow).toEqual({ status: "unavailable", cause: "timeout", rawCode: null, retryAfter: null });
		expect(record.semsNplStatus).toBeNull();
		expect(record.semsCoordinate).toBeNull();
		expect(record.subject.value).toBe("U.S. OIL RECOVERY");
		expect(record.frsActiveStatus.value).toBe("CURRENTLY ON THE FINAL NPL");
		expect(record.distanceMeters?.value).toBe(3916);
		// The site is still measurable and still on the report: the FRS coordinate
		// is what the radius matched on, and nothing about it came from Envirofacts.
		expect(record.location?.longitude.value).toBe(-95.22152799999999);
		expect(sited(records, NEAREST_EPA_ID)).toEqual(semsRecord(locus, NEAREST_EPA_ID));
	});

	it("is the rowless site in every field but statusRow, which is the only thing telling them apart", async () => {
		const failed = sited(
			ok(await run(driving({ fixture: LAYER_5MI }, joinsExcept("TXN000607155", { aborted: true })))),
			"TXN000607155",
		);
		const rowless = sited(ok(await run(serving(LAYER_5MI, WITHOUT_ROW))), "TXN000607155");

		const { statusRow: failedRow, ...failedRest } = failed;
		const { statusRow: rowlessRow, ...rowlessRest } = rowless;
		// Every Superfund-side field is null in both, so nothing else can carry the
		// difference between "the inventory holds nothing" and "we could not ask".
		expect(failedRest).toEqual(rowlessRest);
		expect(failedRow).toEqual({ status: "unavailable", cause: "timeout", rawCode: null, retryAfter: null });
		expect(rowlessRow).toEqual({ status: "no-row" });
	});
});

describe("the whole layer", () => {
	it("agrees with the kernel helper's hand-built record for every site in the fixture", async () => {
		const served = serving(LAYER_5MI, JOINED);
		const records = ok(await run(served));
		const epaIds = frsLayer().raw.features.map((f) => f.attributes.PGM_SYS_ID);
		expect(records).toHaveLength(15);
		expect(records.map((r) => r.id.sourceRecordId)).toEqual(epaIds);
		for (const epaId of epaIds) {
			expect(sited(records, epaId)).toEqual(semsRecord(locus, epaId));
		}
	});

	it("asks the radius endpoint once and the status endpoint once per distinct EPA ID", async () => {
		const served = serving(LAYER_5MI, JOINED);
		await run(served);
		expect(served.requested.filter((u) => u.includes("services.arcgis.com"))).toHaveLength(1);
		expect(served.requested.filter((u) => u.includes("efservice"))).toHaveLength(15);
		expect(new Set(served.requested).size).toBe(16);
	});
});

/**
 * The live round trip. Skipped unless GROUND_TRUTH_LIVE=1, so the suite passes
 * with no network. It exists to catch the endpoints moving under us.
 */
const live = process.env["GROUND_TRUTH_LIVE"] === "1" ? it : it.skip;

describe("against the live endpoints", () => {
	live("returns Superfund sites around the mapped point", async () => {
		const io: SourceIo = {
			async get(url, schema) {
				const response = await fetch(url);
				if (!response.ok) throw new SourceFailure("http", response.status);
				const bytes = Buffer.from(await response.arrayBuffer());
				return { raw: schema.parse(JSON.parse(bytes.toString("utf8"))), payload: payloadFor(url.toString(), bytes) };
			},
			query(parameter, value, adapterVersion, payload) {
				return { kind: "query", parameter, value, adapterVersion, payload };
			},
			now: () => new Date().toISOString(),
		};
		const outcome = await runSource(locus, semsAdapter, io, { timeoutMs: 30_000 });
		expect(ok(outcome).length).toBeGreaterThan(0);
	}, 60_000);
});
