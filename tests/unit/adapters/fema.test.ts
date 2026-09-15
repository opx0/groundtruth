/**
 * The FEMA flood-zone adapter against the committed Esri fixtures.
 *
 * The authoritative NFHL host answered for the first time on 2026-09-17, from a
 * Compute Engine instance in `us-central1`. It resets the TLS handshake from
 * this machine and from `asia-southeast1`, and returns HTTP 200 in 0.26 s from
 * Iowa, so the block is on egress and not on the request. Three NFHL fixtures
 * are committed and the last describe block reads them.
 *
 * Every other test here still serves real recorded Esri bytes at the NFHL
 * address where it needs that host to answer. Those tests predate the capture
 * and are left alone on purpose: the field names are identical, and what they
 * prove is that the dataset label and the no-polygon wording follow the host
 * that answered rather than the bytes. They are named accordingly.
 *
 * B12's seven cases, and where each one sits:
 *
 *   1 success          "Esri fallback, zone AE, Pasadena", "…shaded X…", "NFHL answers with a polygon"
 *   2 no records       "no polygon: the two datasets must not be confused"
 *   3 missing optional "B12 case 3" — ZONE_SUBTY and STATIC_BFE are null in the recorded Pasadena row
 *   4 unknown status   "a zone code and an SFHA letter the code has never seen"
 *   5 malformed        "the ArcGIS error body" (an error delivered with HTTP 200) and "B12 case 5"
 *                      (a body that is not JSON at all, and JSON the schema rejects)
 *   6 rate limit       "B12 case 6"
 *   7 timeout          "B12 case 7"
 *
 * Neither host has ever rate-limited or timed out on this machine, so 6 and 7
 * are raised by the io double rather than by bytes. That double mirrors
 * `lib/io/fetch-source-io.ts` — the failure before any parse, `safeParse`
 * rather than `parse`, and a `SourceFailure` carrying no URL — because a
 * double that parsed more forgivingly than the real `SourceIo` would prove
 * nothing about the malformed case.
 *
 * Both of those cases mean two things here, because there are two datasets and
 * a fallback between them. A failure at the NFHL host is not the end of the
 * flood section: Esri is asked next, and `FloodZoneResult.nfhl` is the record
 * that the authoritative layer failed, with its cause and its retry hint. A
 * failure at the Esri host ends the section, and what it must end as is
 * unavailable and never empty — "no polygon here" and "we could not ask" are
 * the distinction the whole product rests on.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Locus, SourceIo, SourcePolicy } from "@/lib/evidence";
import { complete, runSource, SourceFailure } from "@/lib/evidence";
import {
	ArcgisQueryBody,
	esriReducedSetAdapter,
	FEMA_DATASETS,
	FEMA_VERSION,
	FloodAreaAttrs,
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

// B10's wording, prefixed with the dataset that answered so a no-polygon
// state names its dataset (B12). The second sentence is B10 verbatim.
const NFHL_NOTE =
	"FEMA's own National Flood Hazard Layer answered with no polygon. No digital FEMA designation was available at this point.";
const ESRI_NOTE =
	"No 1% or 0.2% flood hazard polygon intersects this point in the Esri copy of FEMA's layer, dated 2026-03-11. This copy omits minimal-hazard areas, so it cannot tell minimal hazard from an unmapped area.";

/** What a host answers: recorded bytes, a transport failure, a body written inline by a test, or nothing, ever. */
type Route =
	| { readonly fixture: string }
	| { readonly fail: SourceFailure }
	/** Bytes written inline by a test. Never a claim about what either host sends, and never filed as a fixture. */
	| { readonly body: string }
	/** The request is issued and never answers. The policy handed to `runSource` is the only thing that ends it. */
	| { readonly hang: true };

const refused: Route = { fail: new SourceFailure("refused") };

function stubIo(routes: Readonly<Record<string, Route>>): { readonly io: SourceIo; readonly calls: string[] } {
	const calls: string[] = [];
	const io: SourceIo = {
		async get(url, schema) {
			calls.push(url.toString());
			const route = routes[url.host];
			if (route === undefined) throw new Error(`test io has no route for ${url.host}`);
			if ("fail" in route) throw route.fail;
			if ("hang" in route) return new Promise<never>(() => undefined);
			const bytes = "fixture" in route ? readFileSync(`${fixturesDir}${route.fixture}`) : Buffer.from(route.body, "utf8");
			// Mirrors `lib/io/fetch-source-io.ts`: a body that is not JSON and a
			// body the schema rejects are both `malformed`, raised before the
			// adapter is handed anything.
			let json: unknown;
			try {
				json = JSON.parse(bytes.toString("utf8"));
			} catch {
				throw new SourceFailure("malformed", null);
			}
			const parsed = schema.safeParse(json);
			if (!parsed.success) throw new SourceFailure("malformed", null);
			return {
				raw: parsed.data,
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
			"Read from Esri's reduced-set copy of FEMA's National Flood Hazard Layer, not from FEMA's own service."
			+ " Esri's item page gave 2026-03-11 as the copy's date when it was checked on 2026-09-15;"
			+ " no response this adapter parses states it.",
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
	it("labels the record NFHL from the host that answered and carries that layer's two caveats", async () => {
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
		// Two caveats, where this list pinned three until 2026-09-17. The one
		// that said no response from this layer had ever been recorded is gone
		// from `lib/adapters/fema.ts`, because one has been, and the comment
		// above that array is where the deleted sentence is kept.
		expect(record.caveats).toEqual([
			"Read from FEMA's National Flood Hazard Layer, the authoritative source.",
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

describe("B12 case 3, missing optional fields", () => {
	it("validates the recorded row's nulls rather than rejecting them, including a column no record field reads", () => {
		const parsed = ArcgisQueryBody.parse(
			JSON.parse(readFileSync(`${fixturesDir}esri-zone-ae-pasadena.json`).toString("utf8")),
		);
		if ("error" in parsed) throw new Error("expected a features body");
		const [feature] = parsed.features;
		if (feature === undefined) throw new Error("expected one feature");
		// Real recorded nulls, in a row that is otherwise complete. STATIC_BFE is
		// requested and validated and has no record field yet; a null there must
		// not make the whole response malformed.
		expect(feature.attributes.ZONE_SUBTY).toBeNull();
		expect(feature.attributes.STATIC_BFE).toBeNull();
		expect(feature.attributes.FLD_ZONE).toBe("AE");
	});

	it("keeps a null the layer sent apart from a field the layer does not carry", async () => {
		const { io } = stubIo({ [NFHL_HOST]: refused, [ESRI_HOST]: { fixture: "esri-zone-ae-pasadena.json" } });
		const result = await floodZoneOutcome(locus(), io);
		if (result.outcome.status !== "ok") throw new Error(`expected ok, got ${result.outcome.status}`);
		const record = result.outcome.records[0];

		// ZONE_SUBTY arrived, empty: a field provenance whose rawValue is null.
		expect(record.zoneSubtype.value).toBeNull();
		expect(record.zoneSubtype.provenance).toEqual([
			{
				kind: "field",
				dataset: "esri_usa_flood_hazard_reduced_set",
				sourceField: "ZONE_SUBTY",
				rawValue: null,
				transform: "identity",
				adapterVersion: "fema@1",
				payload: { url: `${ESRI_LAYER}/query?${QUERY_TAIL}`, sha256: SHA.pasadena, retrievedAt: NOW },
			},
		]);
		// UPDATE_DATE never arrived at all: an absent provenance, which has no
		// rawValue to show. Both read null; they are not the same fact.
		expect(record.sourceUpdatedAt.value).toBeNull();
		expect(record.sourceUpdatedAt.provenance).toEqual([
			{
				kind: "absent",
				dataset: "esri_usa_flood_hazard_reduced_set",
				sourceField: "UPDATE_DATE",
				adapterVersion: "fema@1",
				payload: { url: `${ESRI_LAYER}/query?${QUERY_TAIL}`, sha256: SHA.pasadena, retrievedAt: NOW },
			},
		]);
		// And the neighbours on the same row are present, so the null is the row's.
		expect(record.zoneCode.value).toBe("AE");
		expect(record.sourceCitation.value).toBe("48201C_FIRM1");
	});

	it("builds a whole record from a row where every nullable column is null", async () => {
		// No recorded row is this empty. The row is built through the adapter's
		// own schema rather than typed as bytes, so it claims nothing about what
		// either host sends: FLD_AR_ID is the one column S_Fld_Haz_Ar requires,
		// and this asserts the record survives on it alone.
		const row = FloodAreaAttrs.parse({
			FLD_ZONE: "A",
			ZONE_SUBTY: null,
			SFHA_TF: null,
			DFIRM_ID: null,
			FLD_AR_ID: "48201C_9999",
			STATIC_BFE: null,
			SOURCE_CIT: null,
		});
		const { io } = stubIo({
			[NFHL_HOST]: refused,
			[ESRI_HOST]: { body: JSON.stringify({ features: [{ attributes: row }] }) },
		});
		const result = await floodZoneOutcome(locus(), io);
		if (result.outcome.status !== "ok") throw new Error(`expected ok, got ${result.outcome.status}`);
		const record = result.outcome.records[0];

		expect(record.sourceRecordId).toBe("48201C_9999");
		expect(record.subject.value).toBe("A");
		expect(record.zoneCode.value).toBe("A");
		expect(record.zoneSubtype.value).toBeNull();
		expect(record.firmPanelId.value).toBeNull();
		expect(record.sourceCitation.value).toBeNull();
		// One null column read three ways, and all three stay null rather than
		// guessing a side of the SFHA boundary.
		expect(record.specialFloodHazardArea.value).toBeNull();
		expect(record.sfhaLabel.value).toBeNull();
		expect(record.sfhaFlag.value).toBeNull();
		expect(record.specialFloodHazardArea.provenance[0]).toMatchObject({
			sourceField: "SFHA_TF",
			rawValue: null,
			transform: "map-boolean",
		});
		expect(record.sourceUrl.value).toBe(`${ESRI_LAYER}/query?where=FLD_AR_ID%3D%2748201C_9999%27&outFields=*&f=html`);
	});
});

describe("B12 case 5, malformed: a body that is not JSON, and JSON the schema rejects", () => {
	it("is unavailable and malformed when the Esri host answers with an HTML error page", async () => {
		const { io } = stubIo({
			[NFHL_HOST]: refused,
			[ESRI_HOST]: { body: "<html><head><title>502 Bad Gateway</title></head><body>502 Bad Gateway</body></html>" },
		});
		const result = await floodZoneOutcome(locus(), io);

		expect(result.dataset).toBe("ESRI_REDUCED_SET");
		expect(result.outcome).toEqual({ status: "unavailable", cause: "malformed", rawCode: null, retryAfter: null });
	});

	it("is unavailable and malformed for a feature row missing the one required column", async () => {
		// FLD_AR_ID is the record's id and the key its citable URL is built from.
		// A row without it must not become a record with a guessed identity.
		const { io } = stubIo({
			[NFHL_HOST]: refused,
			[ESRI_HOST]: { body: JSON.stringify({ features: [{ attributes: { FLD_ZONE: "AE", SFHA_TF: "T" } }] }) },
		});
		const result = await floodZoneOutcome(locus(), io);

		expect(result.outcome).toEqual({ status: "unavailable", cause: "malformed", rawCode: null, retryAfter: null });
	});

	it("falls back when NFHL answers a body we cannot read, and says malformed rather than refused", async () => {
		// This is the likeliest way the NFHL half fails in production: its parse
		// follows FEMA's published field names and no response from that host has
		// ever been checked against it. The reader is owed the difference between
		// a layer that never answered and one whose answer we could not read.
		const { io, calls } = stubIo({
			[NFHL_HOST]: { body: '{"features":[{"attributes":{"FLD_ZONE":"AE"}}]}' },
			[ESRI_HOST]: { fixture: "esri-zone-ae-pasadena.json" },
		});
		const result = await floodZoneOutcome(locus(), io);

		expect(calls).toEqual([`${NFHL_LAYER}/query?${QUERY_TAIL}`, `${ESRI_LAYER}/query?${QUERY_TAIL}`]);
		expect(result.nfhl).toEqual({ status: "unavailable", cause: "malformed", rawCode: null, retryAfter: null });
		expect(result.dataset).toBe("ESRI_REDUCED_SET");
		expect(result.outcome.status).toBe("ok");
	});
});

describe("B12 case 6, rate limit: which host was rate-limited decides whether anything else is asked", () => {
	// Neither host has ever rate-limited this machine, and no 429 from either is
	// recorded — `tests/fixtures/aqs/rate-limited.json` is the repo's only one.
	// So the io raises this the way `lib/io/fetch-source-io.ts` does from a real
	// 429: the source's own status, its own `Retry-After`, and no parse.
	const rateLimited: Route = { fail: new SourceFailure("rate-limited", 429, "120") };

	it("NFHL rate-limited: Esri answers, and the retry hint survives on the record of the failure", async () => {
		const { io, calls } = stubIo({
			[NFHL_HOST]: rateLimited,
			[ESRI_HOST]: { fixture: "esri-zone-x-levee-neworleans.json" },
		});
		const result = await floodZoneOutcome(locus(), io);

		expect(calls).toEqual([`${NFHL_LAYER}/query?${QUERY_TAIL}`, `${ESRI_LAYER}/query?${QUERY_TAIL}`]);
		// Not flattened to "unknown": the card can say which layer was throttled
		// and when it is worth asking again.
		expect(result.nfhl).toEqual({ status: "unavailable", cause: "rate-limited", rawCode: 429, retryAfter: "120" });
		expect(result.dataset).toBe("ESRI_REDUCED_SET");
		if (result.outcome.status !== "ok") throw new Error(`expected ok, got ${result.outcome.status}`);
		const record = result.outcome.records[0];
		expect(record.sourceRecordId).toBe("22071C_10770");
		expect(record.dataset.value).toBe("ESRI_REDUCED_SET");
		expect(record.caveats).toEqual(FEMA_DATASETS.ESRI_REDUCED_SET.caveats);
		expect(record.caveats).not.toEqual(FEMA_DATASETS.NFHL.caveats);
	});

	it("Esri rate-limited: the section ends unavailable, carrying Esri's own code and retry hint", async () => {
		const { io, calls } = stubIo({ [NFHL_HOST]: refused, [ESRI_HOST]: rateLimited });
		const result = await floodZoneOutcome(locus(), io);

		expect(calls).toHaveLength(2);
		expect(result.dataset).toBe("ESRI_REDUCED_SET");
		expect(result.nfhl).toEqual({ status: "unavailable", cause: "refused", rawCode: null, retryAfter: null });
		expect(result.outcome).toEqual({ status: "unavailable", cause: "rate-limited", rawCode: 429, retryAfter: "120" });
	});

	it("throws through the single-dataset adapter, so the kernel is what classifies it", async () => {
		const { io } = stubIo({ [ESRI_HOST]: rateLimited });
		await expect(esriReducedSetAdapter.run(locus(), io)).rejects.toMatchObject({
			name: "SourceFailure",
			reason: "rate-limited",
			rawCode: 429,
			retryAfter: "120",
		});
	});
});

describe("B12 case 7, timeout: two datasets, so two meanings", () => {
	// 20ms, not the 8s `DEFAULT_POLICY`. The last test here waits for it twice.
	const IMPATIENT: SourcePolicy = { timeoutMs: 20 };

	it("NFHL timing out is not the end of the section: Esri is asked and answers", async () => {
		const { io, calls } = stubIo({ [NFHL_HOST]: { hang: true }, [ESRI_HOST]: { fixture: "esri-zone-ae-pasadena.json" } });
		const result = await floodZoneOutcome(locus(), io, IMPATIENT);

		expect(calls).toEqual([`${NFHL_LAYER}/query?${QUERY_TAIL}`, `${ESRI_LAYER}/query?${QUERY_TAIL}`]);
		expect(result.nfhl).toEqual({ status: "unavailable", cause: "timeout", rawCode: null, retryAfter: null });
		expect(result.dataset).toBe("ESRI_REDUCED_SET");
		if (result.outcome.status !== "ok") throw new Error(`expected ok, got ${result.outcome.status}`);
		const record = result.outcome.records[0];
		// The record that reaches the reader is Esri's, and says so in every
		// place it could be mistaken for FEMA's own layer.
		expect(record.dataset.value).toBe("ESRI_REDUCED_SET");
		expect(record.datasetLabel.value).toBe("Esri's reduced-set copy of FEMA's National Flood Hazard Layer");
		expect(record.caveats).toEqual(FEMA_DATASETS.ESRI_REDUCED_SET.caveats);
		expect(record.sourceUrl.value).toBe(`${ESRI_LAYER}/query?where=FLD_AR_ID%3D%2748201C_8563%27&outFields=*&f=html`);
		expect(record.payloads[0].url).toBe(`${ESRI_LAYER}/query?${QUERY_TAIL}`);
	});

	it("an NFHL timeout never becomes an empty answer from NFHL", async () => {
		const { io } = stubIo({ [NFHL_HOST]: { hang: true }, [ESRI_HOST]: { fixture: "esri-no-polygon-houston.json" } });
		const result = await floodZoneOutcome(locus(), io, IMPATIENT);

		expect(result.nfhl).toEqual({ status: "unavailable", cause: "timeout", rawCode: null, retryAfter: null });
		expect(result.dataset).toBe("ESRI_REDUCED_SET");
		// The layer that did not answer must not be the one quoted as having
		// found nothing. Esri's wording, on Esri's empty answer.
		expect(result.outcome).toEqual({ status: "no-data", note: ESRI_NOTE, retrievedAt: NOW });
		expect(result.outcome.status === "no-data" && result.outcome.note).not.toBe(NFHL_NOTE);
	});

	it("Esri timing out is the end of the section: unavailable, and nothing follows it", async () => {
		const { io, calls } = stubIo({ [NFHL_HOST]: refused, [ESRI_HOST]: { hang: true } });
		const result = await floodZoneOutcome(locus(), io, IMPATIENT);

		// There is no third dataset, so this is the last word: unavailable, never
		// the no-data note of a copy that never answered.
		expect(calls).toEqual([`${NFHL_LAYER}/query?${QUERY_TAIL}`, `${ESRI_LAYER}/query?${QUERY_TAIL}`]);
		expect(result.dataset).toBe("ESRI_REDUCED_SET");
		expect(result.nfhl).toEqual({ status: "unavailable", cause: "refused", rawCode: null, retryAfter: null });
		expect(result.outcome).toEqual({ status: "unavailable", cause: "timeout", rawCode: null, retryAfter: null });
	});

	it("both hosts hanging is unavailable twice over, and each dataset is given the whole budget in turn", async () => {
		const { io, calls } = stubIo({ [NFHL_HOST]: { hang: true }, [ESRI_HOST]: { hang: true } });
		const started = Date.now();
		const result = await floodZoneOutcome(locus(), io, IMPATIENT);
		const elapsed = Date.now() - started;

		expect(calls).toHaveLength(2);
		expect(result.nfhl).toEqual({ status: "unavailable", cause: "timeout", rawCode: null, retryAfter: null });
		expect(result.outcome).toEqual({ status: "unavailable", cause: "timeout", rawCode: null, retryAfter: null });
		// The two runs are sequential and each starts its own timer, so the flood
		// section's worst case is two whole policies rather than one.
		// `app/api/report/handler.ts` hands it `DEFAULT_POLICY`, which makes that
		// 16s here against 8s for every other source.
		expect(elapsed).toBeGreaterThanOrEqual(2 * IMPATIENT.timeoutMs);
	});

	it("is unavailable rather than zero rows when one dataset is run on its own", async () => {
		// A source we could not ask has not answered with nothing. `runSource` is
		// what draws that line, and it has to draw it for each adapter alone as
		// well as for the pair.
		const { io } = stubIo({ [NFHL_HOST]: { hang: true } });
		const outcome = await runSource(locus(), nfhlAdapter, io, IMPATIENT);

		expect(outcome).toEqual({ status: "unavailable", cause: "timeout", rawCode: null, retryAfter: null });
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

/* -------------------------------------------------------------------------- */
/* The authoritative layer, captured 2026-09-17 from us-central1              */
/* -------------------------------------------------------------------------- */

/**
 * `FloodAreaAttrs` was written from FEMA's published field names for
 * S_Fld_Haz_Ar and carried a caveat saying no response had ever been checked
 * against it. These are that check. The schema parses both real rows with no
 * change, which is the outcome the caveat was hedging against and not a given:
 * the same exercise against AQS on 2026-09-16 falsified three of thirteen
 * column names.
 */
describe("the authoritative NFHL layer, against a schema written before it ever answered", () => {
	const nfhlBody = (name: string): unknown => JSON.parse(readFileSync(`${fixturesDir}${name}`, "utf8"));

	const rowsOf = (name: string): readonly FloodAreaAttrs[] => {
		const parsed = ArcgisQueryBody.parse(nfhlBody(name));
		if ("error" in parsed) throw new Error(`${name} is an ArcGIS error body`);
		return parsed.features.map((feature) => feature.attributes);
	};

	it("parses both recorded point responses with no schema change", () => {
		for (const name of ["nfhl-minimal-hazard.json", "nfhl-zone-ae-pasadena.json"]) {
			const parsed = ArcgisQueryBody.safeParse(nfhlBody(name));

			expect(parsed.success, `${name} did not parse`).toBe(true);
		}
	});

	/**
	 * Queue item 10 in `.dev/PLAN.md` asked this and could not answer it.
	 * `FLD_AR_ID` is the layer's primary key and the record id is built from it,
	 * so a null would have read as `malformed` and cost the whole card.
	 */
	it("carries a non-null FLD_AR_ID in every real row", () => {
		const rows = [...rowsOf("nfhl-minimal-hazard.json"), ...rowsOf("nfhl-zone-ae-pasadena.json")];

		expect(rows).toHaveLength(2);
		expect(rows.map((row) => row.FLD_AR_ID)).toEqual(["48201C_8882", "48201C_9306"]);
	});

	/**
	 * The point the whole fallback argument was about. `docs/BRIEF.md` A6 puts
	 * this address on screen, and the Esri copy drops unshaded X entirely, so
	 * the card could only say it was unable to tell minimal hazard from
	 * unmapped. The authoritative layer says which one it is.
	 */
	it("names minimal hazard at the demo point, where the Esri copy returns nothing at all", () => {
		const [authoritative] = rowsOf("nfhl-minimal-hazard.json");
		const copy = ArcgisQueryBody.parse(nfhlBody("esri-no-polygon-houston.json"));
		if (authoritative === undefined) throw new Error("the NFHL fixture has no row");
		if ("error" in copy) throw new Error("the Esri fixture is an error body");

		expect(copy.features).toHaveLength(0);
		expect(authoritative.FLD_ZONE).toBe("X");
		expect(authoritative.ZONE_SUBTY).toBe("AREA OF MINIMAL FLOOD HAZARD");
		expect(authoritative.SFHA_TF).toBe("F");
	});

	/**
	 * Both datasets describe the same point and disagree about its identifier,
	 * which is why `SourcePlacement.agency` exists and why every record says
	 * which layer answered. A reader comparing two reports of one address would
	 * otherwise see two different flood areas and no way to tell why.
	 */
	it("agrees with the Esri copy about the zone and disagrees about the flood-area id", () => {
		const [authoritative] = rowsOf("nfhl-zone-ae-pasadena.json");
		const [copy] = rowsOf("esri-zone-ae-pasadena.json");
		if (authoritative === undefined || copy === undefined) throw new Error("a Pasadena fixture has no row");

		expect(authoritative.FLD_ZONE).toBe(copy.FLD_ZONE);
		expect(authoritative.SFHA_TF).toBe(copy.SFHA_TF);
		expect(authoritative.DFIRM_ID).toBe(copy.DFIRM_ID);
		expect(authoritative.FLD_AR_ID).toBe("48201C_9306");
		expect(copy.FLD_AR_ID).toBe("48201C_8563");
	});

	/**
	 * `STATIC_BFE` is requested and validated and reaches no record field. The
	 * authoritative layer sends -9999 where the copy sends null, and -9999 is an
	 * ArcGIS no-data sentinel rather than an elevation. A record field for it
	 * would have printed a base flood elevation of minus nine thousand feet.
	 */
	it("sends a no-data sentinel for STATIC_BFE that no record field can carry", () => {
		const [authoritative] = rowsOf("nfhl-zone-ae-pasadena.json");
		const [copy] = rowsOf("esri-zone-ae-pasadena.json");
		if (authoritative === undefined || copy === undefined) throw new Error("a Pasadena fixture has no row");

		expect(authoritative.STATIC_BFE).toBe(-9999);
		expect(copy.STATIC_BFE).toBeNull();
	});
});
