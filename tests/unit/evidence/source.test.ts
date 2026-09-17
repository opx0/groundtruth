import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Adapter, Built, Kind, SourceIo, SourceId } from "@/lib/evidence";
import { recordId, runSource, runSources, SourceFailure, storeOfSources } from "@/lib/evidence";
import {
	envirofactsFor,
	frsLayer,
	frsRowFor,
	houstonLocus,
	loadFixture,
	NEAREST_EPA_ID,
	semsBuilt,
} from "./helpers/sems-fixtures";

const locus = houstonLocus();
const io: SourceIo = {
	get() {
		return Promise.reject(new SourceFailure("refused"));
	},
	query(parameter, value, adapterVersion, payload) {
		return { kind: "query", parameter, value, adapterVersion, payload };
	},
	now: () => "2026-09-15T18:00:00Z",
};

function adapterReturning(run: Adapter<"sems-site">["run"]): Adapter<"sems-site"> {
	return { kind: "sems-site", source: "sems", version: "sems@1", run };
}

describe("source outcomes (graft 2 and graft 3)", () => {
	it("ok carries the completed, sealed records", async () => {
		const layer = frsLayer();
		const adapter = adapterReturning(async () =>
			layer.raw.features
				.filter((f) => f.attributes.PGM_SYS_ID === NEAREST_EPA_ID)
				.map((f) => semsBuilt({ raw: f.attributes, payload: layer.payload }, envirofactsFor(NEAREST_EPA_ID))),
		);
		const outcome = await runSource(locus, adapter, io, { timeoutMs: 1000 });
		if (outcome.status !== "ok") throw new Error(outcome.status);
		expect(outcome.records).toHaveLength(1);
		expect(outcome.records[0].id).toEqual({ kind: "sems-site", sourceRecordId: NEAREST_EPA_ID });
		expect(outcome.records[0].distanceMeters?.value).toBe(755);
		expect(outcome.records[0].payloads).toHaveLength(2);
		expect(outcome.retrievedAt).toBe("2026-09-15T18:00:00Z");
	});

	it("zero records is no-data, never ok", async () => {
		const outcome = await runSource(locus, adapterReturning(async () => []), io, { timeoutMs: 1000 });
		expect(outcome).toEqual({
			status: "no-data",
			note: "No matching records within the stated boundary.",
			retrievedAt: "2026-09-15T18:00:00Z",
			// An adapter that issued no request has none to name.
			query: null,
		});
	});

	it("a thrown SourceFailure becomes unavailable with the source's own code kept verbatim", async () => {
		const adapter = adapterReturning(() => Promise.reject(new SourceFailure("rate-limited", "429", "60")));
		const outcome = await runSource(locus, adapter, io, { timeoutMs: 1000 });
		expect(outcome).toEqual({ status: "unavailable", cause: "rate-limited", rawCode: "429", retryAfter: "60" });
	});

	it("an adapter that never resolves is a timeout", async () => {
		const adapter = adapterReturning(() => new Promise(() => undefined));
		const outcome = await runSource(locus, adapter, io, { timeoutMs: 20 });
		expect(outcome).toMatchObject({ status: "unavailable", cause: "timeout" });
	});

	it("an unknown throw is unavailable with cause unknown and no body", async () => {
		const adapter = adapterReturning(() => Promise.reject(new Error("body: 9311 E AVE P")));
		const outcome = await runSource(locus, adapter, io, { timeoutMs: 1000 });
		expect(outcome).toEqual({ status: "unavailable", cause: "unknown", rawCode: null, retryAfter: null });
	});
});

/**
 * The fan-out. These are the functions that keep one failing source from
 * taking the report down with it, so each failure mode is exercised against
 * the other five sources still answering.
 */
const EsriFeatures = z.object({ features: z.array(z.object({ attributes: z.object({ OBJECTID: z.number() }) })) });
const EsriError = z.object({
	error: z.object({ code: z.number(), message: z.string(), details: z.array(z.string()) }),
});

const ERROR_FIXTURE = "fema/esri-error-bad-geometry.json";

function nearestBuilt(): Built<"sems-site"> {
	return semsBuilt(frsRowFor(NEAREST_EPA_ID), envirofactsFor(NEAREST_EPA_ID));
}

/** Six fakes, one per source. The kind is irrelevant to the fan-out; the outcome per source ID is the subject. */
function adapters(
	overrides: Partial<Record<Exclude<SourceId, "census">, Adapter<"sems-site">["run"]>>,
): { readonly [S in Exclude<SourceId, "census">]: Adapter<Kind> } {
	const one = (s: Exclude<SourceId, "census">): Adapter<Kind> =>
		adapterReturning(overrides[s] ?? (async () => [nearestBuilt()]));
	return { echo: one("echo"), frs: one("frs"), sems: one("sems"), aqs: one("aqs"), airnow: one("airnow"), fema: one("fema") };
}

const SOURCE_IDS = ["airnow", "aqs", "echo", "fema", "frs", "sems"];

describe("the fan-out: one source failing never takes another down", () => {
	it("names every source in the result whatever happened to each", async () => {
		const sources = await runSources(
			locus,
			adapters({
				echo: () => Promise.reject(new SourceFailure("refused")),
				aqs: async () => [],
				airnow: () => new Promise(() => undefined),
				fema: () => Promise.reject(new Error("boom")),
			}),
			io,
			{ airnow: { timeoutMs: 20 } },
		);
		expect(Object.keys(sources).sort()).toEqual(SOURCE_IDS);
		expect(Object.values(sources).every((o) => o.status === "ok" || o.status === "no-data" || o.status === "unavailable")).toBe(true);
	});

	it("leaves the other five ok when one adapter throws", async () => {
		const sources = await runSources(
			locus,
			adapters({ echo: () => Promise.reject(new SourceFailure("http", 503)) }),
			io,
		);
		expect(sources.echo).toEqual({ status: "unavailable", cause: "http", rawCode: 503, retryAfter: null });
		for (const s of ["frs", "sems", "aqs", "airnow", "fema"] as const) {
			expect(sources[s].status).toBe("ok");
		}
	});

	it("leaves the other five ok when one adapter times out", async () => {
		const sources = await runSources(
			locus,
			adapters({ sems: () => new Promise(() => undefined) }),
			io,
			{ sems: { timeoutMs: 20 } },
		);
		expect(sources.sems).toMatchObject({ status: "unavailable", cause: "timeout" });
		for (const s of ["echo", "frs", "aqs", "airnow", "fema"] as const) {
			expect(sources[s].status).toBe("ok");
		}
	});

	it("reports a source that answered with zero records as no-data, never ok", async () => {
		const sources = await runSources(locus, adapters({ aqs: async () => [] }), io);
		expect(sources.aqs.status).toBe("no-data");
		expect(sources.aqs).toEqual({
			status: "no-data",
			note: "No matching records within the stated boundary.",
			retrievedAt: "2026-09-15T18:00:00Z",
			query: null,
		});
	});

	it("reads an ArcGIS error body delivered with HTTP 200 as unavailable, keeping the source's own code unmapped", async () => {
		// The fixture is an error envelope served with a 200 status.
		const detected = loadFixture(ERROR_FIXTURE, EsriError);
		expect(detected.raw.error.code).toBe(400);

		const sources = await runSources(
			locus,
			adapters({
				// An adapter that reads the envelope: the source's own code travels verbatim.
				fema: () => Promise.reject(new SourceFailure("http", loadFixture(ERROR_FIXTURE, EsriError).raw.error.code)),
				// An adapter that trusts the 200 and parses for features: the schema rejects it.
				frs: async () => loadFixture(ERROR_FIXTURE, EsriFeatures).raw.features.map(() => nearestBuilt()),
			}),
			io,
		);
		expect(sources.fema).toEqual({ status: "unavailable", cause: "http", rawCode: 400, retryAfter: null });
		expect(sources.frs.status).toBe("unavailable");
		// Nothing of the response body is carried out with the failure.
		expect(sources.frs).toEqual({ status: "unavailable", cause: "unknown", rawCode: null, retryAfter: null });
		expect(sources.sems.status).toBe("ok");
	});

	it("builds the store from the sources that answered, and from no others", async () => {
		const sources = await runSources(
			locus,
			adapters({
				echo: () => Promise.reject(new SourceFailure("refused")),
				aqs: async () => [],
			}),
			io,
		);
		const store = storeOfSources(sources);
		// Four sources answered with the same one site, so the store holds it once, by id.
		expect(store.size).toBe(1);
		expect(store.get(recordId("sems-site", NEAREST_EPA_ID))?.subject.value).toBe("VALERO PLUME");
		expect(store.ofKind("fema-flood-zone")).toEqual([]);

		// And when nothing answered, the store is empty rather than partly built.
		const down = () => Promise.reject(new SourceFailure("refused"));
		const allDown = await runSources(
			locus,
			adapters({ echo: down, frs: down, sems: down, aqs: async () => [], airnow: down, fema: down }),
			io,
		);
		expect(storeOfSources(allDown).size).toBe(0);
	});
});
