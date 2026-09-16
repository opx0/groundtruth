/**
 * Driving the real app: what is served to it, and how a reader gets from the
 * search box to the report.
 *
 * WHERE THE INTERCEPTION IS. `page.route` runs in the test process, so the two
 * API routes are answered before the request leaves the browser. Everything
 * else -- the HTML, the client bundle, the React that renders the cards -- is
 * served by the production build `playwright.config.ts` starts, and that build
 * knows nothing about any fixture. The seam is deliberate: a report assembled
 * from live sources would make this suite a weather report, and four of the
 * eight paths (`.dev/BRIEF.md` B12) cannot be reached from this machine at all
 * -- FEMA's NFHL host refuses the connection and the two air sources have no
 * key. So the bytes are the ones `helpers/bodies.ts` built with the real route
 * handlers over the committed fixtures, and the wiring under test is everything
 * between those bytes and the screen.
 *
 * WHY EACH TEST SERVES ITS OWN. Every function here takes a `Page`, so nothing
 * is shared between tests and the suite runs under `fullyParallel` as
 * configured: a test's routes live on its own page, and the only state it has
 * is the state it drove itself into.
 */

import { expect, type Page } from "@playwright/test";
import { geocodeBody, CENSUS, type Body } from "./bodies";

/** `.dev/BRIEF.md` A6 row 1, and the address the match fixture was recorded for. */
export const HOUSTON = "9311 E Ave P, Houston, TX 77012";

/** A6 row 3. Its match returns a New Orleans point, and the flood answer there is the zone X levee subtype. */
export const PERDIDO = "1300 Perdido St, New Orleans, LA 70112";

/**
 * A6 row 2. Its match returns -95.219949564692, 29.717476102334, which is
 * exactly the geometry `scripts/capture-us-fixtures.sh` uses for both Pasadena
 * flood fixtures. The address and those recordings were captured months apart
 * and describe the same spot, so this row is drivable from what a reader types
 * rather than from a coordinate written into a test.
 */
export const RICHEY = "400 N Richey St, Pasadena, TX 77506";

/** Which recorded match a path confirms, so a path is not stuck with the demo address. */
export type Typed = { readonly fixture: string; readonly address: string };

export const AT_HOUSTON: Typed = { fixture: CENSUS.match, address: HOUSTON };
export const AT_PERDIDO: Typed = { fixture: CENSUS.perdido, address: PERDIDO };
export const AT_RICHEY: Typed = { fixture: CENSUS.richey, address: RICHEY };

/** How many times the fixture body was served. A route that stopped matching would otherwise leave the real route to answer, over the real network. */
type Served = () => number;

async function serve(page: Page, pattern: string, body: Body): Promise<Served> {
	let calls = 0;
	// Unrouted first, so a test that serves a second report on the same page --
	// the flood path drives two -- replaces the first rather than racing it.
	await page.unroute(pattern);
	await page.route(pattern, (route) => {
		calls += 1;
		return route.fulfill({ status: body.status, contentType: body.contentType, body: body.body });
	});
	return () => calls;
}

/**
 * That the fixture answered, and so that nothing went to a government endpoint.
 * A pattern that stopped matching would hand the request to the production
 * build's own route, which would reach for the network -- and the Census
 * Geocoder would very likely answer, which is how a suite goes live without
 * anyone noticing.
 */
async function served(count: Served, what: string): Promise<void> {
	await expect.poll(count, { message: `the ${what} route was never intercepted` }).toBeGreaterThan(0);
}

/** The report stream this page will be given when the reader asks for it. */
export async function serveReport(page: Page, body: Body): Promise<Served> {
	return serve(page, "**/api/report", body);
}

/**
 * Screen 1: type an address and ask for it.
 *
 * The fixture decides the outcome, and the address is what the reader typed --
 * `.dev/BRIEF.md` B9's one place a raw address exists. Nothing downstream of
 * the geocode route ever sees it.
 */
export async function search(page: Page, fixture: string, address: string): Promise<void> {
	const geocode = await serve(page, "**/api/geocode", await geocodeBody(fixture, address));
	await page.goto("/");
	await page.getByLabel("Street address").fill(address);
	await page.getByRole("button", { name: "Find this address" }).click();
	await served(geocode, "geocode");
}

/**
 * Screens 1 to 3: search, confirm the match, ask for the report. The
 * confirmation is a click and not a render, which is why this helper has to
 * make it -- `.dev/BRIEF.md` B9 step 5.
 *
 * `typed` defaults to the Houston demo point, so every path written before
 * 2026-09-17 reads as it did. A path that passes something else drives its own
 * curated address from the search box, which is what a reader does and what
 * `tests/fixtures/census/` could not support until both matches were recorded.
 */
export async function openReport(page: Page, report: Body, typed: Typed = AT_HOUSTON): Promise<void> {
	const stream = await serveReport(page, report);
	await search(page, typed.fixture, typed.address);
	await page.getByRole("button", { name: "See the report" }).click();
	await served(stream, "report");
}
