import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

async function lintUnder(filePath: string, code: string) {
	const eslint = new ESLint({ cwd: repoRoot, overrideConfigFile: `${repoRoot}eslint.config.mjs` });
	const [result] = await eslint.lintText(code, { filePath });
	return result?.messages ?? [];
}

const snippet = `
type Sourced<T> = { readonly value: T };
const raw: unknown = { value: "VALERO PLUME" };
export const forged = raw as unknown as Sourced<string>;
export const maybe: string | null = null;
export const forcedNonNull = maybe!;
export const anything: any = 1;
`;

describe("graft 5: the brand is protected by lint, not by review", () => {
	it("reports every assertion and any in a file under lib/evidence/", async () => {
		const messages = await lintUnder(`${repoRoot}lib/evidence/__lint_probe__.ts`, snippet);
		const rules = messages.map((m) => m.ruleId);
		expect(rules.filter((r) => r === "no-restricted-syntax")).toHaveLength(3);
		expect(rules).toContain("@typescript-eslint/no-explicit-any");
		expect(messages.every((m) => m.severity === 2)).toBe(true);
	}, 30_000);

	it("reports the same under lib/adapters/", async () => {
		const messages = await lintUnder(`${repoRoot}lib/adapters/__lint_probe__.ts`, snippet);
		expect(messages.filter((m) => m.ruleId === "no-restricted-syntax")).toHaveLength(3);
	}, 30_000);

	it("does not apply the ban elsewhere, so the rule is scoped and not accidental", async () => {
		const messages = await lintUnder(`${repoRoot}tests/unit/__lint_probe__.ts`, snippet);
		expect(messages.filter((m) => m.ruleId === "no-restricted-syntax")).toHaveLength(0);
	}, 30_000);
});
