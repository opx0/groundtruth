/**
 * Facility grouping, against the committed fixtures — .dev/BRIEF.md B6.
 *
 * Every record here is built the way the real adapters build it (`lookupFrsFacility`,
 * `createEchoAdapter`, `esriReducedSetAdapter`, and the shared SEMS test helper),
 * fed real committed bytes through a stub `SourceIo`. Nothing here invents a
 * payload; the facts asserted below — which two names one registry ID carries,
 * which two real ECHO facilities sit at the same coordinate, which two sit
 * meters apart under very different names — are all read off
 * `tests/fixtures/**`, not made up for the test.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { complete, haversine, runSource } from "@/lib/evidence";
import type { EvidenceRecord, JsonValue, PayloadRef, RecordOf, Sealed, SourceIo } from "@/lib/evidence";
import { lookupFrsFacility } from "@/lib/adapters/frs";
import { createEchoAdapter } from "@/lib/adapters/echo";
import { esriReducedSetAdapter } from "@/lib/adapters/fema";
import { houstonLocus, semsRecord } from "@/tests/unit/evidence/helpers/sems-fixtures";
import {
	anchoredDistanceMeters,
	groupRecords,
	NAME_SIMILARITY_THRESHOLD,
	NEARBY_COORDINATE_METERS,
	nameTokenSimilarity,
	type FacilityGroup,
} from "@/lib/report/grouping";

const fixturesDir = fileURLToPath(new URL("../../fixtures/", import.meta.url));
const RETRIEVED_AT = "2026-09-16T12:00:00Z";

function bytesOf(relative: string): Buffer {
	return readFileSync(`${fixturesDir}${relative}`);
}

function payloadOf(url: string, bytes: Buffer): PayloadRef {
	return { url, sha256: createHash("sha256").update(bytes).digest("hex"), retrievedAt: RETRIEVED_AT };
}

/* -------------------------------------------------------------------------- */
/* Real records, built the way the adapters build them.                      */
/* -------------------------------------------------------------------------- */

/** One FRS facility, from the real ArcGIS FRS_INTERESTS layer bytes for one registry ID. */
async function frsFacilityRecord(fixtureRelative: string, registryId: string): Promise<Sealed<RecordOf<"frs-facility">>> {
	const io: SourceIo = {
		get<Raw extends JsonValue>(url: URL, schema: z.ZodType<Raw>) {
			const bytes = bytesOf(fixtureRelative);
			return Promise.resolve({ raw: schema.parse(JSON.parse(bytes.toString("utf8"))), payload: payloadOf(url.toString(), bytes) });
		},
		query: (parameter, value, adapterVersion, payload) => ({ kind: "query", parameter, value, adapterVersion, payload }),
		now: () => RETRIEVED_AT,
	};
	const [built] = await lookupFrsFacility(registryId, io);
	if (built === undefined) throw new Error(`expected a facility for ${registryId}`);
	return complete(houstonLocus(), built);
}

/** Every ECHO facility within a quarter mile of the demo point, from the two real ECHO response bytes. */
async function echoQuarterMileRecords(): Promise<readonly Sealed<RecordOf<"echo-facility">>[]> {
	const steps = ["echo/facilities-quarter-mi.json", "echo/facilities-page-quarter-mi.json"];
	let step = 0;
	const io: SourceIo = {
		get<Raw extends JsonValue>(url: URL, schema: z.ZodType<Raw>) {
			const relative = steps[Math.min(step, steps.length - 1)];
			step += 1;
			if (relative === undefined) throw new Error("echo stub ran out of steps");
			const bytes = bytesOf(relative);
			return Promise.resolve({ raw: schema.parse(JSON.parse(bytes.toString("utf8"))), payload: payloadOf(url.toString(), bytes) });
		},
		query: (parameter, value, adapterVersion, payload) => ({ kind: "query", parameter, value, adapterVersion, payload }),
		now: () => RETRIEVED_AT,
	};
	const outcome = await runSource(houstonLocus(), createEchoAdapter({ retryDelayMs: 0 }), io, { timeoutMs: 5000 });
	if (outcome.status !== "ok") throw new Error(`expected ok ECHO outcome, got ${outcome.status}`);
	return outcome.records;
}

function byRegistry(records: readonly Sealed<RecordOf<"echo-facility">>[], registryId: string): Sealed<RecordOf<"echo-facility">> {
	const found = records.find((record) => record.sourceRecordId === registryId);
	if (found === undefined) throw new Error(`no ECHO record for registry ${registryId}`);
	return found;
}

/** One FEMA flood-zone record, from the real Esri fixture. `location` is always null on this kind — it is not a facility and never eligible for grouping. */
async function femaFloodZoneRecord(): Promise<Sealed<RecordOf<"fema-flood-zone">>> {
	const relative = "fema/esri-zone-ae-pasadena.json";
	const io: SourceIo = {
		get<Raw extends JsonValue>(url: URL, schema: z.ZodType<Raw>) {
			const bytes = bytesOf(relative);
			return Promise.resolve({ raw: schema.parse(JSON.parse(bytes.toString("utf8"))), payload: payloadOf(url.toString(), bytes) });
		},
		query: (parameter, value, adapterVersion, payload) => ({ kind: "query", parameter, value, adapterVersion, payload }),
		now: () => RETRIEVED_AT,
	};
	const outcome = await runSource(houstonLocus(), esriReducedSetAdapter, io, { timeoutMs: 5000 });
	if (outcome.status !== "ok") throw new Error(`expected ok FEMA outcome, got ${outcome.status}`);
	const [record] = outcome.records;
	return record;
}

const TWO_IDS_FIXTURE = "frs/arcgis-registry-110000462703-two-ids.json";
const HOUSTON_REFINERY_FIXTURE = "frs/arcgis-registry-110000460885.json";

/* -------------------------------------------------------------------------- */
/* Rule 1 — exact FRS registry ID.                                           */
/* -------------------------------------------------------------------------- */

describe("rule 1 — an exact FRS registry ID match", () => {
	it("groups the two Superfund site IDs under one registry ID as confirmed", async () => {
		const siteA = semsRecord(houstonLocus(), "TXN000607355");
		const siteB = semsRecord(houstonLocus(), "TXN000605303");
		expect(siteA.frsRegistryId.value).toBe("110000462703");
		expect(siteB.frsRegistryId.value).toBe("110000462703");

		const result = groupRecords([siteA, siteB]);

		expect(result.ungrouped).toEqual([]);
		expect(result.groups).toHaveLength(1);
		const [group] = result.groups;
		if (group === undefined) throw new Error("expected one group");
		expect(group.confidence).toBe("confirmed");
		if (group.confidence !== "confirmed") throw new Error("unreachable");
		expect(group.reason).toBe("registry-id");
		expect(group.matchedId).toBe("110000462703");
		// Both original records, unmerged: their own IDs are still there to inspect.
		expect(group.members.map((member) => member.sourceRecordId).sort()).toEqual(["TXN000605303", "TXN000607355"]);
	});

	it("keeps both names for one registry ID reachable, neither discarded", async () => {
		const frsFacility = await frsFacilityRecord(HOUSTON_REFINERY_FIXTURE, "110000460885");
		const semsSite = semsRecord(houstonLocus(), "TXN000622182");
		expect(frsFacility.subject.value).toBe("HOUSTON REFINERY");
		// The real Envirofacts row for this EPA ID names the same registry ID "VALERO PLUME".
		expect(semsSite.subject.value).toBe("VALERO PLUME");
		expect(semsSite.frsName.value).toBe("HOUSTON REFINERY");
		expect(semsSite.frsRegistryId.value).toBe("110000460885");

		const result = groupRecords([frsFacility, semsSite]);

		expect(result.groups).toHaveLength(1);
		const [group] = result.groups;
		if (group === undefined) throw new Error("expected one group");
		expect(group.confidence).toBe("confirmed");
		if (group.confidence !== "confirmed") throw new Error("unreachable");
		expect(group.reason).toBe("registry-id");
		// Grouping never merges: each member is the exact same object, still carrying its own name.
		expect(group.members).toContain(frsFacility);
		expect(group.members).toContain(semsSite);
		const names = new Set(group.members.map((member) => member.subject.value));
		expect(names).toEqual(new Set(["HOUSTON REFINERY", "VALERO PLUME"]));
	});
});

/* -------------------------------------------------------------------------- */
/* Rule 2 — exact programme ID.                                              */
/* -------------------------------------------------------------------------- */

describe("rule 2 — an exact programme ID match", () => {
	it("is present in the real two-ID fixture: the FRS facility's own programme interests name the two SEMS records' IDs", async () => {
		const frsFacility = await frsFacilityRecord(TWO_IDS_FIXTURE, "110000462703");
		const programIds = frsFacility.programInterests.map((interest) => interest.programId.value);
		expect(programIds).toEqual(["TXN000607355", "TXN000605303"]);

		const siteA = semsRecord(houstonLocus(), "TXN000607355");
		const siteB = semsRecord(houstonLocus(), "TXN000605303");
		expect(programIds).toContain(siteA.epaSiteId.value);
		expect(programIds).toContain(siteB.epaSiteId.value);

		// This trio is already linked by rule 1 (they share registry ID 110000462703
		// too), so the confirmed group's stated reason is rule 1's, the higher one —
		// but the programme-ID agreement is real and holds regardless.
		const result = groupRecords([frsFacility, siteA, siteB]);
		expect(result.groups).toHaveLength(1);
		const [group] = result.groups;
		if (group === undefined) throw new Error("expected one group");
		if (group.confidence !== "confirmed") throw new Error("expected confirmed");
		expect(group.reason).toBe("registry-id");
		expect(group.members).toHaveLength(3);
	});
});

/* -------------------------------------------------------------------------- */
/* Rule 3 — similar name, nearby coordinate. Conservative by design.          */
/* -------------------------------------------------------------------------- */

describe("rule 3 — similar name plus nearby coordinate (suggested, never confirmed)", () => {
	it("suggests a match for two real, differently-registered ECHO facilities sharing a name and a coordinate", async () => {
		const records = await echoQuarterMileRecords();
		const westwayHouston = byRegistry(records, "110070369610");
		const westwayLlc = byRegistry(records, "110035313844");
		expect(westwayHouston.subject.value).toBe("WESTWAY FEED PRODUCTS HOUSTON");
		expect(westwayLlc.subject.value).toBe("WESTWAY FEED PRODUCTS LLC");
		expect(westwayHouston.registryId.value).not.toBe(westwayLlc.registryId.value);

		const result = groupRecords([westwayHouston, westwayLlc]);

		expect(result.ungrouped).toEqual([]);
		expect(result.groups).toHaveLength(1);
		const [group] = result.groups;
		if (group === undefined) throw new Error("expected one group");
		expect(group.confidence).toBe("suggested");
		if (group.confidence !== "suggested") throw new Error("unreachable");
		expect(group.label).toBe("Possible match");
		expect(group.reason).toBe("similar-name-and-coordinate");
		expect(group.nameSimilarity).toBeGreaterThanOrEqual(NAME_SIMILARITY_THRESHOLD);
		expect(group.coordinateDistanceMeters.value).toBe(0);
		expect(anchoredDistanceMeters(group)).toBeNull(); // neither member is FRS- or SEMS-sourced
	});

	it("does not group a real near-miss: two ECHO facilities ~24m apart share zero meaningful name words", async () => {
		const records = await echoQuarterMileRecords();
		const grizzly = byRegistry(records, "110070365452");
		const southPort = byRegistry(records, "110016765277");
		expect(grizzly.subject.value).toBe("GRIZZLY VAEVSERVICES");
		expect(southPort.subject.value).toBe("SOUTH-PORT SYSTEMS, INC.");

		// The coordinate gate alone would not have stopped this pair: they are
		// genuinely close, well inside the "nearby" threshold.
		if (grizzly.location === null || southPort.location === null) throw new Error("expected both to have a coordinate");
		const distance = haversine(grizzly.location, southPort.location);
		expect(distance.value).toBeLessThan(NEARBY_COORDINATE_METERS);
		expect(nameTokenSimilarity(grizzly.subject.value, southPort.subject.value)).toBe(0);

		const result = groupRecords([grizzly, southPort]);

		expect(result.groups).toEqual([]);
		expect(result.ungrouped).toHaveLength(2);
		expect(result.ungrouped).toContain(grizzly);
		expect(result.ungrouped).toContain(southPort);
	});

	it("does not group a second real near-miss: a similar name pair ~2.1km apart, well outside the coordinate threshold", async () => {
		const houstonRefinery = semsRecord(houstonLocus(), "TXN000622182"); // registry 110000460885
		const houstonRefiningLp = semsRecord(houstonLocus(), "TXD981157522"); // registry 110058113704, a different real facility
		expect(houstonRefinery.frsName.value).toBe("HOUSTON REFINERY");
		expect(houstonRefiningLp.frsName.value).toBe("HOUSTON REFINING LP");
		expect(houstonRefinery.frsRegistryId.value).not.toBe(houstonRefiningLp.frsRegistryId.value);

		const result = groupRecords([houstonRefinery, houstonRefiningLp]);

		expect(result.groups).toEqual([]);
		expect(result.ungrouped).toHaveLength(2);
	});
});

/* -------------------------------------------------------------------------- */
/* Confidence is structural, not a boolean a caller can skip past.           */
/* -------------------------------------------------------------------------- */

describe("a suggested group cannot be read as confirmed by accident", () => {
	/** The shape a real caller would use: it must handle both branches to compile at all. */
	function describeForReader(group: FacilityGroup): string {
		switch (group.confidence) {
			case "confirmed":
				return `Same facility (${group.reason}: ${group.matchedId})`;
			case "suggested":
				return `${group.label} — ${Math.round(group.nameSimilarity * 100)}% name overlap`;
		}
	}

	it("forces an exhaustive switch on `confidence`: the two branches read differently, and nothing lets one pose as the other", async () => {
		const records = await echoQuarterMileRecords();
		const westwayHouston = byRegistry(records, "110070369610");
		const westwayLlc = byRegistry(records, "110035313844");
		const suggested = groupRecords([westwayHouston, westwayLlc]).groups;
		const [suggestedGroup] = suggested;
		if (suggestedGroup === undefined) throw new Error("expected the Westway pair to produce a suggested group");

		const siteA = semsRecord(houstonLocus(), "TXN000607355");
		const siteB = semsRecord(houstonLocus(), "TXN000605303");
		const confirmed = groupRecords([siteA, siteB]).groups;
		const [confirmedGroup] = confirmed;
		if (confirmedGroup === undefined) throw new Error("expected the two SEMS IDs to produce a confirmed group");

		expect(describeForReader(suggestedGroup)).toBe("Possible match — 75% name overlap");
		expect(describeForReader(confirmedGroup)).toBe("Same facility (registry-id: 110000462703)");
	});

	it("does not expose `label` on the union type without narrowing on `confidence` first", async () => {
		const records = await echoQuarterMileRecords();
		const westwayHouston = byRegistry(records, "110070369610");
		const westwayLlc = byRegistry(records, "110035313844");
		const [group] = groupRecords([westwayHouston, westwayLlc]).groups;
		if (group === undefined) throw new Error("expected a suggested group");

		// @ts-expect-error `label` exists only on `SuggestedGroup`, never on the plain `FacilityGroup` union — a caller must narrow on `confidence` before it compiles, so a confirmed group can never be misread as carrying a "possible match" label, or vice versa.
		const cannotCompileWithoutNarrowing: string = group.label;
		expect(cannotCompileWithoutNarrowing).toBe("Possible match");
	});
});

/* -------------------------------------------------------------------------- */
/* Totality: no record is ever dropped.                                      */
/* -------------------------------------------------------------------------- */

describe("grouping never drops a record", () => {
	it("keeps every input reachable, grouped or alone — confirmed pairs, a suggested pair, a solo record, and a kind grouping does not consider", async () => {
		const siteA = semsRecord(houstonLocus(), "TXN000607355"); // -> confirmed group with siteB
		const siteB = semsRecord(houstonLocus(), "TXN000605303");
		const solo = semsRecord(houstonLocus(), "TXN000607443"); // "SUPPLY PRO FIRE", unrelated to anything else here

		const records = await echoQuarterMileRecords();
		const westwayHouston = byRegistry(records, "110070369610"); // -> suggested group
		const westwayLlc = byRegistry(records, "110035313844");
		const grizzly = byRegistry(records, "110070365452"); // near-miss: stays alone
		const southPort = byRegistry(records, "110016765277");

		const flood = await femaFloodZoneRecord(); // not a groupable kind at all

		const input: readonly Sealed<EvidenceRecord>[] = [
			siteA,
			siteB,
			solo,
			westwayHouston,
			westwayLlc,
			grizzly,
			southPort,
			flood,
		];

		const result = groupRecords(input);

		const seen = new Set<Sealed<EvidenceRecord>>();
		for (const group of result.groups) for (const member of group.members) seen.add(member);
		for (const alone of result.ungrouped) seen.add(alone);

		expect(seen.size).toBe(input.length);
		for (const record of input) expect(seen.has(record)).toBe(true);

		expect(result.groups).toHaveLength(2); // the two SEMS IDs, and the Westway pair
		expect(result.ungrouped).toEqual(expect.arrayContaining([solo, grizzly, southPort, flood]));
		expect(result.ungrouped).toHaveLength(4);
	});
});
