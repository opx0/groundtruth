import { describe, expect, it } from "vitest";
import type { Placement, Trace } from "@/lib/evidence";
import { complete, isSourced, KindMismatch, render, seal, storeOf, trace, UnbrandedValue, verify } from "@/lib/evidence";
import { semsSiteSummary, semsTemplates } from "@/lib/templates/sems";
import {
	NEAREST_EPA_ID,
	envirofactsFor,
	fieldsOfEnvirofacts,
	frsRowFor,
	houstonLocus,
	semsBuilt,
	semsId,
	semsRecord,
	semsStore,
} from "./helpers/sems-fixtures";

const locus = houstonLocus();
const store = semsStore(locus);
const nearest: Placement = { scope: "record", recordId: semsId(NEAREST_EPA_ID), template: semsSiteSummary };

function text(spans: readonly { text: string }[]): string {
	return spans.map((s) => s.text).join("");
}

function mustRender(placement: Placement) {
	const sentence = render(store, placement);
	if (sentence === null) throw new Error("expected a sentence");
	return sentence;
}

function mustTrace(spanIndex: number): Trace {
	const t = trace(store, mustRender(nearest), spanIndex);
	if (t === null) throw new Error(`expected a trace for span ${spanIndex}`);
	return t;
}

describe("render: the nearest SEMS record from the committed fixture bytes", () => {
	it("renders the exact sentence (acceptance 2)", () => {
		const sentence = mustRender(nearest);
		expect(text(sentence.spans)).toBe(
			"VALERO PLUME, 0.76 km. Not on the NPL. Status: Removal Only Site (No Site Assessment Work Needed), as of 2022-02-08.",
		);
		expect(sentence.spans.map((s) => s.slot?.field ?? null)).toEqual([
			"subject",
			null,
			"distanceMeters",
			null,
			null,
			"nplStatus",
			null,
			null,
			null,
			"nonNplStatus",
			null,
			"statusDate",
			null,
		]);
	});

	it("traces the distance span to the formula and all four coordinates, each with its own provenance (acceptance 3)", () => {
		const sentence = mustRender(nearest);
		const index = sentence.spans.findIndex((s) => s.slot?.field === "distanceMeters");
		expect(sentence.spans[index]?.text).toBe("0.76 km");
		const t = mustTrace(index);
		expect(t.clicked.field).toBe("distanceMeters");
		expect(t.clicked.displayed).toBe("0.76 km");
		expect(t.clicked.normalized).toBe(755);
		const [p] = t.clicked.provenance;
		if (p?.kind !== "computation") throw new Error("distance provenance must be a computation");
		expect(p.formula).toBe("haversine");
		expect(p.inputs.map((i) => [i.name, i.value])).toEqual([
			["from.latitude", 29.720658823001],
			["from.longitude", -95.261995884462],
			["to.latitude", 29.722274],
			["to.longitude", -95.254401],
		]);
		for (const input of p.inputs) {
			expect(input.provenance.length).toBeGreaterThanOrEqual(1);
		}
		const datasets = p.inputs.map((i) => {
			const inner = i.provenance[0];
			return inner?.kind === "field" ? `${inner.dataset}.${inner.sourceField}` : null;
		});
		expect(datasets).toEqual([
			"census_geocoder.y",
			"census_geocoder.x",
			"frs_program_facility.LATITUDE83",
			"frs_program_facility.LONGITUDE83",
		]);
	});

	it("reaches both names for the one site from one record's trace (acceptance 4)", () => {
		const t = mustTrace(0);
		const raw = (field: string) => {
			const v = t.values.find((x) => x.field === field);
			const p = v?.provenance[0];
			return p?.kind === "field" ? { dataset: p.dataset, sourceField: p.sourceField, rawValue: p.rawValue } : null;
		};
		expect(raw("frsName")).toEqual({
			dataset: "frs_program_facility",
			sourceField: "PRIMARY_NAME",
			rawValue: "HOUSTON REFINERY",
		});
		expect(raw("semsName")).toEqual({ dataset: "envirofacts_site", sourceField: "name", rawValue: "VALERO PLUME" });

		// The displayed name is the kernel's coalesce, so the clicked span itself carries both.
		expect(t.clicked.displayed).toBe("VALERO PLUME");
		const [p] = t.clicked.provenance;
		if (p?.kind !== "computation") throw new Error("subject must be a coalesce");
		expect(p.formula).toBe("coalesce");
		expect(p.inputs.map((i) => i.value)).toEqual(["VALERO PLUME", "HOUSTON REFINERY"]);
	});

	it("shows the record identity the A3 panel needs", () => {
		const t = mustTrace(0);
		expect(t.record.agency).toBe("EPA Superfund Enterprise Management System");
		expect(t.record.sourceRecordId).toBe("TXN000622182");
		expect(t.record.sourceUrl).toBe("https://cumulis.epa.gov/supercpad/cursites/csitinfo.cfm?id=0622182");
		expect(t.record.payloads).toHaveLength(2);
		expect(t.record.payloads.map((p) => p.url)).toEqual([
			"fixture:sems/arcgis-5mi-houston.json",
			"fixture:sems/envirofacts-TXN000622182.json",
		]);
		expect(t.record.payloads.every((p) => /^[0-9a-f]{64}$/.test(p.sha256))).toBe(true);
		expect(t.values.find((v) => v.field === "semsSiteId")?.normalized).toBe("0622182");
		expect(t.values.find((v) => v.field === "frsRegistryId")?.normalized).toBe("110000460885");
		expect(t.values.find((v) => v.field === "location.referencePoint")?.normalized).toBe(
			"CENTER OF A FACILITY OR STATION",
		);
		expect(t.values.find((v) => v.field === "location.accuracyMeters")?.normalized).toBeNull();
	});

	it("returns nothing for a deleted record, for render, trace, and verify (acceptance 5)", () => {
		const sentence = mustRender(nearest);
		expect(trace(store, sentence, 0)).not.toBeNull();
		const smaller = store.without(nearest.recordId);
		expect(smaller.size).toBe(store.size - 1);
		expect(render(smaller, nearest)).toBeNull();
		expect(trace(smaller, sentence, 0)).toBeNull();
		expect(trace(smaller, sentence, 2)).toBeNull();
		expect(verify(smaller, sentence, semsTemplates)).toBe(false);
		expect(verify(store, sentence, semsTemplates)).toBe(true);
	});

	it("keeps a status string the code has never seen, verbatim (acceptance 6)", () => {
		// TXN000607155 has no Envirofacts fixture, so nplStatus reads FRS ACTIVE_STATUS.
		const placement: Placement = { scope: "record", recordId: semsId("TXN000607155"), template: semsSiteSummary };
		const sentence = mustRender(placement);
		expect(text(sentence.spans)).toBe("MCC RECYCLING, 5.50 km. SITE IS PART OF NPL SITE.");
		const t = trace(store, sentence, sentence.spans.findIndex((s) => s.slot?.field === "nplStatus"));
		const p = t?.clicked.provenance[0];
		expect(p?.kind === "field" ? [p.sourceField, p.rawValue, p.transform] : null).toEqual([
			"ACTIVE_STATUS",
			"SITE IS PART OF NPL SITE",
			"identity",
		]);
	});

	it("renders the two date shapes literally (acceptance 9)", () => {
		const record = semsRecord(locus, NEAREST_EPA_ID);
		expect(record.sourceUpdatedAt.value).toBe("2024-03-14T10:51:51Z");
		expect(record.sourceUpdatedAt.provenance[0]).toMatchObject({
			sourceField: "UPDATE_DATE",
			rawValue: 1710413511000,
			transform: "parse-epoch-ms",
		});
		expect(record.statusDate?.value).toBe("2022-02-08");
		expect(record.statusDate?.provenance[0]).toMatchObject({
			sourceField: "non_npl_status_date",
			rawValue: "2022-02-08 00:00:00",
			transform: "normalize-date",
		});
	});

	it("gives a null location and a null distance for a null coordinate, without throwing (acceptance 10)", () => {
		// The Envirofacts row for the nearest site has null coordinates.
		const ef = envirofactsFor(NEAREST_EPA_ID);
		if (ef === null) throw new Error("fixture missing");
		expect(ef.raw.primary_latitude_decimal_val).toBeNull();
		const point = fieldsOfEnvirofacts(ef).point("primary_latitude_decimal_val", "primary_longitude_decimal_val", {});
		expect(point).toBeNull();

		const nearestRecord = semsRecord(locus, NEAREST_EPA_ID);
		expect(nearestRecord.semsCoordinate).toBeNull();

		// A record whose only coordinate is that null one.
		const layer = frsRowFor(NEAREST_EPA_ID);
		const built = { ...semsBuilt(layer, ef), location: point };
		const record = complete(locus, built);
		expect(record.location).toBeNull();
		expect(record.distanceMeters).toBeNull();
		const smallStore = storeOf([record]);
		const sentence = render(smallStore, nearest);
		// The distance clause dropped; the rest of the sentence stands.
		expect(sentence === null ? null : text(sentence.spans)).toBe(
			"Not on the NPL. Status: Removal Only Site (No Site Assessment Work Needed), as of 2022-02-08.",
		);
	});

	it("drops a clause whose field is null and has no fallback, keeping the rest", () => {
		const record = semsRecord(locus, "TXN000607093"); // NPL site; non_npl_status_name is null, date is not
		expect(record.nonNplStatus?.value).toBeNull();
		const sentence = render(store, { scope: "record", recordId: record.id, template: semsSiteSummary });
		// nonNplStatus is null with no fallback, so the whole Status clause drops.
		expect(sentence === null ? null : text(sentence.spans)).toBe("US OIL RECOVERY, 3.92 km. Currently on the Final NPL.");
	});
});

describe("render: the guarantees a reviewer cannot be trusted to notice", () => {
	it("throws KindMismatch when a template's kind disagrees with the record at runtime", () => {
		const femaShaped = { ...semsSiteSummary, kind: "fema-flood-zone" };
		const forged: unknown = { scope: "record", recordId: semsId(NEAREST_EPA_ID), template: femaShaped };
		const placement = forged as Placement; // tests may assert; lib/evidence may not
		expect(() => render(store, placement)).toThrow(KindMismatch);
	});

	it("seal rejects a hand-built {value, provenance} lookalike", () => {
		const record = semsRecord(locus, NEAREST_EPA_ID);
		const lookalike = { ...record, semsName: { value: "VALERO", provenance: [] } };
		expect(() => seal(lookalike)).toThrow(UnbrandedValue);
		expect(isSourced(lookalike.semsName)).toBe(false);
		expect(isSourced(record.semsName)).toBe(true);
	});

	it("a sealed record is frozen: a mutation after validation throws", () => {
		const record = semsRecord(locus, NEAREST_EPA_ID);
		const mutable = record.nplStatus as { value: string | null };
		expect(() => {
			mutable.value = "x";
		}).toThrow(TypeError);
		expect(record.nplStatus.value).toBe("Not on the NPL");
	});

	it("verify rejects a sentence whose text was edited", () => {
		const sentence = mustRender(nearest);
		const [first, ...rest] = sentence.spans;
		const edited = { ...sentence, spans: [{ ...first, text: "VALERO PLUM" }, ...rest] as const };
		expect(verify(store, edited, semsTemplates)).toBe(false);
	});

	it("every span with a slot resolves through trace to at least one provenance entry", () => {
		for (const record of store.ofKind("sems-site")) {
			for (const template of semsTemplates) {
				const sentence = render(store, { scope: "record", recordId: record.id, template });
				if (sentence === null) continue;
				expect(sentence.spans.some((s) => s.slot !== null)).toBe(true);
				sentence.spans.forEach((span, i) => {
					if (span.slot === null) return;
					const t = trace(store, sentence, i);
					expect(t?.clicked.provenance.length ?? 0).toBeGreaterThanOrEqual(1);
				});
			}
		}
	});
});
