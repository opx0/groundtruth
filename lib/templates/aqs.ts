import type { Template } from "@/lib/evidence/templates";
import { defineTemplate, km, sentence } from "@/lib/evidence/templates";

export const aqsMonitorSummary = defineTemplate("aqs-monitor-summary", "aqs-monitor-summary/summary@1", (field) => [
	sentence`${field("pollutant")} monitor ${field("monitorId")} is ${km(field("distanceMeters"))} from the mapped point, and measures its own location, not this address.`,
	sentence`${field("period")} ${field("statistic")}: ${field("value")} ${field("unit")}. AQS data lags collection by six months or more.`,
	sentence`Observations in the summary: ${field("observationCount")}.`,
]);

export const aqsTemplates: readonly [Template<"aqs-monitor-summary">, ...Template<"aqs-monitor-summary">[]] = [aqsMonitorSummary];
