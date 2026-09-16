/**
 * The registry that ties every record kind to at least one template.
 *
 * `TemplateRegistry` was declared with the kernel and never constructed, so for
 * the whole of the build a kind with no template was a runtime absence rather
 * than a build failure: the card counted a record it could not describe and
 * `refuseUndescribed` threw when a reader asked for it. `lib/templates/registry.ts`
 * is the instantiation. Queue item 11.
 *
 * WHAT THE COMPILER ALREADY GUARANTEES, so these tests do not restate it. The
 * registry is a mapped type over `Kind`, so a missing kind and a kind whose
 * array is empty are both compile errors. There is no runtime check to write
 * for either, and a test asserting `TEMPLATES["sems-site"].length > 0` would be
 * a test that cannot fail.
 *
 * WHAT IS LEFT TO ASSERT is the part the type cannot see: that each entry holds
 * templates for the kind it is filed under, and that the flat list really is
 * every one of them. A registry whose `aqs-monitor-summary` slot held AirNow's
 * templates would typecheck if the kinds were structurally alike, and would put
 * the wrong sentence over the right record.
 */

import { describe, expect, it } from "vitest";
import { KINDS } from "@/lib/evidence/records";
import { RECORD_TEMPLATES, TEMPLATES } from "@/lib/templates/registry";

describe("every record kind has templates, and they are its own", () => {
	it("covers exactly the kinds `KINDS` declares, with no extra and none missing", () => {
		expect(Object.keys(TEMPLATES).toSorted()).toEqual([...KINDS].toSorted());
	});

	it("files every template under the kind it declares for itself", () => {
		const misfiled = Object.entries(TEMPLATES).flatMap(([kind, templates]) =>
			templates.filter((template) => template.kind !== kind).map((template) => `${template.id} under ${kind}`),
		);

		expect(misfiled).toEqual([]);
	});

	it("gives every template an id nothing else shares", () => {
		const ids = RECORD_TEMPLATES.map((template) => template.id);

		expect(ids.toSorted()).toEqual([...new Set(ids)].toSorted());
	});

	it("flattens to every template the registry holds and nothing besides", () => {
		const counted = Object.values(TEMPLATES).reduce((total, templates) => total + templates.length, 0);

		expect(RECORD_TEMPLATES).toHaveLength(counted);
		for (const [, templates] of Object.entries(TEMPLATES)) {
			for (const template of templates) expect(RECORD_TEMPLATES).toContain(template);
		}
	});
});
