import type { Template } from "@/lib/evidence/templates";
import { defineTemplate, dollars, km, sentence } from "@/lib/evidence/templates";

export const echoFacilitySummary = defineTemplate(
	"echo-facility",
	"echo-facility/summary@1",
	(field) => [
		sentence`${field("subject")}, registry ID ${field("registryId")}.`,
		sentence`${km(field("distanceMeters"))} from the mapped point.`,
		sentence`Compliance status in ECHO's twelve-quarter history: ${field("complianceStatus")}.`,
	],
	[{ slot: "complianceStatus", present: true }],
);

export const echoFacilityFormalAction = defineTemplate(
	"echo-facility",
	"echo-facility/formal-action@1",
	(field) => [
		sentence`Most recent formal enforcement action in ECHO's facility summary for ${field("subject")}: ${field("lastFormalActionDate")}.`,
		sentence`Penalties counted in ECHO's facility summary: ${field("penaltyCount")}.`,
		sentence`Most recent penalty date in ECHO's facility summary: ${field("lastPenaltyDate")}.`,
		sentence`Amount of the most recent penalty in ECHO's facility summary: ${dollars(field("lastPenaltyAmountUsd"))}.`,
	],
	[{ slot: "lastFormalActionDate", present: true }],
);

export const echoFacilityNoFormalAction = defineTemplate(
	"echo-facility",
	"echo-facility/no-formal-action@1",
	(field) => [
		sentence`For ${field("subject")}, ECHO's facility summary carries no formal enforcement action date.`,
	],
	[{ slot: "lastFormalActionDate", present: false }],
);

export const echoFacilityNoncompliance = defineTemplate(
	"echo-facility",
	"echo-facility/noncompliance@1",
	(field) => [
		sentence`Quarters of noncompliance in ECHO's twelve-quarter history for ${field("subject")}: ${field("quartersInNoncompliance")}.`,
		sentence`ECHO's significant noncompliance flag: ${field("significantNoncomplianceFlag")}.`,
	],
	[{ slot: "quartersInNoncompliance", atLeast: 1 }],
);

export const echoFacilityNoStatus = defineTemplate(
	"echo-facility",
	"echo-facility/no-status@1",
	(field) => [
		sentence`${field("subject")}, registry ID ${field("registryId")}: EPA ECHO's facility summary carries no compliance status.`,
		sentence`${km(field("distanceMeters"))} from the mapped point.`,
	],
	[{ slot: "complianceStatus", present: false }],
);

export const echoFacilityIndustryCodes = defineTemplate(
	"echo-facility",
	"echo-facility/industry-codes@1",
	(field) => [
		sentence`NAICS codes ECHO lists for ${field("subject")}: ${field("naicsCodes")}.`,
		sentence`SIC codes ECHO lists for ${field("subject")}: ${field("sicCodes")}.`,
	],
);

export const echoTemplates: readonly [Template<"echo-facility">, ...Template<"echo-facility">[]] = [
	echoFacilitySummary,
	echoFacilityFormalAction,
	echoFacilityNoFormalAction,
	echoFacilityNoncompliance,
	echoFacilityNoStatus,
	echoFacilityIndustryCodes,
];
