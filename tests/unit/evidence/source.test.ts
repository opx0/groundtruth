import { describe, expect, it } from "vitest";
import type { Adapter, SourceIo } from "@/lib/evidence";
import { runSource, SourceFailure } from "@/lib/evidence";
import { envirofactsFor, frsLayer, houstonLocus, NEAREST_EPA_ID, semsBuilt } from "./helpers/sems-fixtures";

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
