/**
 * The suite's own precondition, asserted rather than assumed.
 *
 * Four files are written against a deployment that holds no air credential,
 * and `tests/unit/app/report-route.test.ts` states that as a rule: the
 * unconfigured state is the default, and `withAirKeys` is the one way out of
 * it. Until 2026-09-17 nothing enforced it. It held by accident, because
 * `vitest` does not read `.env.local` the way `next` does.
 *
 * In a shell that exports the three keys -- an operator who has run
 * `scripts/setup.sh`, or a CI job that provides them -- the same commit failed
 * eight tests across four files. `tests/setup/no-ambient-credentials.ts` is the
 * fix and this is its guard.
 *
 * WHAT THIS TEST CAN AND CANNOT CATCH, because that matters here. In a clean
 * shell it cannot fail, and a test that cannot fail is usually worth deleting.
 * This one is not, because the shell it is written for is the one where it
 * does fail: delete the setup file, export `AQS_KEY`, and this goes red before
 * the eight confusing failures elsewhere do. It converts a puzzle about missing
 * trace spans into a sentence naming the cause.
 */

import { describe, expect, it } from "vitest";

const AIR_CREDENTIALS: readonly string[] = ["AQS_EMAIL", "AQS_KEY", "AIRNOW_KEY"];

describe("the unit suite is hermetic with respect to the shell it was started from", () => {
	it("holds no air credential from the environment", () => {
		const leaked = AIR_CREDENTIALS.filter((name) => process.env[name] !== undefined);

		expect(
			leaked,
			`${leaked.join(", ")} reached the suite from the environment. ` +
				"tests/setup/no-ambient-credentials.ts should have removed them.",
		).toEqual([]);
	});
});
