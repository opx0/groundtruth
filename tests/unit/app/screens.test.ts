/**
 * Renders each screen component with `react-dom/server`'s
 * `renderToStaticMarkup`, which needs no DOM. `vitest.config.ts` only
 * collects `*.test.ts` files, so this file stays `.ts` and builds elements
 * with `createElement` rather than JSX -- the components themselves are
 * `.tsx` and import fine from here regardless.
 *
 * The confirm screen's match is not hand-written: it is what the geocode
 * handler actually returns for the recorded Houston bytes, parsed through the
 * shared schema. So the sentence asserted below is the one
 * `lib/templates/origin.ts` rendered, and a template edit that changes the
 * text fails here as well as in the template's own tests.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SourceIo } from "@/lib/evidence";
import { createGeocodeHandler } from "@/app/api/geocode/handler";
import { CandidatesScreen } from "@/app/components/candidates-screen";
import { ConfirmScreen } from "@/app/components/confirm-screen";
import { NoMatchScreen } from "@/app/components/no-match-screen";
import { SearchScreen } from "@/app/components/search-screen";
import {
	CURATED_EXAMPLES,
	GeocodeApiResponseSchema,
	type GeocodeMatchView,
} from "@/app/lib/geocode-contract";
import HomePage from "@/app/page";

const fixturesDir = fileURLToPath(new URL("../../fixtures/", import.meta.url));
const RETRIEVED_AT = "2026-09-16T12:00:00Z";

function fixtureIo(fixture: string): SourceIo {
	const bytes = readFileSync(`${fixturesDir}${fixture}`);
	const json: unknown = JSON.parse(bytes.toString("utf8"));
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	return {
		get(url, schema) {
			return Promise.resolve({
				raw: schema.parse(json),
				payload: { url: url.toString(), sha256, retrievedAt: RETRIEVED_AT },
			});
		},
		query(parameter, value, adapterVersion, payload) {
			return { kind: "query", parameter, value, adapterVersion, payload };
		},
		now: () => RETRIEVED_AT,
	};
}

/** The Houston demo match, exactly as the route returns it. */
async function houstonMatch(): Promise<GeocodeMatchView> {
	const handler = createGeocodeHandler(fixtureIo("census/match-9311-e-ave-p.json"));
	const response = await handler(
		new Request("http://localhost/api/geocode", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ address: "9311 E Avenue P, Houston, TX 77012" }),
		}),
	);
	const parsed = GeocodeApiResponseSchema.parse(await response.json());
	if (parsed.status !== "matched") throw new Error(`expected a match, got ${parsed.status}`);
	return parsed.match;
}

function confirmHtmlFor(match: GeocodeMatchView): string {
	return renderToStaticMarkup(createElement(ConfirmScreen, { match, onStartOver: () => undefined }));
}

/** Server-rendered spans arrive as separate elements; this is the sentence a reader sees. */
function visibleText(html: string): string {
	return html.replace(/<[^>]*>/g, "");
}

describe("the three outcomes render three different screens", () => {
	it("SearchScreen shows the address field, the privacy note, and the curated examples", () => {
		const html = renderToStaticMarkup(
			createElement(SearchScreen, {
				address: "",
				pending: false,
				error: null,
				examples: CURATED_EXAMPLES,
				onAddressChange: () => undefined,
				onSubmit: () => undefined,
				onExampleSelect: () => undefined,
			}),
		);
		expect(html).toContain("Street address");
		expect(html).toContain("9311 E Ave P, Houston, TX 77012");
		expect(html).toContain("400 N Richey St, Pasadena, TX 77506");
		expect(html).toContain("1300 Perdido St, New Orleans, LA 70112");
		expect(html.toLowerCase()).toContain("census");
		expect(html.toLowerCase()).toContain("point and a distance only");
	});

	it("ConfirmScreen shows the sentences lib/templates/origin.ts rendered, and no sentence of its own", async () => {
		const match = await houstonMatch();
		const text = visibleText(confirmHtmlFor(match));
		expect(text).toContain(
			"Matched: 9311 E AVE P, HOUSTON, TX, 77012." +
				" The point sits on the 9301 to 9399 block, street side L," +
				" interpolated by the Census Geocoder along TIGER line 96085986." +
				" It marks the block, not the parcel.",
		);
		expect(text).toContain("Mapped point: 29.720658823001, -95.261995884462.");
		// The words the hand-written sentence used, which the Census does not.
		expect(text).not.toContain("left side of the street segment");
	});

	it("ConfirmScreen names the field behind every span that has one, for the trace panel to hang a click on", async () => {
		const match = await houstonMatch();
		const html = confirmHtmlFor(match);
		const fields = [...html.matchAll(/data-field="([^"]+)"/g)].map((hit) => hit[1]);
		expect(fields).toEqual([
			"matchedAddress",
			"blockFrom",
			"blockTo",
			"streetSide",
			"tigerLineId",
			"latitude",
			"longitude",
		]);
	});

	it("ConfirmScreen shows one paragraph fewer when a sentence did not render, and writes nothing in its place", async () => {
		const match = await houstonMatch();
		const [first] = match.origin;
		if (first === undefined) throw new Error("expected a rendered sentence");

		// What the screen shows if `origin/point@1` had rendered null: the other
		// sentence, and nothing standing in for the missing one.
		const withoutPoint = visibleText(confirmHtmlFor({ ...match, origin: [first] }));
		expect(withoutPoint).toContain("It marks the block, not the parcel.");
		expect(withoutPoint).not.toContain("Mapped point");

		// And if every sentence dropped: the heading, the note and the control,
		// with no substitute prose about the match at all.
		const empty = visibleText(confirmHtmlFor({ ...match, origin: [] }));
		expect(empty).toContain("Match confirmed");
		expect(empty).toContain("Search another address");
		expect(empty).not.toContain("9311");
		expect(empty).not.toContain("block");
		expect(empty).not.toContain("Census");
	});

	it("CandidatesScreen lists every candidate as its own control and preselects none of them", async () => {
		const match = await houstonMatch();
		const candidates: readonly GeocodeMatchView[] = [
			{ ...match, matchedAddress: "100 MAIN ST, SPRINGFIELD, MA, 01105" },
			{ ...match, matchedAddress: "100 MAIN ST, SPRINGFIELD, VT, 05156" },
			{ ...match, matchedAddress: "100 MAIN ST, SPRINGFIELD, OH, 45502" },
		];
		const html = renderToStaticMarkup(
			createElement(CandidatesScreen, { candidates, onChoose: () => undefined, onStartOver: () => undefined }),
		);
		for (const candidate of candidates) expect(html).toContain(candidate.matchedAddress);
		// No `checked`, `selected`, or `aria-pressed="true"` attribute anywhere: nothing is preselected.
		expect(html).not.toMatch(/checked|selected|aria-pressed="true"/);
	});

	it("NoMatchScreen asks for a fuller address without implying the address does not exist", () => {
		const html = renderToStaticMarkup(createElement(NoMatchScreen, { onEdit: () => undefined }));
		const lower = html.toLowerCase();
		expect(lower).toContain("street number");
		expect(lower).toContain("city");
		expect(lower).toContain("state");
		expect(lower).toContain("zip");
		// The B10 gap this fixture exists to name: EPA lists facilities at 9400
		// Clinton Dr, so the copy must not read as a claim the place is fictional.
		expect(lower).not.toMatch(/does not exist|doesn't exist|no such address|not a real address|not a valid address/);
		expect(lower).not.toContain("safe");
		expect(lower).not.toContain("risk");
	});

	it("the three screens produce visibly different markup for the same underlying data shape", async () => {
		const match = await houstonMatch();
		const confirmHtml = confirmHtmlFor(match);
		const candidatesHtml = renderToStaticMarkup(
			createElement(CandidatesScreen, {
				candidates: [match, { ...match, matchedAddress: "OTHER" }],
				onChoose: () => undefined,
				onStartOver: () => undefined,
			}),
		);
		const noMatchHtml = renderToStaticMarkup(createElement(NoMatchScreen, { onEdit: () => undefined }));
		const headings = [confirmHtml, candidatesHtml, noMatchHtml].map((html) => {
			const found = /<h1[^>]*>([^<]*)<\/h1>/.exec(html);
			if (found?.[1] === undefined) throw new Error("expected an h1");
			return found[1];
		});
		expect(new Set(headings).size).toBe(3);
	});
});

describe("the app's initial render", () => {
	it("starts on the search screen with no committed match anywhere", () => {
		const html = renderToStaticMarkup(createElement(HomePage));
		expect(html).toContain("Ground Truth");
		expect(html).toContain("Street address");
		expect(html).not.toContain("Match confirmed");
	});
});
