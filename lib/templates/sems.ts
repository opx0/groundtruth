import type { Template } from "@/lib/evidence/templates";
import { defineTemplate, fallback, km, sentence } from "@/lib/evidence/templates";

export const semsSiteSummary = defineTemplate(
	"sems-site",
	"sems-site/summary@1",
	(field) => [
		sentence`${field("subject")}, EPA ID ${field("epaSiteId")}.`,
		sentence`${km(field("distanceMeters"))} from the mapped point.`,
		sentence`NPL status: ${field("semsNplStatus")}.`,
		sentence`Non-NPL status: ${field("nonNplStatus")}.`,
		sentence`Non-NPL status date: ${fallback(field("statusDate"), "Date unavailable")}.`,
		sentence`Superfund inventory record: ${field("archivedLabel")}.`,
		sentence`Archived date: ${field("archivedDate")}.`,
	],
	[{ state: "statusRow", is: "joined" }],
);

export const semsSiteRegistryOnly = defineTemplate(
	"sems-site",
	"sems-site/registry-only@1",
	(field) => [
		sentence`${field("subject")}, ${km(field("distanceMeters"))} from the mapped point.`,
		sentence`EPA's facility registry records the ${field("interestType")} interest at ${field("subject")} as ${field("frsActiveStatus")}.`,
		sentence`The Superfund inventory returned no status row for ${field("epaSiteId")}.`,
	],
	[{ state: "statusRow", is: "no-row" }],
);

export const semsSiteStatusUnavailable = defineTemplate(
	"sems-site",
	"sems-site/status-unavailable@1",
	(field) => [
		sentence`${field("subject")}, ${km(field("distanceMeters"))} from the mapped point.`,
		sentence`EPA's facility registry records the ${field("interestType")} interest at ${field("subject")} as ${field("frsActiveStatus")}.`,
		sentence`The Superfund inventory's status for ${field("epaSiteId")} could not be retrieved.`,
	],
	[{ state: "statusRow", is: "unavailable" }],
);

export const semsSiteNpl = defineTemplate(
	"sems-site",
	"sems-site/npl@1",
	(field) => [
		sentence`${field("subject")} is listed by SEMS.`,
		sentence`${km(field("distanceMeters"))} from the mapped point.`,
	],
	[{ slot: "semsNplStatus", equals: "Currently on the Final NPL" }],
);

export const semsTemplates: readonly [Template<"sems-site">, ...Template<"sems-site">[]] = [
	semsSiteSummary,
	semsSiteRegistryOnly,
	semsSiteStatusUnavailable,
	semsSiteNpl,
];
