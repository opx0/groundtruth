/**
 * The report route, driven end to end from committed fixture bytes.
 *
 * Every record here is built by running a real adapter (`semsAdapter`,
 * `echoAdapter`, `floodZoneOutcome`, `lookupFrsFacility`) through the route's
 * own handler over a stub `SourceIo` that serves recorded bytes. Nothing
 * hand-builds a record, nothing invents a payload, and nothing reaches the
 * network.
 *
 * Two answers are derived rather than recorded, each labelled `derived:` in its
 * payload URL and each reaching a state the recorded bytes cannot: an ECHO
 * summary whose `QueryRows` is zero, and an NFHL answer with no features, which
 * no recording exists for because FEMA's host refuses non-US traffic
 * (docs/BRIEF.md B14). That is the technique `tests/unit/report/selection.test.ts`
 * already uses, for the same reason and with the same labelling.
 *
 * WHAT THE LEAK ASSERTIONS ARE MADE AGAINST. The response body is grepped as
 * raw text, before any parse: parsing it through `ReportEventSchema` would
 * re-apply the server's own key redaction on the way in and a test that did
 * that would pass whether or not the server had redacted anything.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { SourceFailure } from "@/lib/evidence";
import type { Fetched, JsonValue, PayloadRef, SourceIo } from "@/lib/evidence";
import { createReportHandler } from "@/app/api/report/handler";
import { ReportEventSchema, REDACTED, type CardView, type ReportEvent } from "@/app/lib/report-contract";
import { censusOrigin } from "../evidence/helpers/sems-fixtures";

const fixturesDir = fileURLToPath(new URL("../../fixtures/", import.meta.url));
const RETRIEVED_AT = "2026-09-16T09:00:00Z";

/** The demo point of docs/BRIEF.md A6 row 1, read out of the committed Census bytes rather than typed in. */
const HOUSTON = censusOrigin();
const LATITUDE = HOUSTON.latitude.value;
const LONGITUDE = HOUSTON.longitude.value;

/** `noUncheckedIndexedAccess` is on, and a test that silently skipped an index would assert nothing. */
function at<T>(items: readonly T[], index: number, what: string): T {
	const item = items[index];
	if (item === undefined) throw new Error(`no ${what} at index ${index}`);
	return item;
}

/* -------------------------------------------------------------------------- */
/* The stub io                                                                */
/* -------------------------------------------------------------------------- */

/** What one request is answered with: recorded bytes, bytes derived from them, a failure, or any of those late. */
type Answer =
	| { readonly fixture: string }
	| { readonly derived: string; readonly body: JsonValue }
	| { readonly fail: SourceFailure }
	| { readonly slow: number; readonly then: Answer };

function bytesOf(relative: string): Buffer {
	return readFileSync(`${fixturesDir}${relative}`);
}

function payloadOf(url: string, bytes: Buffer): PayloadRef {
	return { url, sha256: createHash("sha256").update(bytes).digest("hex"), retrievedAt: RETRIEVED_AT };
}

function pause(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJson(relative: string): JsonValue {
	const value: JsonValue = JSON.parse(bytesOf(relative).toString("utf8"));
	return value;
}

type Requested = { readonly urls: string[]; readonly io: SourceIo };

function ioOf(answerFor: (url: URL) => Answer): Requested {
	const urls: string[] = [];
	const io: SourceIo = {
		async get<Raw extends JsonValue>(url: URL, schema: z.ZodType<Raw>): Promise<Fetched<Raw>> {
			urls.push(url.toString());
			let answer = answerFor(url);
			while ("slow" in answer) {
				await pause(answer.slow);
				answer = answer.then;
			}
			if ("fail" in answer) throw answer.fail;
			const bytes = "fixture" in answer ? bytesOf(answer.fixture) : Buffer.from(JSON.stringify(answer.body), "utf8");
			const label = "fixture" in answer ? `fixture:${answer.fixture}` : answer.derived;
			return { raw: schema.parse(JSON.parse(bytes.toString("utf8"))), payload: payloadOf(label, bytes) };
		},
		query(parameter, value, adapterVersion, payload) {
			return { kind: "query", parameter, value, adapterVersion, payload };
		},
		now: () => RETRIEVED_AT,
	};
	return { urls, io };
}

/* -------------------------------------------------------------------------- */
/* Routing one URL to one answer                                              */
/* -------------------------------------------------------------------------- */

const ECHO_SUMMARY = "echo/facilities-quarter-mi.json";
const ECHO_PAGE = "echo/facilities-page-quarter-mi.json";
const SEMS_LAYER = "sems/arcgis-5mi-houston.json";

/** The two registry IDs FRS has recorded bytes for. Any other ID is answered with no rows, which is a real FRS answer. */
const FRS_FIXTURES: ReadonlyMap<string, string> = new Map([
	["110000460885", "frs/arcgis-registry-110000460885.json"],
	["110000462703", "frs/arcgis-registry-110000462703-two-ids.json"],
]);

const NO_FEATURES: JsonValue = { features: [] };

type Plan = {
	readonly echoSummary: Answer;
	readonly echoPage: Answer;
	readonly semsLayer: Answer;
	readonly status: (epaId: string) => Answer;
	readonly frs: (registryId: string) => Answer;
	readonly nfhl: Answer;
	readonly esri: Answer;
};

/** The EPA ID out of `.../efservice/envirofacts_site/epa_id/<EPA_ID>/JSON`. */
function epaIdOf(url: URL): string {
	const segments = url.pathname.split("/");
	return segments[segments.length - 2] ?? "";
}

/** The registry ID out of ArcGIS's `where=REGISTRY_ID='<id>'`. */
function registryIdOf(url: URL): string {
	return /REGISTRY_ID='([^']*)'/.exec(url.searchParams.get("where") ?? "")?.[1] ?? "";
}

/**
 * NFHL's host refuses connections from outside the US and no response from it
 * has ever been recorded, so the default plan refuses it and Esri's recorded
 * copy answers. That is also the case that leaves a non-null prior attempt on
 * the flood card.
 */
const NFHL_REFUSED = new SourceFailure("refused");

const DEMO: Plan = {
	echoSummary: { fixture: ECHO_SUMMARY },
	echoPage: { fixture: ECHO_PAGE },
	semsLayer: { fixture: SEMS_LAYER },
	status: (epaId) => ({ fixture: `sems/envirofacts-${epaId}.json` }),
	frs: (registryId) => {
		const fixture = FRS_FIXTURES.get(registryId);
		return fixture === undefined ? { derived: `derived:frs-no-rows-${registryId}`, body: NO_FEATURES } : { fixture };
	},
	nfhl: { fail: NFHL_REFUSED },
	esri: { fixture: "fema/esri-no-polygon-houston.json" },
};

function planned(plan: Plan): Requested {
	let echoCalls = 0;
	return ioOf((url) => {
		if (url.host === "echodata.epa.gov") {
			echoCalls += 1;
			return echoCalls === 1 ? plan.echoSummary : plan.echoPage;
		}
		if (url.host === "data.epa.gov") return plan.status(epaIdOf(url));
		if (url.host === "hazards.fema.gov") return plan.nfhl;
		if (url.pathname.includes("FRS_INTERESTS_SEMS")) return plan.semsLayer;
		if (url.pathname.includes("/FRS_INTERESTS/")) return plan.frs(registryIdOf(url));
		if (url.pathname.includes("USA_Flood_Hazard_Reduced_Set")) return plan.esri;
		throw new Error(`the stub io was asked for an unrouted URL: ${url.host}${url.pathname}`);
	});
}

/* -------------------------------------------------------------------------- */
/* Driving the route                                                          */
/* -------------------------------------------------------------------------- */

function postRequest(body: unknown): Request {
	return new Request("http://localhost/api/report", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

const CONFIRMED_POINT: unknown = { latitude: LATITUDE, longitude: LONGITUDE };

type Run = { readonly response: Response; readonly raw: string; readonly events: readonly ReportEvent[] };

async function report(plan: Plan, timeouts: Record<string, { readonly timeoutMs: number }> = {}): Promise<Run> {
	const { io } = planned(plan);
	return drive(io, timeouts);
}

async function drive(io: SourceIo, timeouts: Record<string, { readonly timeoutMs: number }> = {}): Promise<Run> {
	const handler = createReportHandler(io, timeouts);
	const response = await handler(postRequest(CONFIRMED_POINT));
	const raw = await response.text();
	const events = raw
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line): ReportEvent => ReportEventSchema.parse(JSON.parse(line)));
	return { response, raw, events };
}

function cardFor(events: readonly ReportEvent[], source: string): CardView {
	for (const event of events) {
		if (event.type === "card" && event.card.source === source) return event.card;
	}
	throw new Error(`no card was emitted for ${source}`);
}

type Sentence = CardView["headlines"][number];

function textOf(sentence: Sentence): string {
	return sentence.spans.map((span) => span.text).join("");
}

/** Every sentence on a card, in reading order: status, prior attempts, headlines, then every record's sentences. */
function sentencesOf(card: CardView): readonly Sentence[] {
	const out: Sentence[] = [];
	if (card.status !== null) out.push(card.status);
	out.push(...card.priorAttempts, ...card.headlines);
	for (const listing of card.listings) {
		for (const entry of [...listing.shown, ...listing.rest]) out.push(...entry.sentences);
	}
	return out;
}

function textsOf(card: CardView): readonly string[] {
	return sentencesOf(card).map(textOf);
}

/** What each event is, in one string, so a whole stream can be asserted as one list. */
function shapeOf(event: ReportEvent): string {
	if (event.type === "card") return `card:${event.card.source}:${event.card.state}`;
	if (event.type === "groups") return "groups";
	return `end:${event.status}`;
}

/* -------------------------------------------------------------------------- */
/* A captured console, for every test in this file                            */
/* -------------------------------------------------------------------------- */

const CONSOLE_METHODS: readonly ["log", "info", "warn", "error", "debug"] = ["log", "info", "warn", "error", "debug"];

let consoleSpies: Array<ReturnType<typeof vi.spyOn>>;
let logged: unknown[];

beforeEach(() => {
	logged = [];
	const capture =
		(): ((...args: unknown[]) => void) =>
		(...args: unknown[]) => {
			logged.push(args);
		};
	consoleSpies = CONSOLE_METHODS.map((method) => vi.spyOn(console, method).mockImplementation(capture()));
});

afterEach(() => {
	for (const spy of consoleSpies) spy.mockRestore();
});

function serialize(value: unknown): string {
	return JSON.stringify(value) ?? "";
}

/* -------------------------------------------------------------------------- */
/* 2. The whole route, over the Houston demo point                            */
/* -------------------------------------------------------------------------- */

describe("the Houston demo point, every source, one stream", () => {
	it("emits one card per source, then the groups, then a terminal event", async () => {
		const { response, events } = await report(DEMO);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("application/x-ndjson");

		// The exact sequence, for these bytes. The two air sources have no adapter
		// yet and were never asked, so they settle first: a source nobody asked
		// settles the moment the report starts. Everything after that is the
		// order these sources answered in -- ECHO reads two pages, FEMA two
		// layers, SEMS the layer and then fifteen status rows four at a time, and
		// FRS cannot start until SEMS has finished. That this is stable is a
		// property worth pinning; that it is not a *fixed* order is what the
		// settle-order test below proves, by moving the delay and watching it
		// change.
		expect(events.map(shapeOf)).toEqual([
			"card:aqs:not-asked",
			"card:airnow:not-asked",
			"card:echo:asked",
			"card:fema:asked",
			"card:sems:asked",
			"card:frs:asked",
			"groups",
			"end:complete",
		]);
	});

	it("renders the Superfund card's count and its nearest site from the agency's own fields", async () => {
		const { events } = await report(DEMO);
		const sems = cardFor(events, "sems");
		const texts = textsOf(sems);
		expect(sems.agency).toBe("EPA Superfund Enterprise Management System");
		expect(texts).toContain(
			"Superfund sites EPA's inventory lists within 5 miles of the mapped point: 15.",
		);
		expect(texts.some((text) => text.startsWith("VALERO PLUME, EPA ID TXN000622182. 0.76 km from the mapped point."))).toBe(
			true,
		);
	});

	it("renders the ECHO card, the flood card and the registry card, each naming what answered", async () => {
		const { events } = await report(DEMO);

		const echo = cardFor(events, "echo");
		expect(echo.agency).toBe("EPA Enforcement and Compliance History Online");
		expect(textsOf(echo)).toContain(
			`EPA Enforcement and Compliance History Online answered with records, retrieved ${RETRIEVED_AT}.`,
		);
		expect(textsOf(echo).some((text) => text.includes("CARGILL INCORPORATED"))).toBe(true);

		const fema = cardFor(events, "fema");
		// NFHL refused, so the Esri copy answered and the card is labelled for it.
		expect(fema.agency).toBe("Esri's reduced-set copy of FEMA's National Flood Hazard Layer");
		expect(fema.priorAttempts.map(textOf)).toContain(
			"FEMA's National Flood Hazard Layer could not be reached: the host refused the connection.",
		);

		const frs = cardFor(events, "frs");
		expect(frs.agency).toBe("EPA Facility Registry Service");
		expect(textsOf(frs).some((text) => text.includes("110000460885"))).toBe(true);
	});

	it("ties the Superfund site and the registry facility into one group, after every source has settled", async () => {
		const { events } = await report(DEMO);
		const groups = events.filter((event) => event.type === "groups");
		expect(groups.length).toBe(1);
		const event = at(groups, 0, "groups event");
		if (event.type !== "groups") throw new Error("expected the groups event");
		const spoken = event.cards.flatMap((card) => [...card.groups, ...card.crossReferences]).map(textOf);
		expect(spoken.some((text) => text.includes("110000460885"))).toBe(true);
	});

	it("puts both chrome numbers on every listing, agreeing with the count sentence beside them", async () => {
		const { events } = await report(DEMO);
		const sems = cardFor(events, "sems");
		const listing = at(sems.listings, 0, "SEMS listing");
		expect(listing.kind).toBe("sems-site");
		expect(listing.boundary).toBe("5 miles");
		expect(listing.ordering).toBe("distance");
		// 15 sites within five miles; the bound carries all of them, five shown.
		expect(listing.total).toBe(15);
		expect(listing.carried).toBe(15);
		expect(listing.shown.length).toBe(5);
		expect(listing.shown.length + listing.rest.length).toBe(listing.carried);
		expect(textsOf(sems)).toContain("Superfund sites EPA's inventory lists within 5 miles of the mapped point: 15.");
	});
});

/* -------------------------------------------------------------------------- */
/* 3. A failing source is a card, not a stream error                          */
/* -------------------------------------------------------------------------- */

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
	return Array.isArray(value);
}

function objectAt(value: JsonValue | undefined, what: string): { readonly [key: string]: JsonValue } {
	if (value === null || value === undefined || typeof value !== "object" || isJsonArray(value)) {
		throw new Error(`${what} is not an object`);
	}
	return value;
}

/** The recorded ECHO summary with its row count set to zero, which is ECHO's own no-data answer. */
function echoNoRows(): JsonValue {
	const results = objectAt(objectAt(parseJson(ECHO_SUMMARY), ECHO_SUMMARY)["Results"], "Results");
	return { Results: { ...results, QueryRows: "0" } };
}

describe("one source that throws, one that times out and one that answers with nothing", () => {
	const BROKEN: Plan = {
		...DEMO,
		// SEMS's layer request is refused outright.
		semsLayer: { fail: new SourceFailure("refused") },
		// Both flood layers hang past their policy.
		nfhl: { slow: 80, then: { fixture: "fema/esri-no-polygon-houston.json" } },
		esri: { slow: 80, then: { fixture: "fema/esri-no-polygon-houston.json" } },
		// ECHO counts zero rows and never gets asked for a page.
		echoSummary: { derived: "derived:echo-zero-rows", body: echoNoRows() },
	};

	it("gives every source a card and still ends complete", async () => {
		const { events } = await report(BROKEN, { fema: { timeoutMs: 20 } });
		const shapes = events.map(shapeOf);
		expect(shapes.filter((shape) => shape.startsWith("card:")).length).toBe(6);
		expect(at(shapes, shapes.length - 1, "terminal event")).toBe("end:complete");
	});

	it("says the Superfund source could not be reached, and nothing about what it holds", async () => {
		const { events } = await report(BROKEN, { fema: { timeoutMs: 20 } });
		const sems = cardFor(events, "sems");
		expect(textsOf(sems)).toEqual([
			"EPA Superfund Enterprise Management System could not be reached: the host refused the connection.",
		]);
		expect(sems.listings).toEqual([]);
	});

	it("says the flood layer timed out, naming the dataset that was asked last", async () => {
		const { events } = await report(BROKEN, { fema: { timeoutMs: 20 } });
		const fema = cardFor(events, "fema");
		expect(textsOf(fema)).toContain(
			"Esri's reduced-set copy of FEMA's National Flood Hazard Layer could not be reached: the request timed out.",
		);
		expect(fema.priorAttempts.map(textOf)).toContain(
			"FEMA's National Flood Hazard Layer could not be reached: the request timed out.",
		);
	});

	it("says ECHO answered with no matching records, which is not the same as unavailable", async () => {
		const { events } = await report(BROKEN, { fema: { timeoutMs: 20 } });
		const echo = cardFor(events, "echo");
		const texts = textsOf(echo);
		expect(texts).toContain(
			`EPA Enforcement and Compliance History Online answered with no matching records, retrieved ${RETRIEVED_AT}.`,
		);
		expect(texts).toContain("No matching records within the stated boundary.");
	});

	it("does not ask the registry when nothing named a registry ID", async () => {
		const { events } = await report(BROKEN, { fema: { timeoutMs: 20 } });
		const frs = cardFor(events, "frs");
		expect(frs.state).toBe("not-asked");
		expect(frs.status).toBeNull();
		expect(frs.agency).toBe("EPA Facility Registry Service");
	});
});

describe("the whole report failing before any card", () => {
	it("says so in one event, ends the stream and logs a fixed string", async () => {
		// The clock the report reads the confirmed point's payload from throws.
		// Nothing below that point is a source, so no card can be built and there
		// is nothing to say but that it failed.
		const { io } = planned(DEMO);
		const broken: SourceIo = {
			get: io.get.bind(io),
			query: io.query.bind(io),
			now: () => {
				throw new Error(`the clock failed at ${LATITUDE},${LONGITUDE}`);
			},
		};
		const { events, raw } = await drive(broken);

		expect(events.map(shapeOf)).toEqual(["end:failed"]);
		// The thrown error carried a coordinate in its own message on purpose.
		// Neither the body nor the log may repeat it.
		expect(raw).not.toContain(String(LATITUDE));
		expect(logged).toEqual([["report: run failed"]]);
		expect(serialize(logged)).not.toContain(String(LATITUDE));
	});
});

/* -------------------------------------------------------------------------- */
/* 4. Settle order, not a fixed order                                         */
/* -------------------------------------------------------------------------- */

describe("cards arrive as their sources settle", () => {
	function orderOf(events: readonly ReportEvent[], source: string): number {
		const index = events.findIndex((event) => event.type === "card" && event.card.source === source);
		if (index === -1) throw new Error(`no card for ${source}`);
		return index;
	}

	it("emits the fast card first, whichever source is the fast one", async () => {
		const slowEcho = await report({
			...DEMO,
			echoSummary: { slow: 60, then: { fixture: ECHO_SUMMARY } },
		});
		expect(orderOf(slowEcho.events, "sems")).toBeLessThan(orderOf(slowEcho.events, "echo"));

		// The same run with the delay moved proves the order is the settle order
		// and not the order the table happens to list the sources in.
		const slowSems = await report({
			...DEMO,
			semsLayer: { slow: 60, then: { fixture: SEMS_LAYER } },
		});
		expect(orderOf(slowSems.events, "echo")).toBeLessThan(orderOf(slowSems.events, "sems"));
	});
});

/* -------------------------------------------------------------------------- */
/* 5. The flood card names its dataset                                        */
/* -------------------------------------------------------------------------- */

describe("the flood card names the dataset that answered", () => {
	it("names Esri's copy on a polygon it answered, in the record's own sentence", async () => {
		const { events } = await report({ ...DEMO, esri: { fixture: "fema/esri-zone-ae-pasadena.json" } });
		const fema = cardFor(events, "fema");
		expect(fema.agency).toBe("Esri's reduced-set copy of FEMA's National Flood Hazard Layer");
		expect(
			textsOf(fema).some((text) => text.includes("Esri's reduced-set copy of FEMA's National Flood Hazard Layer")),
		).toBe(true);
		expect(at(fema.listings, 0, "flood listing").shown.length).toBe(1);
	});

	it("gives the two datasets different no-polygon wordings, each naming itself", async () => {
		const esri = await report(DEMO);
		// No recorded NFHL response exists -- the host refuses non-US traffic --
		// so the empty answer is derived and labelled as such.
		const nfhl = await report({
			...DEMO,
			nfhl: { derived: "derived:nfhl-no-features", body: NO_FEATURES },
		});

		const esriCard = cardFor(esri.events, "fema");
		const nfhlCard = cardFor(nfhl.events, "fema");
		expect(nfhlCard.agency).toBe("FEMA's National Flood Hazard Layer");
		expect(nfhlCard.priorAttempts).toEqual([]);

		const esriNote = textsOf(esriCard).find((text) => text.includes("no polygon") || text.includes("no 1%"));
		const nfhlNote = textsOf(nfhlCard).find((text) => text.includes("No digital FEMA designation"));
		expect(textsOf(esriCard)).toContain(
			"No 1% or 0.2% flood hazard polygon intersects this point in the Esri copy of FEMA's layer, dated 2026-03-11." +
				" This copy omits minimal-hazard areas, so it cannot tell minimal hazard from an unmapped area.",
		);
		expect(textsOf(nfhlCard)).toContain(
			"FEMA's own National Flood Hazard Layer answered with no polygon." +
				" No digital FEMA designation was available at this point.",
		);
		expect(esriNote).not.toEqual(nfhlNote);
	});
});

/* -------------------------------------------------------------------------- */
/* 6. Privacy                                                                 */
/* -------------------------------------------------------------------------- */

const ADDRESS_MARKER = "APT-9Z-DO-NOT-LEAK";

describe("no address reaches this route, and no coordinate reaches a log", () => {
	it("refuses a body that carries an address rather than stripping it and carrying on", async () => {
		const { urls, io } = planned(DEMO);
		const handler = createReportHandler(io);
		const response = await handler(
			postRequest({ latitude: LATITUDE, longitude: LONGITUDE, address: `9311 E Ave P, ${ADDRESS_MARKER}` }),
		);
		const body: unknown = await response.json();

		expect(response.status).toBe(400);
		expect(body).toEqual({ status: "invalid" });
		// No source was asked anything at all, so no adapter can have received it.
		expect(urls).toEqual([]);
		expect(serialize(body)).not.toContain(ADDRESS_MARKER);
		expect(serialize(logged)).not.toContain(ADDRESS_MARKER);
		expect(logged).toEqual([]);
	});

	it("sends no adapter a request carrying anything but coordinates and query parameters", async () => {
		const { urls, io } = planned(DEMO);
		await drive(io);
		expect(urls.length).toBeGreaterThan(0);
		for (const url of urls) {
			expect(url).not.toContain(ADDRESS_MARKER);
			expect(url.toLowerCase()).not.toContain("address");
		}
	});

	it("writes no log line at all on a report that ran, and none carrying the coordinate", async () => {
		const { raw } = await report(DEMO);
		expect(raw.length).toBeGreaterThan(0);
		expect(logged).toEqual([]);
		expect(serialize(logged)).not.toContain(String(LATITUDE));
		expect(serialize(logged)).not.toContain(String(LONGITUDE));
	});

	it("puts the coordinate in no sentence, no card label and no boundary on the wire", async () => {
		const { events } = await report(DEMO);
		const chrome: string[] = [];
		for (const event of events) {
			if (event.type !== "card") continue;
			chrome.push(event.card.agency);
			for (const sentence of sentencesOf(event.card)) chrome.push(textOf(sentence));
			for (const listing of event.card.listings) chrome.push(listing.boundary, listing.kind, listing.ordering);
		}
		expect(chrome.length).toBeGreaterThan(0);
		for (const text of chrome) {
			expect(text).not.toContain(String(LATITUDE));
			expect(text).not.toContain(String(LONGITUDE));
		}
	});
});

/* -------------------------------------------------------------------------- */
/* 7. A payload URL never carries a key                                       */
/* -------------------------------------------------------------------------- */

const KEY_SENTINEL = "SENTINEL-KEY-DO-NOT-SHIP";

describe("a payload URL carrying an API key does not reach the wire", () => {
	it("redacts the key an adapter failed to redact, and ships the rest of the URL unchanged", async () => {
		// The stub stamps the SEMS layer's payload with a URL carrying a key, the
		// way a future AQS or AirNow adapter would if its own redaction were
		// wrong. Every SEMS record's provenance then names that payload.
		const leaky = `https://aqs.epa.gov/data/api/annualData/byBox?param=88101&email=nobody%40example.gov&key=${KEY_SENTINEL}`;
		const { raw } = await report({
			...DEMO,
			semsLayer: { derived: leaky, body: parseJson(SEMS_LAYER) },
		});

		expect(raw).not.toContain(KEY_SENTINEL);
		expect(raw).toContain(`key=${REDACTED}`);
		expect(raw).toContain(`email=${REDACTED}`);
		// The rest of the citation survives: a redacted URL is still the request.
		expect(raw).toContain("param=88101");
	});

	/**
	 * The redaction above works on shape: it parses a string as a URL and
	 * rewrites the parameters it recognises. A source's own error text is not a
	 * URL, and both air adapters forward it verbatim into
	 * `SourceFailure.rawCode`, which `lib/templates/sources.ts` renders as
	 * "It answered {rawCode}." -- on the card. An audit drove exactly this and
	 * the key reached the wire, so the second redaction works on value.
	 */
	it("redacts a configured key out of a source's own error text, which is not a URL", async () => {
		const previous = process.env["AIRNOW_KEY"];
		process.env["AIRNOW_KEY"] = KEY_SENTINEL;
		try {
			const { raw } = await report({
				...DEMO,
				// The shape a real source answers with: prose, with the request
				// echoed back inside it, credential and all.
				semsLayer: {
					fail: new SourceFailure(
						"http",
						`Request not authenticated for https://www.airnowapi.org/aq/observation/latLong/current/?API_KEY=${KEY_SENTINEL}`,
					),
				},
			});

			expect(raw).not.toContain(KEY_SENTINEL);
			expect(raw).toContain(REDACTED);
			// The message is still the source's, minus the credential: B10 shows an
			// unknown status verbatim and the redaction takes the key, not the text.
			expect(raw).toContain("Request not authenticated for");
		} finally {
			if (previous === undefined) delete process.env["AIRNOW_KEY"];
			else process.env["AIRNOW_KEY"] = previous;
		}
	});

	it("leaves the report alone when no key is configured", async () => {
		const previous = { aqs: process.env["AQS_KEY"], airnow: process.env["AIRNOW_KEY"] };
		delete process.env["AQS_KEY"];
		delete process.env["AIRNOW_KEY"];
		try {
			const { raw } = await report(DEMO);
			expect(raw).toContain("VALERO PLUME");
			expect(raw).not.toContain(REDACTED);
		} finally {
			if (previous.aqs !== undefined) process.env["AQS_KEY"] = previous.aqs;
			if (previous.airnow !== undefined) process.env["AIRNOW_KEY"] = previous.airnow;
		}
	});
});

/* -------------------------------------------------------------------------- */
/* 8. Every span of every sentence can be traced                              */
/* -------------------------------------------------------------------------- */

describe("the trace that crosses the wire answers what is behind every span", () => {
	it("resolves every slotted span of every sentence of every card from that sentence's one trace", async () => {
		const { events } = await report(DEMO);
		let checked = 0;
		for (const event of events) {
			const sentences: Sentence[] = [];
			if (event.type === "card") sentences.push(...sentencesOf(event.card));
			if (event.type === "groups") {
				for (const card of event.cards) sentences.push(...card.groups, ...card.crossReferences);
			}
			for (const sentence of sentences) {
				const slotted = sentence.spans.filter((span) => span.slot !== null);
				if (slotted.length === 0) continue;
				const trace = sentence.trace;
				expect(trace, `${sentence.templateId} has no trace`).not.toBeNull();
				if (trace === null) continue;
				for (const span of slotted) {
					const field = span.slot?.field ?? "";
					const value = trace.values.find((one) => one.field === field);
					expect(value, `${sentence.templateId}: no trace value for ${field}`).toBeDefined();
					expect(value?.displayed).toBe(span.text);
					checked += 1;
				}
			}
		}
		expect(checked).toBeGreaterThan(50);
	});

	it("carries no sentence subject on any event", async () => {
		const { events } = await report(DEMO);
		for (const event of events) {
			if (event.type !== "card") continue;
			for (const sentence of sentencesOf(event.card)) {
				expect(Object.keys(sentence).sort()).toEqual(["spans", "templateId", "trace"]);
			}
		}
	});
});

/* -------------------------------------------------------------------------- */
/* The request this route will not act on                                     */
/* -------------------------------------------------------------------------- */

describe("the request carries a coordinate and nothing else", () => {
	it("refuses a missing, malformed or out-of-range body with the geocode route's own invalid shape", async () => {
		const { io } = planned(DEMO);
		const handler = createReportHandler(io);
		for (const body of [{}, { latitude: LATITUDE }, { latitude: "29", longitude: "-95" }, { latitude: 91, longitude: 0 }]) {
			const response = await handler(postRequest(body));
			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({ status: "invalid" });
		}
		const malformed = new Request("http://localhost/api/report", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: `{"latitude": ${LATITUDE},`,
		});
		const response = await handler(malformed);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ status: "invalid" });
		expect(logged).toEqual([]);
	});
});
