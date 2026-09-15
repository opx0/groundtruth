import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./tests/e2e",
	tsconfig: "./tests/e2e/tsconfig.json",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	reporter: process.env.CI ? "github" : "list",
	use: {
		baseURL: "http://127.0.0.1:3000",
		trace: "on-first-retry",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	webServer: {
		command: "pnpm build && pnpm start",
		url: "http://127.0.0.1:3000",
		/**
		 * Never reuse, not even locally.
		 *
		 * Playwright's scaffold sets `!process.env.CI` here, which is right for a
		 * dev server you want to keep warm. This command is `pnpm build && pnpm
		 * start`: reusing means paying for the rebuild and then serving the *old*
		 * server anyway, which is strictly worse than either. It cost a debugging
		 * cycle once -- six of nine paths failed with the search button stuck
		 * disabled, against a build from before the change under test, and nothing
		 * in the output said the server was stale.
		 *
		 * A suite that passes or fails depending on whether something happens to
		 * be listening on 3000 is not a predicate.
		 */
		reuseExistingServer: false,
		timeout: 180_000,
	},
});
