/**
 * The FEMA flood-zone adapter against the committed Esri fixtures.
 *
 * The authoritative NFHL host has never answered this machine, so there is no
 * NFHL fixture. Where a test needs the NFHL host to answer, it serves real
 * recorded Esri bytes at the NFHL address. The field names are identical, and
 * what those tests prove is that the dataset label and the no-polygon wording
 * follow the host that answered, not the bytes. They are named accordingly.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Locus, SourceIo } from "@/lib/evidence";
import { complete, SourceFailure } from "@/lib/evidence";
import {
	ArcgisQueryBody,
	esriReducedSetAdapter,
	FEMA_DATASETS,
	FEMA_VERSION,
	floodZoneOutcome,
	floodZoneQueryUrl,
	nfhlAdapter,
} from "@/lib/adapters/fema";
import { houstonLocus } from "../evidence/helpers/sems-fixtures";

const fixturesDir = fileURLToPath(new URL("../../fixtures/fema/", import.meta.url));

const NOW = "2026-09-16T02:00:00Z";
const NFHL_HOST = "hazards.fema.gov";
const ESRI_HOST = "services.arcgis.com";

const ESRI_LAYER =
	"https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Flood_Hazard_Reduced_Set_gdb/FeatureServer/0";
const NFHL_LAYER = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28";

const QUERY_TAIL =
	"geometry=-95.261995884462%2C29.720658823001&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=FLD_ZONE%2CZONE_SUBTY%2CSFHA_TF%2CDFIRM_ID%2CFLD_AR_ID%2CSTATIC_BFE%2CSOURCE_CIT&returnGeometry=false&f=json";

const SHA = {
	pasadena: "f611d6e6d500495b591e5b30e4970aafc7865fd3c5453014ce8d554b4fe72446",
	neworleans: "3f381fb3885aab7c00a40b9a50192b3393d27f32ada592469a5fb34aa8ddef2a",
	houston: "cf4ebcfcc74358f6b8005616e1544c334a2fba9f1408458b6b05c3d1e3a9ce22",
	error: "889c681894d89d34616e16a4fd28016e321f9b7330caabfd6902aa23afe89211",
};

const NFHL_NOTE = "No digital FEMA designation was available at this point.";
const ESRI_NOTE =
	"No 1% or 0.2% flood hazard polygon intersects this point in the Esri copy of FEMA's layer, dated 2026-03-11. This copy omits minimal-hazard areas, so it cannot tell minimal hazard from an unmapped area.";

/** What a host answers: recorded bytes, a transport failure, or (one test only) a derived body. */
type Route = { readonly fixture: string } | { readonly fail: SourceFailure } | { readonly body: string };

const refused: Route = { fail: new SourceFailure("refused") };

function stubIo(routes: Readonly<Record<string, Route>>): { readonly io: SourceIo; readonly calls: string[] } {
	const calls: string[] = [];
	const io: SourceIo = {
		async get(url, schema) {
			calls.push(url.toString());
			const route = routes[url.host];
			if (route === undefined) throw new Error(`test io has no route for ${url.host}`);
			if ("fail" in route) throw route.fail;
			const bytes = "fixture" in route ? readFileSync(`${fixturesDir}${route.fixture}`) : Buffer.from(route.body, "utf8");
			return {
				raw: schema.parse(JSON.parse(bytes.toString("utf8"))),
				payload: {
					url: url.toString(),
					sha256: createHash("sha256").update(bytes).digest("hex"),
					retrievedAt: NOW,
				},
			};
		},
		query(parameter, value, adapterVersion, payload) {
			return { kind: "query", parameter, value, adapterVersion, payload };
		},
		now: () => NOW,
	};
	return { io, calls };
}

function locus(): Locus {
	return houstonLocus();
}

describe("query", () => {
	it("is a point intersection on the chosen layer, carrying the coordinate and nothing else", () => {
		expect(floodZoneQueryUrl("ESRI_REDUCED_SET", locus()).toString()).toBe(`${ESRI_LAYER}/query?${QUERY_TAIL}`);
		expect(floodZoneQueryUrl("NFHL", locus()).toString()).toBe(`${NFHL_LAYER}/query?${QUERY_TAIL}`);
	});

	it("declares one adapter per dataset for the same kind and source", () => {
		expect(nfhlAdapter).toMatchObject({ kind: "fema-flood-zone", source: "fema", version: "fema@1", dataset: "NFHL" });
		expect(esriReducedSetAdapter).toMatchObject({
			kind: "fema-flood-zone",
			source: "fema",
			version: "fema@1",
			dataset: "ESRI_REDUCED_SET",
		});
		expect(FEMA_VERSION).toBe("fema@1");
	});
});

describe("Esri fallback, zone AE, Pasadena", () => {
	it("falls back when NFHL refuses and builds the record from the Esri row", async () => {
		const { io, calls } = stubIo({ [NFHL_HOST]: refused, [ESRI_HOST]: { fixture: "esri-zone-ae-pasadena.json" } });
		const result = await floodZoneOutcome(locus(), io);

		expect(calls).toEqual([`${NFHL_LAYER}/query?${QUERY_TAIL}`, `${ESRI_LAYER}/query?${QUERY_TAIL}`]);
		expect(result.dataset).toBe("ESRI_REDUCED_SET");
		expect(result.nfhl).toEqual({ status: "unavailable", cause: "refused", rawCode: null, retryAfter: null });
		if (result.outcome.status !== "ok") throw new Error(`expected ok, got ${result.outcome.status}`);
		expect(result.outcome.records).toHaveLength(1);
		const record = result.outcome.records[0];

		expect(record.kind).toBe("fema-flood-zone");
		expect(record.source).toBe("fema");
		expect(record.sourceRecordId).toBe("48201C_8563");
		expect(record.id).toEqual({ kind: "fema-flood-zone", sourceRecordId: "48201C_8563" });
		expect(record.subject.value).toBe("AE");
		expect(record.dataset.value).toBe("ESRI_REDUCED_SET");
		expect(record.zoneCode.value).toBe("AE");
		expect(record.zoneSubtype.value).toBeNull();
		expect(record.specialFloodHazardArea.value).toBe(true);
		expect(record.firmPanelId.value).toBe("48201C");
		expect(record.floodAreaId.value).toBe("48201C_8563");
		expect(record.sourceCitation.value).toBe("48201C_FIRM1");
		expect(record.location).toBeNull();
		expect(record.distanceMeters).toBeNull();
		expect(record.effectiveAt.value).toBeNull();
		expect(record.sourceUpdatedAt.value).toBeNull();
		expect(record.sourceUrl.value).toBe(`${ESRI_LAYER}/query?where=FLD_AR_ID%3D%2748201C_8563%27&outFields=*&f=html`);
		expect(record.caveats).toEqual([
			"Read from Esri's reduced-set copy of FEMA's National Flood Hazard Layer, dated 2026-03-11, not from FEMA's own service.",
			"The mapped point is a street-segment interpolation, not the parcel boundary.",
		]);
		expect(record.payloads).toEqual([
			{ url: `${ESRI_LAYER}/query?${QUERY_TAIL}`, sha256: SHA.pasadena, retrievedAt: NOW },
		]);
	});

	it("traces every value to the Esri row, and the dataset to the request", async () => {
		const { io } = stubIo({ [NFHL_HOST]: refused, [ESRI_HOST]: { fixture: "esri-zone-ae-pasadena.json" } });
		const result = await floodZoneOutcome(locus(), io);
		if (result.outcome.status !== "ok") throw new Error(`expected ok, got ${result.outcome.status}`);
		const record = result.outcome.records[0];
		const payload = { url: `${ESRI_LAYER}/query?${QUERY_TAIL}`, sha256: SHA.pasadena, retrievedAt: NOW };

		expect(record.zoneCode.provenance).toEqual([
			{
				kind: "field",
				dataset: "esri_usa_flood_hazard_reduced_set",
				sourceField: "FLD_ZONE",
				rawValue: "AE",
				transform: "identity",
				adapterVersion: "fema@1",
				payload,
			},
		]);
		// The letter, not a boolean, is what the source sent; the trace keeps it.
		expect(record.specialFloodHazardArea.provenance).toEqual([
			{
				kind: "field",
				dataset: "esri_usa_flood_hazard_reduced_set",
				sourceField: "SFHA_TF",
				rawValue: "T",
				transform: "map-boolean",
				adapterVersion: "fema@1",
				payload,
			},
		]);
		expect(record.zoneSubtype.provenance).toEqual([
			{
				kind: "field",
				dataset: "esri_usa_flood_hazard_reduced_set",
				sourceField: "ZONE_SUBTY",
				rawValue: null,
				transform: "identity",
				adapterVersion: "fema@1",
				payload,
			},
		]);
		expect(record.dataset.provenance).toEqual([
			{ kind: "query", parameter: "service", value: `${ESRI_LAYER}/query`, adapterVersion: "fema@1", payload },
		]);
		expect(record.effectiveAt.provenance).toEqual([
			{
				kind: "absent",
				dataset: "esri_usa_flood_hazard_reduced_set",
				sourceField: "EFF_DATE",
				adapterVersion: "fema@1",
				payload,
			},
		]);
		expect(record.sourceUrl.provenance[0].kind).toBe("computation");
	});
});

describe("Esri fallback, shaded X behind a levee, New Orleans", () => {
	it("passes the subtype through verbatim and reads F as outside the SFHA", async () => {
		const { io } = stubIo({ [NFHL_HOST]: refused, [ESRI_HOST]: { fixture: "esri-zone-x-levee-neworleans.json" } });
		const result = await floodZoneOutcome(locus(), io);
		if (result.outcome.status !== "ok") throw new Error(`expected ok, got ${result.outcome.status}`);
		const record = result.outcome.records[0];

		expect(record.sourceRecordId).toBe("22071C_10770");
		expect(record.dataset.value).toBe("ESRI_REDUCED_SET");
		expect(record.zoneCode.value).toBe("X");
		expect(record.zoneSubtype.value).toBe("Area With Reduced Flood Risk Due To Levee");
		expect(record.specialFloodHazardArea.value).toBe(false);
		expect(record.specialFloodHazardArea.provenance[0]).toMatchObject({ sourceField: "SFHA_TF", rawValue: "F" });
		expect(record.firmPanelId.value).toBe("22071C");
		expect(record.floodAreaId.value).toBe("22071C_10770");
		expect(record.sourceCitation.value).toBe("22071C_STUDY13");
		expect(record.payloads[0].sha256).toBe(SHA.neworleans);
	});
});

describe("no polygon: the two datasets must not be confused", () => {
	it("an empty Esri answer is no-data with the Esri wording, never the NFHL wording", async () => {
		const { io } = stubIo({ [NFHL_HOST]: refused, [ESRI_HOST]: { fixture: "esri-no-polygon-houston.json" } });
		const result = await floodZoneOutcome(locus(), io);

		expect(result.dataset).toBe("ESRI_REDUCED_SET");
		expect(result.nfhl).toEqual({ status: "unavailable", cause: "refused", rawCode: null, retryAfter: null });
		expect(result.outcome).toEqual({ status: "no-data", note: ESRI_NOTE, retrievedAt: NOW });
		expect(result.outcome.status === "no-data" && result.outcome.note).not.toBe(NFHL_NOTE);
	});

	it("an empty NFHL answer is no-data with the NFHL wording, and Esri is never asked", async () => {
		// Real recorded empty ArcGIS body, served at the NFHL host: the wording follows the host, not the bytes.
		const { io, calls } = stubIo({
			[NFHL_HOST]: { fixture: "esri-no-polygon-houston.json" },
			[ESRI_HOST]: { fixture: "esri-zone-ae-pasadena.json" },
		});
		const result = await floodZoneOutcome(locus(), io);

		expect(calls).toEqual([`${NFHL_LAYER}/query?${QUERY_TAIL}`]);
		expect(result.dataset).toBe("NFHL");
		expect(result.nfhl).toBeNull();
		expect(result.outcome).toEqual({ status: "no-data", note: NFHL_NOTE, retrievedAt: NOW });
	});

	it("the two B10 wordings are distinct constants", () => {
		expect(FEMA_DATASETS.NFHL.noPolygonNote).toBe(NFHL_NOTE);
		expect(FEMA_DATASETS.ESRI_REDUCED_SET.noPolygonNote).toBe(ESRI_NOTE);
		expect(NFHL_NOTE).not.toBe(ESRI_NOTE);
	});

	it("the single-dataset adapters return zero rows, which the kernel reports as no-data", async () => {
		const { io } = stubIo({ [ESRI_HOST]: { fixture: "esri-no-polygon-houston.json" } });
		await expect(esriReducedSetAdapter.run(locus(), io)).resolves.toEqual([]);
	});
});

describe("NFHL answers with a polygon", () => {
	it("labels the record NFHL from the host that answered and carries the unrecorded-layer caveat", async () => {
		// Real recorded Esri bytes served at the NFHL host; same field names. Proves the label follows the host.
		const { io, calls } = stubIo({
			[NFHL_HOST]: { fixture: "esri-zone-ae-pasadena.json" },
			[ESRI_HOST]: refused,
		});
		const result = await floodZoneOutcome(locus(), io);

		expect(calls).toEqual([`${NFHL_LAYER}/query?${QUERY_TAIL}`]);
		expect(result.dataset).toBe("NFHL");
		expect(result.nfhl).toBeNull();
		if (result.outcome.status !== "ok") throw new Error(`expected ok, got ${result.outcome.status}`);
		const record = result.outcome.records[0];
		expect(record.dataset.value).toBe("NFHL");
		expect(record.dataset.provenance).toEqual([
			{
				kind: "query",
				parameter: "service",
				value: `${NFHL_LAYER}/query`,
				adapterVersion: "fema@1",
				payload: { url: `${NFHL_LAYER}/query?${QUERY_TAIL}`, sha256: SHA.pasadena, retrievedAt: NOW },
			},
		]);
		expect(record.zoneCode.provenance[0]).toMatchObject({ dataset: "nfhl_s_fld_haz_ar", sourceField: "FLD_ZONE" });
		expect(record.sourceUrl.value).toBe(`${NFHL_LAYER}/query?where=FLD_AR_ID%3D%2748201C_8563%27&outFields=*&f=html`);
		expect(record.caveats).toEqual([
			"Read from FEMA's National Flood Hazard Layer, the authoritative source.",
			"No response from this layer has been recorded yet. The parse follows FEMA's published field names and is unverified against real bytes.",
			"The mapped point is a street-segment interpolation, not the parcel boundary.",
		]);
	});
});

describe("the ArcGIS error body", () => {
	it("parses as an error under the schema even though it arrived with HTTP 200", () => {
		const bytes = readFileSync(`${fixturesDir}esri-error-bad-geometry.json`);
		expect(createHash("sha256").update(bytes).digest("hex")).toBe(SHA.error);
		const parsed = ArcgisQueryBody.parse(JSON.parse(bytes.toString("utf8")));
		expect("error" in parsed).toBe(true);
		if (!("error" in parsed)) throw new Error("expected an error body");
		expect(parsed.error.code).toBe(400);
		expect(parsed.error.message).toBe("Cannot perform query. Invalid query parameters.");
	});

	it("is unavailable with the source's own code, not ok and not no-data", async () => {
		const { io } = stubIo({ [NFHL_HOST]: refused, [ESRI_HOST]: { fixture: "esri-error-bad-geometry.json" } });
		const result = await floodZoneOutcome(locus(), io);

		expect(result.dataset).toBe("ESRI_REDUCED_SET");
		expect(result.nfhl).toEqual({ status: "unavailable", cause: "refused", rawCode: null, retryAfter: null });
		expect(result.outcome).toEqual({ status: "unavailable", cause: "http", rawCode: 400, retryAfter: null });
	});

	it("throws SourceFailure from the single-dataset adapter so the kernel classifies it", async () => {
		const { io } = stubIo({ [ESRI_HOST]: { fixture: "esri-error-bad-geometry.json" } });
		await expect(esriReducedSetAdapter.run(locus(), io)).rejects.toMatchObject({
			name: "SourceFailure",
			reason: "http",
			rawCode: 400,
		});
	});
});

describe("a zone code and an SFHA letter the code has never seen", () => {
	it("reach the record verbatim; the flag becomes null with the letter kept in the trace", async () => {
		// Derived from the Pasadena row: no recorded payload carries an unfamiliar zone, so two fields are altered here.
		const pasadena = JSON.parse(readFileSync(`${fixturesDir}esri-zone-ae-pasadena.json`).toString("utf8"));
		const feature = pasadena.features[0];
		feature.attributes.FLD_ZONE = "AR/AE";
		feature.attributes.SFHA_TF = "U";
		const { io } = stubIo({ [ESRI_HOST]: { body: JSON.stringify({ features: [feature] }) } });

		const [first, ...rest] = await esriReducedSetAdapter.run(locus(), io);
		if (first === undefined) throw new Error("expected one row");
		expect(rest).toEqual([]);
		const record = complete(locus(), first);
		expect(record.zoneCode.value).toBe("AR/AE");
		expect(record.subject.value).toBe("AR/AE");
		expect(record.specialFloodHazardArea.value).toBeNull();
		expect(record.specialFloodHazardArea.provenance[0]).toMatchObject({
			sourceField: "SFHA_TF",
			rawValue: "U",
			transform: "map-boolean",
		});
	});
});

describe("live NFHL", () => {
	// hazards.fema.gov resets the TLS handshake from this machine. Run with FEMA_LIVE=1 from a US egress.
	it.skipIf(process.env.FEMA_LIVE !== "1")("answers the Houston point from the authoritative layer", async () => {
		const io: SourceIo = {
			async get(url, schema) {
				const response = await fetch(url);
				const bytes = Buffer.from(await response.arrayBuffer());
				return {
					raw: schema.parse(JSON.parse(bytes.toString("utf8"))),
					payload: {
						url: url.toString(),
						sha256: createHash("sha256").update(bytes).digest("hex"),
						retrievedAt: new Date().toISOString(),
					},
				};
			},
			query(parameter, value, adapterVersion, payload) {
				return { kind: "query", parameter, value, adapterVersion, payload };
			},
			now: () => new Date().toISOString(),
		};
		const result = await floodZoneOutcome(locus(), io);
		expect(result.dataset).toBe("NFHL");
		expect(result.nfhl).toBeNull();
	});
});
