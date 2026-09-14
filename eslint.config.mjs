import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * SYNTHESIS.md graft 5. The `Sourced` brand is defeated by
 * `x as unknown as Sourced<T>`, so type assertions, non-null assertions, and
 * `any` are banned wherever values enter or leave the evidence kernel.
 * tests/unit/evidence/lint.test.ts asserts this block is on.
 */
export const evidenceKernelRules = {
	files: ["lib/evidence/**/*.ts", "lib/adapters/**/*.ts"],
	rules: {
		"no-restricted-syntax": [
			"error",
			{
				selector: "TSAsExpression",
				message: "No type assertions under lib/evidence or lib/adapters: read the value through a kernel reader.",
			},
			{
				selector: "TSTypeAssertion",
				message: "No type assertions under lib/evidence or lib/adapters: read the value through a kernel reader.",
			},
			{
				selector: "TSNonNullExpression",
				message: "No non-null assertions under lib/evidence or lib/adapters: handle the null.",
			},
		],
		"@typescript-eslint/no-explicit-any": "error",
	},
};

/**
 * docs/BRIEF.md B11 and B12: "Recorded fixtures live only under the test
 * directory. Production code cannot import them," and "fixtures cannot enter a
 * production build."
 *
 * A lint rule rather than a test, because the two fail at different moments: a
 * test fails after the import exists and someone runs the suite, and this fails
 * in the editor, in `pnpm lint`, and in `next build` -- on the line that wrote
 * it. Everything shipped to a browser or run on the server is built from `app/`
 * and `lib/`, so a ban on importing `tests/` from those two trees is the whole
 * boundary. It is deliberately about the *directory*, not about a file naming
 * convention: `tests/fixtures/` is where the recorded agency bytes live and
 * where the replay label of B11 does not reach.
 *
 * Only `no-restricted-imports` is set here. A `no-restricted-syntax` block for
 * `import("...tests/...")` would be the natural companion, and it is not here
 * on purpose: flat config replaces a rule's options rather than merging them,
 * so a second `no-restricted-syntax` matching `lib/adapters/**` would silently
 * disable the assertion bans above for the very files that most need them. The
 * dynamic spellings -- `import()`, `require()`, a bare path string -- are
 * covered instead by the source scan in tests/unit/app/privacy.test.ts, which
 * also catches an `eslint-disable` written over this rule.
 *
 * tests/unit/app/privacy.test.ts asserts this block is on.
 */
export const fixtureBoundaryRules = {
	files: ["lib/**/*.ts", "lib/**/*.tsx", "app/**/*.ts", "app/**/*.tsx"],
	rules: {
		"no-restricted-imports": [
			"error",
			{
				patterns: [
					{
						group: [
							"@/tests",
							"@/tests/**",
							"tests/**",
							"**/tests",
							"**/tests/**",
							"../tests/**",
							"../../tests/**",
							"../../../tests/**",
							"../../../../tests/**",
						],
						message:
							"No import from tests/ under lib/ or app/: recorded fixtures live only under the test directory and cannot enter a production build (docs/BRIEF.md B11).",
					},
				],
			},
		],
	},
};

const eslintConfig = defineConfig([
	...nextVitals,
	...nextTs,
	fixtureBoundaryRules,
	evidenceKernelRules,
	// Override default ignores of eslint-config-next.
	globalIgnores([
		// Default ignores of eslint-config-next:
		".next/**",
		"out/**",
		"build/**",
		"next-env.d.ts",
	]),
]);

export default eslintConfig;
