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

const eslintConfig = defineConfig([
	...nextVitals,
	...nextTs,
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
