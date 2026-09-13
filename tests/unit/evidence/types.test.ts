/**
 * Type-level tests. Each `@ts-expect-error` line is a snippet that must fail
 * to compile; `pnpm typecheck` fails if any of them ever compiles. The runtime
 * body never calls these functions.
 */

import { describe, expect, it } from "vitest";
import type {
	Adapter,
	Built,
	GeocodeMatch,
	Locus,
	Placement,
	RecordId,
	SourceIo,
	SourceOutcome,
	Sourced,
} from "@/lib/evidence";
import { defineSection, defineTemplate, fallback, km, sentence } from "@/lib/evidence";
import { semsSiteSummary } from "@/lib/templates/sems";
import { semsSectionCount } from "@/lib/templates/sections";
import { sourceUnavailable } from "@/lib/templates/sources";
import { originMatch } from "@/lib/templates/origin";
import { groupMemberCount } from "@/lib/templates/groups";

declare const built: Built<"sems-site">;
declare const somewhereSourcedNumber: Sourced<number>;
declare const semsId: RecordId<"sems-site">;
declare const femaId: RecordId<"fema-flood-zone">;
declare const locus: Locus;
declare const io: SourceIo;
declare const match: GeocodeMatch;
declare const outcome: SourceOutcome;

const semsSection = defineSection({
	kind: "sems-site",
	source: "sems",
	boundary: "5 miles",
	query: null,
	retrievedAt: null,
	filter: null,
	note: "No matching records within the stated boundary.",
	carried: null,
});

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

	// (7e) One compile failure per scope added by U2.3. A template cannot
	// render a subject of the wrong shape, whether the subject is a record or
	// one of the four wider ones.

	// section: a section subject has no record fields.
	defineTemplate("section", "section/wrong-subject@1", (field) => [
		// @ts-expect-error -- epaSiteId is a sems-site field; a section counts records, it is not one
		sentence`${field("epaSiteId")}.`,
	]);
	// @ts-expect-error -- a section placement cannot take a record template
	const sectionWithRecordTemplate: Placement = { scope: "section", section: semsSection, template: semsSiteSummary };
	void sectionWithRecordTemplate;
	defineSection({
		kind: "sems-site",
		source: "sems",
		boundary: "5 miles",
		query: null,
		retrievedAt: null,
		// @ts-expect-error -- zoneCode is not a slot of a sems-site record
		filter: { field: "zoneCode", equals: "AE" },
		note: "No matching records within the stated boundary.",
		carried: null,
	});

	// source: a source subject has no count; that is a section's.
	defineTemplate("source", "source/wrong-subject@1", (field) => [
		// @ts-expect-error -- count belongs to a section, not to a source outcome
		sentence`${field("count")}.`,
	]);
	// @ts-expect-error -- a source placement cannot take a section template
	const sourceWithSectionTemplate: Placement = { scope: "source", source: "sems", outcome, template: semsSectionCount };
	void sourceWithSectionTemplate;

	// origin: a geocode match has no cause; that is a source's.
	defineTemplate("origin", "origin/wrong-subject@1", (field) => [
		// @ts-expect-error -- cause belongs to a source outcome, not to the geocode match
		sentence`${field("cause")}.`,
	]);
	// @ts-expect-error -- an origin placement cannot take a source template
	const originWithSourceTemplate: Placement = { scope: "origin", match, template: sourceUnavailable };
	void originWithSourceTemplate;

	// group: a group subject has no matched address; that is the origin's.
	defineTemplate("group", "group/wrong-subject@1", (field) => [
		// @ts-expect-error -- matchedAddress belongs to the geocode match, not to a group of records
		sentence`${field("matchedAddress")}.`,
	]);
	// @ts-expect-error -- a group placement cannot take an origin template
	const groupWithOriginTemplate: Placement = { scope: "group", members: [semsId], groupedBy: null, template: originMatch };
	void groupWithOriginTemplate;
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

	// One well-formed placement per scope added by U2.3.
	const okSection: Placement = { scope: "section", section: semsSection, template: semsSectionCount };
	const okSource: Placement = { scope: "source", source: "sems", outcome, agency: null, template: sourceUnavailable };
	const okOrigin: Placement = { scope: "origin", match, template: originMatch };
	const okGroup: Placement = {
		scope: "group",
		members: [semsId, semsId],
		groupedBy: "frsRegistryId",
		template: groupMemberCount,
	};
	void [okSection, okSource, okOrigin, okGroup];
}

describe("type-level guarantees", () => {
	it("are checked by tsc, not at runtime", () => {
		expect(typeof mustNotCompile).toBe("function");
		expect(femaTemplate.kind).toBe("fema-flood-zone");
	});
});
