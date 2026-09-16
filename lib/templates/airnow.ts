import type { Clause, FieldRef, Template } from "@/lib/evidence/templates";
import { defineTemplate, sentence } from "@/lib/evidence/templates";

function qualification(field: FieldRef<"airnow-observation">): Clause<"airnow-observation"> {
	return sentence`AirNow's observations describe the ${field("reportingArea")} reporting area, not the mapped point.`;
}

export const airnowObservationSummary = defineTemplate(
	"airnow-observation",
	"airnow-observation/summary@1",
	(field) => [
		sentence`AirNow reports an air quality index of ${field("aqi")} for ${field("pollutant")} in the ${field("reportingArea")} reporting area, observed ${field("observedAt")}.`,
		sentence`AirNow's category for that index is ${field("category")}.`,
		qualification(field),
	],
	[{ slot: "aqi", present: true }],
);

export const airnowObservationNoIndex = defineTemplate(
	"airnow-observation",
	"airnow-observation/no-index@1",
	(field) => [
		sentence`AirNow's ${field("pollutant")} observation for the ${field("reportingArea")} reporting area, observed ${field("observedAt")}, carries no air quality index.`,
		qualification(field),
	],
	[{ slot: "aqi", present: false }],
);

export const airnowTemplates: readonly [Template<"airnow-observation">, ...Template<"airnow-observation">[]] = [airnowObservationSummary, airnowObservationNoIndex];
