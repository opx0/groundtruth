import { describe, expect, it } from "vitest";
import { z } from "zod";

describe("toolchain", () => {
	it("runs typescript through vitest", () => {
		const parsed = z.object({ ok: z.literal(true) }).parse({ ok: true });
		expect(parsed.ok).toBe(true);
	});
});
