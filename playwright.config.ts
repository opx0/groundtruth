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
		/**
		 * The standalone server, not `next start`.
		 *
		 * `next.config.ts` sets `output: "standalone"` so the Docker image carries
		 * only reachable modules, and Next then warns that `next start` "does not
		 * work" with it. It did still serve, and all nine paths passed against it,
		 * which is the worse failure: a suite green against a server the deployment
		 * does not use. `.next/standalone/server.js` is the exact artifact the
		 * Dockerfile runs. The two `cp` calls are what that Dockerfile's final stage
		 * does, because Next emits `public` and `.next/static` outside the bundle
		 * and the standalone server does not copy them itself.
		 *
		 * The copy removes its targets first. Without that, a second run copies
		 * `public` inside the `public` the first run made, and the server starts
		 * against a tree that is wrong in a way the first run cannot reproduce.
		 * That failed here once, and the error Next prints for it blames a build
		 * that did not exit cleanly, which is not what happened.
		 */
		command: "bun run build && bun run start:standalone",
		url: "http://127.0.0.1:3000",
		/**
		 * Never reuse, not even locally.
		 *
		 * Playwright's scaffold sets `!process.env.CI` here, which is right for a
		 * dev server you want to keep warm. This command is `bun run build && bun run
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
