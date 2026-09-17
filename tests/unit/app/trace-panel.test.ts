/**
 * The trace panel, rendered over a real stream.
 *
 * Every sentence the panel is opened on here came out of `createReportHandler`
 * over the committed fixture bytes and back through `ReportEventSchema`, so
 * nothing below is opened on an invented card. `vitest.config.ts` collects only
 * `*.test.ts`, so this file builds elements with `createElement` rather than
 * JSX, exactly as `tests/unit/app/screens.test.ts` does.
 *
 * THE TEST THIS FILE EXISTS FOR IS `no component wrote a factual sentence`.
 * The panel's markup keeps its two kinds of string in different elements: a
 * `<dt>`, an `<h2>`, an `<h3>` and the one `<button>` are chrome the component
 * wrote; every other text node is a string the server put on the wire. So the
 * test can collect every text node the panel produces, split it on that rule,
 * and check the chrome against an enumerated list and the rest against the
 * strings that actually crossed the wire. A component that started composing a
 * sentence out of wire values fails the second half; a component that started
 * writing a claim of its own fails the first.
 *
 * The stream harness is the same fifty lines as `trace-view.test.ts` and
 * `report-route.test.ts`. It is duplicated rather than shared because a new
 * shared path under `tests/unit/app/` is the one file two agents working in
 * disjoint sets could collide on.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { SourceFailure } from "@/lib/evidence";
import type { Fetched, JsonValue, PayloadRef, SourceIo } from "@/lib/evidence";
import { createReportHandler } from "@/app/api/report/handler";
import { CHROME, TracePanel } from "@/app/components/trace-panel";
import { ReportEventSchema, type ReportEvent, type SentenceViewMessage } from "@/app/lib/report-contract";
import { openableSpans } from "@/app/lib/trace-view";
import { censusOrigin } from "../evidence/helpers/sems-fixtures";

const fixturesDir = fileURLToPath(new URL("../../fixtures/", import.meta.url));
const RETRIEVED_AT = "2026-09-16T09:00:00Z";
const HOUSTON = censusOrigin();

/* -------------------------------------------------------------------------- */
/* The stream, from the committed bytes through the real route                */
/* -------------------------------------------------------------------------- */

type Answer = { readonly fixture: string } | { readonly derived: string; readonly body: JsonValue } | { readonly fail: SourceFailure };

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

/* -------------------------------------------------------------------------- */
/* Rendering, and reading the markup back                                     */
/* -------------------------------------------------------------------------- */

function panelHtml(sentence: SentenceViewMessage, spanIndex: number): string {
	return renderToStaticMarkup(
		createElement(TracePanel, { selection: { sentence, spanIndex }, onClose: () => undefined }),
	);
}

/** The first span a reader can open, which is the one the demo clicks. */
function firstOpenable(sentence: SentenceViewMessage): number {
	const [index] = openableSpans(sentence);
	if (index === undefined) throw new Error(`no slotted span in ${textOf(sentence)}`);
	return index;
}

const ENTITIES: ReadonlyMap<string, string> = new Map([
	["&amp;", "&"],
	["&lt;", "<"],
	["&gt;", ">"],
	["&quot;", '"'],
	["&#x27;", "'"],
	["&#39;", "'"],
]);

function unescaped(text: string): string {
	return text.replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, (entity) => ENTITIES.get(entity) ?? entity);
}

type TextNode = { readonly text: string; readonly chrome: boolean };

/** Elements whose text this component wrote. Everything else on the panel is the wire's. */
const CHROME_TAGS: ReadonlySet<string> = new Set(["dt", "h2", "h3", "button"]);

/**
 * Every text node of the markup, each marked with whether it sits inside a
 * chrome element. A tiny tokenizer rather than a DOM: `vitest.config.ts` runs
 * in `node` with no document, and the panel's markup is generated by React and
 * so has no stray angle brackets to confuse one.
 */
function textNodes(html: string): readonly TextNode[] {
	const out: TextNode[] = [];
	const stack: string[] = [];
	const pattern = /<\/?([a-zA-Z0-9]+)[^>]*?(\/?)>|([^<]+)/g;
	for (const match of html.matchAll(pattern)) {
		const [whole, tag, selfClosing, text] = match;
		if (text !== undefined) {
			const trimmed = unescaped(text).trim();
			if (trimmed !== "") out.push({ text: trimmed, chrome: stack.some((name) => CHROME_TAGS.has(name)) });
			continue;
		}
		if (tag === undefined) continue;
		if (whole.startsWith("</")) {
			const last = stack.lastIndexOf(tag);
			if (last !== -1) stack.splice(last, 1);
		} else if (selfClosing !== "/" && !["br", "img", "input", "hr", "meta", "link"].includes(tag)) {
			stack.push(tag);
		}
	}
	return out;
}

/**
 * Every string that crossed the wire inside this sentence, at any depth, plus
 * the JSON rendering of every non-string leaf -- `755`, `null`, `false` -- which
 * is how the panel shows a raw value that is not a string.
 */
function wireStrings(value: unknown): ReadonlySet<string> {
	const out = new Set<string>();
	const walk = (node: unknown): void => {
		if (typeof node === "string") {
			out.add(node);
			// A connective span carries the template's own spacing -- " answered "
			// -- and a text node read back out of the markup is trimmed.
			out.add(node.trim());
			return;
		}
		if (node === null || typeof node === "number" || typeof node === "boolean") {
			out.add(JSON.stringify(node));
			return;
		}
		if (Array.isArray(node)) {
			for (const item of node) walk(item);
			return;
		}
		if (typeof node === "object") {
			out.add(JSON.stringify(node));
			for (const item of Object.values(node)) walk(item);
		}
	};
	walk(value);
	return out;
}

const CHROME_STRINGS: ReadonlySet<string> = new Set(Object.values(CHROME));

/* -------------------------------------------------------------------------- */
/* What a reader sees                                                         */
/* -------------------------------------------------------------------------- */

describe("clicking a record sentence opens the agency, the record, the raw field and the raw value", () => {
	it("shows A3's rows for the VALERO PLUME sentence", async () => {
		const sentences = everySentence(await houstonEvents());
		const sentence = sentenceSaying(sentences, "VALERO PLUME");
		const html = panelHtml(sentence, firstOpenable(sentence));

		expect(html).toContain("EPA Superfund Enterprise Management System");
		expect(html).toContain("TXN000622182");
		expect(html).toContain("0622182");
		expect(html).toContain("110000460885");
		expect(html).toContain("https://cumulis.epa.gov/supercpad/cursites/csitinfo.cfm?id=0622182");
		expect(html).toContain("npl_status_name");
		expect(html).toContain("non_npl_status_date");
		expect(html).toContain("2022-02-08 00:00:00");
		expect(html).toContain("normalize-date");
		expect(html).toContain("parse-epoch-ms");
		expect(html).toContain("1710413511000");
		expect(html).toContain("haversine");
		expect(html).toContain("CENTER OF A FACILITY OR STATION");
		expect(html).toContain("sems@1");
		expect(html).toContain("A SEMS record can mean assessment, proposed action, active cleanup, or completed work.");
		// The clicked span is marked, and every span of the sentence keeps its field.
		expect(html).toContain('data-clicked="true"');
		expect(html).toContain('data-field="subject"');
		expect(html).toContain('data-scope="record"');
	});

	it("shows the counted records behind a count and the outcome behind a status", async () => {
		const sentences = everySentence(await houstonEvents());

		const count = sentenceSaying(sentences, "Superfund sites EPA's inventory lists within");
		const countHtml = panelHtml(count, firstOpenable(count));
		expect(countHtml).toContain('data-scope="section"');
		expect(countHtml).toContain(CHROME.counted);
		expect(countHtml).toContain("TXN000622182");
		expect(countHtml).toContain("5 miles");
		// The boundary is our wording; the request the adapter issued is what a
		// reader can check it against, so it is cited under the boundary the way
		// a raw field is cited under a record's value.
		expect(countHtml).toContain('data-provenance="query"');
		expect(countHtml).toContain("fixture:sems/arcgis-5mi-houston.json");

		// Named, not taken first: three sources on this report could not be
		// reached, and the other two -- the air sources this deployment holds no
		// credential for -- fail with a different cause.
		const failed = sentenceSaying(sentences, "FEMA's National Flood Hazard Layer could not be reached");
		const failedHtml = panelHtml(failed, firstOpenable(failed));
		expect(failedHtml).toContain('data-scope="source"');
		expect(failedHtml).toContain("unavailable");
		expect(failedHtml).toContain("refused");
		// React escapes the apostrophe in FEMA's, so the comparison is against
		// the markup as a reader sees it rather than as it is serialized.
		expect(unescaped(failedHtml)).toContain("FEMA's National Flood Hazard Layer");

		const group = sentenceSaying(sentences, "share one EPA facility registry ID");
		const groupHtml = panelHtml(group, firstOpenable(group));
		expect(groupHtml).toContain('data-scope="group"');
		expect(groupHtml).toContain(CHROME.grouped);
		expect(groupHtml).toContain("frsRegistryId");
		expect(groupHtml).toContain("TXN000607355");
	});

	it("opens nothing on the template's own connective text", async () => {
		const sentences = everySentence(await houstonEvents());
		const sentence = sentenceSaying(sentences, "VALERO PLUME");
		const connective = sentence.spans.findIndex((span) => span.slot === null);
		expect(connective).toBeGreaterThan(-1);
		expect(panelHtml(sentence, connective)).toBe("");
	});
});

/* -------------------------------------------------------------------------- */
/* Every span of every sentence, walked                                       */
/* -------------------------------------------------------------------------- */

describe("every slotted span of every card opens a panel that names what is behind it", () => {
	it("names the agency or the members, an identifier, the field and the value, span by span", async () => {
		const sentences = everySentence(await houstonEvents());
		let opened = 0;
		// Counted apart: the two air sources this deployment holds no credential
		// for carry one `source/unavailable@1` sentence each, three slotted spans
		// apiece, and they are the whole of the difference between the 172 the
		// brief's audit took -- when those two were `not-asked` and carried no
		// sentence at all -- and the 173 below, which is five short of 178: the
		// registry card's boundary and retrieval time, over a lookup by registry
		// ID that searched no area, and the three spans of a group sentence
		// naming the registry's own record of an identifier as a sharer of it.
		//
		// Two more came off on 2026-09-17, which is the difference between that
		// 173 and the 171 below: `sems-site/npl@1` stopped printing
		// `semsNplStatus`, one span on each of the two final-NPL sites, because
		// the site that is in both SEMS listings had its status printed twice.
		// The value is still on the card, under `summary@1`'s own clause and in
		// the section headline, and still in the trace behind every SEMS
		// sentence -- a slot with no span is listed there like any other.
		let onNotConfigured = 0;
		for (const sentence of sentences) {
			const trace = sentence.trace;
			if (trace === null) throw new Error(`no trace on ${textOf(sentence)}`);
			const notConfigured = trace.scope === "source" && trace.source.cause === "not-configured";
			for (const index of openableSpans(sentence)) {
				const span = sentence.spans[index];
				const field = span?.slot?.field;
				if (span === undefined || field === undefined) throw new Error("a slotted span lost its slot");
				const html = unescaped(panelHtml(sentence, index));
				const where = `${textOf(sentence)} @${index}`;
				opened += 1;
				if (notConfigured) onNotConfigured += 1;

				// The agency, where the scope carries one. `group` carries none, and
				// names its member records instead.
				if (trace.scope === "record") expect(html, where).toContain(trace.record.agency);
				if (trace.scope === "section") expect(html, where).toContain(trace.section.agency);
				if (trace.scope === "source") expect(html, where).toContain(trace.source.agency);

				// The record, or the records this claim is about.
				const ids =
					trace.scope === "record"
						? [trace.record.sourceRecordId]
						: trace.scope === "section"
							? trace.section.counted.map((id) => id.sourceRecordId)
							: trace.scope === "group"
								? trace.group.members.map((id) => id.sourceRecordId)
								: [];
				if (trace.scope === "source") {
					expect(html, where).toContain(trace.source.status);
				} else {
					// A record and a group always name records. A section names the
					// records it counted, and the flood card's no-polygon section
					// counted none -- which is the claim, not a gap.
					if (trace.scope !== "section") expect(ids.length, where).toBeGreaterThan(0);
					for (const id of ids) expect(html, where).toContain(id);
				}

				// The raw field the span was read from, and the value as shown.
				expect(html, where).toContain(field);
				expect(html, where).toContain(span.text);
				const value = trace.values.find((entry) => entry.field === field);
				for (const entry of value?.provenance ?? []) {
					if (entry.kind === "field" || entry.kind === "absent") expect(html, where).toContain(entry.sourceField);
				}
			}
		}
		expect(onNotConfigured).toBe(6);
		expect(opened).toBe(171);
	});
});

/* -------------------------------------------------------------------------- */
/* Nothing on this screen was written by a component                          */
/* -------------------------------------------------------------------------- */

describe("no rendered string outside a span was written by a component", () => {
	it("splits every text node into enumerated chrome and strings that crossed the wire", async () => {
		const sentences = everySentence(await houstonEvents());
		const unexpectedChrome = new Set<string>();
		const unexpectedWire = new Set<string>();
		let checked = 0;

		// The same split as above: 172 spans, plus the three each on the two
		// cards this deployment holds no credential for.
		let onNotConfigured = 0;
		for (const sentence of sentences) {
			const wire = wireStrings(sentence);
			const notConfigured = sentence.trace?.scope === "source" && sentence.trace.source.cause === "not-configured";
			for (const index of openableSpans(sentence)) {
				checked += 1;
				if (notConfigured) onNotConfigured += 1;
				for (const node of textNodes(panelHtml(sentence, index))) {
					if (node.chrome) {
						if (!CHROME_STRINGS.has(node.text)) unexpectedChrome.add(node.text);
					} else if (!wire.has(node.text)) {
						unexpectedWire.add(node.text);
					}
				}
			}
		}

		expect(onNotConfigured).toBe(6);
		expect(checked).toBe(171);
		expect([...unexpectedChrome]).toEqual([]);
		expect([...unexpectedWire]).toEqual([]);
	});

	it("enumerates the chrome, which is every string this component can write", () => {
		expect(Object.values(CHROME)).toEqual([
			"Trace",
			"Close",
			"Agency",
			"Record kind",
			"Source",
			"Record IDs",
			"Records counted",
			"Records grouped",
			"Original record",
			"Boundary",
			"Status",
			"Cause",
			"Code",
			"Retry after",
			"Grouped by",
			"Field",
			"As shown",
			"Normalized",
			"Dataset",
			"Raw field",
			"Raw value",
			"Transform",
			"Adapter",
			"Parameter",
			"Formula",
			"Computed by",
			"Input",
			"Value",
			"Payload",
			"SHA-256",
			"Retrieved",
			"Record date",
			"Source updated",
			"Caveats",
			"Not shown in this sentence",
		]);
	});
});

/* -------------------------------------------------------------------------- */
/* .dev/BRIEF.md C2                                                           */
/* -------------------------------------------------------------------------- */

/** Every phrase and every distinctive word of .dev/BRIEF.md C2, plus the two words A5 bans from the renderer. */
const FORBIDDEN: readonly string[] = [
	"operating polluters near your home",
	"polluter",
	"any us address",
	"parcel-level",
	"flood risk",
	"no records means safe",
	"safe",
	"unsafe",
	"the ai cannot hallucinate",
	"hallucinat",
	"personal exposure",
	"exposure",
	"real-time",
	"every source is complete and correct",
	"likely cause",
	"risk score",
	"score",
	"cumulative",
];

describe(".dev/BRIEF.md C2's words never appear", () => {
	it("greps every panel the demo report can open", async () => {
		const sentences = everySentence(await houstonEvents());
		const hits: string[] = [];
		for (const sentence of sentences) {
			for (const index of openableSpans(sentence)) {
				const html = unescaped(panelHtml(sentence, index)).toLowerCase();
				for (const word of FORBIDDEN) {
					if (html.includes(word)) hits.push(`${word} in ${textOf(sentence)} @${index}`);
				}
			}
		}
		expect(hits).toEqual([]);
	});

	it("greps the chrome itself, which is the only part a component chose", () => {
		const chrome = Object.values(CHROME).join(" ").toLowerCase();
		for (const word of FORBIDDEN) expect(chrome).not.toContain(word);
	});
});
