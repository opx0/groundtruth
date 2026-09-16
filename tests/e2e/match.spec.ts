/**
 * `.dev/BRIEF.md` B12, paths 1 to 3: the three outcomes the Census Geocoder can
 * give an address, each driven through the real screens in a real browser.
 *
 * What these three add to the 600-odd unit tests is the wiring: that the
 * response the route built is parsed, reduced and rendered on the screen the
 * outcome belongs to, and that the one screen with a question on it -- several
 * candidates -- does not answer it for the reader.
 */

import { expect, test } from "@playwright/test";
import { CENSUS } from "./helpers/bodies";
import { HOUSTON, search } from "./helpers/drive";

/**
 * The whole of `origin/match@1`, rendered by `lib/templates/origin.ts` from the
 * committed Census reply. Written out here because it is what a reader sees,
 * and because a template that stops saying it is what this test exists to
 * catch.
 */
const BLOCK_SENTENCE =
	"Matched: 9311 E AVE P, HOUSTON, TX, 77012. The point sits on the 9301 to 9399 block, street side L, " +
	"interpolated by the Census Geocoder along TIGER line 96085986. It marks the block, not the parcel.";

test("a precise match", async ({ page }) => {
	await search(page, CENSUS.match, HOUSTON);

	await expect(page.getByRole("heading", { name: "Match confirmed" })).toBeVisible();
	await expect(page.getByText(BLOCK_SENTENCE)).toBeVisible();

	// Not just the text: every fact in that sentence is a span naming the Census
	// field behind it, which is what the trace panel hangs on and what
	// distinguishes a rendered sentence from prose a screen wrote.
	await expect(page.locator("[data-field='matchedAddress']")).toHaveText("9311 E AVE P, HOUSTON, TX, 77012");
	await expect(page.locator("[data-field='blockFrom']")).toHaveText("9301");
	await expect(page.locator("[data-field='blockTo']")).toHaveText("9399");
	await expect(page.locator("[data-field='streetSide']")).toHaveText("L");
	await expect(page.locator("[data-field='tigerLineId']")).toHaveText("96085986");

	// The point the report will be asked with, stated on the screen that asks
	// the reader to confirm it.
	await expect(page.locator("[data-field='latitude']")).toHaveText("29.720658823001");
	await expect(page.locator("[data-field='longitude']")).toHaveText("-95.261995884462");
});

test("an ambiguous match", async ({ page }) => {
	await search(page, CENSUS.ambiguous, "100 Main St");

	await expect(page.getByRole("heading", { name: "Several matches" })).toBeVisible();
	await expect(page.getByText("The Census Geocoder found 7 possible matches. Choose the one you meant.")).toBeVisible();
	await expect(page.getByRole("listitem").getByRole("button")).toHaveCount(7);

	// Nothing is chosen for the reader: no confirm screen, and no origin
	// sentence, which is the thing a confirmed match brings with it.
	await expect(page.getByRole("heading", { name: "Match confirmed" })).toHaveCount(0);
	await expect(page.locator("[data-field='matchedAddress']")).toHaveCount(0);
	await expect(page.getByRole("button", { name: "See the report" })).toHaveCount(0);

	// The seventh of seven, across four states from the first: choosing it
	// reaches the confirm screen with that candidate's own sentences.
	await page.getByRole("button", { name: "100 MAIN ST, SPRINGFIELD, OR, 97477" }).click();

	await expect(page.getByRole("heading", { name: "Match confirmed" })).toBeVisible();
	await expect(page.locator("[data-field='matchedAddress']")).toHaveText("100 MAIN ST, SPRINGFIELD, OR, 97477");
	await expect(page.getByRole("button", { name: "See the report" })).toBeVisible();
});

test("a no-match", async ({ page }) => {
	const typed = "9400 Clinton Dr, Houston, TX 77029";
	await search(page, CENSUS.noMatch, typed);

	await expect(page.getByRole("heading", { name: "No match yet" })).toBeVisible();

	// `.dev/BRIEF.md` B10: the limit is the geocoder's own address-range data,
	// and the screen says so rather than saying the address does not exist.
	await expect(
		page.getByText("The Census Geocoder has no street-range entry that matches this address as typed."),
	).toBeVisible();
	await expect(
		page.getByText("That is a gap in the geocoder's own address data, not a finding about whether the address exists."),
	).toBeVisible();

	// And the address is still editable, with what the reader typed still in it.
	await page.getByRole("button", { name: "Edit the address" }).click();
	await expect(page.getByLabel("Street address")).toHaveValue(typed);
	await expect(page.getByLabel("Street address")).toBeEditable();
});
