import { describe, expect, it } from "vitest";
import type { Built, EvidenceStore, PayloadRef, Placement, Trace } from "@/lib/evidence";
import {
	complete,
	fieldsOf,
	isSourced,
	KindMismatch,
	ReaderInvariant,
	render,
	seal,
	storeOf,
	trace,
	UnbrandedValue,
	urlFrom,
	verify,
} from "@/lib/evidence";
import { semsSiteNpl, semsSiteRegistryOnly, semsSiteSummary, semsTemplates } from "@/lib/templates/sems";
import {
	NEAREST_EPA_ID,
	RETRIEVED_AT,
	SEMS_SITE_URL,
	SEMS_VERSION,
	envirofactsFor,
	fieldsOfEnvirofacts,
	frsRowFor,
	houstonLocus,
	semsBuilt,
	semsId,
	semsRecord,
	semsRecordWithoutRow,
	semsStore,
} from "./helpers/sems-fixtures";

const locus = houstonLocus();
const store = semsStore(locus);
const nearest: Placement = { scope: "record", recordId: semsId(NEAREST_EPA_ID), template: semsSiteSummary };

function text(spans: readonly { text: string }[]): string {
	return spans.map((s) => s.text).join("");
}

function mustRender(placement: Placement, from: EvidenceStore = store) {
	const sentence = render(from, placement);
	if (sentence === null) throw new Error("expected a sentence");
	return sentence;
}

/**
 * U2.3 widened `Trace` into a union over subject scope, so a record trace is
 * reached by narrowing on `scope`. The narrowing is an extra assertion, not a
 * weaker one: every use below now also proves the trace is record-scoped.
 */
function mustTrace(spanIndex: number): Extract<Trace, { scope: "record" }> {
	const t = trace(store, mustRender(nearest), spanIndex);
	if (t === null) throw new Error(`expected a trace for span ${spanIndex}`);
	if (t.scope !== "record") throw new Error(`expected a record-scoped trace, got ${t.scope}`);
	return t;
}

describe("render: the nearest SEMS record from the committed fixture bytes", () => {
	it("renders the exact sentence (acceptance 2)", () => {
		const sentence = mustRender(nearest);
		// Relabelled in U2.0c: the distance says what it is measured from, and
		// both status columns are named. `non_npl_status_name` was labelled
		// "Status:" while `npl_status_name` carried no label at all, which made
		// the reader take the labelled one as the site's status, and the date
		// moved to its own clause so a null date stops dragging the status with
		// it. See lib/templates/sems.ts.
		expect(text(sentence.spans)).toBe(
			"VALERO PLUME, EPA ID TXN000622182. 0.76 km from the mapped point. NPL status: Not on the NPL." +
				" Non-NPL status: Removal Only Site (No Site Assessment Work Needed)." +
				" Non-NPL status date: 2022-02-08.",
		);
		expect(sentence.spans.map((s) => s.slot?.field ?? null)).toEqual([
			"subject",
			null,
			"epaSiteId",
			null,
			null,
			"distanceMeters",
			null,
			null,
			null,
			"semsNplStatus",
			null,
			null,
			null,
			"nonNplStatus",
			null,
			null,
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
		expect(t.record.sourceUrl.normalized).toBe("https://cumulis.epa.gov/supercpad/cursites/csitinfo.cfm?id=0622182");
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
		// Every real site has an inventory row, so this one is built from the real
		// empty response to reach the rowless branch. It is a constructed case.
		// No Envirofacts row, so the registry-only template is the right one: it
		// prints the registry's status under the registry's name and states the
		// gap rather than letting one agency's answer pose as the other's.
		const rowless = semsRecordWithoutRow(locus, "TXN000607155");
		const placement: Placement = { scope: "record", recordId: rowless.id, template: semsSiteRegistryOnly };
		const sentence = mustRender(placement, storeOf([rowless]));
		expect(text(sentence.spans)).toBe(
			"MCC RECYCLING, 5.50 km from the mapped point." +
				" EPA's facility registry records the SUPERFUND (NON-NPL) interest at MCC RECYCLING as SITE IS PART OF NPL SITE." +
				" The Superfund inventory returned no status row for TXN000607155.",
		);
		const t = trace(store, sentence, sentence.spans.findIndex((s) => s.slot?.field === "frsActiveStatus"));
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
		// Only the distance clause drops. The naming clause survives because it
		// carries the EPA site ID rather than the distance -- until U2.1b it did
		// not, and a coordinate-less site rendered three labelled column
		// readouts with the site named nowhere.
		expect(sentence === null ? null : text(sentence.spans)).toBe(
			"VALERO PLUME, EPA ID TXN000622182." +
				" NPL status: Not on the NPL." +
				" Non-NPL status: Removal Only Site (No Site Assessment Work Needed)." +
				" Non-NPL status date: 2022-02-08.",
		);
	});

	it("drops a clause whose field is null and has no fallback, keeping the rest", () => {
		const record = semsRecord(locus, "TXN000607093"); // NPL site; non_npl_status_name is null, date is not
		expect(record.nonNplStatus?.value).toBeNull();
		const sentence = render(store, { scope: "record", recordId: record.id, template: semsSiteSummary });
		// nonNplStatus is null with no fallback, so its clause drops -- and only
		// its clause. Until U2.0c the name and the date shared one clause, so a
		// null name silently took a date the inventory did have with it.
		expect(record.statusDate?.value).toBe("2010-07-05");
		expect(sentence === null ? null : text(sentence.spans)).toBe(
			"US OIL RECOVERY, EPA ID TXN000607093. 3.92 km from the mapped point. NPL status: Currently on the Final NPL." +
				" Non-NPL status date: 2010-07-05.",
		);
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
		const mutable = record.frsActiveStatus as { value: string | null };
		expect(() => {
			mutable.value = "x";
		}).toThrow(TypeError);
		expect(record.frsActiveStatus.value).toBe("NOT ON THE NPL");
		expect(record.semsNplStatus?.value).toBe("Not on the NPL");
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

describe("the four gaps U0.3 closes", () => {
	it("derives the government link from the identifier field it interpolates (gap 1)", () => {
		const t = mustTrace(0);
		expect(t.record.sourceUrl.normalized).toBe("https://cumulis.epa.gov/supercpad/cursites/csitinfo.cfm?id=0622182");
		const [p] = t.record.sourceUrl.provenance;
		if (p?.kind !== "computation") throw new Error("the link must carry a computation, not nothing");
		expect(p.formula).toBe("url-template");
		expect(p.inputs.map((i) => [i.name, i.value])).toEqual([
			["template", SEMS_SITE_URL],
			["id", "0622182"],
		]);
		// The template is visible, and the id traces to the raw field it was read from.
		const idOrigin = p.inputs[1]?.provenance[0];
		expect(idOrigin?.kind === "field" ? [idOrigin.dataset, idOrigin.sourceField, idOrigin.rawValue] : null).toEqual([
			"envirofacts_site",
			"site_id",
			"0622182",
		]);
		// And it is a value on the record like any other, so the panel can list it.
		expect(t.values.find((v) => v.field === "sourceUrl")?.normalized).toBe(t.record.sourceUrl.normalized);
	});

	it("traces a link that is a source field, not a template, to that field (gap 1)", () => {
		const frsOnly = semsRecordWithoutRow(locus, "TXN000607155");
		const [p] = frsOnly.sourceUrl.provenance;
		expect(p?.kind === "field" ? [p.dataset, p.sourceField] : null).toEqual(["frs_program_facility", "FAC_URL"]);
		expect(frsOnly.sourceUrl.value).toContain("p_registry_id=110071101301");
	});

	it("refuses a url template that lost its slot, or an empty identifier, and escapes what it interpolates (gap 1)", () => {
		const payload: PayloadRef = { url: "fixture:none", sha256: "0".repeat(64), retrievedAt: RETRIEVED_AT };
		const reader = (id: string) => fieldsOf({ raw: { id }, payload }, "probe", SEMS_VERSION).text("id");
		expect(() => urlFrom("https://example.gov/site", reader("7"))).toThrow(ReaderInvariant);
		expect(() => urlFrom("https://example.gov/{id}/{id}", reader("7"))).toThrow(ReaderInvariant);
		expect(() => urlFrom(SEMS_SITE_URL, reader(""))).toThrow(ReaderInvariant);
		expect(urlFrom("https://example.gov/{id}", reader("a b&c")).value).toBe("https://example.gov/a%20b%26c");
	});

	it("keeps the two agencies' status fields apart, neither standing in for the other (gap 2)", () => {
		const joined = semsRecord(locus, NEAREST_EPA_ID);
		expect(joined.semsNplStatus?.value).toBe("Not on the NPL");
		expect(joined.frsActiveStatus.value).toBe("NOT ON THE NPL");
		const sems = joined.semsNplStatus?.provenance[0];
		expect(sems?.kind === "field" ? [sems.dataset, sems.sourceField] : null).toEqual([
			"envirofacts_site",
			"npl_status_name",
		]);
		const frs = joined.frsActiveStatus.provenance[0];
		expect(frs?.kind === "field" ? [frs.dataset, frs.sourceField] : null).toEqual([
			"frs_program_facility",
			"ACTIVE_STATUS",
		]);

		// No Envirofacts row joined: the SEMS field is null and the FRS field is not promoted into it.
		const unjoined = semsRecordWithoutRow(locus, "TXN000607155");
		expect(unjoined.semsNplStatus).toBeNull();
		expect(unjoined.frsActiveStatus.value).toBe("SITE IS PART OF NPL SITE");
		// The template's decision, in the open: the NPL sentence needs what SEMS said, so it does not render.
		// Rendered from a store holding the rowless build, since the shared store joins this site.
		expect(
			render(storeOf([unjoined]), { scope: "record", recordId: unjoined.id, template: semsSiteNpl }),
		).toBeNull();
		// And the same decision one step finer, since U2.0c: `npl@1` is B7's
		// separate sentence for the *final* National Priorities List, so a joined
		// record is not enough. VALERO PLUME joined and SEMS said "Not on the
		// NPL", so it does not render; a site SEMS put on the final list does.
		expect(render(store, { scope: "record", recordId: joined.id, template: semsSiteNpl })).toBeNull();
		const onTheFinalList = semsRecord(locus, "TXN000607093");
		expect(onTheFinalList.semsNplStatus?.value).toBe("Currently on the Final NPL");
		expect(
			render(store, { scope: "record", recordId: onTheFinalList.id, template: semsSiteNpl }),
		).not.toBeNull();
	});

	it("lists a Sourced value nested two containers deep in the trace (gap 3)", () => {
		const frsRow = frsRowFor(NEAREST_EPA_ID);
		const frs = fieldsOf(frsRow, "frs_program_facility", SEMS_VERSION);
		const built = semsBuilt(frsRow, envirofactsFor(NEAREST_EPA_ID));
		// A future container the walk has never been told about.
		const nested: unknown = { ...built, outer: { inner: { registryId: frs.text("REGISTRY_ID") } } };
		const record = complete(locus, nested as Built<"sems-site"> & { kind: "sems-site" });
		const deepStore = storeOf([record]);
		const sentence = render(deepStore, { scope: "record", recordId: record.id, template: semsSiteSummary });
		if (sentence === null) throw new Error("expected a sentence");
		const t = trace(deepStore, sentence, 0);
		const row = t?.values.find((v) => v.field === "outer.inner.registryId");
		expect(row?.normalized).toBe("110000460885");
		expect(row?.provenance[0]).toMatchObject({ dataset: "frs_program_facility", sourceField: "REGISTRY_ID" });
		// The one-level values are still there.
		expect(t?.values.map((v) => v.field)).toContain("location.latitude");
	});
});
