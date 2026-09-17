import { chromium, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { DEMO, reportBody } from "../tests/e2e/helpers/bodies";
import { AT_HOUSTON, search, serveReport } from "../tests/e2e/helpers/drive";

const BASE = process.env["SHOTS_BASE"] ?? "http://127.0.0.1:3000";
const OUT = ".dev/shots";
const WIDTHS = [
	{ name: "wide", width: 1440, height: 1400 },
	{ name: "phone", width: 390, height: 1800 },
];

async function shoot(page: Page, name: string, width: string): Promise<void> {
	await page.screenshot({ path: `${OUT}/${name}-${width}.png`, fullPage: true });
}

mkdirSync(OUT, { recursive: true });
const report = await reportBody(DEMO);
const browser = await chromium.launch();

for (const size of WIDTHS) {
	const context = await browser.newContext({
		viewport: { width: size.width, height: size.height },
		deviceScaleFactor: 2,
		baseURL: BASE,
	});
	const page = await context.newPage();

	await page.goto("/");
	await page.waitForFunction(() => document.fonts.status === "loaded");
	// React has to have hydrated before a fill reaches its state. On a heavy page
	// that is measurably later than load, and a screenshot run that raced it read
	// as a broken button.
	await page.waitForFunction(() => document.querySelector("[data-hydrated]") !== null);
	await shoot(page, "landing", size.name);

	await search(page, AT_HOUSTON.fixture, AT_HOUSTON.address);
	await shoot(page, "confirm", size.name);

	await serveReport(page, report);
	await page.getByRole("button", { name: "See the report" }).click();
	await page.locator("[data-source='sems']").waitFor();
	await shoot(page, "report", size.name);

	await page.locator("[data-source='sems'] [data-field='count']").first().click();
	await page.getByRole("dialog", { name: "Trace" }).waitFor();
	await shoot(page, "trace", size.name);

	await context.close();
}

await browser.close();
console.log(`wrote ${WIDTHS.length * 4} screenshots to ${OUT}/`);
