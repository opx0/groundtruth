/**
 * The unit suite runs as if this deployment holds no credential, whatever the
 * developer's shell holds.
 *
 * `tests/unit/app/report-route.test.ts` says the unconfigured state is "the
 * default here and `withAirKeys` the one way out of it", and several files are
 * written against that: a card whose source has no key reports `not-configured`
 * and renders a status sentence instead of records. That default was never
 * actually enforced. It held only because `vitest` does not read `.env.local`
 * the way `next` does, so the variables happened to be absent.
 *
 * They are not absent for everyone. An operator who has run `scripts/setup.sh`
 * and exported the three keys into their shell, or any CI job that provides
 * them, gets eight failures across four files -- the air cards answer with
 * records where the test expected a status, and a trace panel that expected six
 * spans finds none. Measured on 2026-09-17, on this machine and on the
 * deployment host, with the same commit passing in a clean shell.
 *
 * Deleting them here makes the claim those files already make a true one. It
 * takes nothing away: every test that wants the configured state sets the
 * variables itself and restores them afterwards, which is what `withAirKeys`
 * does in both files that need it, and what `tests/e2e/helpers/bodies.ts` does
 * for the Playwright suite. That helper's comment is the rule this file
 * enforces one level up -- "a developer with a real `AQS_KEY` in their shell
 * runs the same suite as CI".
 */

const AMBIENT_CREDENTIALS: readonly string[] = ["AQS_EMAIL", "AQS_KEY", "AIRNOW_KEY"];

for (const name of AMBIENT_CREDENTIALS) delete process.env[name];
