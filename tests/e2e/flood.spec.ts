/**
 * `docs/BRIEF.md` B12, path 6: a FEMA polygon and a FEMA no-polygon state, each
 * naming the dataset that answered.
 *
 * Both halves are one test because the claim is a comparison: the same card,
 * driven twice on the same page, says two different things and names its layer
 * either way. That is B12's requirement and A5's -- a flood answer that does
 * not say which dataset produced it is not an answer a reader can check.
 *
 * WHICH DATASET ANSWERS, AND WHY IT IS ALWAYS ESRI'S COPY. `lib/adapters/fema.ts`
 * asks FEMA's own National Flood Hazard Layer first and falls back to Esri's
 * reduced-set copy. The NFHL host refuses this machine's connections and no
 * response from it has ever been recorded, so the committed plan has it fail
 * and Esri's recorded copy answers -- which is why the prior-attempt line below
 * is part of both states. The NFHL's *own* no-polygon wording ("FEMA's own
 * National Flood Hazard Layer answered with no polygon.") is therefore not
 * reachable from any recorded bytes; see this unit's report.
 *
 * The polygon comes from the Pasadena recording and the point from the Houston
 * one, because those are the bytes that exist: the flood adapter is asked with
 * a point and the recorded layer answers with the polygon it recorded. What is
 * under test here is the card, not the geometry.
 */

import { expect, test } from "@playwright/test";
import { DEMO, reportBody, type Plan } from "./helpers/bodies";
import { openReport } from "./helpers/drive";

const ESRI = "Esri's reduced-set copy of FEMA's National Flood Hazard Layer";
const NFHL_REFUSED = "FEMA's National Flood Hazard Layer could not be reached: the host refused the connection.";

/** `DEMO`, with Esri's copy answering from the recorded Pasadena polygon instead of the recorded empty Houston answer. */
const POLYGON: Plan = { ...DEMO, esri: { fixture: "fema/esri-zone-ae-pasadena.json" } };

test("a FEMA polygon and a FEMA no-polygon state, each naming its dataset", async ({ page }) => {
	await openReport(page, await reportBody(POLYGON));

	const flood = page.locator("[data-source='fema']");
	await expect(flood).toHaveAttribute("data-card-state", "records");
	await expect(flood).toContainText(ESRI);

	const polygon = flood.locator("[data-record='48201C_8563']");
	await expect(polygon).toContainText(
		"The mapped point, a street-segment interpolation rather than a parcel boundary, is in zone AE, " +
			"inside the Special Flood Hazard Area.",
	);
	await expect(polygon.locator("[data-field='zoneCode']")).toHaveText("AE");
	await expect(polygon.locator("[data-field='firmStudyId']")).toHaveText("48201C");
	// The dataset is a span of the sentence, not a footnote: it names itself
	// where the claim is made.
	await expect(polygon.locator("[data-field='datasetLabel']")).toHaveText(ESRI);
	await expect(flood).toContainText(NFHL_REFUSED);

	// The same card, the same layer, the other answer: the recorded Houston
	// reply, in which no polygon intersects the point.
	await openReport(page, await reportBody(DEMO));

	await expect(flood).toHaveAttribute("data-card-state", "no-records");
	await expect(flood).toContainText(
		"No 1% or 0.2% flood hazard polygon intersects this point in the Esri copy of FEMA's layer, dated 2026-03-11. " +
			"This copy omits minimal-hazard areas, so it cannot tell minimal hazard from an unmapped area.",
	);
	await expect(flood).toContainText(NFHL_REFUSED);
	await expect(flood.locator("[data-record='48201C_8563']")).toHaveCount(0);
});
