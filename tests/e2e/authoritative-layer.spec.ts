/**
 * `.dev/BRIEF.md` A6 row 2's flood half, read from the layer the demonstration
 * will actually be run against: zone AE, inside the Special Flood Hazard Area,
 * out of FEMA's own National Flood Hazard Layer rather than Esri's copy of it.
 *
 * WHY IT IS A PATH OF ITS OWN. `flood.spec.ts` drives the same designation from
 * `fema/esri-zone-ae-pasadena.json`, under a plan in which FEMA's own host
 * refuses, and its header gives the reason: "no response from it has ever been
 * recorded". One has been since. `hazards.fema.gov` answered from `us-central1`
 * on 2026-09-17 and `tests/fixtures/fema/nfhl-zone-ae-pasadena.json` is what it
 * sent. Unit tests read those bytes; no browser had, so no test had ever put a
 * flood card on a screen without the fallback behind it.
 *
 * What a browser sees is two differences, and both are what the card says about
 * itself rather than about the place: the dataset clause names FEMA's own
 * service where the other card names Esri's copy, and there is no prior-attempt
 * sentence at all, because nothing failed. One `SourceId`, two layers, and a
 * reader who cannot tell which one answered cannot check the answer.
 *
 * WHAT IS NOT DRIVEN HERE. A6 row 2 is 400 N Richey St, Pasadena, and its other
 * claim is the final-NPL site U.S. OIL RECOVERY 183 m from the mapped point.
 * That distance is a haversine from the Pasadena point, and no Census reply for
 * that address and no Superfund radius answer for that point has ever been
 * recorded: `tests/fixtures/census/` has three files, none of them Pasadena,
 * and the one committed Superfund radius answer is the Houston one, where the
 * same site is 3.92 km away and is already asserted in `claims.spec.ts`.
 * Asserting 3.92 km under this address would be asserting the wrong number
 * because it is the one available, so the NPL half of the row is left undriven
 * until the two recordings exist. The mapped point below is Houston's, for the
 * same reason `flood.spec.ts` gives: the recorded layer answers with the
 * polygon it recorded, and what is under test is the card, not the geometry.
 */

import { expect, test } from "@playwright/test";
import { DEMO, reportBody, type Plan } from "./helpers/bodies";
import { AT_RICHEY, openReport, search } from "./helpers/drive";

/** `DEMO`, with FEMA's own layer answering instead of refusing the connection. Esri is then never asked. */
const AUTHORITATIVE: Plan = { ...DEMO, nfhl: { fixture: "fema/nfhl-zone-ae-pasadena.json" } };

/** This polygon's key in FEMA's own layer. The Esri row `flood.spec.ts` drives is a different polygon with the same zone, keyed `48201C_8563`. */
const FLOOD_AREA = "48201C_9306";

const NFHL = "FEMA's National Flood Hazard Layer";
const ESRI = "Esri's reduced-set copy of FEMA's National Flood Hazard Layer";

/** The whole of `fema-flood-zone/summary@1` over FEMA's own row: no subtype clause, because `ZONE_SUBTY` is null in it. */
const ZONE_AE_SENTENCE =
	"The mapped point, a street-segment interpolation rather than a parcel boundary, is in zone AE, " +
	"inside the Special Flood Hazard Area." +
	" FEMA's FIRM study identifier for this area is 48201C." +
	` The flood area ID recorded for this area is ${FLOOD_AREA}.` +
	" The source-citation lookup key recorded for this area is 48201C_FIRM1." +
	` Read from ${NFHL}.`;

test("zone AE inside the SFHA, named to FEMA's own layer and not to Esri's copy", async ({ page }) => {
	await openReport(page, await reportBody(AUTHORITATIVE), AT_RICHEY);

	const flood = page.locator("[data-source='fema']");
	await expect(flood).toHaveAttribute("data-card-state", "records");

	const polygon = flood.locator(`[data-record='${FLOOD_AREA}']`);
	await expect(polygon).toContainText(ZONE_AE_SENTENCE);

	// The clause that carries the whole difference: the dataset names itself
	// where the claim is made, and here it is the authoritative service.
	await expect(polygon.locator("[data-field='datasetLabel']")).toHaveText(NFHL);
	await expect(polygon.locator("[data-field='zoneCode']")).toHaveText("AE");
	await expect(polygon.locator("[data-field='sfhaLabel']")).toHaveText("inside the Special Flood Hazard Area");

	// Nothing on this card came from the copy, and nothing on it reports a
	// failure: the layer that answered is the one that was asked first.
	await expect(flood).not.toContainText(ESRI);
	await expect(flood).not.toContainText("could not be reached");
});

/**
 * The address itself, not the point behind it.
 *
 * Until `tests/fixtures/census/` gained this match on 2026-09-17 this path
 * drove the Houston coordinate and said so in its header, because A6 row 2's
 * address could not reach the confirm screen at all. It can now, so the seam
 * this file is about starts where a reader starts.
 */
test("A6 row 2's address reaches the confirm screen as the reader typed it", async ({ page }) => {
	await search(page, AT_RICHEY.fixture, AT_RICHEY.address);

	await expect(page.getByRole("heading", { name: "Match confirmed" })).toBeVisible();
	await expect(page.locator("[data-field='matchedAddress']")).toHaveText("400 N RICHEY ST, PASADENA, TX, 77506");
	await expect(page.locator("[data-field='blockFrom']")).toHaveText("400");
	await expect(page.locator("[data-field='blockTo']")).toHaveText("498");
	await expect(page.locator("[data-field='streetSide']")).toHaveText("R");
	await expect(page.locator("[data-field='tigerLineId']")).toHaveText("657372840");

	// The point the report is then asked with, stated on the screen that asks
	// the reader to confirm it.
	await expect(page.locator("[data-field='latitude']")).toHaveText("29.717476102334");
	await expect(page.locator("[data-field='longitude']")).toHaveText("-95.219949564692");
});
