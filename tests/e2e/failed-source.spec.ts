/**
 * `.dev/BRIEF.md` B12, path 8, and A6 beat 6: one source failed and the report
 * is still worth reading.
 *
 * `FOUR_STATES` is the committed plan that puts every card state on one
 * stream: ECHO answers with records, SEMS answers with nothing, both flood
 * layers refuse, the two air sources fail before the network for want of a
 * credential, and FRS is never asked -- a Superfund layer with no rows names
 * no registry ID, and FRS takes a registry ID rather than a locus, which is
 * the only remaining path to that state now that every other source is asked.
 *
 * What this test asserts is the thing a screenshot cannot: the
 * failed card says it failed and offers a retry, the cards beside it are
 * complete, and a span on one of them still opens its trace. A report that
 * degraded to a spinner, an error page or a silent gap would fail here and
 * nowhere else in the suite.
 */

import { expect, test } from "@playwright/test";
import { FOUR_STATES, reportBody } from "./helpers/bodies";
import { openReport } from "./helpers/drive";

test("one failed source with a usable report", async ({ page }) => {
	await openReport(page, await reportBody(FOUR_STATES));

	// Every source settled, so nothing below is a card that simply has not
	// arrived yet.
	await expect(page.locator("[data-settled]")).toHaveText("Sources settled: 6 of 6.");

	// The failed source says so, in the words of the layer that refused, and
	// offers the one thing there is to offer.
	const flood = page.locator("[data-source='fema']");
	await expect(flood).toHaveAttribute("data-card-state", "unavailable");
	await expect(flood).toContainText(
		"Esri's reduced-set copy of FEMA's National Flood Hazard Layer could not be reached: the host refused the connection.",
	);
	await expect(flood).toContainText("FEMA's National Flood Hazard Layer could not be reached: the host refused the connection.");
	await expect(flood.getByRole("button", { name: "Retry" })).toBeVisible();
	// It claims nothing about the place: a source that could not be reached is
	// not a source that answered with nothing.
	await expect(flood).not.toContainText("No matching records within the stated boundary.");

	// And the rest of the report is fully readable beside it.
	const enforcement = page.locator("[data-source='echo']");
	await expect(enforcement).toHaveAttribute("data-card-state", "records");
	await expect(enforcement).toContainText("Regulated facilities EPA ECHO lists within 5 miles of the mapped point: 7.");
	await expect(enforcement.locator("[data-record='110064116987']")).toContainText("SOUTH COAST TERMINALS PTF");

	// A source that answered with nothing says exactly that, and is not the
	// same card as the one that could not be reached.
	const superfund = page.locator("[data-source='sems']");
	await expect(superfund).toHaveAttribute("data-card-state", "no-records");
	await expect(superfund).toContainText("No matching records within the stated boundary.");

	// And a source nobody asked is a fourth thing again: no status sentence,
	// because no template speaks for a request that was never made.
	const registry = page.locator("[data-source='frs']");
	await expect(registry).toHaveAttribute("data-card-state", "not-asked");
	await expect(registry).toContainText("EPA Facility Registry Service");
	await expect(registry.getByRole("button", { name: "Retry" })).toHaveCount(0);

	// Readable, and still traceable: the panel opens from a card that answered
	// while another card's source is unreachable.
	await enforcement.locator("[data-record='110064116987'] [data-field='subject']").first().click();
	const panel = page.getByRole("dialog", { name: "Trace" });
	await expect(panel).toContainText("EPA Enforcement and Compliance History Online");
	await expect(panel.locator("[data-row='record-ids']")).toContainText("110064116987");
	await expect(flood).toBeVisible();
});
