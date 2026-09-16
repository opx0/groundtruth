import { defineTemplate, sentence } from "@/lib/evidence/templates";

export const semsSectionCount = defineTemplate("section", "section/sems-count@1", (field) => [
	sentence`Superfund sites EPA's inventory lists within ${field("boundary")} of the mapped point: ${field("count")}.`,
]);

export const semsNplSectionCount = defineTemplate("section", "section/sems-npl-count@1", (field) => [
	sentence`Sites on the final National Priorities List within ${field("boundary")} of the mapped point: ${field("count")}.`,
]);

export const echoSectionCount = defineTemplate("section", "section/echo-count@1", (field) => [
	sentence`Regulated facilities EPA ECHO lists within ${field("boundary")} of the mapped point: ${field("count")}.`,
]);

export const echoFormalActionCount = defineTemplate("section", "section/echo-formal-actions@1", (field) => [
	sentence`Facilities within ${field("boundary")} with a formal enforcement action in ECHO's facility summary: ${field("count")}.`,
]);

export const echoNoncomplianceCount = defineTemplate("section", "section/echo-noncompliance@1", (field) => [
	sentence`Facilities within ${field("boundary")} with at least one quarter of noncompliance in ECHO's twelve-quarter history: ${field("count")}.`,
]);

export const sectionNoRecords = defineTemplate("section", "section/no-records@1", (field) => [
	sentence`${field("note")}`,
]);

export const aqsNoPollutantMonitor = defineTemplate(
	"section",
	"section/aqs-no-pollutant-monitor@1",
	(field) => [
		sentence`EPA's Air Quality System listed no ${field("filterValue")} monitor within ${field("boundary")} of the mapped point.`,
	],
	[
		{ slot: "filterField", equals: "pollutant" },
		{ slot: "count", equals: 0 },
	],
);

export const sectionNotShown = defineTemplate("section", "section/not-shown@1", (field) => [
	sentence`Records within ${field("boundary")} of the mapped point that this list leaves out: ${field("notShown")}.`,
]);

export const sectionRetrievedAt = defineTemplate("section", "section/retrieved-at@1", (field) => [
	sentence`Searched within ${field("boundary")} of the mapped point, retrieved ${field("retrievedAt")}.`,
]);

export const sectionTemplates = [
	semsSectionCount,
	semsNplSectionCount,
	echoSectionCount,
	echoFormalActionCount,
	echoNoncomplianceCount,
	sectionNoRecords,
	aqsNoPollutantMonitor,
	sectionNotShown,
	sectionRetrievedAt,
];
