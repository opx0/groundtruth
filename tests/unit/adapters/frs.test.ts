/**
 * The FRS adapter against the committed fixtures.
 *
 * FRS's job is an identity lookup keyed by registry ID, not a list: a
 * five-mile radius around the demo point answers 6,915 programme-interest
 * rows, so this adapter is never driven by a locus. These tests call it the
 * way an ECHO or SEMS resolution step will, one registry ID at a time,
 * against a `SourceIo` that serves the committed ArcGIS bytes instead of the
 * network.
 *
 * No committed fixture happens to disagree on a facility's identity across its
 * own rows — both recorded registries agree on name and coordinate everywhere.
 * The disagreement tests below build that case from the real fixture rows by
 * perturbing one field in memory, the same way `echo.test.ts` perturbs one
 * status string to exercise the "code has never seen this" path no fixture
 * demonstrates.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { JsonObject, PayloadRef, RecordOf, Sealed, SourceIo } from "@/lib/evidence";
import { complete, SourceFailure } from "@/lib/evidence";
import { houstonLocus } from "@/tests/unit/evidence/helpers/sems-fixtures";
import {
	ArcgisResponse,
	FRS_CAVEATS,
	frsFacility,
	identityMismatches,
	lookupFrsFacility,
	registryQueryUrl,
} from "@/lib/adapters/frs";

const fixturesRoot = fileURLToPath(new URL("../../fixtures/", import.meta.url));
const RETRIEVED_AT = "2026-09-16T12:00:00Z";

type FrsRecord = Sealed<RecordOf<"frs-facility">>;

function bytesOf(relative: string): Buffer {
	return readFileSync(`${fixturesRoot}${relative}`);
}

function payloadOf(relative: string, bytes: Buffer): PayloadRef {
	return { url: `fixture:${relative}`, sha256: createHash("sha256").update(bytes).digest("hex"), retrievedAt: RETRIEVED_AT };
}

type Step = { readonly fixture: string } | { readonly fail: SourceFailure };

function stubIo(step: Step): { readonly io: SourceIo; readonly calls: URL[] } {
	const calls: URL[] = [];
	const io: SourceIo = {
		get<Raw extends JsonObject>(url: URL, schema: z.ZodType<Raw>) {
			calls.push(url);
			if ("fail" in step) return Promise.reject(step.fail);
			const bytes = bytesOf(step.fixture);
			return Promise.resolve({ raw: schema.parse(JSON.parse(bytes.toString("utf8"))), payload: payloadOf(step.fixture, bytes) });
		},
		query(parameter, value, adapterVersion, payload) {
			return { kind: "query", parameter, value, adapterVersion, payload };
		},
		now: () => RETRIEVED_AT,
	};
	return { io, calls };
}

/** The layer's parsed features and the payload they were read from, for the tests that build `Built` values by hand. */
function loadLayer(relative: string) {
	const bytes = bytesOf(relative);
	const parsed = ArcgisResponse.parse(JSON.parse(bytes.toString("utf8")));
	if (!("features" in parsed)) throw new Error(`${relative} is an error body, not a layer`);
	return { features: parsed.features, payload: payloadOf(relative, bytes) };
}

async function facilityFrom(fixture: string, registryId: string): Promise<FrsRecord> {
	const { io } = stubIo({ fixture });
	const [built] = await lookupFrsFacility(registryId, io);
	if (built === undefined) throw new Error(`expected a facility for ${registryId}`);
	return complete(houstonLocus(), built);
}

const HOUSTON_REFINERY = "frs/arcgis-registry-110000460885.json";
const TWO_IDS = "frs/arcgis-registry-110000462703-two-ids.json";

describe("the request", () => {
	it("filters the FRS_INTERESTS layer on REGISTRY_ID, with no geometry returned", () => {
		expect(registryQueryUrl("110000460885").toString()).toBe(
			"https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/FRS_INTERESTS/FeatureServer/0/query" +
				"?where=REGISTRY_ID%3D%27110000460885%27&outFields=*&returnGeometry=false&f=json",
		);
	});

	it("doubles an embedded quote the way a SQL-like where clause escapes one", () => {
		expect(registryQueryUrl("11'0").searchParams.get("where")).toBe("REGISTRY_ID='11''0'");
	});
});

describe("a facility with 38 programme-interest rows across 15 programmes", () => {
	it("collapses every row into one record, keyed by the registry ID", async () => {
		const record = await facilityFrom(HOUSTON_REFINERY, "110000460885");

		expect(record.kind).toBe("frs-facility");
		expect(record.source).toBe("frs");
		expect(record.sourceRecordId).toBe("110000460885");
		expect(record.registryId.value).toBe("110000460885");
		expect(record.subject.value).toBe("HOUSTON REFINERY");
		expect(record.sourceUrl.value).toBe("https://echo.epa.gov/detailed-facility-report?fid=110000460885");
		expect(record.location?.latitude.value).toBe(29.722274);
		expect(record.location?.longitude.value).toBe(-95.254401);
		// The most recently updated row's UPDATE_DATE, not the first row's.
		expect(record.sourceUpdatedAt.value).toBe("2024-03-14T10:51:51Z");
		expect(record.effectiveAt.value).toBeNull();
		expect(record.caveats).toEqual(FRS_CAVEATS);

		expect(record.programInterests.value).toHaveLength(38);
		expect(new Set(record.programInterests.value.map((interest) => interest.program)).size).toBe(15);
	});

	it("carries the coordinate's own quality fields into location, null on this real facility", async () => {
		const record = await facilityFrom(HOUSTON_REFINERY, "110000460885");

		expect(record.location?.accuracyMeters.value).toBeNull();
		expect(record.location?.collectionMethod.value).toBeNull();
		expect(record.location?.referencePoint.value).toBe("CENTER OF A FACILITY OR STATION");
	});

	it("passes an active-status code it has never catalogued through unchanged", async () => {
		const record = await facilityFrom(HOUSTON_REFINERY, "110000460885");

		const tsca = record.programInterests.value.find((interest) => interest.programId === "TSCA10169492");
		if (tsca === undefined) throw new Error("expected the TSCA10169492 programme-interest row");
		expect(tsca.program).toBe("TSCA");
		expect(tsca.interestType).toBe("TSCA SUBMITTER");
		expect(tsca.activeStatus).toBe("***UNCHANGED***");
	});

	it("sources programInterests through the outFields request parameter", async () => {
		const record = await facilityFrom(HOUSTON_REFINERY, "110000460885");

		const [provenance] = record.programInterests.provenance;
		expect(provenance.kind).toBe("query");
		if (provenance.kind !== "query") throw new Error("expected query provenance");
		expect(provenance.parameter).toBe("outFields");
		expect(provenance.value).toBe("*");
	});

	it("names exactly the one payload it was built from", async () => {
		const record = await facilityFrom(HOUSTON_REFINERY, "110000460885");

		expect(record.payloads).toHaveLength(1);
		expect(record.payloads[0]?.url).toBe(`fixture:${HOUSTON_REFINERY}`);
	});

	it("builds the link from the registry ID it read, not a literal", async () => {
		const record = await facilityFrom(HOUSTON_REFINERY, "110000460885");

		const [computation] = record.sourceUrl.provenance;
		if (computation.kind !== "computation") throw new Error("sourceUrl is not a url-template computation");
		expect(computation.formula).toBe("url-template");
		expect(computation.inputs.map((input) => input.value)).toEqual([
			"https://echo.epa.gov/detailed-facility-report?fid={id}",
			"110000460885",
		]);
	});
});

describe("one registry ID, two Superfund site IDs", () => {
	it("keeps both EPA IDs as separate programme-interest rows under the one registry ID", async () => {
		const record = await facilityFrom(TWO_IDS, "110000462703");

		expect(record.sourceRecordId).toBe("110000462703");
		expect(record.subject.value).toBe("PASADENA REFINING SYSTEM, INC.");
		expect(record.programInterests.value).toEqual([
			{ program: "SEMS", programId: "TXN000607355", interestType: "SUPERFUND (NON-NPL)", activeStatus: "NOT ON THE NPL" },
			{ program: "SEMS", programId: "TXN000605303", interestType: "SUPERFUND (NON-NPL)", activeStatus: "NOT ON THE NPL" },
		]);
		// The two rows' UPDATE_DATE values differ by two seconds; the later one wins.
		expect(record.sourceUpdatedAt.value).toBe("2021-11-24T13:48:56Z");
	});
});

describe("a registry ID FRS has no row for", () => {
	it("is zero results, not a failure", async () => {
		const { io, calls } = stubIo({ fixture: "sems/arcgis-no-records-nevada.json" });

		const built = await lookupFrsFacility("999999999999", io);

		expect(built).toEqual([]);
		expect(calls).toHaveLength(1);
	});
});

describe("the source's error body", () => {
	it("is unavailable, not an empty result, even though ArcGIS answers it with HTTP 200", async () => {
		const { io } = stubIo({ fixture: "fema/esri-error-bad-geometry.json" });

		await expect(lookupFrsFacility("110000460885", io)).rejects.toMatchObject(
			new SourceFailure("http", 400),
		);
	});

	it("raises a transport failure rather than swallowing it as no-data", async () => {
		const { io } = stubIo({ fail: new SourceFailure("timeout") });

		await expect(lookupFrsFacility("110000460885", io)).rejects.toBeInstanceOf(SourceFailure);
	});
});

describe("facility-identity fields that disagree across a registry ID's rows", () => {
	it("is surfaced as a caveat rather than silently taking the first row", () => {
		const layer = loadLayer(HOUSTON_REFINERY);
		const [first, ...rest] = layer.features;
		if (first === undefined) throw new Error("fixture has no features");
		const disagreeing = { attributes: { ...first.attributes, PRIMARY_NAME: "HOUSTON REFINERY ANNEX" } };

		expect(identityMismatches([disagreeing.attributes, ...rest.map((feature) => feature.attributes)])).toEqual([
			"PRIMARY_NAME",
		]);

		const built = frsFacility([disagreeing, ...rest], layer.payload, stubIo({ fixture: HOUSTON_REFINERY }).io);
		expect(built.caveats).toContain(
			"FRS's own programme-interest rows disagree on PRIMARY_NAME for this registry ID; the first row's values are shown.",
		);
		// The identity fields still come from the first row, not an average or a guess.
		expect(built.subject.value).toBe("HOUSTON REFINERY ANNEX");
	});

	it("adds no caveat when every row agrees, which is every committed fixture", () => {
		const layer = loadLayer(HOUSTON_REFINERY);

		expect(identityMismatches(layer.features.map((feature) => feature.attributes))).toEqual([]);

		const [first, ...rest] = layer.features;
		if (first === undefined) throw new Error("fixture has no features");
		const built = frsFacility([first, ...rest], layer.payload, stubIo({ fixture: HOUSTON_REFINERY }).io);
		expect(built.caveats).toEqual(FRS_CAVEATS);
	});
});
