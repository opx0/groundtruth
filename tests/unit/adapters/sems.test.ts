/**
 * The SEMS adapter against the committed fixture bytes.
 *
 * `tests/unit/evidence/helpers/sems-fixtures.ts` builds SEMS records by hand
 * for the kernel's own tests. This suite runs the live adapter over the same
 * bytes through a `SourceIo` that serves fixtures instead of the network, and
 * asserts the two agree record for record, provenance included. If the adapter
 * ever drifts from the shape the kernel's tests assume, these fail.
 *
 * No test here touches the network unless GROUND_TRUTH_LIVE is set.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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

/** The two EPA IDs in the 5-mile layer that have a recorded Envirofacts row. */
const JOINED: Readonly<Record<string, string>> = {
	TXN000622182: "sems/envirofacts-TXN000622182.json",
	TXN000607093: "sems/envirofacts-TXN000607093.json",
};

const locus: Locus = houstonLocus();
const policy = { timeoutMs: 5000 };

/**
 * Envirofacts answers an EPA ID it holds no row for with exactly these two
 * bytes. No such response was recorded, because there is nothing in it to
 * record; every other payload below is a committed fixture read from disk.
 */
const NO_ROWS = Buffer.from("[]", "utf8");

function payloadFor(url: string, bytes: Buffer): PayloadRef {
	return { url, sha256: createHash("sha256").update(bytes).digest("hex"), retrievedAt: RETRIEVED_AT };
}

/** The EPA ID out of `.../efservice/envirofacts_site/epa_id/<EPA_ID>/JSON`. */
function epaIdOf(url: URL): string | null {
	const segments = url.pathname.split("/");
	const id = segments[segments.length - 2];
	return url.host === "data.epa.gov" && id !== undefined ? id : null;
}

type Served = { readonly io: SourceIo; readonly requested: string[] };

/**
 * A `SourceIo` that answers the radius query from `layer` and each status join
 * from `status[epaId]`, or with an empty row set when that ID has no fixture.
 * Payload URLs match the helper's `fixture:<path>` so records compare equal.
 */
function serving(layer: string, status: Readonly<Record<string, string>> = {}): Served {
	const requested: string[] = [];
	const io: SourceIo = {
		get(url, schema) {
			requested.push(url.toString());
			const epaId = epaIdOf(url);
			const relative = epaId === null ? layer : status[epaId];
			const bytes = relative === undefined ? NO_ROWS : readFileSync(`${fixturesDir}${relative}`);
			const payload = payloadFor(relative === undefined ? url.toString() : `fixture:${relative}`, bytes);
			return Promise.resolve({ raw: schema.parse(JSON.parse(bytes.toString("utf8"))), payload });
		},
		query(parameter, value, adapterVersion, payload) {
			return { kind: "query", parameter, value, adapterVersion, payload };
		},
		now: () => RETRIEVED_AT,
	};
	return { io, requested };
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

describe("a site that exists in both systems", () => {
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
});

describe("a site the Superfund inventory has no row for", () => {
	it("keeps every Envirofacts-side field null and links to the registry instead", async () => {
		const record = sited(ok(await run(serving(LAYER_5MI, JOINED))), "TXN000607155");
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

	it("passes through a registry status string the code has never seen", async () => {
		const record = sited(ok(await run(serving(LAYER_5MI, JOINED))), "TXN000607155");
		expect(record.frsActiveStatus.value).toBe("SITE IS PART OF NPL SITE");
	});
});

describe("statuses are sentences, not codes", () => {
	it("passes an archived NFRAP-style status and its Y flag through unmapped", async () => {
		const served = serving(LAYER_5MI, { TXN000622182: "sems/envirofacts-archived.json" });
		const record = sited(ok(await run(served)), NEAREST_EPA_ID);
		expect(record.semsNplStatus?.value).toBe("Not on the NPL");
		expect(record.nonNplStatus?.value).toBe("Deferred to RCRA (Subtitle C)");
		expect(record.statusDate?.value).toBe("1984-09-01");
		expect(record.archived?.value).toBe(true);
		expect(record.semsName?.value).toBe("CT RESOURCE RECOVERY AUTHORITY");
		expect(record.sourceUrl.value).toBe("https://cumulis.epa.gov/supercpad/cursites/csitinfo.cfm?id=0100001");
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

describe("the outcomes that are not records", () => {
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

	it("reads the ArcGIS error body that arrives with HTTP 200 and reports the source's own code", async () => {
		const outcome = await run(serving(LAYER_ERROR));
		expect(outcome).toEqual({ status: "unavailable", cause: "http", rawCode: 400, retryAfter: null });
	});

	it("costs one site its status when a join fails, never the other fourteen their records", async () => {
		const io: SourceIo = {
			get(url, schema) {
				if (epaIdOf(url) !== null) return Promise.reject(new SourceFailure("rate-limited", "429", "60"));
				const bytes = readFileSync(`${fixturesDir}${LAYER_5MI}`);
				return Promise.resolve({
					raw: schema.parse(JSON.parse(bytes.toString("utf8"))),
					payload: payloadFor(`fixture:${LAYER_5MI}`, bytes),
				});
			},
			query(parameter, value, adapterVersion, payload) {
				return { kind: "query", parameter, value, adapterVersion, payload };
			},
			now: () => RETRIEVED_AT,
		};
		const outcome = await runSource(locus, semsAdapter, io, policy);
		// A failed request is not an empty answer. Every site keeps its record and
		// its registry-side fields; only the inventory's answer is missing, and
		// `statusRow` says so verbatim rather than letting the error pose as
		// "the inventory has no row for this site".
		if (outcome.status !== "ok") throw new Error(`expected ok, got ${outcome.status}`);
		expect(outcome.records).toHaveLength(15);
		for (const record of outcome.records) {
			expect(record.statusRow).toEqual({
				status: "unavailable",
				cause: "rate-limited",
				rawCode: "429",
				retryAfter: "60",
			});
			expect(record.semsNplStatus).toBeNull();
			expect(record.frsActiveStatus.value).not.toBeNull();
		}
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
