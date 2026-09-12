/**
 * Renders each screen component with `react-dom/server`'s
 * `renderToStaticMarkup`, which needs no DOM. `vitest.config.ts` only
 * collects `*.test.ts` files, so this file stays `.ts` and builds elements
 * with `createElement` rather than JSX -- the components themselves are
 * `.tsx` and import fine from here regardless.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CandidatesScreen } from "@/app/components/candidates-screen";
import { ConfirmScreen } from "@/app/components/confirm-screen";
import { NoMatchScreen } from "@/app/components/no-match-screen";
import { SearchScreen } from "@/app/components/search-screen";
import { CURATED_EXAMPLES, type GeocodeMatchView } from "@/app/lib/geocode-contract";
import HomePage from "@/app/page";

const MATCH: GeocodeMatchView = {
	matchedAddress: "9311 E AVE P, HOUSTON, TX, 77012",
	latitude: 29.720658823001,
	longitude: -95.261995884462,
	addressRange: { from: "9301", to: "9399" },
	streetSide: "L",
};

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

	it("ConfirmScreen shows the matched address, the mapped point, and the precision sentence built from the match", () => {
		const html = renderToStaticMarkup(createElement(ConfirmScreen, { match: MATCH, onStartOver: () => undefined }));
		expect(html).toContain("9311 E AVE P, HOUSTON, TX, 77012");
		expect(html).toContain(String(MATCH.latitude));
		expect(html).toContain(String(MATCH.longitude));
		expect(html).toContain(
			"The point sits on the 9301 to 9399 block, left side of the street segment, interpolated by the Census Geocoder. It marks the block, not the parcel.",
		);
	});

	it("CandidatesScreen lists every candidate as its own control and preselects none of them", () => {
		const candidates: readonly GeocodeMatchView[] = [
			{ ...MATCH, matchedAddress: "100 MAIN ST, SPRINGFIELD, MA, 01105" },
			{ ...MATCH, matchedAddress: "100 MAIN ST, SPRINGFIELD, VT, 05156" },
			{ ...MATCH, matchedAddress: "100 MAIN ST, SPRINGFIELD, OH, 45502" },
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

	it("the three screens produce visibly different markup for the same underlying data shape", () => {
		const confirmHtml = renderToStaticMarkup(createElement(ConfirmScreen, { match: MATCH, onStartOver: () => undefined }));
		const candidatesHtml = renderToStaticMarkup(
			createElement(CandidatesScreen, { candidates: [MATCH, { ...MATCH, matchedAddress: "OTHER" }], onChoose: () => undefined, onStartOver: () => undefined }),
		);
		const noMatchHtml = renderToStaticMarkup(createElement(NoMatchScreen, { onEdit: () => undefined }));
		const headings = [confirmHtml, candidatesHtml, noMatchHtml].map((html) => {
			const match = /<h1[^>]*>([^<]*)<\/h1>/.exec(html);
			if (match?.[1] === undefined) throw new Error("expected an h1");
			return match[1];
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
