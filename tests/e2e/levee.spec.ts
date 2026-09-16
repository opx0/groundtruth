/**
 * `.dev/BRIEF.md` A6 row 3's flood half: FEMA's zone X levee subtype, on the
 * screen, in FEMA's own words, and openable to the column it was read from.
 *
 * WHY THIS PATH EXISTS. `.dev/BUILD.md` and `.dev/BUILD.md` record the gap it
 * closes in the same words -- the zone X levee subtype, "the one verbatim
 * agency string A6 puts on screen for that address", was asserted only in unit
 * tests. The bytes are `tests/fixtures/fema/esri-zone-x-levee-neworleans.json`:
 * one polygon, `FLD_ZONE: "X"`, `SFHA_TF: "F"`, `ZONE_SUBTY: "Area With
 * Reduced Flood Risk Due To Levee"`. `.dev/BRIEF.md` B14's row for that answer
 * carries a dated correction -- it had recorded a 0.2% annual chance subtype --
 * so every string asserted below is read off the committed bytes and off
 * `lib/templates/fema.ts`, never off that log row.
 *
 * WHAT IS NOT DRIVEN HERE, AND WHY NOT. A6 row 3 is an address, 1300 Perdido
 * St, New Orleans, and two claims about it: this subtype, and 19 SEMS sites
 * within 5 miles. Neither the Census reply for that address nor a Superfund
 * radius answer for that point has ever been recorded -- `tests/fixtures/census/`
 * holds three files and none of them is New Orleans, and `tests/fixtures/sems/`
 * holds one radius answer, the Houston one. So the reader below types the
 * Houston demo address, the mapped point is Houston's, and the flood layer
 * answers with the New Orleans polygon it really recorded. That is the seam
 * `flood.spec.ts` already states for the Pasadena polygon and it is stated for
 * the same reason: what is under test is the card, not the geometry. Putting
 * the address itself on the confirm screen needs a recorded
 * `census/match-1300-perdido-st.json`, and the count needs a recorded Superfund
 * layer answer for that point. Authoring either would be inventing government
 * bytes, which is the one thing this repository refuses to do, so neither claim
 * is asserted here rather than asserted against something convenient.
 */

import { expect, test } from "@playwright/test";
import { DEMO, reportBody, type Plan } from "./helpers/bodies";
import { AT_PERDIDO, openReport, search } from "./helpers/drive";

/** `DEMO`, with Esri's copy answering from the recorded New Orleans polygon instead of the recorded empty Houston answer. */
const LEVEE: Plan = { ...DEMO, esri: { fixture: "fema/esri-zone-x-levee-neworleans.json" } };

/** FEMA's string, character for character. A6 says "shown verbatim" and this is the whole of what that means. */
const SUBTYPE = "Area With Reduced Flood Risk Due To Levee";

/** The polygon's own key in the layer, which is what the card keys the record by. */
const FLOOD_AREA = "22071C_10770";

/**
 * The whole of `fema-flood-zone/summary@1` over this row, as one rendered
 * sentence. Written out rather than sampled: a clause quietly dropping is
 * exactly the failure this path exists to catch, and a substring cannot see it.
 */
const ZONE_X_SENTENCE =
	"The mapped point, a street-segment interpolation rather than a parcel boundary, is in zone X, " +
	"outside the Special Flood Hazard Area." +
	` The zone subtype recorded for this area is ${SUBTYPE}.` +
	" FEMA's FIRM study identifier for this area is 22071C." +
	` The flood area ID recorded for this area is ${FLOOD_AREA}.` +
	" The source-citation lookup key recorded for this area is 22071C_STUDY13." +
	" Read from Esri's reduced-set copy of FEMA's National Flood Hazard Layer.";

test("the zone X levee subtype, verbatim on the flood card", async ({ page }) => {
	await openReport(page, await reportBody(LEVEE), AT_PERDIDO);

	const flood = page.locator("[data-source='fema']");
	await expect(flood).toHaveAttribute("data-card-state", "records");

	const polygon = flood.locator(`[data-record='${FLOOD_AREA}']`);
	await expect(polygon).toContainText(ZONE_X_SENTENCE);

	// The subtype is a span of its own, and its text is the agency's string with
	// nothing added to it and nothing taken off: no expansion, no gloss, no
	// second name for a levee.
	await expect(polygon.locator("[data-field='zoneSubtype']")).toHaveText(SUBTYPE);

	// The two facts the subtype qualifies, each read from its own column: the
	// zone letter, and SFHA_TF read as F.
	await expect(polygon.locator("[data-field='zoneCode']")).toHaveText("X");
	await expect(polygon.locator("[data-field='sfhaLabel']")).toHaveText("outside the Special Flood Hazard Area");
});

test("the levee subtype opens on the column FEMA sent it in", async ({ page }) => {
	await openReport(page, await reportBody(LEVEE), AT_PERDIDO);

	const polygon = page.locator(`[data-source='fema'] [data-record='${FLOOD_AREA}']`);
	await polygon.locator("[data-field='zoneSubtype']").click();

	const panel = page.getByRole("dialog", { name: "Trace" });
	await expect(panel).toBeVisible();
	await expect(panel).toContainText("FEMA National Flood Hazard Layer");
	await expect(panel.locator("[data-row='record-ids']")).toContainText(FLOOD_AREA);

	// A3's promise for the one string A6 shows verbatim: the slot, the layer
	// that answered, the column, and the bytes in it. The displayed string and
	// the raw string are the same string under an `identity` transform, which is
	// the whole of what "verbatim" claims -- no expansion, no mapping, nothing
	// this codebase composed on the way to the screen.
	const clicked = panel.locator("[data-row='value'][data-presence='clicked']");
	await expect(clicked).toContainText("zoneSubtype");
	await expect(clicked).toContainText("esri_usa_flood_hazard_reduced_set");
	await expect(clicked).toContainText("ZONE_SUBTY");
	await expect(clicked).toContainText(SUBTYPE);
	await expect(clicked).toContainText("identity");
});

/**
 * The address itself, not the point behind it.
 *
 * Until `tests/fixtures/census/` gained this match on 2026-09-17 this path
 * drove the Houston coordinate and said so in its header, because A6 row 3's
 * address could not reach the confirm screen at all. It can now, so the seam
 * this file is about starts where a reader starts.
 */
test("A6 row 3's address reaches the confirm screen as the reader typed it", async ({ page }) => {
	await search(page, AT_PERDIDO.fixture, AT_PERDIDO.address);

	await expect(page.getByRole("heading", { name: "Match confirmed" })).toBeVisible();
	await expect(page.locator("[data-field='matchedAddress']")).toHaveText("1300 PERDIDO ST, NEW ORLEANS, LA, 70112");
	await expect(page.locator("[data-field='blockFrom']")).toHaveText("1200");
	await expect(page.locator("[data-field='blockTo']")).toHaveText("1416");
	await expect(page.locator("[data-field='streetSide']")).toHaveText("L");
	await expect(page.locator("[data-field='tigerLineId']")).toHaveText("637842040");

	// The point the report is then asked with, stated on the screen that asks
	// the reader to confirm it.
	await expect(page.locator("[data-field='latitude']")).toHaveText("29.952439235888");
	await expect(page.locator("[data-field='longitude']")).toHaveText("-90.076572135869");
});
