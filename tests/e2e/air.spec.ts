/**
 * `docs/BRIEF.md` B12, path 7: a distant monitor, with its distance beside the
 * value it reports.
 *
 * WHY THIS ONE NEEDS A PLAN OF ITS OWN. AQS and AirNow are registered sources
 * now (`app/api/report/handler.ts`'s `LOCUS_SOURCES`), and both read a
 * credential out of `process.env` at the point of use: without one the adapter
 * fails before the network and the card states that instead of a monitor. So
 * `helpers/bodies.ts` builds this one body with its own credentials in scope
 * and an io that routes the two air hosts to the committed fixtures. Every
 * other path in this suite is built with those variables removed, so a
 * developer holding a real `AQS_KEY` runs the same eight tests as CI.
 *
 * WHAT THE PATH IS FOR. A2's air card is the one place this product prints a
 * number measured somewhere else, and the distance is the qualification that
 * makes it readable: `lib/templates/aqs.ts` puts "measures its own location,
 * not this address" in the same clause as the distance, so the two cannot be
 * separated on screen. The monitor asserted below is 20.88 km from the mapped
 * point and is in the part of the list the reader has to open -- the nearest
 * PM2.5 monitor, 1.51 km away, is the one shown -- so this test drives the
 * "Show the rest" seam as well.
 */

import { expect, test } from "@playwright/test";
import { AIR_ANSWERED, airReportBody } from "./helpers/bodies";
import { openReport } from "./helpers/drive";

test("a distant monitor", async ({ page }) => {
	await openReport(page, await airReportBody(AIR_ANSWERED));

	const aqs = page.locator("[data-source='aqs']");
	await expect(aqs).toHaveAttribute("data-card-state", "records");
	await expect(aqs).toContainText("EPA Air Quality System");
	await expect(aqs).toContainText("Searched within 50 km of the mapped point");

	// The nearest PM2.5 monitor is the one the card shows.
	const nearest = aqs.locator("[data-record='48-201-1039-88101']");
	await expect(nearest).toContainText(
		"PM2.5 monitor 48-201-1039-88101 is 1.51 km from the mapped point, and measures its own location, not this address.",
	);

	// The distant one is in the rest of that listing.
	await expect(aqs.locator("[data-record='48-201-0416-88101']")).toHaveCount(0);
	await aqs.locator("[data-toggle='aqs:0']").click();

	const distant = aqs.locator("[data-record='48-201-0416-88101']");
	await expect(distant).toContainText(
		"PM2.5 monitor 48-201-0416-88101 is 20.88 km from the mapped point, and measures its own location, not this address.",
	);
	// The distance and the value are the same card's spans, each naming its own
	// field: the reader can see how far away the number was measured.
	await expect(distant.locator("[data-field='distanceMeters']")).toHaveText("20.88 km");
	await expect(distant.locator("[data-field='value']")).toHaveText("8.4");
	await expect(distant.locator("[data-field='unit']")).toHaveText("Micrograms/cubic meter (LC)");
	await expect(distant).toContainText("2025 annual arithmetic mean: 8.4 Micrograms/cubic meter (LC).");
	await expect(distant).toContainText("AQS data lags collection by six months or more.");

	// And the distance is a value with a trace, not a number the card wrote.
	await distant.locator("[data-field='distanceMeters']").click();

	const panel = page.getByRole("dialog", { name: "Trace" });
	await expect(panel).toContainText("EPA Air Quality System");
	await expect(panel.locator("[data-row='record-ids']")).toContainText("48-201-0416-88101");
	const clicked = panel.locator("[data-row='value'][data-presence='clicked']");
	await expect(clicked).toContainText("20.88 km");
	await expect(clicked).toContainText("haversine");
});
