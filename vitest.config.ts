import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
	resolve: {
		alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
	},
	test: {
		environment: "node",
		include: ["tests/unit/**/*.test.ts"],
		/**
		 * Strips the three air credentials from `process.env` before any test
		 * runs, so the suite is hermetic with respect to the shell it was
		 * started from. The file itself argues why.
		 */
		setupFiles: ["tests/setup/no-ambient-credentials.ts"],
		globals: false,
		/**
		 * Vitest's default is five seconds, and several tests here legitimately
		 * take longer because of what they actually do rather than what they wait
		 * on: one runs a production `next build` and scans the client bundle for
		 * a credential, one renders every trace panel of a whole report -- 173
		 * spans, three times over, across three files -- and one walks every
		 * module specifier under `lib/` and `app/`. Measured alone they are two to
		 * ten seconds; on a loaded machine, with workers in parallel, the panel
		 * ones crossed five and the suite went red on a timeout rather than on an
		 * assertion. A predicate that has to be reproducibly green cannot sit that
		 * close to the edge.
		 *
		 * Raising it hides nothing. Nothing in this suite can hang: there is no
		 * network (`tests/unit/app/privacy.test.ts` proves no test issues a
		 * request), no timer a test does not control, and the three live-endpoint
		 * tests are skipped. A test that reaches thirty seconds here is broken,
		 * and will still say so.
		 */
		testTimeout: 30_000,
	},
});
