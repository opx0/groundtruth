/**
 * Type-level tests. Each `@ts-expect-error` line is a snippet that must fail
 * to compile; `pnpm typecheck` fails if any of them ever compiles. The runtime
 * body never calls these functions.
 */

import { describe, expect, it } from "vitest";
import type { Adapter, Built, Locus, Placement, RecordId, Sourced, SourceIo } from "@/lib/evidence";
import { defineTemplate, fallback, km, sentence } from "@/lib/evidence";
import { semsSiteSummary } from "@/lib/templates/sems";

declare const built: Built<"sems-site">;
declare const somewhereSourcedNumber: Sourced<number>;
declare const semsId: RecordId<"sems-site">;
declare const femaId: RecordId<"fema-flood-zone">;
declare const locus: Locus;
declare const io: SourceIo;

const femaTemplate = defineTemplate("fema-flood-zone", "fema-flood-zone/test@1", (field) => [
	sentence`Zone ${field("zoneCode")}.`,
]);

export function mustNotCompile(): void {
	// (7a) A template naming a field of the wrong record kind.
	defineTemplate("sems-site", "sems-site/wrong-kind@1", (field) => [
		// @ts-expect-error -- zoneCode is a fema-flood-zone field, not a sems-site field
		sentence`${field("zoneCode")}.`,
	]);

	// (7b) A clause with no field reference.
	// @ts-expect-error -- a factual sentence with no provenance cannot be written
	void sentence`No data.`;

	// (7c) A clause interpolating a plain string.
	// @ts-expect-error -- a string is not a field reference, so text cannot bypass provenance
	void sentence`${"VALERO PLUME"}`;

	// (7d) An adapter-shaped object trying to supply its own distanceMeters.
	const adapter: Adapter<"sems-site"> = {
		kind: "sems-site",
		source: "sems",
		version: "sems@1",
		async run(): Promise<readonly Built<"sems-site">[]> {
			// @ts-expect-error -- distanceMeters is kernel-owned; only haversine from the locus can fill it
			return [{ ...built, distanceMeters: somewhereSourcedNumber }];
		},
	};
	void adapter.run(locus, io);

	// Also: a Built value cannot carry an id or payloads.
	// @ts-expect-error -- id is kernel-owned
	const withId: Built<"sems-site"> = { ...built, id: semsId };
	void withId;

	// A placement cannot pair a record id with a template of another kind.
	// @ts-expect-error -- sems-site id with a fema-flood-zone template
	const crossed: Placement = { scope: "record", recordId: semsId, template: femaTemplate };
	void crossed;
	// @ts-expect-error -- fema-flood-zone id with a sems-site template
	const crossedBack: Placement = { scope: "record", recordId: femaId, template: semsSiteSummary };
	void crossedBack;

	// km() only accepts a numeric field.
	defineTemplate("sems-site", "sems-site/km-on-text@1", (field) => [
		// @ts-expect-error -- frsActiveStatus is a string field, not a distance
		sentence`${km(field("frsActiveStatus"))}`,
	]);

	// A sealed record is readonly.
	// @ts-expect-error -- value is readonly
	built.frsActiveStatus.value = "x";
}

export function mustCompile(): void {
	const ok: Placement = { scope: "record", recordId: semsId, template: semsSiteSummary };
	void ok;
	const okFema: Placement = { scope: "record", recordId: femaId, template: femaTemplate };
	void okFema;
	defineTemplate("sems-site", "sems-site/ok@1", (field) => [
		sentence`${field("subject")}, ${km(field("distanceMeters"))}.`,
		sentence`as of ${fallback(field("statusDate"), "Date unavailable")}.`,
	]);
}

describe("type-level guarantees", () => {
	it("are checked by tsc, not at runtime", () => {
		expect(typeof mustNotCompile).toBe("function");
		expect(femaTemplate.kind).toBe("fema-flood-zone");
	});
});
