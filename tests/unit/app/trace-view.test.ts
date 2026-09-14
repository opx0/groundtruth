/**
 * A3's table, computed from a real stream.
 *
 * Every sentence asserted here is one the report route rendered, over the
 * committed fixture bytes, through `createReportHandler` and back through
 * `ReportEventSchema` -- the same path a browser's bytes take. Nothing in this
 * file builds a card, a sentence, a trace or a provenance by hand, so an edit
 * to a template, an adapter or the selection policy fails here rather than
 * passing against an invention.
 *
 * WHY THE STREAM HARNESS IS DUPLICATED IN `trace-panel.test.ts`. A shared
 * helper would be a third file, and the trace panel and the report screen are
 * being built by two agents in disjoint file sets; a new shared path is the one
 * thing that could collide. The harness is fifty lines and is the same fifty
 * lines `tests/unit/app/report-route.test.ts` already carries.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { SourceFailure } from "@/lib/evidence";
import type { Fetched, JsonValue, PayloadRef, SourceIo } from "@/lib/evidence";
import { createReportHandler } from "@/app/api/report/handler";
import { ReportEventSchema, type ReportEvent, type SentenceViewMessage } from "@/app/lib/report-contract";
import {
	absentRowsFor,
	openableSpans,
	traceView,
	type TracePanelView,
	type TraceRow,
	type TraceRowName,
	type TraceValueRow,
} from "@/app/lib/trace-view";
import { censusOrigin } from "../evidence/helpers/sems-fixtures";

const fixturesDir = fileURLToPath(new URL("../../fixtures/", import.meta.url));
const RETRIEVED_AT = "2026-09-16T09:00:00Z";
const HOUSTON = censusOrigin();

/* -------------------------------------------------------------------------- */
/* The stream, from the committed bytes through the real route                */
/* -------------------------------------------------------------------------- */

type Answer = { readonly fixture: string } | { readonly derived: string; readonly body: JsonValue } | { readonly fail: SourceFailure };

/** The two registry IDs FRS has recorded bytes for. Any other is answered with no rows, which is a real FRS answer. */
const FRS_FIXTURES: ReadonlyMap<string, string> = new Map([
	["110000460885", "frs/arcgis-registry-110000460885.json"],
	["110000462703", "frs/arcgis-registry-110000462703-two-ids.json"],
]);

function epaIdOf(url: URL): string {
	const segments = url.pathname.split("/");
	return segments[segments.length - 2] ?? "";
}

function registryIdOf(url: URL): string {
	return /REGISTRY_ID='([^']*)'/.exec(url.searchParams.get("where") ?? "")?.[1] ?? "";
}

/**
 * NFHL's host refuses connections from outside the US and no response from it
 * has ever been recorded (docs/BRIEF.md B14), so it is refused here and Esri's
 * recorded copy answers. That is what leaves a `source`-scoped prior attempt on
 * the flood card, which is the only unavailable trace in the demo report.
 */
function answerFor(url: URL, echoCall: number): Answer {
	if (url.host === "echodata.epa.gov") {
		return echoCall === 1
			? { fixture: "echo/facilities-quarter-mi.json" }
			: { fixture: "echo/facilities-page-quarter-mi.json" };
	}
	if (url.host === "data.epa.gov") return { fixture: `sems/envirofacts-${epaIdOf(url)}.json` };
	if (url.host === "hazards.fema.gov") return { fail: new SourceFailure("refused") };
	if (url.pathname.includes("FRS_INTERESTS_SEMS")) return { fixture: "sems/arcgis-5mi-houston.json" };
	if (url.pathname.includes("/FRS_INTERESTS/")) {
		const fixture = FRS_FIXTURES.get(registryIdOf(url));
		return fixture === undefined ? { derived: "derived:frs-no-rows", body: { features: [] } } : { fixture };
	}
	if (url.pathname.includes("USA_Flood_Hazard_Reduced_Set")) return { fixture: "fema/esri-no-polygon-houston.json" };
	throw new Error(`the stub io was asked for an unrouted URL: ${url.host}${url.pathname}`);
}

function demoIo(): SourceIo {
	let echoCalls = 0;
	return {
		async get<Raw extends JsonValue>(url: URL, schema: z.ZodType<Raw>): Promise<Fetched<Raw>> {
			if (url.host === "echodata.epa.gov") echoCalls += 1;
			const answer = answerFor(url, echoCalls);
			if ("fail" in answer) throw answer.fail;
			const bytes =
				"fixture" in answer
					? readFileSync(`${fixturesDir}${answer.fixture}`)
					: Buffer.from(JSON.stringify(answer.body), "utf8");
			const label = "fixture" in answer ? `fixture:${answer.fixture}` : answer.derived;
			const payload: PayloadRef = {
				url: label,
				sha256: createHash("sha256").update(bytes).digest("hex"),
				retrievedAt: RETRIEVED_AT,
			};
			return { raw: schema.parse(JSON.parse(bytes.toString("utf8"))), payload };
		},
		query(parameter, value, adapterVersion, payload) {
			return { kind: "query", parameter, value, adapterVersion, payload };
		},
		now: () => RETRIEVED_AT,
	};
}

async function houstonEvents(): Promise<readonly ReportEvent[]> {
	const handler = createReportHandler(demoIo());
	const response = await handler(
		new Request("http://localhost/api/report", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ latitude: HOUSTON.latitude.value, longitude: HOUSTON.longitude.value }),
		}),
	);
	const raw = await response.text();
	return raw
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line): ReportEvent => ReportEventSchema.parse(JSON.parse(line)));
}

/** Every sentence the report puts on screen, in reading order, with where it sits. */
function everySentence(events: readonly ReportEvent[]): readonly SentenceViewMessage[] {
	const out: SentenceViewMessage[] = [];
	for (const event of events) {
		if (event.type === "card") {
			const card = event.card;
			if (card.status !== null) out.push(card.status);
			out.push(...card.priorAttempts, ...card.headlines);
			for (const listing of card.listings) {
				for (const entry of [...listing.shown, ...listing.rest]) out.push(...entry.sentences);
			}
		}
		if (event.type === "groups") {
			for (const card of event.cards) out.push(...card.groups, ...card.crossReferences);
		}
	}
	return out;
}

function textOf(sentence: SentenceViewMessage): string {
	return sentence.spans.map((span) => span.text).join("");
}

function sentenceSaying(sentences: readonly SentenceViewMessage[], fragment: string): SentenceViewMessage {
	const found = sentences.find((sentence) => textOf(sentence).includes(fragment));
	if (found === undefined) throw new Error(`no sentence containing ${fragment}`);
	return found;
}

/** The view of the first openable span of a sentence, which is the one a reader meets first. */
function firstView(sentence: SentenceViewMessage): TracePanelView {
	const [index] = openableSpans(sentence);
	if (index === undefined) throw new Error(`sentence has no slotted span: ${textOf(sentence)}`);
	const view = traceView(sentence, index);
	if (view === null) throw new Error(`no view for ${textOf(sentence)}`);
	return view;
}

/**
 * One row of a view, narrowed to its own arm. The narrowing is a runtime check
 * inside each picker rather than a type parameter, because
 * `Extract<TraceRow, {row: N}>` needs an assertion to satisfy and this unit
 * allows none.
 */
const pick = {
	agency: (row: TraceRow) => (row.row === "agency-and-kind" ? row : null),
	ids: (row: TraceRow) => (row.row === "record-ids" ? row : null),
	original: (row: TraceRow) => (row.row === "original-record" ? row : null),
	boundary: (row: TraceRow) => (row.row === "boundary" ? row : null),
	outcome: (row: TraceRow) => (row.row === "outcome" ? row : null),
	groupedBy: (row: TraceRow) => (row.row === "grouped-by" ? row : null),
	recordDate: (row: TraceRow) => (row.row === "record-date" ? row : null),
	sourceUpdated: (row: TraceRow) => (row.row === "source-updated" ? row : null),
	retrieved: (row: TraceRow) => (row.row === "retrieved" ? row : null),
	caveats: (row: TraceRow) => (row.row === "caveats" ? row : null),
};

function rowNamed<T>(view: TracePanelView, of: (row: TraceRow) => T | null, what: TraceRowName): T {
	for (const row of view.rows) {
		const hit = of(row);
		if (hit !== null) return hit;
	}
	throw new Error(`no ${what} row on a ${view.scope} trace`);
}

function valueNamed(view: TracePanelView, field: string): TraceValueRow {
	for (const row of view.rows) {
		if ((row.row === "value" || row.row === "record-date" || row.row === "source-updated") && row.value.field === field) {
			return row.value;
		}
	}
	throw new Error(`no value row for ${field}`);
}

/** The one field-kind provenance of a value, which is what A3's rows 4 to 9 name. */
/**
 * The value the reader clicked, wherever it landed. `sourceUrl`, `effectiveAt`
 * and `sourceUpdatedAt` have rows of A3's own rather than `value` rows, and the
 * registry card's update-date sentence does put a click on one of them.
 */
function clickedValues(view: TracePanelView): readonly TraceValueRow[] {
	return view.rows.flatMap((row) => {
		if (row.row === "value" || row.row === "record-date" || row.row === "source-updated" || row.row === "original-record") {
			return row.value.presence === "clicked" ? [row.value] : [];
		}
		return [];
	});
}

function fieldProvenance(value: TraceValueRow) {
	for (const entry of value.provenance) if (entry.kind === "field") return entry;
	throw new Error(`no field provenance on ${value.field}`);
}

function computation(value: TraceValueRow) {
	for (const entry of value.provenance) if (entry.kind === "computation") return entry;
	throw new Error(`no computation provenance on ${value.field}`);
}

function inputNamed(inputs: ReturnType<typeof computation>["inputs"], name: string) {
	const found = inputs.find((input) => input.name === name);
	if (found === undefined) throw new Error(`no computation input named ${name}`);
	return found;
}

/* -------------------------------------------------------------------------- */
/* A3, row by row, over the sentence A3 was written about                     */
/* -------------------------------------------------------------------------- */

describe("a record trace fills every row of docs/BRIEF.md A3", () => {
	it("names the agency, the record kind and the three identifiers", async () => {
		const sentences = everySentence(await houstonEvents());
		const view = firstView(sentenceSaying(sentences, "VALERO PLUME"));
		expect(view.scope).toBe("record");

		const header = rowNamed(view, pick.agency, "agency-and-kind");
		expect(header.agency).toBe("EPA Superfund Enterprise Management System");
		expect(header.recordKind).toBe("sems-site");
		expect(header.source).toBe("sems");

		expect(rowNamed(view, pick.ids, "record-ids").ids).toEqual([
			{ label: "epaSiteId", value: "TXN000622182" },
			{ label: "semsSiteId", value: "0622182" },
			{ label: "frsRegistryId", value: "110000460885" },
		]);
		expect(rowNamed(view, pick.ids, "record-ids").relation).toBe("this-record");
	});

	it("links the original record, built from the site ID by a url-template", async () => {
		const sentences = everySentence(await houstonEvents());
		const view = firstView(sentenceSaying(sentences, "VALERO PLUME"));
		const original = rowNamed(view, pick.original, "original-record").value;
		expect(original.normalized).toBe("https://cumulis.epa.gov/supercpad/cursites/csitinfo.cfm?id=0622182");
		expect(computation(original).formula).toBe("url-template");
		expect(inputNamed(computation(original).inputs, "id").value).toBe("0622182");
	});

	it("shows both names behind the site name, as A3's fourth row does", async () => {
		const sentences = everySentence(await houstonEvents());
		const view = firstView(sentenceSaying(sentences, "VALERO PLUME"));
		const subject = valueNamed(view, "subject");
		expect(subject.displayed).toBe("VALERO PLUME");
		expect(subject.presence).toBe("clicked");
		const coalesce = computation(subject);
		expect(coalesce.formula).toBe("coalesce");
		const envirofacts = inputNamed(coalesce.inputs, "first").provenance[0];
		const frs = inputNamed(coalesce.inputs, "second").provenance[0];
		expect(envirofacts).toMatchObject({ dataset: "envirofacts_site", sourceField: "name", rawValue: "VALERO PLUME" });
		expect(frs).toMatchObject({ dataset: "frs_program_facility", sourceField: "PRIMARY_NAME", rawValue: "HOUSTON REFINERY" });
	});

	it("shows the distance as a haversine over both coordinates, with the reference point beside it", async () => {
		const sentences = everySentence(await houstonEvents());
		const view = firstView(sentenceSaying(sentences, "VALERO PLUME"));
		const distance = valueNamed(view, "distanceMeters");
		expect(distance.displayed).toBe("0.76 km");
		expect(distance.normalized).toBe(755);
		const haversine = computation(distance);
		expect(haversine.formula).toBe("haversine");
		expect(haversine.inputs.map((input) => input.value)).toEqual([
			29.720658823001, -95.261995884462, 29.722274, -95.254401,
		]);
		expect(inputNamed(haversine.inputs, "to.latitude").provenance[0]).toMatchObject({ sourceField: "LATITUDE83" });

		// A3 puts these two in the distance row. They are values of the record
		// that this sentence does not show, so they arrive as context rows.
		const reference = valueNamed(view, "location.referencePoint");
		expect(reference.normalized).toBe("CENTER OF A FACILITY OR STATION");
		expect(reference.presence).toBe("context");
		const accuracy = valueNamed(view, "location.accuracyMeters");
		expect(accuracy.normalized).toBeNull();
		expect(fieldProvenance(accuracy).sourceField).toBe("ACCURACY_VALUE");
	});

	it("names the raw field, raw value and transform behind each status and the date", async () => {
		const sentences = everySentence(await houstonEvents());
		const view = firstView(sentenceSaying(sentences, "VALERO PLUME"));

		const npl = valueNamed(view, "semsNplStatus");
		expect(npl.displayed).toBe("Not on the NPL");
		expect(fieldProvenance(npl)).toMatchObject({ sourceField: "npl_status_name", transform: "identity" });

		const nonNpl = valueNamed(view, "nonNplStatus");
		expect(nonNpl.displayed).toBe("Removal Only Site (No Site Assessment Work Needed)");
		expect(fieldProvenance(nonNpl).sourceField).toBe("non_npl_status_name");

		const date = valueNamed(view, "statusDate");
		expect(date.displayed).toBe("2022-02-08");
		expect(fieldProvenance(date)).toMatchObject({
			sourceField: "non_npl_status_date",
			rawValue: "2022-02-08 00:00:00",
			transform: "normalize-date",
		});
	});

	it("carries the source-update date, the retrieval row and the caveats", async () => {
		const sentences = everySentence(await houstonEvents());
		const view = firstView(sentenceSaying(sentences, "VALERO PLUME"));

		const updated = rowNamed(view, pick.sourceUpdated, "source-updated").value;
		expect(updated.normalized).toBe("2024-03-14T10:51:51Z");
		expect(fieldProvenance(updated)).toMatchObject({
			sourceField: "UPDATE_DATE",
			rawValue: 1710413511000,
			transform: "parse-epoch-ms",
		});
		expect(rowNamed(view, pick.recordDate, "record-date").value.normalized).toBe("2022-02-08");

		const retrieved = rowNamed(view, pick.retrieved, "retrieved");
		expect(retrieved.at).toEqual([RETRIEVED_AT]);
		expect(retrieved.adapters).toContain("sems@1");
		expect(retrieved.payloads.length).toBeGreaterThan(0);
		for (const payload of retrieved.payloads) expect(payload.sha256).toMatch(/^[0-9a-f]{64}$/);

		expect(rowNamed(view, pick.caveats, "caveats").caveats).toEqual([
			"A SEMS record can mean assessment, proposed action, active cleanup, or completed work.",
			"The coordinate is a reference point, not a boundary.",
		]);
		expect(view.absentRows).toEqual([]);
	});
});

/* -------------------------------------------------------------------------- */
/* The three scopes A3 was not written for                                    */
/* -------------------------------------------------------------------------- */

describe("a count sentence opens on the records it counted", () => {
	it("gives the section's agency, kind, boundary and every counted record ID", async () => {
		const sentences = everySentence(await houstonEvents());
		const view = firstView(sentenceSaying(sentences, "Superfund sites EPA's inventory lists within"));
		expect(view.scope).toBe("section");

		expect(rowNamed(view, pick.agency, "agency-and-kind")).toMatchObject({
			agency: "EPA Superfund Enterprise Management System",
			recordKind: "sems-site",
			source: "sems",
		});
		const ids = rowNamed(view, pick.ids, "record-ids");
		expect(ids.relation).toBe("counted");
		expect(ids.ids.length).toBe(15);
		expect(ids.ids.map((id) => id.value)).toContain("TXN000622182");
		for (const id of ids.ids) expect(id.label).toBe("sems-site");

		expect(valueNamed(view, "count").normalized).toBe(15);
		expect(rowNamed(view, pick.boundary, "boundary").boundary).toBe("5 miles");
		expect(rowNamed(view, pick.retrieved, "retrieved").at).toEqual([RETRIEVED_AT]);
	});

	it("has no query behind the boundary, and says which A3 rows the scope cannot fill", async () => {
		const sentences = everySentence(await houstonEvents());
		const view = firstView(sentenceSaying(sentences, "Superfund sites EPA's inventory lists within"));
		// SectionTrace.query is null on every section this route builds, so the
		// boundary string is the whole of what stands behind "5 miles".
		expect(rowNamed(view, pick.boundary, "boundary").query).toBeNull();
		expect(view.absentRows).toEqual(["original-record", "record-date", "source-updated", "caveats"]);
	});
});

describe("a status sentence opens on our own request", () => {
	it("gives the agency and the status enum for a source that answered", async () => {
		const sentences = everySentence(await houstonEvents());
		const view = firstView(sentenceSaying(sentences, "EPA Enforcement and Compliance History Online answered"));
		expect(view.scope).toBe("source");
		expect(rowNamed(view, pick.agency, "agency-and-kind")).toMatchObject({
			agency: "EPA Enforcement and Compliance History Online",
			recordKind: null,
			source: "echo",
		});
		expect(rowNamed(view, pick.outcome, "outcome")).toEqual({
			row: "outcome",
			status: "ok",
			cause: null,
			rawCode: null,
			retryAfter: null,
		});
		expect(rowNamed(view, pick.retrieved, "retrieved").at).toEqual([RETRIEVED_AT]);
		expect(view.absentRows).toEqual(["record-ids", "original-record", "record-date", "source-updated", "caveats"]);
	});

	it("gives the failure cause for the flood card's prior attempt, which is the only unavailable trace here", async () => {
		const sentences = everySentence(await houstonEvents());
		const view = firstView(sentenceSaying(sentences, "could not be reached"));
		expect(rowNamed(view, pick.outcome, "outcome")).toEqual({
			row: "outcome",
			status: "unavailable",
			cause: "refused",
			rawCode: null,
			retryAfter: null,
		});
		// An unavailable source has no retrieval time, so the row is absent
		// rather than filled with a time nothing was retrieved at.
		expect(view.rows.some((row) => row.row === "retrieved")).toBe(false);
	});
});

describe("a group sentence opens on the records it tied together", () => {
	it("names the members and the field they share, and recovers the payloads from the provenance", async () => {
		const sentences = everySentence(await houstonEvents());
		const view = firstView(sentenceSaying(sentences, "share one EPA facility registry ID"));
		expect(view.scope).toBe("group");

		const ids = rowNamed(view, pick.ids, "record-ids");
		expect(ids.relation).toBe("grouped");
		expect(ids.ids).toEqual([
			{ label: "sems-site", value: "TXN000607355" },
			{ label: "sems-site", value: "TXN000605303" },
		]);
		expect(rowNamed(view, pick.groupedBy, "grouped-by").field).toBe("frsRegistryId");

		// The group header carries no agency and no payload of its own; these
		// come off the member record the values were read from.
		const retrieved = rowNamed(view, pick.retrieved, "retrieved");
		expect(retrieved.adapters).toContain("sems@1");
		expect(retrieved.payloads.length).toBeGreaterThan(0);
		expect(view.absentRows).toEqual(["agency-and-kind", "original-record", "record-date", "source-updated", "caveats"]);
	});
});

/* -------------------------------------------------------------------------- */
/* Every span of every sentence, walked                                       */
/* -------------------------------------------------------------------------- */

describe("every slotted span of the demo report opens something", () => {
	it("opens a view naming the clicked field, its value, and what grounds it", async () => {
		const sentences = everySentence(await houstonEvents());
		let opened = 0;
		for (const sentence of sentences) {
			for (const index of openableSpans(sentence)) {
				const view = traceView(sentence, index);
				expect(view, textOf(sentence)).not.toBeNull();
				if (view === null) continue;
				opened += 1;

				// The clicked value is on screen, named, and shown as the span shows it.
				const span = sentence.spans[index];
				expect(span?.slot?.field).toBe(view.clickedField);
				const clicked = clickedValues(view);
				expect(clicked.length, `${textOf(sentence)} @${index}`).toBe(1);
				expect(clicked[0]?.displayed).toBe(span?.text);

				// And something grounds it: a record, a section's counted list, a
				// source outcome, or a group's members. Never nothing.
				const grounding = view.rows.filter(
					(row) => row.row === "agency-and-kind" || row.row === "record-ids" || row.row === "outcome",
				);
				expect(grounding.length, `${textOf(sentence)} @${index}`).toBeGreaterThan(0);
			}
		}
		// docs/BRIEF.md A2 screen 3 over the Houston demo point: 48 sentences,
		// 172 of whose spans carry a slot. Pinned, so a template that loses a
		// slot is a failure here.
		expect(sentences.length).toBe(48);
		expect(opened).toBe(172);
	});

	it("leaves 27 spans whose value has no provenance of its own, and gives every one of them a header", async () => {
		const sentences = everySentence(await houstonEvents());
		let empty = 0;
		for (const sentence of sentences) {
			for (const index of openableSpans(sentence)) {
				const view = traceView(sentence, index);
				if (view === null) continue;
				const value = clickedValues(view)[0];
				if (value === undefined || value.provenance.length > 0) continue;
				empty += 1;
				// Every one of them is a count or a status, and every one still
				// opens on a header: the agency, and either the counted records or
				// the outcome of our own request.
				expect(view.scope === "section" || view.scope === "source").toBe(true);
				expect(rowNamed(view, pick.agency, "agency-and-kind").agency).not.toBeNull();
				const grounding = view.rows.some((row) => row.row === "record-ids" || row.row === "outcome");
				expect(grounding, `${textOf(sentence)} @${index}`).toBe(true);
			}
		}
		expect(empty).toBe(27);
	});

	it("opens nothing for connective text or for an index off the end", async () => {
		const sentences = everySentence(await houstonEvents());
		const sentence = sentenceSaying(sentences, "VALERO PLUME");
		const connective = sentence.spans.findIndex((span) => span.slot === null);
		expect(connective).toBeGreaterThan(-1);
		expect(traceView(sentence, connective)).toBeNull();
		expect(traceView(sentence, sentence.spans.length)).toBeNull();
		expect(traceView(sentence, -1)).toBeNull();
	});
});

describe("absentRowsFor is a fact about the scope, not about one trace", () => {
	it("says what each of the four arms cannot carry", () => {
		expect(absentRowsFor("record")).toEqual([]);
		expect(absentRowsFor("section")).toEqual(["original-record", "record-date", "source-updated", "caveats"]);
		expect(absentRowsFor("source")).toEqual([
			"record-ids",
			"original-record",
			"record-date",
			"source-updated",
			"caveats",
		]);
		expect(absentRowsFor("group")).toEqual([
			"agency-and-kind",
			"original-record",
			"record-date",
			"source-updated",
			"caveats",
		]);
	});
});
