/**
 * What the cards of the demo report claim, read off the screen.
 *
 * The three sentences here are the ones `.dev/BUILD.md`
 * section A found claiming more than the requests behind them supported: a
 * count of the final National Priorities List taken over a field a partial
 * outage nulls, a five-mile search the registry lookup never made, and a
 * registry record named as a record sharing its own identifier. Two of them are
 * assertions that a string is *absent*, which is worth a browser: the strings
 * were on this page, and nothing between `lib/report/selection.ts` and the
 * rendered card is stubbed here.
 *
 * The report is `DEMO`, the committed bytes for the `.dev/BRIEF.md` A6 row 1
 * address, where all fifteen Envirofacts status requests answer — so the
 * final-NPL count is one the card may state, and does.
 */

import { expect, test } from "@playwright/test";
import { DEMO, reportBody } from "./helpers/bodies";
import { openReport } from "./helpers/drive";

test("every card claims what was asked for, and no more", async ({ page }) => {
	await openReport(page, await reportBody(DEMO));

	// A6 row 1's headline number, on a report the Superfund inventory answered
	// about in full. A card holding a site it did not answer for states no count
	// at all -- see `nplCountHeadline` -- so this sentence is also the assertion
	// that this report is that one.
	const sems = page.locator("[data-source='sems']");
	await expect(sems).toContainText("Sites on the final National Priorities List within 5 miles of the mapped point: 2.");
	await expect(sems).toContainText("US OIL RECOVERY is listed by SEMS. 3.92 km");

	// The registry is asked `where=REGISTRY_ID='...'`, one request per
	// identifier. .dev/BRIEF.md B14 records 6,915 FRS interest rows within five
	// miles of this point, so a card claiming that search claims an area it
	// never queried. The retrieval time is still on the card, in the one
	// sentence that was never about an area.
	const frs = page.locator("[data-source='frs']");
	await expect(frs).toContainText("EPA Facility Registry Service answered with records, retrieved");
	await expect(frs).not.toContainText("Searched within 5 miles of the mapped point");

	// Registry 110000460885 is VALERO PLUME in Envirofacts and HOUSTON REFINERY
	// in the registry: one site under two names, which the cross-reference
	// states and the group sentence did not. The group sentence that stays is
	// two Superfund records that do share one identifier.
	const report = page.locator("main");
	await expect(report).toContainText(
		"PASADENA REFINING FIRE and PRSI FIRE share one EPA facility registry ID, 110000462703.",
	);
	await expect(report).toContainText(
		"EPA's facility registry carries the name HOUSTON REFINERY for registry ID 110000460885.",
	);
	await expect(report).not.toContainText("VALERO PLUME and HOUSTON REFINERY share one EPA facility registry ID");
});
