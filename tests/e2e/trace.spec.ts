/**
 * `docs/BRIEF.md` B12, paths 4 and 5: a sentence on a card, and what stands
 * behind the span the reader clicked.
 *
 * This is A3's promise -- every displayed value traces to the agency, the
 * record, the raw field and the raw value it was read from -- driven the way a
 * judge will drive it: click the underlined date, read the panel. Both paths
 * click a span whose raw value is visibly *not* what is on screen
 * (`2012-06-12 00:00:00` behind `2012-06-12`, `08/12/2024` behind
 * `2024-08-12`), because a trace that only ever showed the value back would
 * prove nothing about where it came from.
 *
 * The report both tests read is `DEMO`: the committed SEMS layer and
 * Envirofacts rows for the Houston point, and the committed ECHO quarter-mile
 * summary and facility page.
 */

import { expect, test } from "@playwright/test";
import { DEMO, reportBody } from "./helpers/bodies";
import { openReport } from "./helpers/drive";

test("a SEMS result with trace to raw field", async ({ page }) => {
	await openReport(page, await reportBody(DEMO));

	const sems = page.locator("[data-source='sems']");
	await expect(sems).toContainText("Superfund sites EPA's inventory lists within 5 miles of the mapped point: 15.");

	const site = sems.locator("[data-record='TXN000607438']");
	await expect(site).toContainText(
		"RHODIA INC., ACID RELEASE, EPA ID TXN000607438. 0.71 km from the mapped point. " +
			"NPL status: Not on the NPL. Non-NPL status: Removal Only Site (No Site Assessment Work Needed). " +
			"Non-NPL status date: 2012-06-12.",
	);

	await site.locator("[data-field='statusDate']").click();

	const panel = page.getByRole("dialog", { name: "Trace" });
	await expect(panel).toBeVisible();
	// The agency, and the EPA site ID the record is keyed by.
	await expect(panel).toContainText("EPA Superfund Enterprise Management System");
	await expect(panel.locator("[data-row='record-ids']")).toContainText("epaSiteId");
	await expect(panel.locator("[data-row='record-ids']")).toContainText("TXN000607438");

	// The clicked value, the raw field it was read from, the bytes EPA sent, and
	// what was done to them.
	const clicked = panel.locator("[data-row='value'][data-presence='clicked']");
	await expect(clicked).toContainText("2012-06-12");
	await expect(clicked).toContainText("envirofacts_site");
	await expect(clicked).toContainText("non_npl_status_date");
	await expect(clicked).toContainText("2012-06-12 00:00:00");
	await expect(clicked).toContainText("normalize-date");

	// The panel closes, and the report is still there behind it.
	await panel.getByRole("button", { name: "Close" }).click();
	await expect(panel).toHaveCount(0);
	await expect(site).toBeVisible();
});

test("an ECHO enforcement result", async ({ page }) => {
	await openReport(page, await reportBody(DEMO));

	const echo = page.locator("[data-source='echo']");
	await expect(echo).toContainText(
		"Facilities within 5 miles with a formal enforcement action in ECHO's facility summary: 1.",
	);

	// The one facility in the committed page fixture that carries one.
	const facility = echo.locator("[data-record='110064116987']");
	await expect(facility).toContainText(
		"Most recent formal enforcement action in ECHO's facility summary for SOUTH COAST TERMINALS PTF: 2024-08-12.",
	);
	await expect(facility).toContainText("Penalties counted in ECHO's facility summary: 1.");

	await facility.locator("[data-field='lastFormalActionDate']").click();

	const panel = page.getByRole("dialog", { name: "Trace" });
	await expect(panel).toBeVisible();
	await expect(panel).toContainText("EPA Enforcement and Compliance History Online");
	await expect(panel.locator("[data-row='record-ids']")).toContainText("110064116987");

	const clicked = panel.locator("[data-row='value'][data-presence='clicked']");
	await expect(clicked).toContainText("lastFormalActionDate");
	await expect(clicked).toContainText("echo_get_qid");
	await expect(clicked).toContainText("FacDateLastFormalAction");
	await expect(clicked).toContainText("08/12/2024");
	await expect(clicked).toContainText("parse-us-date");
});
