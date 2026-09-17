/**
 * The selection and ordering policy, against the committed fixture bytes —
 * .dev/BRIEF.md B7.
 *
 * Every record here is built by running a real adapter (`semsAdapter`,
 * `createEchoAdapter`, `floodZoneOutcome` over `esriReducedSetAdapter`,
 * `lookupFrsFacility`) through a stub `SourceIo` that serves committed bytes,
 * and sealed by the kernel's `complete`. Nothing here hand-builds a record and
 * nothing invents a payload.
 *
 * Three answers are served with one column altered, each labelled `derived:` in
 * its payload URL and each reaching a state the recorded bytes cannot: an ECHO
 * row with no coordinate, a pair of ECHO rows that tie on distance and differ on
 * their dates, and an SFHA letter outside {T, F}. That is the technique
 * `tests/unit/templates/sems.test.ts` and `tests/unit/templates/fema.test.ts`
 * already use, for the same reason and with the same labelling.
 *
 * The assertion this whole file is built around is that every placement the
 * policy produces renders. `assemble` now refuses a template whose subject does
 * not satisfy its requirements, so a wrong choice is silence rather than a false
 * sentence — and a record the report holds and cannot describe is still a
 * defect. So the cross-cutting block below renders every placement of the plan
 * against the store it was selected from, per record, and `verify` re-derives
 * each sentence from that same store.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
	complete,
	NO_DATA_NOTE,
	recordId,
	render,
	runSource,
	sectionOrdering,
	SourceFailure,
	requestMade,
	storeOf,
	trace,
	unavailableOf,
	verify,
	watched,
	type EvidenceRecord,
	type EvidenceStore,
	type Fetched,
	type GeocodeMatch,
	type JsonValue,
	type Kind,
	type Locus,
	type PayloadRef,
	type Placement,
	type RecordId,
	type RecordOf,
	type Sealed,
	type SectionSpec,
	type Sentence,
	type SourceIo,
	type SourceOutcome,
	type SubjectKey,
	type Template,
} from "@/lib/evidence";
import { airnowAdapter } from "@/lib/adapters/airnow";
import { aqsAdapter, latestLikelySummaryYear } from "@/lib/adapters/aqs";
import { geocode } from "@/lib/adapters/census";
import { createEchoAdapter } from "@/lib/adapters/echo";
import { FEMA_DATASETS, floodZoneOutcome, type FloodZoneResult } from "@/lib/adapters/fema";
import { FRS_VERSION, lookupFrsFacility } from "@/lib/adapters/frs";
import { semsAdapter } from "@/lib/adapters/sems";
import { groupRecords, type GroupingResult } from "@/lib/report/grouping";
import {
	airnowCard,
	aqsCard,
	BOUNDARY,
	byDistance,
	cardPlacements,
	carriedCount,
	CARRIED_RECORDS,
	echoCard,
	FINAL_NPL_STATUS,
	floodCard,
	frsCard,
	NEAREST_MONITOR,
	NO_GROUPS,
	NONCOMPLIANCE_QUARTERS,
	ORDERINGS,
	planPlacements,
	selectReport,
	semsCard,
	SHOWN_RECORDS,
	type AirTemplates,
	type AnyListing,
	type Bounds,
	type ListingEntry,
	type Card,
	type ReportInput,
	type ReportPlan,
	type ReportSource,
} from "@/lib/report/selection";
import { airnowObservationNoIndex, airnowObservationSummary, airnowTemplates } from "@/lib/templates/airnow";
import { aqsMonitorSummary } from "@/lib/templates/aqs";
import { groupTemplates } from "@/lib/templates/groups";
import { originTemplates } from "@/lib/templates/origin";
import { aqsNoPollutantMonitor, sectionTemplates, semsNplSectionCount } from "@/lib/templates/sections";
import { semsSiteRegistryOnly } from "@/lib/templates/sems";
import { RECORD_TEMPLATES } from "@/lib/templates/registry";
import { sourceTemplates } from "@/lib/templates/sources";
import { houstonLocus } from "@/tests/unit/evidence/helpers/sems-fixtures";

const fixturesDir = fileURLToPath(new URL("../../fixtures/", import.meta.url));
const RETRIEVED_AT = "2026-09-16T09:00:00Z";
const POLICY = { timeoutMs: 10_000 };

const locus: Locus = houstonLocus();

/**
 * Every template the report may hold, for `verify`.
 *
 * The record kinds come from `RECORD_TEMPLATES` rather than six spreads written
 * out here. The spreads were correct and would have stayed correct only by
 * someone remembering: a kind left out of them fails nothing, because `verify`
 * simply finds no template for that sentence and returns false, which reads
 * like a defect in the renderer rather than a gap in this list. The registry
 * cannot leave one out and still compile.
 *
 * The four subject kinds below it are not record kinds and are not in `Kind`,
 * so they are still named here.
 */
const ALL_TEMPLATES: readonly Template<SubjectKey>[] = [
	...RECORD_TEMPLATES,
	...sectionTemplates,
	...sourceTemplates,
	...originTemplates,
	...groupTemplates,
];

/** `noUncheckedIndexedAccess` is on, and a test that silently skipped an index would assert nothing. */
function at<T>(items: readonly T[], index: number, what: string): T {
	const item = items[index];
	if (item === undefined) throw new Error(`no ${what} at index ${index}`);
	return item;
}

/* -------------------------------------------------------------------------- */
/* Fixture bytes, and the three derived answers                               */
/* -------------------------------------------------------------------------- */

function bytesOf(relative: string): Buffer {
	return readFileSync(`${fixturesDir}${relative}`);
}

function payloadOf(url: string, bytes: Buffer): PayloadRef {
	return { url, sha256: createHash("sha256").update(bytes).digest("hex"), retrievedAt: RETRIEVED_AT };
}

/** What one request is answered with: recorded bytes, bytes derived from them, or a failure. */
type Answer =
	| { readonly fixture: string }
	| { readonly derived: string; readonly body: JsonValue }
	| { readonly fail: SourceFailure };

function ioOf(answerFor: (url: URL) => Answer): SourceIo {
	return {
		get<Raw extends JsonValue>(url: URL, schema: z.ZodType<Raw>): Promise<Fetched<Raw>> {
			const answer = answerFor(url);
			if ("fail" in answer) return Promise.reject(answer.fail);
			const bytes = "fixture" in answer ? bytesOf(answer.fixture) : Buffer.from(JSON.stringify(answer.body), "utf8");
			const label = "fixture" in answer ? `fixture:${answer.fixture}` : `derived:${answer.derived}`;
			return Promise.resolve({
				raw: schema.parse(JSON.parse(bytes.toString("utf8"))),
				payload: payloadOf(label, bytes),
			});
		},
		query(parameter, value, adapterVersion, payload) {
			return { kind: "query", parameter, value, adapterVersion, payload };
		},
		now: () => RETRIEVED_AT,
	};
}

type JsonObject = { readonly [key: string]: JsonValue };

function parseJson(relative: string): JsonValue {
	const value: JsonValue = JSON.parse(bytesOf(relative).toString("utf8"));
	return value;
}

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
	return Array.isArray(value);
}

function objectAt(value: JsonValue | undefined, path: string): JsonObject {
	if (value === undefined || value === null || typeof value !== "object" || isJsonArray(value)) {
		throw new Error(`${path} is not an object`);
	}
	return value;
}

function arrayAt(value: JsonValue | undefined, path: string): readonly JsonValue[] {
	if (value === undefined || !isJsonArray(value)) throw new Error(`${path} is not an array`);
	return value;
}

/* -------------------------------------------------------------------------- */
/* The origin                                                                 */
/* -------------------------------------------------------------------------- */

async function houstonMatch(): Promise<GeocodeMatch> {
	const outcome = await geocode(
		"9311 E Ave P, Houston, TX 77012",
		ioOf(() => ({ fixture: "census/match-9311-e-ave-p.json" })),
	);
	if (outcome.status !== "matched") throw new Error(`expected a match, got ${outcome.status}`);
	return outcome.match;
}

const match = await houstonMatch();

/* -------------------------------------------------------------------------- */
/* SEMS, in all three status-row states                                       */
/* -------------------------------------------------------------------------- */

const LAYER_5MI = "sems/arcgis-5mi-houston.json";

/** The EPA ID out of `.../efservice/envirofacts_site/epa_id/<EPA_ID>/JSON`. */
function epaIdOf(url: URL): string | null {
	const segments = url.pathname.split("/");
	const id = segments[segments.length - 2];
	return url.host === "data.epa.gov" && id !== undefined ? id : null;
}

/**
 * The one recorded site whose `npl_status_name` is `Site is Part of NPL Site`.
 * That is NPL vocabulary and it is not the final list, which is the distinction
 * the final-NPL count has to make.
 */
const PART_OF_NPL = "TXN000607155";

/** The two sites .dev/BRIEF.md A2 names as being on the final National Priorities List, nearest first. */
const FINAL_NPL_SITES: readonly string[] = ["TXN000607093", "TXD980748453"];

/** .dev/BRIEF.md B6's verified pair: two Superfund EPA IDs under registry 110000462703, each with its own Envirofacts name. */
const PASADENA_PAIR: readonly string[] = ["TXN000607355", "TXN000605303"];

/**
 * Served the recorded empty Envirofacts answer, so its record reaches the
 * `no-row` state. All fifteen recorded sites do have a status row — that was
 * checked against the live endpoint — so the state is reached by changing what
 * the inventory is served, never by claiming this site lacks a row.
 */
const ROWLESS_SITE = "TXN000606604";

/** Its status request is rejected, so its record reaches the `unavailable` state. */
const FAILED_SITE = "TXN000607443";

/** The layer's own rows, with named columns replaced on the row for a named EPA ID and everything else untouched. */
function semsLayerBody(overrides: Readonly<Record<string, JsonObject>>): JsonValue {
	const layer = objectAt(parseJson(LAYER_5MI), LAYER_5MI);
	const features = arrayAt(layer["features"], "features").map((feature, index) => {
		const one = objectAt(feature, `features.${index}`);
		const attributes = objectAt(one["attributes"], "attributes");
		const id = attributes["PGM_SYS_ID"];
		const override = typeof id === "string" ? overrides[id] : undefined;
		return override === undefined ? one : { ...one, attributes: { ...attributes, ...override } };
	});
	return { ...layer, features };
}

/**
 * The recorded answers, with the Envirofacts status request rejected for the
 * sites `failing` names.
 *
 * Which sites those are is the whole of .dev/BRIEF.md A1: Envirofacts is a
 * second host, asked once per site, fifteen times at `STATUS_CONCURRENCY = 4`,
 * and the sites whose request fails are the sites the final-NPL filter cannot
 * see. One unrelated site failing is the default here; the two final-NPL sites
 * failing is the case that printed a zero.
 */
function semsIo(
	layer: Answer = { fixture: LAYER_5MI },
	failing: readonly string[] = [FAILED_SITE],
	rowless: readonly string[] = [ROWLESS_SITE],
): SourceIo {
	return ioOf((url) => {
		const epaId = epaIdOf(url);
		if (epaId === null) return layer;
		if (failing.includes(epaId)) return { fail: new SourceFailure("rate-limited", "429", "60") };
		if (rowless.includes(epaId)) return { fixture: "sems/envirofacts-no-row.json" };
		return { fixture: `sems/envirofacts-${epaId}.json` };
	});
}

const sems = await runSource(locus, semsAdapter, semsIo(), POLICY);

/**
 * The same fifteen sites with every status request answered, which is what the
 * recorded demo does: all fifteen have an Envirofacts row and every one of them
 * came back (`tests/fixtures/README.md`). The Superfund inventory has then
 * answered about every site the final-NPL count counts from, which is the state
 * that count may be stated in.
 */
const semsAnswered = await runSource(locus, semsAdapter, semsIo({ fixture: LAYER_5MI }, []), POLICY);

function recordsOf(outcome: SourceOutcome): readonly Sealed<EvidenceRecord>[] {
	return outcome.status === "ok" ? outcome.records : [];
}

/* -------------------------------------------------------------------------- */
/* ECHO, recorded and derived                                                 */
/* -------------------------------------------------------------------------- */

const ECHO_SUMMARY = "echo/facilities-quarter-mi.json";
const ECHO_PAGE = "echo/facilities-page-quarter-mi.json";

/** The recorded page, with named columns replaced on named rows and everything else untouched. */
function echoPageBody(overrides: Readonly<Record<string, JsonObject>>): JsonValue {
	const page = objectAt(parseJson(ECHO_PAGE), ECHO_PAGE);
	const results = objectAt(page["Results"], "Results");
	const rows = arrayAt(results["Facilities"], "Facilities").map((row, index) => {
		const facility = objectAt(row, `Facilities.${index}`);
		const id = facility["RegistryID"];
		const override = typeof id === "string" ? overrides[id] : undefined;
		return override === undefined ? facility : { ...facility, ...override };
	});
	return { ...page, Results: { ...results, Facilities: rows } };
}

/** ECHO answers `get_facilities` first and `get_qid` after; the rows are in the second answer. */
function echoIo(page: Answer): SourceIo {
	let call = 0;
	return ioOf(() => {
		call += 1;
		return call === 1 ? { fixture: ECHO_SUMMARY } : page;
	});
}

async function echoOutcome(page: Answer = { fixture: ECHO_PAGE }): Promise<SourceOutcome> {
	return runSource(locus, createEchoAdapter({ retryDelayMs: 0 }), echoIo(page), POLICY);
}

const echo = await echoOutcome();

const CARGILL = "110005085898";
const GRIZZLY = "110070365452";
const PORT_TERMINAL = "110009747514";
const SOUTH_COAST = "110064116987";
const SOUTH_PORT = "110016765277";
const WESTWAY_HOUSTON = "110070369610";
const WESTWAY_LLC = "110035313844";

/* -------------------------------------------------------------------------- */
/* FRS and FEMA                                                               */
/* -------------------------------------------------------------------------- */

const TWO_IDS_REGISTRY = "110000462703";

/**
 * FRS's entry point takes a registry ID rather than a locus, so it is not an
 * `Adapter` and `runSource` cannot run it. The record still comes through the
 * real `lookupFrsFacility` and the kernel's `complete`; only the three-field
 * outcome around it is assembled here.
 */
async function frsOutcome(fixture: string, registryId: string): Promise<SourceOutcome> {
	const seen = watched(ioOf(() => ({ fixture })));
	const [built] = await lookupFrsFacility(registryId, seen.io);
	if (built === undefined) throw new Error(`no FRS facility for ${registryId}`);
	return {
		status: "ok",
		records: [complete(locus, built)],
		retrievedAt: RETRIEVED_AT,
		query: requestMade(seen.io, FRS_VERSION, seen.made),
	};
}

const frs = await frsOutcome(`frs/arcgis-registry-${TWO_IDS_REGISTRY}-two-ids.json`, TWO_IDS_REGISTRY);

const NFHL_REFUSED = new SourceFailure("refused");

/**
 * `floodZoneOutcome` asks FEMA's own layer first. Its host refuses connections
 * from outside the US (.dev/BRIEF.md B14) and no response from it has ever been
 * recorded, so the stub refuses it and Esri's recorded copy answers — which is
 * the case that leaves a non-null `nfhl` on the result.
 */
async function flood(esri: Answer): Promise<FloodZoneResult> {
	return floodZoneOutcome(
		locus,
		ioOf((url) => (url.host === "hazards.fema.gov" ? { fail: NFHL_REFUSED } : esri)),
		POLICY,
	);
}

const fema = await flood({ fixture: "fema/esri-zone-ae-pasadena.json" });

/* -------------------------------------------------------------------------- */
/* Air: no adapter, no record, no template                                    */
/* -------------------------------------------------------------------------- */

/**
 * AQS's shared test account is exhausted and AirNow refuses without a key, so
 * both recorded fixtures are error bodies. These outcomes carry the recorded
 * body as the raw code, through the kernel's own classification, which is what
 * each adapter does with the same response today.
 */
function unavailableFrom(fixture: string, reason: "rate-limited" | "http", retryAfter: string | null): SourceOutcome {
	return unavailableOf(new SourceFailure(reason, parseJson(fixture), retryAfter));
}

const aqs = unavailableFrom("aqs/rate-limited.json", "rate-limited", "86400");
const airnow = unavailableFrom("airnow/unauthenticated.json", "http", null);

/**
 * The real templates, which exist now. They were stand-ins here while the two
 * adapters were briefed and unwritten, and a stand-in cannot exercise the one
 * thing this file has to check: `lib/templates/airnow.ts` is two templates
 * split on `aqi`, each declaring the state it speaks about, so the policy
 * chooses per record and a card built from one of them alone leaves every row
 * in the other state with no sentence at all.
 */
const AIR: AirTemplates = { aqs: aqsMonitorSummary, airnow: airnowTemplates };

/**
 * The year the report asks AQS about, read off the same clock every payload's
 * `retrievedAt` comes from -- which is what `app/api/report/handler.ts` does
 * with `io.now()`, and is why neither it nor this file reads a wall clock.
 */
const SUMMARY_YEAR = latestLikelySummaryYear(RETRIEVED_AT);

/**
 * Both air sources answering, through their own adapters, over committed bytes.
 *
 * Neither key is in this process and neither adapter will fetch without one, so
 * the two are set for the length of the call and restored after it. That is the
 * request an operator's deployment makes; the unavailable outcomes above are
 * the one this deployment makes, and the report has to be right about both.
 */
async function withAirKeys<T>(run: () => Promise<T>): Promise<T> {
	const names: readonly string[] = ["AQS_EMAIL", "AQS_KEY", "AIRNOW_KEY"];
	const before = names.map((name) => ({ name, value: process.env[name] }));
	process.env["AQS_EMAIL"] = "selection-test@example.test";
	process.env["AQS_KEY"] = "selection-test-aqs-key";
	process.env["AIRNOW_KEY"] = "selection-test-airnow-key";
	try {
		return await run();
	} finally {
		for (const { name, value } of before) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	}
}

/**
 * One AirNow answer carrying both states: the recorded ozone row, which has an
 * index, and the recorded PM2.5 row, which has none. Two committed rows
 * recombined into one body and labelled `derived:`, because no single fixture
 * holds both and a card that shows one row per state is what the per-record
 * choice has to be asserted against.
 */
function airnowBothStates(): JsonValue {
	const indexed = arrayAt(parseJson("airnow/current-observations-houston.json"), "the observations");
	const none = arrayAt(parseJson("airnow/derived-null-aqi.json"), "the null-index observations");
	return [objectAt(indexed[0], "the ozone row"), objectAt(none[0], "the row with no index")];
}

const aqsAnswered = await withAirKeys(() =>
	runSource(
		locus,
		aqsAdapter(SUMMARY_YEAR),
		ioOf(() => ({ fixture: "aqs/annual-summary-houston.json" })),
		POLICY,
	),
);

const airnowAnswered = await withAirKeys(() =>
	runSource(
		locus,
		airnowAdapter,
		ioOf(() => ({ derived: "airnow-one-index-one-not", body: airnowBothStates() })),
		POLICY,
	),
);

const NO_RECORDS: SourceOutcome = { status: "no-data", note: NO_DATA_NOTE, retrievedAt: RETRIEVED_AT, query: null };

/* -------------------------------------------------------------------------- */
/* Plans                                                                      */
/* -------------------------------------------------------------------------- */

const GROUPABLE: readonly Kind[] = ["sems-site", "echo-facility", "frs-facility", "fema-flood-zone"];

function groupingFrom(store: EvidenceStore): GroupingResult {
	return groupRecords(GROUPABLE.flatMap((kind) => [...store.ofKind(kind)]));
}

type PlanFor = {
	readonly sems: SourceOutcome;
	readonly echo: SourceOutcome;
	readonly frs: SourceOutcome;
	readonly aqs: SourceOutcome;
	readonly airnow: SourceOutcome;
	readonly flood: FloodZoneResult;
	readonly air: AirTemplates | null;
};

type Built = { readonly plan: ReportPlan; readonly store: EvidenceStore };

function inputFor(parts: PlanFor, store: EvidenceStore): ReportInput {
	return {
		store,
		match,
		sources: { sems: parts.sems, echo: parts.echo, frs: parts.frs, aqs: parts.aqs, airnow: parts.airnow },
		flood: parts.flood,
		grouping: groupingFrom(store),
		air: parts.air,
	};
}

function planOf(parts: PlanFor, bounds?: Bounds): Built {
	const store = storeOf(
		[parts.sems, parts.echo, parts.frs, parts.aqs, parts.airnow, parts.flood.outcome].flatMap(recordsOf),
	);
	const input = inputFor(parts, store);
	return { plan: bounds === undefined ? selectReport(input) : selectReport(input, bounds), store };
}

const HOUSTON: PlanFor = { sems, echo, frs, aqs, airnow, flood: fema, air: null };

const houston = planOf(HOUSTON);

/**
 * The same report over the fifteen sites the inventory answered about in full.
 *
 * `HOUSTON` rejects one site's status request, because three status-row states
 * over one plan is what the Superfund templates have to be asserted against —
 * and a card holding a site the inventory did not answer for states no
 * final-NPL count at all. So every assertion about that count is made here,
 * where the count is a count of the sites the count is about, and the withheld
 * case has tests of its own.
 */
const ANSWERED: PlanFor = { ...HOUSTON, sems: semsAnswered };

const answered = planOf(ANSWERED);

/**
 * The same report with both air sources answering and the real templates
 * registered: five monitors' worth of AQS body reduced to the three within
 * 50 km, and two AirNow rows, one carrying an index and one not.
 */
const WITH_AIR: PlanFor = { ...HOUSTON, aqs: aqsAnswered, airnow: airnowAnswered, air: AIR };

const withAir = planOf(WITH_AIR);

/* -------------------------------------------------------------------------- */
/* Helpers over a plan                                                        */
/* -------------------------------------------------------------------------- */

function cardOf(plan: ReportPlan, source: ReportSource): Card {
	const found = plan.cards.find((card) => card.source === source);
	if (found === undefined) throw new Error(`no ${source} card`);
	return found;
}

function listingOf(plan: ReportPlan, source: ReportSource, index = 0): AnyListing {
	return at(cardOf(plan, source).listings, index, `${source} listing`);
}

/**
 * Every helper below takes the store, because a listing holds no records: it
 * holds the section, the order, the bound and how a record of that kind becomes
 * placements, and `entries` rebuilds the rest against whatever store it is
 * handed. A test that asked a listing what it held would be asking a plan for a
 * frozen answer, which is the defect this shape removes.
 */
function shownOf(store: EvidenceStore, listing: AnyListing): readonly ListingEntry[] {
	return [...listing.entries(store).shown];
}

function restOf(store: EvidenceStore, listing: AnyListing): readonly ListingEntry[] {
	return [...listing.entries(store).rest];
}

function entriesOf(store: EvidenceStore, listing: AnyListing): readonly ListingEntry[] {
	return [...shownOf(store, listing), ...restOf(store, listing)];
}

function idsOf(store: EvidenceStore, listing: AnyListing): readonly string[] {
	return entriesOf(store, listing).map((entry) => entry.recordId.sourceRecordId);
}

function templateIdsFor(store: EvidenceStore, listing: AnyListing, sourceRecordId: string): readonly string[] {
	const entry = entriesOf(store, listing).find((e) => e.recordId.sourceRecordId === sourceRecordId);
	if (entry === undefined) throw new Error(`${sourceRecordId} is not in the listing`);
	return entry.placements.map((placement) => placement.template.id);
}

function firstPlacementFor(store: EvidenceStore, listing: AnyListing, sourceRecordId: string): Placement {
	const entry = entriesOf(store, listing).find((e) => e.recordId.sourceRecordId === sourceRecordId);
	if (entry === undefined) throw new Error(`${sourceRecordId} is not in the listing`);
	return entry.placements[0];
}

/** Every record sentence a listing renders against this store, in reading order. */
function listingText(store: EvidenceStore, listing: AnyListing): readonly string[] {
	return entriesOf(store, listing).flatMap((entry) =>
		entry.placements.flatMap((placement) => {
			const one = render(store, placement);
			return one === null ? [] : [textOf(one)];
		}),
	);
}

function textOf(one: Sentence): string {
	return one.spans.map((span) => span.text).join("");
}

/** The number a label-then-value sentence ends on. */
function digitsOf(text: string): string {
	const digits = /(\d+)\.$/.exec(text);
	if (digits === null) throw new Error(`${text} does not end on a number`);
	return at(digits, 1, "the number");
}

/** The index of the first span with a field behind it, which is what `trace` explains. */
function spanWithSlot(one: Sentence): number {
	const index = one.spans.findIndex((span) => span.slot !== null);
	if (index < 0) throw new Error(`${textOf(one)} has no span with a slot`);
	return index;
}

/** The spans a reader can click, as `[field, text]`: what a sentence reads off its subject rather than holds itself. */
function slottedOf(one: Sentence): readonly (readonly string[])[] {
	return one.spans.flatMap((span) => (span.slot === null ? [] : [[span.slot.field, span.text]]));
}

function mustSentence(store: EvidenceStore, placement: Placement): Sentence {
	const one = render(store, placement);
	if (one === null) throw new Error(`the ${placement.scope} placement for ${placement.template.id} rendered nothing`);
	return one;
}

function mustRender(store: EvidenceStore, placement: Placement): string {
	const one = render(store, placement);
	if (one === null) throw new Error(`the ${placement.scope} placement for ${placement.template.id} rendered nothing`);
	return textOf(one);
}

function headline(plan: ReportPlan, source: ReportSource, index: number): Placement {
	return at(cardOf(plan, source).headlines, index, `${source} headline`);
}

/* -------------------------------------------------------------------------- */
/* Acceptance 2. Every record came through a real adapter and the kernel      */
/* -------------------------------------------------------------------------- */

describe("the records the policy sorts", () => {
	it("are built by the real adapters from committed bytes and sealed by the kernel", () => {
		const records = [...recordsOf(sems), ...recordsOf(echo), ...recordsOf(frs), ...recordsOf(fema.outcome)];

		expect(records).toHaveLength(15 + 7 + 1 + 1);
		for (const record of records) {
			for (const payload of record.payloads) {
				expect(payload.url.startsWith("fixture:") || payload.url.startsWith("derived:"), payload.url).toBe(true);
			}
			// `complete` is the only way to obtain a sealed record and it is what
			// fills these; an adapter cannot write them.
			expect(record.id.sourceRecordId).toBe(record.sourceRecordId);
			expect(record.payloads.length).toBeGreaterThan(0);
		}
	});

	it("reach all three Superfund status-row states from the recorded bytes", () => {
		const byState = new Map<string, string[]>();
		for (const record of houston.store.ofKind("sems-site")) {
			const ids = byState.get(record.statusRow.status) ?? [];
			ids.push(record.sourceRecordId);
			byState.set(record.statusRow.status, ids);
		}

		expect(byState.get("no-row")).toEqual([ROWLESS_SITE]);
		expect(byState.get("unavailable")).toEqual([FAILED_SITE]);
		expect(byState.get("joined")).toHaveLength(13);
	});
});

/* -------------------------------------------------------------------------- */
/* The addendum's demand: every placement renders                             */
/* -------------------------------------------------------------------------- */

describe("every placement the policy produces renders", () => {
	it("renders every placement of the plan and re-derives each sentence from the store", () => {
		const placements = planPlacements(houston.store, houston.plan);

		// A length that only has to beat 40 would not notice a whole card going
		// missing. Every source's status is on the page, in reading order, FEMA's
		// twice because its authoritative layer refused and its copy answered.
		expect(placements.flatMap((one) => (one.scope === "source" ? [one.source] : []))).toEqual([
			"sems",
			"fema",
			"fema",
			"aqs",
			"airnow",
			"echo",
			"frs",
		]);
		// 57 before the ECHO card stopped placing `industry-codes@1` for the six
		// facilities that have a code column, and before the registry
		// cross-reference moved beside the group it is about. 52 before the two
		// this plan no longer holds: the registry's "Searched within 5 miles",
		// over a lookup by registry ID that stated no boundary, and the
		// final-NPL count, over a store holding a site the inventory did not
		// answer for.
		expect(placements).toHaveLength(50);
		for (const placement of placements) {
			const one = render(houston.store, placement);

			expect(one, `${placement.scope} / ${placement.template.id}`).not.toBeNull();
			if (one === null) continue;
			expect(verify(houston.store, one, ALL_TEMPLATES), textOf(one)).toBe(true);
		}
	});

	it("renders every placement, per record, for every record in every listing", () => {
		for (const card of houston.plan.cards) {
			for (const listing of card.listings) {
				for (const entry of entriesOf(houston.store, listing)) {
					for (const placement of entry.placements) {
						const one = render(houston.store, placement);

						expect(one, `${entry.recordId.sourceRecordId} / ${placement.template.id}`).not.toBeNull();
					}
				}
			}
		}
	});

	it("puts exactly one ECHO primary on every entry, first", () => {
		const primaries = new Set(["echo-facility/summary@1", "echo-facility/no-status@1"]);
		const listing = listingOf(houston.plan, "echo");

		for (const entry of entriesOf(houston.store, listing)) {
			const ids = entry.placements.map((placement) => placement.template.id);

			expect(ids.filter((id) => primaries.has(id)), entry.recordId.sourceRecordId).toHaveLength(1);
			expect(primaries.has(at(ids, 0, "template"))).toBe(true);
		}
	});

	/**
	 * Every secondary names its facility inside its own clauses, which is what
	 * lets a secondary be true wherever it is placed — and four of them printed
	 * one facility's name four times in four consecutive sentences. Industry
	 * codes are the cheapest of the four to lose: B2 asks for none, and the two
	 * columns are bare numbers a reader cannot act on. Nothing is hidden by the
	 * decision, which is the half of it that has to be asserted.
	 */
	it("does not place the industry-codes template, and leaves both code columns in the trace", () => {
		const listing = listingOf(houston.plan, "echo");
		const cargill = houston.store.get(recordId("echo-facility", CARGILL));
		const first = firstPlacementFor(houston.store, listing, CARGILL);
		const one = render(houston.store, first);
		const explained = one === null ? null : trace(houston.store, one, spanWithSlot(one));

		expect(planPlacements(houston.store, houston.plan).map((placement) => placement.template.id)).not.toContain(
			"echo-facility/industry-codes@1",
		);
		// PORT TERMINAL RAILROAD ASSOCIATION is the longest entry the recorded
		// bytes produce, and it carries SIC codes: four sentences before, three
		// now, each of which names the facility inside its own clauses.
		expect(entriesOf(houston.store, listing).map((entry) => entry.placements.length)).toEqual([2, 3, 2, 2, 2, 2, 2]);
		expect(houston.store.get(recordId("echo-facility", PORT_TERMINAL))?.sicCodes.value).toBe("4226 5171");
		expect(templateIdsFor(houston.store, listing, PORT_TERMINAL)).toEqual([
			"echo-facility/summary@1",
			"echo-facility/no-formal-action@1",
			"echo-facility/noncompliance@1",
		]);
		// Nothing is hidden by the decision: both columns are slots, so the record
		// trace behind every other ECHO sentence still carries them.
		expect(cargill?.naicsCodes.value).toBe("311119");
		expect(
			explained?.values.flatMap((value) =>
				value.field === "naicsCodes" || value.field === "sicCodes" ? [[value.field, value.normalized]] : [],
			),
		).toEqual([
			["naicsCodes", "311119"],
			["sicCodes", "2048 5171"],
		]);
	});
});

/* -------------------------------------------------------------------------- */
/* The plan holds no counts                                                   */
/* -------------------------------------------------------------------------- */

describe("the plan holds no counts", () => {
	function sectionsOf(plan: ReportPlan): readonly SectionSpec[] {
		return plan.cards.flatMap((card) => [
			...card.headlines.map((placement) => placement.section),
			...card.listings.map((listing) => listing.section),
		]);
	}

	it("carries specs and placements on a card and a listing, and no length", () => {
		for (const card of houston.plan.cards) {
			expect(Object.keys(card).sort()).toEqual([
				"crossReferences",
				"groups",
				"headlines",
				"listings",
				"priorAttempts",
				"source",
				"status",
			]);
			for (const listing of card.listings) {
				// No `shown` and no `rest`: a listing holds how to rebuild its
				// entries, never the entries. `bounds` is the one number on it, and
				// it is the bound the policy chose rather than a length of anything
				// -- the test below deletes a record and watches it not move.
				expect(Object.keys(listing).sort()).toEqual(["bounds", "describe", "entries", "ordering", "section"]);
				expect(listing.bounds).toEqual({ shown: SHOWN_RECORDS, carried: CARRIED_RECORDS });
				for (const entry of entriesOf(houston.store, listing)) {
					expect(Object.keys(entry).sort()).toEqual(["placements", "recordId"]);
				}
			}
		}
	});

	it("holds the same bound over a store one record smaller, because a bound is not a length", () => {
		const smaller = houston.store.without(recordId("sems-site", PART_OF_NPL));
		const shrunk = selectReport(inputFor(HOUSTON, smaller));

		expect(sectionOrdering(smaller, listingOf(shrunk, "sems").section)).toHaveLength(14);
		expect(listingOf(shrunk, "sems").bounds).toEqual(listingOf(houston.plan, "sems").bounds);
		expect(listingOf(shrunk, "sems").section.carried).toBe(listingOf(houston.plan, "sems").section.carried);
	});

	it("carries no number on a section spec except the bound and a filter's threshold", () => {
		for (const section of sectionsOf(houston.plan)) {
			for (const [key, value] of Object.entries(section)) {
				// `carried` is the bound the policy chose, not a length read off
				// anything: the test below deletes a record and watches it not move.
				if (key === "filter" || key === "carried") continue;

				expect(typeof value, `${section.kind}.${key}`).not.toBe("number");
			}
			const filter = section.filter;
			if (filter === null) continue;
			const numeric = Object.entries(filter).filter(([, value]) => typeof value === "number");

			expect(numeric.map(([key]) => key)).toEqual("atLeast" in filter ? ["atLeast"] : []);
		}
	});

	it("reads the boundary's total from the store at render time, never from the plan", () => {
		const listing = listingOf(houston.plan, "sems");

		expect(sectionOrdering(houston.store, listing.section)).toHaveLength(15);
		expect(mustRender(houston.store, headline(houston.plan, "sems", 0))).toBe(
			"Superfund sites EPA's inventory lists within 5 miles of the mapped point: 15.",
		);
	});
});

/* -------------------------------------------------------------------------- */
/* Acceptance 3. The four Superfund templates                                 */
/* -------------------------------------------------------------------------- */

describe("the four Superfund templates, one state each", () => {
	const listing = listingOf(houston.plan, "sems");
	const npl = listingOf(houston.plan, "sems", 1);

	it("gives a joined site the summary, and it renders", () => {
		expect(templateIdsFor(houston.store, listing, "TXN000622182")).toEqual(["sems-site/summary@1"]);
		expect(mustRender(houston.store, firstPlacementFor(houston.store, listing, "TXN000622182"))).toBe(
			"VALERO PLUME, EPA ID TXN000622182. 0.76 km from the mapped point. NPL status: Not on the NPL." +
				" Non-NPL status: Removal Only Site (No Site Assessment Work Needed). Non-NPL status date: 2022-02-08.",
		);
	});

	it("gives the site the inventory answered with no row the registry-only wording", () => {
		expect(templateIdsFor(houston.store, listing, ROWLESS_SITE)).toEqual(["sems-site/registry-only@1"]);
		// The whole sentence, not its last clause: the two before it were
		// rewritten to name the site rather than say "its", and a `toContain` on
		// the third clause is exactly the assertion that would not have noticed.
		expect(mustRender(houston.store, firstPlacementFor(houston.store, listing, ROWLESS_SITE))).toBe(
			"SUPERIOR PACKAGING AND DISTRIBUTING, 7.91 km from the mapped point." +
				" EPA's facility registry records the SUPERFUND (NON-NPL) interest at" +
				" SUPERIOR PACKAGING AND DISTRIBUTING as NOT ON THE NPL." +
				` The Superfund inventory returned no status row for ${ROWLESS_SITE}.`,
		);
	});

	it("gives the site whose status request failed the status-unavailable wording, and never the registry-only one", () => {
		expect(templateIdsFor(houston.store, listing, FAILED_SITE)).toEqual(["sems-site/status-unavailable@1"]);
		expect(mustRender(houston.store, firstPlacementFor(houston.store, listing, FAILED_SITE))).toBe(
			"SUPPLY PRO FIRE, 6.74 km from the mapped point." +
				" EPA's facility registry records the SUPERFUND (NON-NPL) interest at SUPPLY PRO FIRE as NOT ON THE NPL." +
				` The Superfund inventory's status for ${FAILED_SITE} could not be retrieved.`,
		);

		// "The inventory returned no status row" is a claim about an answer that
		// was never given. No placement anywhere in the plan makes it about this
		// record...
		const wrong = planPlacements(houston.store, houston.plan).filter(
			(placement) =>
				placement.scope === "record" &&
				placement.recordId.sourceRecordId === FAILED_SITE &&
				placement.template.id === semsSiteRegistryOnly.id,
		);

		expect(wrong).toHaveLength(0);
		// ...and if one did, the kernel would refuse to render it.
		expect(
			render(houston.store, {
				scope: "record",
				recordId: recordId("sems-site", FAILED_SITE),
				template: semsSiteRegistryOnly,
			}),
		).toBeNull();
	});

	it("gives a final-NPL site B7's own sentence, beside the record it already has", () => {
		expect(idsOf(houston.store, npl)).toEqual(FINAL_NPL_SITES);
		for (const id of idsOf(houston.store, npl)) {
			expect(templateIdsFor(houston.store, npl, id)).toEqual(["sems-site/npl@1"]);
			expect(idsOf(houston.store, listing)).toContain(id);
		}
		expect(mustRender(houston.store, firstPlacementFor(houston.store, npl, "TXN000607093"))).toBe(
			"US OIL RECOVERY is listed by SEMS. 3.92 km from the mapped point.",
		);
	});

	it("uses all four sems-site templates across the plan and no others", () => {
		const used = new Set(
			planPlacements(houston.store, houston.plan)
				.filter((placement) => placement.scope === "record" && placement.recordId.kind === "sems-site")
				.map((placement) => placement.template.id),
		);

		expect([...used].sort()).toEqual([
			"sems-site/npl@1",
			"sems-site/registry-only@1",
			"sems-site/status-unavailable@1",
			"sems-site/summary@1",
		]);
	});
});

/* -------------------------------------------------------------------------- */
/* Acceptance 4. The final-NPL section                                        */
/* -------------------------------------------------------------------------- */

describe("the final-NPL section counts the final list and nothing else", () => {
	const npl = listingOf(houston.plan, "sems", 1);

	it("counts exactly the two sites .dev/BRIEF.md A2 names", () => {
		const counted = sectionOrdering(answered.store, listingOf(answered.plan, "sems", 1).section).map(
			(record) => record.sourceRecordId,
		);

		expect([...counted].sort()).toEqual([...FINAL_NPL_SITES].sort());
		expect(mustRender(answered.store, headline(answered.plan, "sems", 1))).toBe(
			"Sites on the final National Priorities List within 5 miles of the mapped point: 2.",
		);
	});

	it("does not count `Site is Part of NPL Site`, and keeps that record in the main listing", () => {
		const partOfNpl = houston.store.get(recordId("sems-site", PART_OF_NPL));

		expect(partOfNpl?.semsNplStatus?.value).toBe("Site is Part of NPL Site");
		expect(FINAL_NPL_STATUS).toBe("Currently on the Final NPL");
		expect(idsOf(houston.store, npl)).not.toContain(PART_OF_NPL);
		expect(idsOf(houston.store, listingOf(houston.plan, "sems"))).toContain(PART_OF_NPL);
	});

	it("filters on the Superfund field, so a site whose status request failed is not on the final list", () => {
		const failed = houston.store.get(recordId("sems-site", FAILED_SITE));

		// Its registry status survived the failed join. The Superfund status did
		// not, and the Superfund inventory is the system this sentence is about.
		expect(failed?.frsActiveStatus.value).toBe("NOT ON THE NPL");
		expect(failed?.semsNplStatus).toBeNull();
		expect(npl.section.filter).toEqual({ field: "semsNplStatus", equals: FINAL_NPL_STATUS });
		expect(idsOf(houston.store, npl)).not.toContain(FAILED_SITE);
	});

	/**
	 * A list that leaves a site out says nothing about that site. A count that
	 * leaves it out says there are none — so the count is stated only over a
	 * store the inventory answered about in full, and the two plans differ by
	 * one rejected status request and nothing else.
	 */
	it("states no count of the final list when a status request failed, and states it when none did", () => {
		const withheld = cardPlacements(houston.store, cardOf(houston.plan, "sems")).map((one) => one.template.id);
		const stated = cardPlacements(answered.store, cardOf(answered.plan, "sems")).map((one) => one.template.id);

		expect(houston.store.ofKind("sems-site").filter((one) => one.statusRow.status === "unavailable")).toHaveLength(1);
		expect(answered.store.ofKind("sems-site").filter((one) => one.statusRow.status === "unavailable")).toHaveLength(0);
		expect(withheld).not.toContain("section/sems-npl-count@1");
		expect(stated).toContain("section/sems-npl-count@1");
		// The site count beside it is not filtered on a field the failure nulls,
		// so it is a count of the world on both plans and stays on both cards.
		expect(withheld).toContain("section/sems-count@1");
		expect(stated).toContain("section/sems-count@1");
		// Nothing else moved: the listings speak for all fifteen sites either way.
		expect(idsOf(houston.store, listingOf(houston.plan, "sems"))).toHaveLength(15);
		expect(idsOf(answered.store, listingOf(answered.plan, "sems"))).toHaveLength(15);
	});

	/**
	 * .dev/BRIEF.md A1, which is .dev/BRIEF.md A6 row 1's headline number: fail
	 * the status request for exactly the two final-NPL sites of the demo address
	 * and the filter sees neither, so the count read 0 — above two sentences, on
	 * the same card, naming those two sites and the registry's answer for them.
	 */
	it("prints no zero over the two sites the registry names, when their status requests are the ones that failed", async () => {
		const outage = await runSource(locus, semsAdapter, semsIo({ fixture: LAYER_5MI }, FINAL_NPL_SITES), POLICY);
		const partial = planOf({ ...HOUSTON, sems: outage });
		const card = cardOf(partial.plan, "sems");
		const npl = listingOf(partial.plan, "sems", 1);
		const main = listingOf(partial.plan, "sems");

		// The zero is real: the section that count reads is empty, because the
		// only two sites that would fill it are the two the inventory did not
		// answer for.
		expect(sectionOrdering(partial.store, npl.section)).toHaveLength(0);
		for (const id of FINAL_NPL_SITES) {
			expect(partial.store.get(recordId("sems-site", id))?.semsNplStatus).toBeNull();
			expect(partial.store.get(recordId("sems-site", id))?.frsActiveStatus.value).toBe("CURRENTLY ON THE FINAL NPL");
		}
		// So no sentence on the card states that count.
		expect(planPlacements(partial.store, partial.plan).map((one) => one.template.id)).not.toContain(
			"section/sems-npl-count@1",
		);
		// The status line still says the source answered with records, which is
		// true, and the two sites still reach the reader — each naming what the
		// registry holds and what the inventory did not answer.
		expect(mustRender(partial.store, card.status)).toBe(
			`EPA Superfund Enterprise Management System answered with records, retrieved ${RETRIEVED_AT}.`,
		);
		expect(templateIdsFor(partial.store, main, "TXN000607093")).toEqual(["sems-site/status-unavailable@1"]);
		expect(mustRender(partial.store, firstPlacementFor(partial.store, main, "TXN000607093"))).toBe(
			"U.S. OIL RECOVERY, 3.92 km from the mapped point." +
				" EPA's facility registry records the SUPERFUND NPL interest at U.S. OIL RECOVERY as CURRENTLY ON THE FINAL NPL." +
				" The Superfund inventory's status for TXN000607093 could not be retrieved.",
		);
		expect(mustRender(partial.store, firstPlacementFor(partial.store, main, "TXD980748453"))).toContain(
			"as CURRENTLY ON THE FINAL NPL.",
		);
	});
});

/* -------------------------------------------------------------------------- */
/* Acceptance 5, 6, 7. The ECHO order                                         */
/* -------------------------------------------------------------------------- */

describe("the ECHO order follows B7", () => {
	const listing = listingOf(houston.plan, "echo");

	it("puts formal actions first, then noncompliance, then distance", () => {
		expect(listing.ordering).toBe("echo-b7");
		expect(idsOf(houston.store, listing)).toEqual([
			SOUTH_COAST,
			PORT_TERMINAL,
			CARGILL,
			WESTWAY_HOUSTON,
			GRIZZLY,
			SOUTH_PORT,
			WESTWAY_LLC,
		]);
	});

	it("ranks a record with a formal enforcement action above a nearer record without one", () => {
		const southCoast = houston.store.get(recordId("echo-facility", SOUTH_COAST));
		const cargill = houston.store.get(recordId("echo-facility", CARGILL));

		expect(southCoast?.lastFormalActionDate.value).toBe("2024-08-12");
		expect(cargill?.lastFormalActionDate.value).toBeNull();
		expect(southCoast?.distanceMeters?.value).toBe(229);
		expect(cargill?.distanceMeters?.value).toBe(219);
		expect(idsOf(houston.store, listing).indexOf(SOUTH_COAST)).toBeLessThan(idsOf(houston.store, listing).indexOf(CARGILL));
	});

	it("ranks a record with quarters of noncompliance above a nearer record with none", () => {
		const port = houston.store.get(recordId("echo-facility", PORT_TERMINAL));
		const cargill = houston.store.get(recordId("echo-facility", CARGILL));

		expect(NONCOMPLIANCE_QUARTERS).toBe(1);
		expect(port?.quartersInNoncompliance.value).toBe(6);
		expect(cargill?.quartersInNoncompliance.value).toBe(0);
		expect(port?.distanceMeters?.value).toBe(266);
		expect(idsOf(houston.store, listing).indexOf(PORT_TERMINAL)).toBeLessThan(idsOf(houston.store, listing).indexOf(CARGILL));
	});

	it("counts on the same two rules it orders on", () => {
		expect(at(cardOf(houston.plan, "echo").headlines, 1, "headline").section.filter).toEqual({
			field: "lastFormalActionDate",
			present: true,
		});
		expect(at(cardOf(houston.plan, "echo").headlines, 2, "headline").section.filter).toEqual({
			field: "quartersInNoncompliance",
			atLeast: NONCOMPLIANCE_QUARTERS,
		});
		expect(mustRender(houston.store, headline(houston.plan, "echo", 1))).toBe(
			"Facilities within 5 miles with a formal enforcement action in ECHO's facility summary: 1.",
		);
		expect(mustRender(houston.store, headline(houston.plan, "echo", 2))).toBe(
			"Facilities within 5 miles with at least one quarter of noncompliance in ECHO's twelve-quarter history: 1.",
		);
	});

	it("sorts a record whose quarters ECHO did not send after every record whose quarters it did, and keeps it visible", () => {
		const westwayLlc = houston.store.get(recordId("echo-facility", WESTWAY_LLC));
		const order = idsOf(houston.store, listing);

		expect(westwayLlc?.quartersInNoncompliance.value).toBeNull();
		// Nearer than GRIZZLY (285 m) and SOUTH-PORT (298 m), and still last:
		// unknown sorts after known, and stays visible.
		expect(westwayLlc?.distanceMeters?.value).toBe(221);
		expect(at(order, order.length - 1, "last record")).toBe(WESTWAY_LLC);
		expect(templateIdsFor(houston.store, listing, WESTWAY_LLC)).toContain("echo-facility/no-status@1");
	});

	it("sorts a record ECHO sent no coordinate for after every record it did, and keeps it visible", async () => {
		// Derived: `FacLat` and `FacLong` are `z.string().nullable()` in the
		// adapter's own schema, so a row without them is a shape ECHO may send.
		// No recorded row is one.
		const outcome = await echoOutcome({
			derived: `${ECHO_PAGE}, FacLat and FacLong nulled on ${CARGILL}`,
			body: echoPageBody({ [CARGILL]: { FacLat: null, FacLong: null } }),
		});
		const derived = planOf({ ...HOUSTON, echo: outcome });

		expect(derived.store.get(recordId("echo-facility", CARGILL))?.distanceMeters).toBeNull();
		expect(idsOf(derived.store, listingOf(derived.plan, "echo"))).toEqual([
			SOUTH_COAST,
			PORT_TERMINAL,
			WESTWAY_HOUSTON,
			GRIZZLY,
			SOUTH_PORT,
			CARGILL,
			WESTWAY_LLC,
		]);
	});

	it("breaks a distance tie on the newer date, not on the identifier", async () => {
		// Derived: the two WESTWAY rows share a coordinate exactly and neither
		// carries a date, so the recorded bytes cannot show which way a tie breaks.
		// This gives the lexicographically later ID the newer date, and puts both
		// rows in one noncompliance rank so the tie is reached at all.
		const outcome = await echoOutcome({
			derived: `${ECHO_PAGE}, an inspection date on ${WESTWAY_HOUSTON} and quarters on ${WESTWAY_LLC}`,
			body: echoPageBody({
				[WESTWAY_HOUSTON]: { FacDateLastInspection: "06/19/2014" },
				[WESTWAY_LLC]: { FacQtrsWithNC: "0" },
			}),
		});
		const derived = planOf({ ...HOUSTON, echo: outcome });
		const order = idsOf(derived.store, listingOf(derived.plan, "echo"));

		expect(derived.store.get(recordId("echo-facility", WESTWAY_HOUSTON))?.effectiveAt.value).toBe("2014-06-19");
		expect(derived.store.get(recordId("echo-facility", WESTWAY_LLC))?.effectiveAt.value).toBeNull();
		expect(derived.store.get(recordId("echo-facility", WESTWAY_HOUSTON))?.distanceMeters?.value).toBe(
			derived.store.get(recordId("echo-facility", WESTWAY_LLC))?.distanceMeters?.value,
		);
		expect(WESTWAY_LLC < WESTWAY_HOUSTON).toBe(true);
		expect(order.indexOf(WESTWAY_HOUSTON)).toBeLessThan(order.indexOf(WESTWAY_LLC));
	});

	it("is total: the same records in any order produce the same listing", () => {
		const records = [...recordsOf(echo)];
		const shuffles = [...records.map((_, i) => [...records.slice(i), ...records.slice(0, i)]), [...records].reverse()];
		const reversed = storeOf([...records].reverse());

		for (const shuffled of shuffles) {
			const store = storeOf(shuffled);

			expect(idsOf(store, listingOf(selectReport(inputFor(HOUSTON, store)), "echo"))).toEqual(
				idsOf(houston.store, listing),
			);
		}
		// The comparator is what makes that true, so it has to be handed an order
		// that is not already the answer. `orderedRecords` used to sort
		// `sectionOrdering`'s return, which is in (distance, id) order already.
		expect(reversed.ofKind("echo-facility").map((record) => record.sourceRecordId)).not.toEqual(idsOf(houston.store, listing));
	});

	it("is total for the Superfund order too", () => {
		const store = storeOf([...recordsOf(sems)].reverse());

		expect(store.ofKind("sems-site").map((record) => record.sourceRecordId)).not.toEqual(
			idsOf(houston.store, listingOf(houston.plan, "sems")),
		);
		expect(idsOf(store, listingOf(selectReport(inputFor(HOUSTON, store)), "sems"))).toEqual(
			idsOf(houston.store, listingOf(houston.plan, "sems")),
		);
	});

	/**
	 * Both "is total" tests above were vacuous until the listing stopped being
	 * built out of an array that was already sorted: deleting `byId` from both
	 * orderings left the whole suite green, and so did replacing the `distance`
	 * ordering with `() => 0`. Stable sort washes a comparator out when its
	 * input is already in its order, so the keys are read here directly, on the
	 * pairs the recorded bytes make reachable.
	 */
	describe("the comparators themselves, on the pairs that reach them", () => {
		function echoRecord(store: EvidenceStore, id: string): Sealed<RecordOf<"echo-facility">> {
			const record = store.get(recordId("echo-facility", id));
			if (record === undefined) throw new Error(`${id} is not in the store`);
			return record;
		}

		it("puts the nearer record first", () => {
			const cargill = echoRecord(houston.store, CARGILL);
			const southCoast = echoRecord(houston.store, SOUTH_COAST);

			expect(cargill.distanceMeters?.value).toBe(219);
			expect(southCoast.distanceMeters?.value).toBe(229);
			expect(ORDERINGS.distance(cargill, southCoast)).toBeLessThan(0);
			expect(ORDERINGS.distance(southCoast, cargill)).toBeGreaterThan(0);
		});

		it("breaks a distance tie on the source's own identifier", () => {
			const houstonRow = echoRecord(houston.store, WESTWAY_HOUSTON);
			const llc = echoRecord(houston.store, WESTWAY_LLC);

			// Two real rows at one coordinate, so this pair needs no deriving.
			expect(houstonRow.distanceMeters?.value).toBe(llc.distanceMeters?.value);
			expect(WESTWAY_LLC < WESTWAY_HOUSTON).toBe(true);
			expect(ORDERINGS.distance(houstonRow, llc)).toBeGreaterThan(0);
			expect(ORDERINGS.distance(llc, houstonRow)).toBeLessThan(0);
		});

		it("orders two records whose distance is unknown, and answers 0 for the pair rather than NaN", async () => {
			// Derived: `FacLat` and `FacLong` are nullable in the adapter's own
			// schema, and no recorded row leaves both out.
			const outcome = await echoOutcome({
				derived: `${ECHO_PAGE}, FacLat and FacLong nulled on both WESTWAY rows`,
				body: echoPageBody({
					[WESTWAY_HOUSTON]: { FacLat: null, FacLong: null },
					[WESTWAY_LLC]: { FacLat: null, FacLong: null },
				}),
			});
			const derived = planOf({ ...HOUSTON, echo: outcome });
			const houstonRow = echoRecord(derived.store, WESTWAY_HOUSTON);
			const llc = echoRecord(derived.store, WESTWAY_LLC);

			expect(houstonRow.distanceMeters).toBeNull();
			expect(llc.distanceMeters).toBeNull();
			// Both are POSITIVE_INFINITY, and `Infinity - Infinity` is NaN. Every
			// use of this reads it through `||`, where NaN is falsy and the next
			// key covers for it, so the answer had to be asserted directly.
			expect(byDistance(houstonRow, llc)).toBe(0);
			expect(Number.isNaN(byDistance(houstonRow, llc))).toBe(false);
			expect(ORDERINGS.distance(houstonRow, llc)).toBeGreaterThan(0);
		});

		it("ties on every ECHO key before the identifier, and breaks on it", async () => {
			// Derived: the two WESTWAY rows share a coordinate exactly and neither
			// carries a date, so giving them the same noncompliance rank leaves a
			// tie that only the id can break.
			const outcome = await echoOutcome({
				derived: `${ECHO_PAGE}, quarters on ${WESTWAY_LLC}`,
				body: echoPageBody({ [WESTWAY_LLC]: { FacQtrsWithNC: "0" } }),
			});
			const derived = planOf({ ...HOUSTON, echo: outcome });
			const houstonRow = echoRecord(derived.store, WESTWAY_HOUSTON);
			const llc = echoRecord(derived.store, WESTWAY_LLC);
			const order = idsOf(derived.store, listingOf(derived.plan, "echo"));

			expect(houstonRow.lastFormalActionDate.value).toBeNull();
			expect(llc.lastFormalActionDate.value).toBeNull();
			expect(houstonRow.quartersInNoncompliance.value).toBe(llc.quartersInNoncompliance.value);
			expect(houstonRow.distanceMeters?.value).toBe(llc.distanceMeters?.value);
			expect(houstonRow.effectiveAt.value).toBeNull();
			expect(llc.effectiveAt.value).toBeNull();
			expect(ORDERINGS["echo-b7"](houstonRow, llc)).toBeGreaterThan(0);
			expect(order.indexOf(WESTWAY_LLC)).toBe(order.indexOf(WESTWAY_HOUSTON) - 1);
		});
	});
});

/* -------------------------------------------------------------------------- */
/* Acceptance 8. Bounds, and no silent truncation                             */
/* -------------------------------------------------------------------------- */

describe("the bound, and nothing else, is what a listing drops", () => {
	it("shows five and carries the rest, so the default bound drops nothing recorded", () => {
		const listing = listingOf(houston.plan, "sems");
		const total = sectionOrdering(houston.store, listing.section).length;

		expect(SHOWN_RECORDS).toBe(5);
		expect(CARRIED_RECORDS).toBe(45);
		expect(shownOf(houston.store, listing)).toHaveLength(SHOWN_RECORDS);
		expect(entriesOf(houston.store, listing)).toHaveLength(total);
		expect(total).toBe(15);
	});

	it("drops exactly the tail of the ordering when the bound bites, and the bound is what dropped it", () => {
		const bounds: Bounds = { shown: 2, carried: 3 };
		const tight = planOf(HOUSTON, bounds);
		const listing = listingOf(tight.plan, "sems");
		const total = sectionOrdering(tight.store, listing.section).length;
		const carried = entriesOf(tight.store, listing).length;

		expect(shownOf(tight.store, listing)).toHaveLength(bounds.shown);
		expect(restOf(tight.store, listing)).toHaveLength(bounds.carried);
		expect(carried).toBe(Math.min(total, bounds.shown + bounds.carried));
		// The two numbers the route puts on the chrome are one read of the store,
		// so there is nothing left for them to disagree about.
		expect(carried).toBe(carriedCount(tight.store, listing.section));
		// What is carried is the first `shown + carried` of the same order, in that
		// order, so every record missing is missing only for falling past the bound.
		expect(idsOf(tight.store, listing)).toEqual(
			idsOf(houston.store, listingOf(houston.plan, "sems")).slice(0, bounds.shown + bounds.carried),
		);
		expect(total - carried).toBe(10);
	});

	it("still states the true total from the store when the bound has bitten", () => {
		const tight = planOf(HOUSTON, { shown: 2, carried: 3 });

		expect(mustRender(tight.store, headline(tight.plan, "sems", 0))).toBe(
			"Superfund sites EPA's inventory lists within 5 miles of the mapped point: 15.",
		);
	});
});

/* -------------------------------------------------------------------------- */
/* Acceptance 9. Deleting a record lowers the rendered count by one           */
/* -------------------------------------------------------------------------- */

describe("the deletion guarantee, through a placement the policy produced", () => {
	it("lowers the Superfund count by exactly one, and takes that record's own sentence with it", () => {
		const count = headline(houston.plan, "sems", 0);
		const nearest: RecordId = recordId("sems-site", "TXN000607438");
		const entry = at(shownOf(houston.store, listingOf(houston.plan, "sems")), 0, "nearest entry");
		const smaller = houston.store.without(nearest);
		const before = render(houston.store, entry.placements[0]);
		if (before === null) throw new Error("the nearest record rendered nothing");

		expect(entry.recordId.sourceRecordId).toBe(nearest.sourceRecordId);
		expect(mustRender(houston.store, count)).toBe(
			"Superfund sites EPA's inventory lists within 5 miles of the mapped point: 15.",
		);
		expect(mustRender(smaller, count)).toBe(
			"Superfund sites EPA's inventory lists within 5 miles of the mapped point: 14.",
		);
		expect(render(smaller, entry.placements[0])).toBeNull();
		expect(verify(smaller, before, ALL_TEMPLATES)).toBe(false);
	});

	it("recomputes what the card carries from the live store, exactly as it recomputes the total", () => {
		const listing = listingOf(houston.plan, "sems");
		const nearest: RecordId = recordId("sems-site", "TXN000607438");
		const smaller = houston.store.without(nearest);

		expect(carriedCount(houston.store, listing.section)).toBe(15);
		expect(sectionOrdering(smaller, listing.section)).toHaveLength(14);
		expect(carriedCount(smaller, listing.section)).toBe(14);
		expect(entriesOf(smaller, listing)).toHaveLength(14);
		// `shown.length + rest.length` was the number the module comment used to
		// send the route to, and it stayed at 15 beside a count that said 14. The
		// entries are a read of the store now, so it is the same 14.
		expect(entriesOf(houston.store, listing)).toHaveLength(15);
		expect(idsOf(smaller, listing)).not.toContain(nearest.sourceRecordId);
	});

	/**
	 * The arithmetic the card has to satisfy, and the one nothing checked: the
	 * record sentences a list renders, plus the records it says it left out,
	 * are the count beside it. It held only against the pristine store.
	 *
	 * With the head frozen at plan time and the count and the gap read live,
	 * deleting a record from *inside* the bound produced count 14, four record
	 * sentences, "did not carry: 9" — thirteen — and a "View all" of 5, because
	 * nothing promoted the record at ordering position five into the frozen
	 * head. Deleting one past the bound agreed, which is why the committed
	 * tests, which assert the two halves separately and never compare them,
	 * passed either way.
	 */
	it("renders what it counts: entries plus not-shown is the count, whichever record goes", () => {
		const bounds: Bounds = { shown: 2, carried: 3 };
		const tight = planOf(HOUSTON, bounds);
		const listing = listingOf(tight.plan, "sems");
		const count = headline(tight.plan, "sems", 0);
		// The card states no final-NPL count over this plan, which holds a site
		// the inventory did not answer for, so the gap sits directly beside the
		// site count. `nplCountHeadline` is where that is decided.
		const notShown = headline(tight.plan, "sems", 1);
		const inside: RecordId = recordId("sems-site", at(idsOf(tight.store, listing), 0, "first entry"));
		const past: RecordId = recordId("sems-site", at(idsOf(houston.store, listingOf(houston.plan, "sems")), 14, "last of the ordering"));

		function arithmetic(store: EvidenceStore): { readonly rendered: number; readonly gap: number; readonly count: number } {
			return {
				rendered: entriesOf(store, listing).filter((entry) => render(store, entry.placements[0]) !== null).length,
				gap: Number(digitsOf(mustRender(store, notShown))),
				count: Number(digitsOf(mustRender(store, count))),
			};
		}

		expect(arithmetic(tight.store)).toEqual({ rendered: 5, gap: 10, count: 15 });
		// Inside the bound: the record at ordering position five moves up into the
		// head, because the head is a read of the store and not a list.
		expect(idsOf(tight.store, listing)).toContain(inside.sourceRecordId);
		expect(arithmetic(tight.store.without(inside))).toEqual({ rendered: 5, gap: 9, count: 14 });
		expect(idsOf(tight.store.without(inside), listing)).not.toContain(inside.sourceRecordId);
		// Past the bound: the head is unchanged and the gap falls by one. This
		// half agreed before the fix and still does.
		expect(idsOf(tight.store, listing)).not.toContain(past.sourceRecordId);
		expect(arithmetic(tight.store.without(past))).toEqual({ rendered: 5, gap: 9, count: 14 });
		for (const store of [tight.store, tight.store.without(inside), tight.store.without(past)]) {
			const { rendered, gap, count: total } = arithmetic(store);

			expect(rendered + gap, `${rendered} + ${gap}`).toBe(total);
		}
	});

	it("lowers the ECHO formal-action count by one when that facility goes", () => {
		const count = headline(houston.plan, "echo", 1);
		const smaller = houston.store.without(recordId("echo-facility", SOUTH_COAST));

		expect(mustRender(houston.store, count)).toBe("Facilities within 5 miles with a formal enforcement action in ECHO's facility summary: 1.");
		expect(mustRender(smaller, count)).toBe("Facilities within 5 miles with a formal enforcement action in ECHO's facility summary: 0.");
	});
});

/* -------------------------------------------------------------------------- */
/* Acceptance 10, and the rest of B7's list                                   */
/* -------------------------------------------------------------------------- */

describe("B7's list, item by item", () => {
	it("states the matched address, its block precision and the mapped point", () => {
		expect(mustRender(houston.store, at(houston.plan.origin, 0, "origin"))).toBe(
			"Matched: 9311 E AVE P, HOUSTON, TX, 77012." +
				" The point sits on the 9301 to 9399 block, street side L," +
				" interpolated by the Census Geocoder along TIGER line 96085986." +
				" It marks the block, not the parcel.",
		);
		// The whole coordinate line. `toContain` on a truncated latitude asserted
		// neither the rest of that number nor the longitude at all.
		expect(mustRender(houston.store, at(houston.plan.origin, 1, "origin"))).toBe(
			"Mapped point: 29.720658823001, -95.261995884462.",
		);
	});

	it("gives every source a status placement, whatever it answered", () => {
		expect(houston.plan.cards.map((card) => card.source)).toEqual(["sems", "fema", "aqs", "airnow", "echo", "frs"]);
		for (const card of houston.plan.cards) {
			expect(card.status.scope).toBe("source");
			expect(card.status.source).toBe(card.source);
		}
		// `mustRender(...).length > 0` asserted "did not throw": `mustRender`
		// throws on null and `assemble` never returns a zero-span sentence. What
		// each card says is the assertion.
		expect(houston.plan.cards.map((card) => mustRender(houston.store, card.status))).toEqual([
			`EPA Superfund Enterprise Management System answered with records, retrieved ${RETRIEVED_AT}.`,
			"Esri's reduced-set copy of FEMA's National Flood Hazard Layer answered with records," +
				` retrieved ${RETRIEVED_AT}.`,
			"EPA Air Quality System could not be reached: the source rate-limited the request. Retry after 86400.",
			"EPA AirNow could not be reached: the source answered with an error status.",
			`EPA Enforcement and Compliance History Online answered with records, retrieved ${RETRIEVED_AT}.`,
			`EPA Facility Registry Service answered with records, retrieved ${RETRIEVED_AT}.`,
		]);
	});

	it("says a source that could not be asked could not be asked, and nothing about records", () => {
		const card = cardOf(houston.plan, "aqs");

		expect(mustRender(houston.store, card.status)).toBe(
			"EPA Air Quality System could not be reached: the source rate-limited the request. Retry after 86400.",
		);
		// B10 keeps this apart from "no matching records": the source was never
		// asked, so the card states nothing at all about what it holds.
		expect(card.headlines).toHaveLength(0);
		expect(card.listings).toHaveLength(0);
		expect(mustRender(houston.store, cardOf(houston.plan, "airnow").status)).toContain(
			"EPA AirNow could not be reached: the source answered with an error status.",
		);
	});

	it("says a source that answered with nothing answered with nothing, with its counts beside it", async () => {
		const none = await runSource(
			locus,
			createEchoAdapter({ retryDelayMs: 0 }),
			ioOf(() => ({ fixture: "echo/facilities-none-nevada.json" })),
			POLICY,
		);
		const empty = planOf({ ...HOUSTON, echo: none });
		const card = cardOf(empty.plan, "echo");

		expect(none.status).toBe("no-data");
		expect(mustRender(empty.store, card.status)).toBe(
			`EPA Enforcement and Compliance History Online answered with no matching records, retrieved ${RETRIEVED_AT}.`,
		);
		expect(card.headlines.map((one) => mustRender(empty.store, one))).toEqual([
			"Regulated facilities EPA ECHO lists within 5 miles of the mapped point: 0.",
			"Facilities within 5 miles with a formal enforcement action in ECHO's facility summary: 0.",
			"Facilities within 5 miles with at least one quarter of noncompliance in ECHO's twelve-quarter history: 0.",
			NO_DATA_NOTE,
		]);
	});

	it("states the ECHO and SEMS counts before any record", () => {
		// "Before any record" is a property of `cardPlacements`, which the old
		// version of this test never called: it asserted that two arrays were
		// non-empty and that every headline had the scope its type already fixes.
		const counted: readonly ReportSource[] = ["sems", "echo"];
		// Over the plan the inventory answered about in full, so the SEMS card
		// states both of its counts; `nplCountHeadline` is what withholds the
		// second one, and the tests for that are with the final-NPL section.
		for (const source of counted) {
			const placements = cardPlacements(answered.store, cardOf(answered.plan, source));
			const scopes = placements.map((one) => one.scope);
			const lastCount = scopes.lastIndexOf("section");
			const firstRecord = scopes.indexOf("record");

			expect(placements.flatMap((one) => (one.scope === "section" ? [one.template.id] : []))).toEqual(
				source === "sems"
					? ["section/sems-count@1", "section/sems-npl-count@1"]
					: ["section/echo-count@1", "section/echo-formal-actions@1", "section/echo-noncompliance@1"],
			);
			expect(firstRecord).toBeGreaterThan(lastCount);
			expect(scopes.indexOf("source")).toBe(0);
		}
	});

	it("shows up to five ECHO and five SEMS records, and offers the rest", () => {
		expect(shownOf(houston.store, listingOf(houston.plan, "echo"))).toHaveLength(5);
		expect(restOf(houston.store, listingOf(houston.plan, "echo"))).toHaveLength(2);
		expect(shownOf(houston.store, listingOf(houston.plan, "sems"))).toHaveLength(5);
		expect(restOf(houston.store, listingOf(houston.plan, "sems"))).toHaveLength(10);
	});

	/**
	 * .dev/BRIEF.md A2. `lookupFrsFacility` asks `where=REGISTRY_ID='...'` for
	 * registry IDs another card named; there is no radius in the request, and
	 * .dev/BRIEF.md B14 records 6,915 FRS interest rows within five miles of
	 * this exact point. "Searched within 5 miles of the mapped point" claimed
	 * that search on the answering path and, with `no-records` beside it,
	 * asserted an absence over it.
	 */
	it("claims no search of an area the registry lookup never queried", () => {
		const card = cardOf(houston.plan, "frs");
		const section = listingOf(houston.plan, "frs").section;

		expect(card.headlines).toEqual([]);
		expect(planPlacements(houston.store, houston.plan).map((one) => one.template.id)).not.toContain(
			"section/retrieved-at@1",
		);
		// The boundary is still on the card, in the section behind the listing and
		// in every trace opened from it, and it describes the request that was
		// made. The distance a record is measured at still comes from the
		// five-mile locus the handler centres the lookup on.
		expect(section.boundary).toBe("the registry IDs this report looked up");
		expect(BOUNDARY.frs).toBe("the registry IDs this report looked up");
		// The retrieval time reaches the reader from the status sentence, which is
		// the one sentence on this card that was never about an area.
		expect(mustRender(houston.store, card.status)).toBe(
			`EPA Facility Registry Service answered with records, retrieved ${RETRIEVED_AT}.`,
		);
	});

	/**
	 * The other half of A2: an empty answer from a lookup by identifier is those
	 * identifiers carrying no row, and `NO_DATA_NOTE`'s "within the stated
	 * boundary" states a boundary the request did not have.
	 */
	it("says what an empty registry answer is, in place of the fan-out's boundary wording", () => {
		const empty: SourceOutcome = { status: "no-data", note: NO_DATA_NOTE, retrievedAt: RETRIEVED_AT, query: null };
		const none = planOf({ ...HOUSTON, frs: empty });
		const card = cardOf(none.plan, "frs");

		expect(card.headlines.map((one) => one.template.id)).toEqual(["section/no-records@1"]);
		expect(card.headlines.map((one) => mustRender(none.store, one))).toEqual([
			"EPA's facility registry holds no programme-interest row for the registry IDs this report looked up.",
		]);
		expect(card.headlines.map((one) => mustRender(none.store, one))).not.toContain(NO_DATA_NOTE);
	});
});

/* -------------------------------------------------------------------------- */
/* FEMA                                                                       */
/* -------------------------------------------------------------------------- */

describe("the flood card", () => {
	it("states the zone and says the authoritative layer is not what answered", () => {
		const card = cardOf(houston.plan, "fema");

		expect(fema.dataset).toBe("ESRI_REDUCED_SET");
		expect(fema.nfhl).not.toBeNull();
		expect(card.priorAttempts).toHaveLength(1);
		// One `SourceId`, two layers. Under `AGENCY.fema` both of these read
		// "FEMA National Flood Hazard Layer", so the card said one named source
		// both answered and could not be reached, in consecutive sentences.
		expect(mustRender(houston.store, card.status)).toBe(
			"Esri's reduced-set copy of FEMA's National Flood Hazard Layer answered with records," +
				` retrieved ${RETRIEVED_AT}.`,
		);
		expect(mustRender(houston.store, at(card.priorAttempts, 0, "prior attempt"))).toBe(
			"FEMA's National Flood Hazard Layer could not be reached: the host refused the connection.",
		);
		expect(card.status.agency).toBe(FEMA_DATASETS.ESRI_REDUCED_SET.label);
		expect(at(card.priorAttempts, 0, "prior attempt").agency).toBe(FEMA_DATASETS.NFHL.label);
		expect(templateIdsFor(houston.store, listingOf(houston.plan, "fema"), "48201C_8563")).toEqual(["fema-flood-zone/summary@1"]);
		expect(mustRender(houston.store, firstPlacementFor(houston.store, listingOf(houston.plan, "fema"), "48201C_8563"))).toContain(
			"is in zone AE, inside the Special Flood Hazard Area.",
		);
	});

	it("takes the no-polygon note from the dataset that answered, never from a string written in the policy", async () => {
		const none = await flood({ fixture: "fema/esri-no-polygon-houston.json" });
		const empty = planOf({ ...HOUSTON, flood: none });

		expect(none.outcome.status).toBe("no-data");
		expect(cardOf(empty.plan, "fema").headlines.map((one) => mustRender(empty.store, one))).toEqual([
			"No 1% or 0.2% flood hazard polygon intersects this point in the Esri copy of FEMA's layer," +
				" dated 2026-03-11. This copy omits minimal-hazard areas, so it cannot tell minimal hazard" +
				" from an unmapped area.",
		]);
	});

	it("picks the unmapped-flag wording for an SFHA letter the report does not map", async () => {
		// Derived: no recorded row carries an SFHA_TF outside {T, F}.
		const page = objectAt(parseJson("fema/esri-zone-ae-pasadena.json"), "esri-zone-ae-pasadena.json");
		const features = arrayAt(page["features"], "features").map((feature, index) => {
			const one = objectAt(feature, `features.${index}`);
			return { ...one, attributes: { ...objectAt(one["attributes"], "attributes"), SFHA_TF: "U" } };
		});
		const unmapped = await flood({
			derived: "fema/esri-zone-ae-pasadena.json, SFHA_TF set to U",
			body: { ...page, features },
		});
		const derived = planOf({ ...HOUSTON, flood: unmapped });
		const listing = listingOf(derived.plan, "fema");

		expect(templateIdsFor(derived.store, listing, "48201C_8563")).toEqual(["fema-flood-zone/unmapped-flag@1"]);
		expect(mustRender(derived.store, firstPlacementFor(derived.store, listing, "48201C_8563"))).toContain(
			'FEMA\'s Special Flood Hazard Area flag recorded for this area is "U". Meaning not mapped.',
		);
	});
});

/* -------------------------------------------------------------------------- */
/* Groups and the registry                                                    */
/* -------------------------------------------------------------------------- */

describe("the groups the B6 rules produced", () => {
	it("puts a confirmed registry group on the card of the member that carries the ID", () => {
		const card = cardOf(houston.plan, "sems");

		expect(card.groups.map((group) => group.template.id)).toEqual([
			"group/shared-identifier@1",
			"group/member-count@1",
		]);
		expect(at(card.groups, 0, "group").groupedBy).toBe("frsRegistryId");
		expect(at(card.groups, 0, "group").members.map((member) => member.sourceRecordId)).toEqual([
			"TXN000607355",
			"TXN000605303",
			TWO_IDS_REGISTRY,
		]);
		expect(mustRender(houston.store, at(card.groups, 0, "group"))).toBe(
			`PASADENA REFINING FIRE and PRSI FIRE share one EPA facility registry ID, ${TWO_IDS_REGISTRY}.`,
		);
		expect(mustRender(houston.store, at(card.groups, 1, "group"))).toBe(
			`Records grouped under ${TWO_IDS_REGISTRY}: 3.`,
		);
	});

	/**
	 * A group *placement* is not a group *sentence*. This group is led by a SEMS
	 * record, so its placement sits on the SEMS card; rendered against a store
	 * the SEMS records have not reached yet -- the one-event-per-source wiring
	 * `.dev/BUILD.md` requires -- it renders null while the
	 * registry record still carried `cross-reference@1`, whose whole
	 * justification is that `identity@1` "would restate the group sentence
	 * directly above it". The registry card lost the facility's name and the
	 * registry's update date to a sentence nowhere on the page.
	 *
	 * So the registry listing states the identity whatever the store holds, and
	 * the cross-reference moves beside the group, where it says what the bare
	 * identifier that group sentence ends on resolves to.
	 */
	it("keeps the registry identity on the registry card, whatever the group sentence does", () => {
		const listing = listingOf(houston.plan, "frs");
		const identity =
			`EPA's facility registry lists PASADENA REFINING SYSTEM, INC. under registry ID ${TWO_IDS_REGISTRY}.` +
			" The latest update date on any of its programme-interest rows is 2021-11-24.";
		// Every store the route can hand this card while the sources settle: the
		// registry alone, the registry with its group's SEMS members, everything.
		const alone = storeOf(recordsOf(frs));
		const both = storeOf([...recordsOf(frs), ...recordsOf(sems)]);

		expect(templateIdsFor(houston.store, listing, TWO_IDS_REGISTRY)).toEqual(["frs-facility/identity@1"]);
		for (const store of [alone, both, houston.store]) {
			expect(mustRender(store, firstPlacementFor(store, listing, TWO_IDS_REGISTRY))).toBe(identity);
		}
		// The group sentence is null against the first of those stores. The
		// registry card does not change by one word for it.
		expect(render(alone, at(cardOf(houston.plan, "sems").groups, 0, "group"))).toBeNull();
	});

	it("says what the identifier resolves to beside the group built on it, and not on the registry card", () => {
		const sems = cardOf(houston.plan, "sems");
		const registry = cardOf(houston.plan, "frs");

		expect(sems.crossReferences.map((one) => [one.recordId.sourceRecordId, one.template.id])).toEqual([
			[TWO_IDS_REGISTRY, "frs-facility/cross-reference@1"],
		]);
		expect(registry.crossReferences).toHaveLength(0);
		// It sits after the two group sentences and before any record of this
		// card's own, which is where a reader meets the bare identifier. Found
		// rather than counted from the top: how many headlines precede the groups
		// is the business of the tests above, and one of them is withheld here.
		const ids = cardPlacements(houston.store, sems).map((one) => one.template.id);
		const first = ids.indexOf("group/shared-identifier@1");

		expect(first).toBeGreaterThan(-1);
		expect(ids.slice(first, first + 3)).toEqual([
			"group/shared-identifier@1",
			"group/member-count@1",
			"frs-facility/cross-reference@1",
		]);
		expect(ids.indexOf("sems-site/summary@1")).toBeGreaterThan(first + 2);
		expect(mustRender(houston.store, at(sems.crossReferences, 0, "cross-reference"))).toBe(
			`EPA's facility registry carries the name PASADENA REFINING SYSTEM, INC. for registry ID ${TWO_IDS_REGISTRY}.`,
		);
	});

	/**
	 * The suggested-group case, which is the same defect one step earlier:
	 * `leadGroupOf` places nothing for a suggested group, and the registry
	 * record was handed `cross-reference@1` all the same.
	 *
	 * Derived: CARGILL's row renamed to the registry facility's name and moved
	 * onto its coordinate, so B6 rule 3 pairs them. Nothing links them by ID, so
	 * the group is suggested. The Superfund records are left out of this plan
	 * because rule 3 only compares records rules 1 and 2 left unlinked.
	 */
	it("does not cross-reference a record against a group sentence the report never places", async () => {
		const outcome = await echoOutcome({
			derived: `${ECHO_PAGE}, ${CARGILL} renamed and moved onto registry ${TWO_IDS_REGISTRY}'s coordinate`,
			body: echoPageBody({
				[CARGILL]: { FacName: "PASADENA REFINING SYSTEM", FacLat: "29.723889", FacLong: "-95.208888" },
			}),
		});
		const suggested = planOf({ ...HOUSTON, sems: NO_RECORDS, echo: outcome });
		const groups = groupingFrom(suggested.store).groups;
		const listing = listingOf(suggested.plan, "frs");

		expect(
			groups.map((group) => [group.confidence, group.members.map((member) => member.id.sourceRecordId)]),
		).toContainEqual(["suggested", [CARGILL, TWO_IDS_REGISTRY]]);
		expect(suggested.plan.cards.flatMap((card) => card.groups)).toHaveLength(0);
		expect(templateIdsFor(suggested.store, listing, TWO_IDS_REGISTRY)).toEqual(["frs-facility/identity@1"]);
		expect(mustRender(suggested.store, firstPlacementFor(suggested.store, listing, TWO_IDS_REGISTRY))).toBe(
			`EPA's facility registry lists PASADENA REFINING SYSTEM, INC. under registry ID ${TWO_IDS_REGISTRY}.` +
				" The latest update date on any of its programme-interest rows is 2021-11-24.",
		);
	});

	it("gives an ungrouped registry record the identity wording", async () => {
		const alone = await frsOutcome("frs/arcgis-registry-110000460885.json", "110000460885");
		const solo = planOf({ ...HOUSTON, sems: NO_RECORDS, echo: NO_RECORDS, frs: alone });
		const listing = listingOf(solo.plan, "frs");

		expect(cardOf(solo.plan, "frs").groups).toHaveLength(0);
		expect(templateIdsFor(solo.store, listing, "110000460885")).toEqual(["frs-facility/identity@1"]);
		expect(mustRender(solo.store, firstPlacementFor(solo.store, listing, "110000460885"))).toBe(
			"EPA's facility registry lists HOUSTON REFINERY under registry ID 110000460885." +
				" The latest update date on any of its programme-interest rows is 2024-03-14.",
		);
	});

	/**
	 * .dev/BRIEF.md A3. Registry 110000460885 is VALERO PLUME in Envirofacts and
	 * HOUSTON REFINERY in the registry, and A3 and B6 establish those as one site
	 * under two names. "VALERO PLUME and HOUSTON REFINERY share one EPA facility
	 * registry ID, 110000460885" made them two records sharing a third thing's
	 * identifier; the cross-reference below it, which the card already carried,
	 * is the correct statement of it.
	 */
	it("does not name the registry's own record of an identifier as a record sharing it", async () => {
		const registry = await frsOutcome("frs/arcgis-registry-110000460885.json", "110000460885");
		const pair = planOf({ ...HOUSTON, frs: registry });
		const card = cardOf(pair.plan, "sems");
		const grouped = groupingFrom(pair.store).groups.find(
			(group) => group.confidence === "confirmed" && group.matchedId === "110000460885",
		);

		// The grouping still ties them together, and both records are untouched.
		expect(grouped?.members.map((member) => member.id.sourceRecordId)).toEqual(["TXN000622182", "110000460885"]);
		// No placement speaks for that group at all: the Superfund pair under
		// 110000462703, which is two records sharing one identifier, is the only
		// group sentence on this plan.
		const sentences = pair.plan.cards.flatMap((one) => one.groups).map((one) => mustRender(pair.store, one));

		expect(sentences).toEqual([
			`PASADENA REFINING FIRE and PRSI FIRE share one EPA facility registry ID, ${TWO_IDS_REGISTRY}.`,
		]);
		for (const text of sentences) {
			expect(text).not.toContain("110000460885");
			expect(text).not.toContain("HOUSTON REFINERY");
		}
		// What the card says instead is what the registry holds, beside the record
		// it resolves, and the registry's own card still states its identity.
		expect(card.crossReferences.map((one) => one.recordId.sourceRecordId)).toEqual(["110000460885"]);
		expect(mustRender(pair.store, at(card.crossReferences, 0, "cross-reference"))).toBe(
			"EPA's facility registry carries the name HOUSTON REFINERY for registry ID 110000460885.",
		);
		expect(mustRender(pair.store, firstPlacementFor(pair.store, listingOf(pair.plan, "frs"), "110000460885"))).toBe(
			"EPA's facility registry lists HOUSTON REFINERY under registry ID 110000460885." +
				" The latest update date on any of its programme-interest rows is 2024-03-14.",
		);
	});

	/**
	 * The other half of A3, from committed bytes: a SEMS record's `subject`
	 * coalesces the Superfund name over the registry's, so two sites under one
	 * registry ID whose Envirofacts rows are both missing carry one name between
	 * them and the sentence read "PASADENA REFINING SYSTEM, INC. and PASADENA
	 * REFINING SYSTEM, INC. share one EPA facility registry ID, 110000462703."
	 * The group is real; the pair is unnameable, so the count states it alone.
	 */
	it("counts a group whose two members cannot be told apart, rather than naming them twice", async () => {
		const unnamed = await runSource(
			locus,
			semsAdapter,
			semsIo({ fixture: LAYER_5MI }, [], [ROWLESS_SITE, ...PASADENA_PAIR]),
			POLICY,
		);
		const same = planOf({ ...HOUSTON, sems: unnamed });
		const card = cardOf(same.plan, "sems");
		const subjects = PASADENA_PAIR.map((id) => same.store.get(recordId("sems-site", id))?.subject.value);

		expect(subjects).toEqual(["PASADENA REFINING SYSTEM, INC.", "PASADENA REFINING SYSTEM, INC."]);
		expect(card.groups.map((one) => one.template.id)).toEqual(["group/member-count@1"]);
		expect(mustRender(same.store, at(card.groups, 0, "group"))).toBe(
			`Records grouped under ${TWO_IDS_REGISTRY}: 3.`,
		);
		for (const text of listingText(same.store, listingOf(same.plan, "sems"))) {
			expect(text).not.toContain("PASADENA REFINING SYSTEM, INC. and PASADENA REFINING SYSTEM, INC.");
		}
		// The template keeps the case it was written for: the same group, with the
		// two Superfund names the inventory does hold for it.
		expect(mustRender(houston.store, at(cardOf(houston.plan, "sems").groups, 0, "group"))).toBe(
			`PASADENA REFINING FIRE and PRSI FIRE share one EPA facility registry ID, ${TWO_IDS_REGISTRY}.`,
		);
	});
});

/* -------------------------------------------------------------------------- */
/* The air cards                                                              */
/* -------------------------------------------------------------------------- */

describe("the air cards, built against their record kinds", () => {
	it("are status-only with no templates registered, so no air record can go undescribed", () => {
		const air: readonly ReportSource[] = ["aqs", "airnow"];
		for (const source of air) {
			const card = cardOf(houston.plan, source);

			expect(card.headlines).toHaveLength(0);
			expect(card.listings).toHaveLength(0);
		}
		expect(air.map((source) => mustRender(houston.store, cardOf(houston.plan, source).status))).toEqual([
			"EPA Air Quality System could not be reached: the source rate-limited the request. Retry after 86400.",
			"EPA AirNow could not be reached: the source answered with an error status.",
		]);
	});

	/**
	 * A status-only card drops every record of its kind in silence, so it may
	 * only be built over a store holding none of them. The check is the same on
	 * every kind, and the air kinds can reach it now that both adapters exist:
	 * a deployment holding the records and registering no templates.
	 */
	it("refuses to build a status-only card over records it would drop", () => {
		const refused = unavailableOf(new SourceFailure("refused"));

		expect(() => semsCard(houston.store, refused, NO_GROUPS)).toThrow(/15 sems-site records/);
		expect(() => echoCard(houston.store, refused, NO_GROUPS)).toThrow(/7 echo-facility records/);
		expect(() => aqsCard(houston.store, NO_RECORDS, null)).not.toThrow();
		expect(() => aqsCard(houston.store, aqs, AIR)).not.toThrow();
		// And on the air kinds themselves, which is no longer hypothetical.
		expect(() => aqsCard(withAir.store, refused, AIR)).toThrow(/29 aqs-monitor-summary records/);
		expect(() => airnowCard(withAir.store, NO_RECORDS, null)).toThrow(/2 airnow-observation records/);
	});

	it("wire the nearest-monitor-per-pollutant sections the moment a template is registered", () => {
		const card = aqsCard(houston.store, NO_RECORDS, AIR);

		expect(card.listings.map((listing) => listing.section.filter)).toEqual([
			{ field: "pollutant", equals: "PM2.5" },
			{ field: "pollutant", equals: "Ozone" },
		]);
		expect(card.listings.every((listing) => listing.ordering === "distance")).toBe(true);
		expect(card.headlines.map((one) => one.template.id)).toEqual(["section/retrieved-at@1", "section/no-records@1"]);
		// The only assertion this card's headlines had was that rendering them
		// did not throw.
		expect(card.headlines.map((one) => mustRender(houston.store, one))).toEqual([
			`Searched within 50 km of the mapped point, retrieved ${RETRIEVED_AT}.`,
			NO_DATA_NOTE,
		]);
		expect(card.listings.map((listing) => listing.section.carried)).toEqual([
			NEAREST_MONITOR + CARRIED_RECORDS,
			NEAREST_MONITOR + CARRIED_RECORDS,
		]);
	});

	/**
	 * B2 asks for the nearest qualified monitor per pollutant, so a pollutant
	 * with no monitor is a fact about that pollutant. Headlines read off the
	 * unfiltered section and listings off the per-pollutant ones, so an answer
	 * carrying ozone monitors only left PM2.5 with no count, no note and no
	 * sentence anywhere on the card.
	 *
	 * The words are unchanged and everything behind them is not. They used to be
	 * a note `lib/report/selection.ts` composed with the pollutant interpolated
	 * into it -- the selection policy writing prose, which gave the one word in
	 * the sentence that varies no template, no slot and no trace. So this
	 * asserts the spans and not only the text: "PM2.5" is a slot span reading
	 * `filterValue`, which a policy-composed string cannot be, and every other
	 * word is connective text the template holds.
	 */
	it("gives each pollutant a sentence of its own for having no monitor, with the pollutant a slot", () => {
		const card = aqsCard(houston.store, NO_RECORDS, AIR);
		const sections = card.listings.map((listing) => listing.section);
		const empty = storeOf([]);
		const sentences = sections.map((section) => {
			if (section.kind !== "aqs-monitor-summary") throw new Error(`${section.kind} is not an AQS section`);

			return mustSentence(empty, { scope: "section", section, template: aqsNoPollutantMonitor });
		});

		expect(sections.map((section) => section.filter)).toEqual([
			{ field: "pollutant", equals: "PM2.5" },
			{ field: "pollutant", equals: "Ozone" },
		]);
		// The policy composes no sentence for this: both notes are the source's
		// own, and neither names a pollutant. The words below are the template's.
		expect(sections.map((section) => section.note)).toEqual([NO_DATA_NOTE, NO_DATA_NOTE]);
		expect(sentences.map(textOf)).toEqual([
			"EPA's Air Quality System listed no PM2.5 monitor within 50 km of the mapped point.",
			"EPA's Air Quality System listed no Ozone monitor within 50 km of the mapped point.",
		]);
		expect(sentences.map(slottedOf)).toEqual([
			[
				["filterValue", "PM2.5"],
				["boundary", "50 km"],
			],
			[
				["filterValue", "Ozone"],
				["boundary", "50 km"],
			],
		]);
	});

	/**
	 * The other half of the same claim: the pollutant's name is not this
	 * template's wording either. Nothing in the template holds "PM2.5" -- the
	 * word arrives from the section's own filter, so the section that selects on
	 * `Ozone` renders the same template with the other word in the same slot,
	 * and neither card can print a pollutant its ordering was not selected by.
	 */
	it("holds no pollutant of its own, and refuses a section selected on another field", () => {
		const npl = cardOf(answered.plan, "sems").headlines.find((one) => one.template.id === semsNplSectionCount.id);
		if (npl === undefined || npl.scope !== "section") throw new Error("no section-scoped final-NPL headline");
		const nplSection: SectionSpec = npl.section;

		expect(JSON.stringify(aqsNoPollutantMonitor.clauses)).not.toContain("PM2.5");
		expect(aqsNoPollutantMonitor.requires).toEqual([
			{ slot: "filterField", equals: "pollutant" },
			{ slot: "count", equals: 0 },
		]);
		// The final-NPL section is selected by a string too, and its value is a
		// status rather than a pollutant. The kind gate passes it -- every
		// section template renders over every section -- and the requirement is
		// what refuses "listed no Currently on the Final NPL monitor".
		expect(nplSection.filter).toEqual({ field: "semsNplStatus", equals: FINAL_NPL_STATUS });
		expect(render(storeOf([]), { scope: "section", section: nplSection, template: aqsNoPollutantMonitor })).toBeNull();
	});
});

/* -------------------------------------------------------------------------- */
/* The air cards with both sources answering                                  */
/* -------------------------------------------------------------------------- */

/**
 * The clause both AirNow templates end on. It names the area again rather than
 * saying "it", and it reads the name off the row it is about -- which is why
 * this is a function and not a constant. The two rows in this store come from
 * two different bodies: the recording AirNow returned for the demonstration
 * coordinate calls the area `Houston-Galveston-Brazoria`, and the authored
 * null-index body calls it `Houston`. A constant here would have asserted one
 * name over a sentence that carries the other.
 */
function airnowQualification(area: string): string {
	return ` AirNow's observations describe the ${area} reporting area, not the mapped point.`;
}

describe("the air cards over air records", () => {
	/**
	 * The shape `AirTemplates` was widened for. `lib/templates/airnow.ts` is two
	 * templates disjoint and exhaustive on `aqi`, so a slot holding one of them
	 * left every row in the other state with no sentence at all -- the card
	 * counting a record it could not describe, which is what
	 * `refuseUndescribed` refuses one level up. The choice is per record and it
	 * is read off each template's own requirement, so the policy and the
	 * templates cannot disagree about which speaks for which state.
	 */
	it("gives each AirNow row the template that declares the index state that row is in", () => {
		const listing = listingOf(withAir.plan, "airnow");

		// The two ids differ in their area because the two bodies do: the recorded
		// ozone row is AirNow's own `Houston-Galveston-Brazoria`, the authored
		// null-index row is `Houston`. The record id is built from the area and the
		// parameter, so it carries whichever name the body used.
		expect(idsOf(withAir.store, listing)).toEqual(["Houston-Galveston-Brazoria/O3", "Houston/PM2.5"]);
		expect(templateIdsFor(withAir.store, listing, "Houston-Galveston-Brazoria/O3")).toEqual(["airnow-observation/summary@1"]);
		expect(templateIdsFor(withAir.store, listing, "Houston/PM2.5")).toEqual(["airnow-observation/no-index@1"]);
		expect(airnowObservationSummary.requires).toEqual([{ slot: "aqi", present: true }]);
		expect(airnowObservationNoIndex.requires).toEqual([{ slot: "aqi", present: false }]);
	});

	it("renders a sentence for every row of both states, each one AirNow's own answer", () => {
		expect(listingText(withAir.store, listingOf(withAir.plan, "airnow"))).toEqual([
			"AirNow reports an air quality index of 20 for Ozone in the Houston-Galveston-Brazoria reporting area, observed 2026-09-16." +
				airnowQualification("Houston-Galveston-Brazoria"),
			"AirNow's PM2.5 observation for the Houston reporting area, observed 2026-09-16, carries no air quality" +
				" index." +
				airnowQualification("Houston"),
		]);
	});

	/**
	 * The failure the old shape produced quietly. A template list that speaks
	 * for one state only is a card that holds a record it cannot describe, and
	 * this tier says so rather than dropping the row: silence here is a reader
	 * seeing a count of two above one sentence.
	 */
	it("refuses the card rather than dropping a row no template speaks for", () => {
		const half: AirTemplates = { aqs: aqsMonitorSummary, airnow: [airnowObservationSummary] };

		expect(() => cardPlacements(withAir.store, airnowCard(withAir.store, airnowAnswered, half))).toThrow(
			"no airnow-observation template speaks for a row whose air quality index is absent",
		);
		// And the other half of the pair alone fails on the row that has one.
		expect(() =>
			cardPlacements(withAir.store, airnowCard(withAir.store, airnowAnswered, { aqs: aqsMonitorSummary, airnow: [airnowObservationNoIndex] })),
		).toThrow("no airnow-observation template speaks for a row whose air quality index is present");
	});

	/**
	 * B2's nearest qualified monitor per pollutant, on the card: one listing per
	 * pollutant showing one record, the rest carried behind it. The recording
	 * AQS returned for the demonstration coordinate holds thirty distinct
	 * monitors, twenty-nine of them within 50 km -- twelve PM2.5 and seventeen
	 * ozone -- so both listings have something to carry, and both carry all of
	 * it: the carried bound is forty-six and neither list reaches it.
	 *
	 * The full PM2.5 order is written out rather than counted because the
	 * ordering is the claim. Two monitors at the same site as the nearest one
	 * would make a length assertion pass while the wrong one was on the card.
	 */
	it("shows the nearest monitor for each pollutant and carries the rest behind it", () => {
		const pm25 = listingOf(withAir.plan, "aqs", 0);
		const ozone = listingOf(withAir.plan, "aqs", 1);

		expect(pm25.section.filter).toEqual({ field: "pollutant", equals: "PM2.5" });
		expect(shownOf(withAir.store, pm25).map((entry) => entry.recordId.sourceRecordId)).toEqual([
			"48-201-1035-88101",
		]);
		expect(restOf(withAir.store, pm25).map((entry) => entry.recordId.sourceRecordId)).toEqual([
			"48-201-1056-88101",
			"48-201-1034-88101",
			"48-201-1099-88101",
			"48-201-0046-88101",
			"48-201-1039-88101",
			"48-201-1052-88101",
			"48-201-0024-88101",
			"48-201-0058-88101",
			"48-201-0055-88101",
			"48-201-1050-88101",
			"48-201-0066-88101",
		]);
		expect(shownOf(withAir.store, ozone).map((entry) => entry.recordId.sourceRecordId)).toEqual([
			"48-201-1035-44201",
		]);
		expect(sectionOrdering(withAir.store, pm25.section)).toHaveLength(12);
		expect(carriedCount(withAir.store, pm25.section)).toBe(12);
		expect(sectionOrdering(withAir.store, ozone.section)).toHaveLength(17);
		expect(carriedCount(withAir.store, ozone.section)).toBe(17);
	});

	/**
	 * The placement the per-pollutant sentence exists for, which nothing reached
	 * until now: an AQS answer that carries monitors for one pollutant and none
	 * for the other. Every earlier assertion rendered the template by hand, so
	 * the card could have stopped placing it and the suite would have stayed
	 * green.
	 *
	 * The store is the recorded AQS answer with its twelve PM2.5 monitors
	 * removed, one `without` at a time -- a state the recording cannot reach,
	 * built from the recording rather than authored, the way the derived answers
	 * at the head of this file are.
	 *
	 * The trace is the point. The pollutant is a `filterValue` slot whose
	 * section trace lists what the count counted, so a reader clicking "PM2.5"
	 * opens the query behind an empty ordering instead of a word this policy
	 * typed into a string.
	 */
	it("says which pollutant AQS listed no monitor for, from a slot the trace panel can open", () => {
		const pm25s = withAir.store.ofKind("aqs-monitor-summary").filter((one) => one.pollutant.value === "PM2.5");
		const ozoneOnly = pm25s.reduce((store, one) => store.without(one.id), withAir.store);
		const card = aqsCard(ozoneOnly, aqsAnswered, AIR);
		// The card places the template, not a note: the sentence is chosen here
		// and worded in `lib/templates/sections.ts`.
		expect(card.headlines.map((one) => one.template.id)).toEqual([
			"section/retrieved-at@1",
			"section/aqs-no-pollutant-monitor@1",
		]);
		const placed = card.headlines.filter((one) => one.template.id === aqsNoPollutantMonitor.id);
		const sentence = mustSentence(ozoneOnly, at(placed, 0, "the no-monitor headline"));
		const pollutant = sentence.spans.findIndex((span) => span.slot?.field === "filterValue");
		const explained = trace(ozoneOnly, sentence, pollutant);

		expect(pm25s).toHaveLength(12);
		expect(ozoneOnly.ofKind("aqs-monitor-summary")).toHaveLength(17);
		// One sentence, for the pollutant with nothing, on a card whose source
		// answered: ozone has seventeen monitors and gets none of this.
		expect(placed).toHaveLength(1);
		expect(textOf(sentence)).toBe(
			"EPA's Air Quality System listed no PM2.5 monitor within 50 km of the mapped point.",
		);
		expect(slottedOf(sentence)).toEqual([
			["filterValue", "PM2.5"],
			["boundary", "50 km"],
		]);
		if (explained === null || explained.scope !== "section") throw new Error("expected a section trace");
		expect(explained.clicked.field).toBe("filterValue");
		expect(explained.clicked.displayed).toBe("PM2.5");
		expect(explained.clicked.normalized).toBe("PM2.5");
		expect(explained.section.agency).toBe("EPA Air Quality System");
		expect(explained.section.kind).toBe("aqs-monitor-summary");
		expect(explained.section.counted).toEqual([]);
		// The field the ordering was selected on is beside it, unprinted: it is
		// what the template's requirement reads, and it is in the trace for the
		// reader who asks what "PM2.5" was matched against.
		expect(explained.values.map((value) => [value.field, value.normalized])).toContainEqual([
			"filterField",
			"pollutant",
		]);
		expect(verify(ozoneOnly, sentence, ALL_TEMPLATES)).toBe(true);
		// And the other requirement, over the pollutant that has monitors: a
		// count of nought is what this sentence asserts, so the kernel refuses
		// it over the ozone section's seventeen rather than trusting the policy.
		const ozone: SectionSpec = at(card.listings, 1, "the ozone listing").section;
		expect(sectionOrdering(ozoneOnly, ozone)).toHaveLength(17);
		expect(render(ozoneOnly, { scope: "section", section: ozone, template: aqsNoPollutantMonitor })).toBeNull();
	});

	it("renders the monitor, its distance and the unverified-shape clause on the card", () => {
		const pm25 = listingOf(withAir.plan, "aqs", 0);

		expect(mustRender(withAir.store, firstPlacementFor(withAir.store, pm25, "48-201-1035-88101"))).toBe(
			"PM2.5 monitor 48-201-1035-88101 is 1.52 km from the mapped point, and measures its own location, not this" +
				" address. 2025 annual arithmetic mean: 10.385577 Micrograms/cubic meter (LC). AQS data lags collection by six" +
				" months or more. Observations in the summary: 104.",
		);
		expect(mustRender(withAir.store, cardOf(withAir.plan, "aqs").status)).toBe(
			`EPA Air Quality System answered with records, retrieved ${RETRIEVED_AT}.`,
		);
		expect(mustRender(withAir.store, headline(withAir.plan, "aqs", 0))).toBe(
			`Searched within 50 km of the mapped point, retrieved ${RETRIEVED_AT}.`,
		);
	});

	/**
	 * The assertion the whole file is built around, over the records the air
	 * cards added: per record, per placement, against the store the placement
	 * was selected from. A record the report holds and cannot describe is the
	 * defect, and it is invisible in a card-level assertion.
	 */
	it("renders every placement, per record, for every record on every card", () => {
		let checked = 0;
		for (const card of withAir.plan.cards) {
			for (const listing of card.listings) {
				for (const entry of entriesOf(withAir.store, listing)) {
					for (const placement of entry.placements) {
						const one = render(withAir.store, placement);

						expect(one, `${entry.recordId.sourceRecordId} / ${placement.template.id}`).not.toBeNull();
						if (one === null) continue;
						expect(verify(withAir.store, one, ALL_TEMPLATES), textOf(one)).toBe(true);
						checked += 1;
					}
				}
			}
		}
		// Thirty-one air records among them: the twenty-nine monitors AQS
		// returned inside the 50 km boundary, and two observations.
		expect(withAir.store.ofKind("aqs-monitor-summary")).toHaveLength(29);
		expect(withAir.store.ofKind("airnow-observation")).toHaveLength(2);
		expect(checked).toBeGreaterThan(30);
	});

	it("renders every placement of the whole plan, including both air cards' chrome", () => {
		for (const placement of planPlacements(withAir.store, withAir.plan)) {
			const one = render(withAir.store, placement);

			expect(one, `${placement.scope} / ${placement.template.id}`).not.toBeNull();
		}
	});
});

/* -------------------------------------------------------------------------- */
/* B10's three states, over a store that is still filling                     */
/* -------------------------------------------------------------------------- */

/**
 * `lib/evidence/source.ts` gives an `ok` outcome at least one record, so an
 * empty section under one is not a state the world can be in. It is a state the
 * wiring can be in: `.dev/BUILD.md` asks for one event per
 * source card as that source settles, in settle order, so a card is built while
 * the store is still filling. Reading emptiness off the store alone put "No
 * matching records within the stated boundary" under a status line that said
 * the source answered with records, on every card, and B10's three states --
 * could not be asked, answered with nothing, answered -- collapsed into one.
 */
describe("a card built while the store is still filling", () => {
	const settling = storeOf([]);

	function textFrom(store: EvidenceStore, card: Card): readonly string[] {
		return cardPlacements(store, card).flatMap((placement) => {
			const one = render(store, placement);
			return one === null ? [] : [textOf(one)];
		});
	}

	it("says nothing about records over a source that answered with records", () => {
		const card = echoCard(settling, echo, NO_GROUPS);

		expect(echo.status).toBe("ok");
		expect(card.headlines.map((one) => one.template.id)).toEqual([
			"section/echo-count@1",
			"section/echo-formal-actions@1",
			"section/echo-noncompliance@1",
		]);
		expect(textFrom(settling, card)).toEqual([
			`EPA Enforcement and Compliance History Online answered with records, retrieved ${RETRIEVED_AT}.`,
			"Regulated facilities EPA ECHO lists within 5 miles of the mapped point: 0.",
			"Facilities within 5 miles with a formal enforcement action in ECHO's facility summary: 0.",
			"Facilities within 5 miles with at least one quarter of noncompliance in ECHO's twelve-quarter history: 0.",
		]);
		expect(textFrom(settling, card)).not.toContain(NO_DATA_NOTE);
	});

	it("keeps the Esri no-polygon wording off a card about a point that is in zone AE", () => {
		const card = floodCard(settling, fema);

		expect(fema.outcome.status).toBe("ok");
		expect(card.headlines).toEqual([]);
		expect(textFrom(settling, card)).toEqual([
			"Esri's reduced-set copy of FEMA's National Flood Hazard Layer answered with records," +
				` retrieved ${RETRIEVED_AT}.`,
			"FEMA's National Flood Hazard Layer could not be reached: the host refused the connection.",
		]);
		// The note in the spec is not a claim about what the source answered
		// either: the flood note used to fall back to the dataset's own
		// no-polygon wording whenever the outcome was not `no-data`.
		expect(at(card.listings, 0, "flood listing").section.note).not.toBe(
			FEMA_DATASETS.ESRI_REDUCED_SET.noPolygonNote,
		);
		expect(at(card.listings, 0, "flood listing").section.note).not.toBe(NO_DATA_NOTE);
	});

	it("still says it, in the source's own words, when the source did answer with nothing", async () => {
		const none = await flood({ fixture: "fema/esri-no-polygon-houston.json" });
		const empty = planOf({ ...HOUSTON, flood: none });
		const card = cardOf(empty.plan, "fema");

		expect(none.outcome.status).toBe("no-data");
		expect(card.headlines.map((one) => one.template.id)).toEqual(["section/no-records@1"]);
		expect(mustRender(empty.store, headline(empty.plan, "fema", 0))).toBe(
			FEMA_DATASETS.ESRI_REDUCED_SET.noPolygonNote,
		);
	});
});

/* -------------------------------------------------------------------------- */
/* A source that answered with nothing, over a store that holds its records   */
/* -------------------------------------------------------------------------- */

/**
 * The mirror image of the card built before its records arrived.
 * `noRecordsHeadline` is guarded on both the outcome and the store; the count
 * headlines and the listings were guarded on neither. So a `no-data` outcome
 * over a store holding that source's records rendered the source saying it had
 * nothing, a count of fifteen, and fifteen site sentences under it.
 *
 * One of those two halves is wrong and this tier cannot tell which, so it
 * builds no card at all -- which is what `refuseUndescribed` already did for
 * the other direction, a status-only card over records it would silently drop.
 */
describe("a source that answered with no records, over a store that holds its records", () => {
	it("refuses the card rather than printing both halves of the contradiction", () => {
		expect(() => semsCard(houston.store, NO_RECORDS, NO_GROUPS)).toThrow(
			"the report holds 15 sems-site records under a source that answered with no records",
		);
		expect(() => echoCard(houston.store, NO_RECORDS, NO_GROUPS)).toThrow(/7 echo-facility records/);
		expect(() => frsCard(houston.store, NO_RECORDS, NO_GROUPS)).toThrow(/1 frs-facility records/);
	});

	it("refuses the flood card too, where the outcome is not a slot of the fan-out", async () => {
		const none = await flood({ fixture: "fema/esri-no-polygon-houston.json" });

		expect(none.outcome.status).toBe("no-data");
		expect(() => floodCard(houston.store, { ...fema, outcome: none.outcome })).toThrow(
			/1 fema-flood-zone records/,
		);
	});

	it("builds the card the moment the store agrees with the outcome", () => {
		const empty = storeOf([]);

		expect(() => semsCard(empty, NO_RECORDS, NO_GROUPS)).not.toThrow();
		expect(() => echoCard(empty, NO_RECORDS, NO_GROUPS)).not.toThrow();
		expect(() => aqsCard(houston.store, NO_RECORDS, AIR)).not.toThrow();
		// And says so in the source's own words, with its counts at nought.
		expect(cardPlacements(empty, semsCard(empty, NO_RECORDS, NO_GROUPS)).map((one) => mustRender(empty, one))).toEqual([
			`EPA Superfund Enterprise Management System answered with no matching records, retrieved ${RETRIEVED_AT}.`,
			"Superfund sites EPA's inventory lists within 5 miles of the mapped point: 0.",
			"Sites on the final National Priorities List within 5 miles of the mapped point: 0.",
			NO_DATA_NOTE,
		]);
	});
});

/* -------------------------------------------------------------------------- */
/* The bound, said out loud                                                   */
/* -------------------------------------------------------------------------- */

/**
 * `CARRIED_RECORDS` drops the tail of every listing longer than fifty, and the
 * count sentence beside it states the true total -- so the two numbers looked
 * consistent and the gap was invisible rather than contradictory. On the
 * recorded Houston store a tighter bound leaves ten Superfund sites counted and
 * unspoken; on the live five-mile ECHO query the default bound would leave
 * 1,636 facilities. `section/not-shown@1` is what says so, from
 * `SectionSpec.carried` and the live ordering, never from a number in the plan.
 */
describe("what the bound cost, on the card", () => {
	const TIGHT: Bounds = { shown: 2, carried: 3 };
	// Over the plan the inventory answered about in full: the gap this block is
	// about sits beside both counts, and a card withholding one of them would
	// make every index below a statement about `nplCountHeadline` instead.
	const bounded = planOf(ANSWERED, TIGHT);

	it("bounds every section a listing reads from, and leaves a count-only section unbounded", () => {
		for (const card of houston.plan.cards) {
			const listed: ReadonlySet<SectionSpec> = new Set(card.listings.map((listing) => listing.section));

			for (const listing of card.listings) {
				expect(listing.section.carried, `${card.source} listing`).toBe(SHOWN_RECORDS + CARRIED_RECORDS);
			}
			for (const one of card.headlines) {
				if (listed.has(one.section)) continue;

				expect(one.section.carried, `${card.source} ${one.template.id}`).toBeNull();
			}
		}
	});

	it("states the gap beside the count that does not show it", () => {
		const card = cardOf(bounded.plan, "sems");

		expect(card.headlines.map((one) => one.template.id)).toEqual([
			"section/sems-count@1",
			"section/sems-npl-count@1",
			"section/not-shown@1",
		]);
		expect(mustRender(bounded.store, headline(bounded.plan, "sems", 0))).toBe(
			"Superfund sites EPA's inventory lists within 5 miles of the mapped point: 15.",
		);
		expect(mustRender(bounded.store, headline(bounded.plan, "sems", 2))).toBe(
			"Records within 5 miles of the mapped point that this list leaves out: 10.",
		);
		expect(mustRender(bounded.store, headline(bounded.plan, "echo", 3))).toBe(
			"Records within 5 miles of the mapped point that this list leaves out: 2.",
		);
	});

	it("recomputes the gap from the store, so it falls as the records do", () => {
		const smaller = bounded.store.without(recordId("sems-site", "TXN000607438"));

		expect(mustRender(smaller, headline(bounded.plan, "sems", 2))).toBe(
			"Records within 5 miles of the mapped point that this list leaves out: 9.",
		);
		expect(carriedCount(bounded.store, listingOf(bounded.plan, "sems").section)).toBe(5);
		expect(carriedCount(smaller, listingOf(bounded.plan, "sems").section)).toBe(5);
	});

	it("says nothing over a section that showed everything", () => {
		const npl = listingOf(bounded.plan, "sems", 1).section;

		for (const card of houston.plan.cards) {
			expect(card.headlines.map((one) => one.template.id), card.source).not.toContain("section/not-shown@1");
		}
		// The final-NPL section is bounded too, and holds two of a possible five.
		expect(sectionOrdering(bounded.store, npl)).toHaveLength(2);
		expect(cardOf(bounded.plan, "sems").headlines.filter((one) => one.section === npl)).toEqual([
			{ scope: "section", section: npl, template: semsNplSectionCount },
		]);
	});

	/**
	 * The number is `ordering.length - section.carried` for one section, so it
	 * is the gap in one list and not the gap on a card. The SEMS card holds two
	 * lists over one boundary and a group sentence besides, so a record this
	 * sentence counts may be on the card twice over.
	 *
	 * "Records ... that this list leaves out" claims the report; the number
	 * knows only the list. The wording is what is wrong, and the fix belongs in
	 * `lib/templates/sections.ts`, which this unit does not own:
	 *
	 *     Records within {boundary} of the mapped point that this list leaves out: {notShown}.
	 *
	 * This test states the true arithmetic, and the string it asserts is the one
	 * that has to change when that lands.
	 */
	it("states a gap in one list, and counts records the card speaks for elsewhere", () => {
		const card = cardOf(bounded.plan, "sems");
		const main = listingOf(bounded.plan, "sems");
		const npl = listingOf(bounded.plan, "sems", 1);
		const carried = new Set(idsOf(bounded.store, main));
		// What `group/shared-identifier@1` prints is its first two members; the
		// rest of the group reaches the reader only through the count beside it.
		const named = at(card.groups, 0, "group").members.slice(0, 2);
		const elsewhere = new Set(
			[...idsOf(bounded.store, npl), ...named.flatMap((id) => (id.kind === "sems-site" ? [id.sourceRecordId] : []))]
				.filter((id) => !carried.has(id)),
		);

		expect(mustRender(bounded.store, headline(bounded.plan, "sems", 2))).toBe(
			"Records within 5 miles of the mapped point that this list leaves out: 10.",
		);
		// Three of the ten are on this card anyway: one through the final-NPL
		// list and two through the group sentence. Seven are genuinely unspoken.
		expect([...elsewhere].sort()).toEqual(["TXD980748453", "TXN000605303", "TXN000607355"]);
		expect(10 - elsewhere.size).toBe(7);
		// The evidence for the middle one: the final-NPL list speaks for a record
		// the main list dropped past its bound, on this very card.
		expect(idsOf(bounded.store, npl)).toContain("TXD980748453");
		expect(listingText(bounded.store, npl)).toHaveLength(2);
	});

	it("can only sit beside the list it is about", () => {
		for (const card of bounded.plan.cards) {
			const listed: ReadonlySet<SectionSpec> = new Set(card.listings.map((listing) => listing.section));

			for (const one of card.headlines) {
				if (one.template.id !== "section/not-shown@1") continue;

				// `notShownHeadline` takes a `Listing` and not a `SectionSpec`, so a
				// count-only section can never be handed this sentence.
				expect(listed.has(one.section), `${card.source} ${one.template.id}`).toBe(true);
			}
		}
	});

	it("renders every placement of a plan whose bound has bitten, and re-derives each sentence", () => {
		for (const placement of planPlacements(bounded.store, bounded.plan)) {
			const one = render(bounded.store, placement);

			expect(one, `${placement.scope} / ${placement.template.id}`).not.toBeNull();
			if (one === null) continue;

			expect(verify(bounded.store, one, ALL_TEMPLATES), textOf(one)).toBe(true);
		}
	});
});

/* -------------------------------------------------------------------------- */
/* A final-NPL site the registry sent no coordinate for                       */
/* -------------------------------------------------------------------------- */

/**
 * `sems-site/npl@1` is placed on the field it requires, `semsNplStatus`, and
 * used to be a single clause that also referenced `distanceMeters` -- and a
 * clause dies whole when any reference has nothing to show. `LATITUDE83` and
 * `LONGITUDE83` are `z.number().nullable()` in the adapter's own schema, so a
 * final-NPL site with no FRS coordinate was counted by the section and rendered
 * nothing: the count said two and one sentence appeared, which is the drift the
 * final-NPL section exists to prevent.
 *
 * The record is the layer's own row for US OIL RECOVERY with those two columns
 * nulled and nothing else touched, through the real `semsAdapter` and the real
 * `complete`. The fix is in `lib/templates/sems.ts`; this is the test that
 * stops it coming back.
 */
describe("a final-NPL site the layer sent no coordinate for", () => {
	const FINAL_NPL_NO_POINT = "TXN000607093";

	it("is counted and spoken for, so the count and the sentences agree", async () => {
		const nulled = await runSource(
			locus,
			semsAdapter,
			// Every status request answered, so the count this test is about is
			// one the card states: `nplCountHeadline` withholds it over a store
			// holding a site the inventory did not answer for, and a missing
			// coordinate is not that.
			semsIo(
				{
					derived: `${LAYER_5MI}, LATITUDE83 and LONGITUDE83 nulled on ${FINAL_NPL_NO_POINT}`,
					body: semsLayerBody({ [FINAL_NPL_NO_POINT]: { LATITUDE83: null, LONGITUDE83: null } }),
				},
				[],
			),
			POLICY,
		);
		const derived = planOf({ ...HOUSTON, sems: nulled });
		const npl = listingOf(derived.plan, "sems", 1);

		expect(derived.store.get(recordId("sems-site", FINAL_NPL_NO_POINT))?.distanceMeters).toBeNull();
		expect(derived.store.get(recordId("sems-site", FINAL_NPL_NO_POINT))?.semsNplStatus?.value).toBe(FINAL_NPL_STATUS);
		expect([...idsOf(derived.store, npl)].sort()).toEqual([...FINAL_NPL_SITES].sort());
		expect(mustRender(derived.store, headline(derived.plan, "sems", 1))).toBe(
			"Sites on the final National Priorities List within 5 miles of the mapped point: 2.",
		);
		expect(mustRender(derived.store, firstPlacementFor(derived.store, npl, FINAL_NPL_NO_POINT))).toBe(
			"US OIL RECOVERY is listed by SEMS.",
		);
		// Two counted, two spoken for.
		expect(
			idsOf(derived.store, npl).map((id) => mustRender(derived.store, firstPlacementFor(derived.store, npl, id))),
		).toHaveLength(2);
	});
});

/* -------------------------------------------------------------------------- */
/* Acceptance 11. No escapes from the type system in either file              */
/* -------------------------------------------------------------------------- */

describe("the policy and its test hold no escapes from the type system", () => {
	const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

	/**
	 * Comments and string literals removed, so prose about a keyword never reads
	 * as code.
	 *
	 * One left-to-right pass over all five forms, not five passes: an apostrophe
	 * inside a double-quoted sentence would otherwise open a string that runs to
	 * the next apostrophe and swallows the quotes between them.
	 *
	 * Built from strings with the three quote characters written as escapes,
	 * because this file is one of the files it scans, and a raw backtick inside a
	 * regular expression literal reads to the scan as a template string opening —
	 * which is exactly the desynchronisation that let an `any` through here.
	 */
	const literal = new RegExp(
		[
			"/\\*[\\s\\S]*?\\*/",
			"//[^\\n]*",
			"\\x60(?:[^\\x60\\\\]|\\\\.)*\\x60",
			"\\x22(?:[^\\x22\\\\\\n]|\\\\.)*\\x22",
			"\\x27(?:[^\\x27\\\\\\n]|\\\\.)*\\x27",
		].join("|"),
		"g",
	);

	function code(relative: string): string {
		return readFileSync(repoRoot + relative, "utf8").replace(literal, " ");
	}

	const files: readonly string[] = ["lib/report/selection.ts", "tests/unit/report/selection.test.ts"];

	/**
	 * Held as strings rather than as regular expression literals, because this
	 * file scans itself: a literal here would be code the scrubber cannot strip,
	 * and the detector would find its own pattern.
	 */
	const forbidden: readonly { readonly what: string; readonly pattern: string }[] = [
		{ what: "type assertion", pattern: "\\bas\\s+[A-Za-z_{(]" },
		{ what: "non-null assertion", pattern: "[\\w)\\]]![^=]" },
		{ what: "explicit any", pattern: "\\bany\\b" },
	];

	for (const relative of files) {
		it("has no type assertion, non-null assertion or explicit any in " + relative, () => {
			const body = code(relative);

			for (const { what, pattern } of forbidden) {
				expect(body.match(new RegExp(pattern, "g")) ?? [], what).toEqual([]);
			}
		});
	}
});
