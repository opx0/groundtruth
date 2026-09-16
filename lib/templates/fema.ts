import type { Clause, FieldRef, Template } from "@/lib/evidence/templates";
import { defineTemplate, fallback, sentence } from "@/lib/evidence/templates";

function areaClauses(field: FieldRef<"fema-flood-zone">): Clause<"fema-flood-zone">[] {
	return [
		sentence`The zone subtype recorded for this area is ${field("zoneSubtype")}.`,
		sentence`FEMA's FIRM study identifier for this area is ${field("firmStudyId")}.`,
		sentence`The flood area ID recorded for this area is ${field("floodAreaId")}.`,
		sentence`The source-citation lookup key recorded for this area is ${field("sourceCitation")}.`,
		sentence`Read from ${field("datasetLabel")}.`,
	];
}

export const floodZoneSummary = defineTemplate(
	"fema-flood-zone",
	"fema-flood-zone/summary@1",
	(field) => [
		sentence`The mapped point, a street-segment interpolation rather than a parcel boundary, is in zone ${field("zoneCode")}, ${field("sfhaLabel")}.`,
		...areaClauses(field),
	],
	[{ slot: "sfhaLabel", present: true }],
);

export const floodZoneUnmappedFlag = defineTemplate(
	"fema-flood-zone",
	"fema-flood-zone/unmapped-flag@1",
	(field) => [
		sentence`The mapped point, a street-segment interpolation rather than a parcel boundary, is in zone ${field("zoneCode")}.`,
		sentence`FEMA's Special Flood Hazard Area flag recorded for this area is "${fallback(field("sfhaFlag"), "")}". Meaning not mapped.`,
		...areaClauses(field),
	],
	[{ slot: "sfhaLabel", present: false }],
);

export const femaTemplates: readonly [Template<"fema-flood-zone">, ...Template<"fema-flood-zone">[]] = [floodZoneSummary, floodZoneUnmappedFlag];
