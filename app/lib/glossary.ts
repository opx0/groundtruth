import type { ReportSourceId } from "@/app/lib/report-contract";

export type GlossaryEntry = {
	readonly term: string;
	readonly triggers: readonly string[];
	readonly sources?: readonly ReportSourceId[];
	readonly quote: string;
	readonly agency: string;
	readonly sourceUrl: string;
};

export const GLOSSARY: readonly GlossaryEntry[] = [
	{
		term: "Zone AE",
		triggers: ["AE"],
		quote:
			"The base floodplain where base flood elevations are provided. AE Zones are now used on new format FIRMs instead of A1-A30 Zones.",
		agency: "FEMA",
		sourceUrl: "https://www.fema.gov/about/glossary/zone-ae",
	},
	{
		term: "Zone X",
		triggers: ["X"],
		quote:
			"Shaded Zone X covers areas between the limits of the base flood and the 0.2-percent-annual-chance (or 500-year) flood. Unshaded Zone X covers areas outside the SFHA and higher than the elevation of the 0.2-percent-annual-chance flood.",
		agency: "FEMA",
		sourceUrl: "https://www.fema.gov/glossary/flood-zones",
	},
	{
		term: "Special Flood Hazard Area",
		triggers: ["inside the Special Flood Hazard Area", "outside the Special Flood Hazard Area"],
		quote:
			"The area that will be inundated by the flood event having a 1-percent chance of being equaled or exceeded in any given year.",
		agency: "FEMA",
		sourceUrl: "https://www.fema.gov/glossary/flood-zones",
	},
	{
		term: "National Priorities List",
		triggers: ["Currently on the Final NPL", "Not on the NPL", "Site is Part of NPL Site", "Proposed for NPL"],
		quote:
			"The National Priorities List (NPL) is the list of national priorities among the known releases or threatened releases of hazardous substances, pollutants, or contaminants throughout the United States and its territories.",
		agency: "EPA",
		sourceUrl: "https://www.epa.gov/superfund/superfund-glossary",
	},
	{
		term: "Removal action",
		triggers: [
			"Removal Only Site (No Site Assessment Work Needed)",
			"Removal Only Site (Site Assessment Work Needed)",
		],
		quote:
			"A removal is a short-term cleanup intended to stabilize or clean up a site that poses an imminent and substantial threat to human health or the environment.",
		agency: "EPA",
		sourceUrl: "https://www.epa.gov/superfund/superfund-glossary",
	},
	{
		term: "Air quality index",
		triggers: [],
		sources: ["airnow"],
		quote:
			"An AQI of 50 or below: air quality is satisfactory, and air pollution poses little or no risk. 51 to 100: air quality is acceptable. However, there may be a risk for some people, particularly those who are unusually sensitive to air pollution. The bands are 0-50 Good, 51-100 Moderate, 101-150 Unhealthy for Sensitive Groups, 151-200 Unhealthy, 201-300 Very Unhealthy, 301 and higher Hazardous.",
		agency: "AirNow",
		sourceUrl: "https://www.airnow.gov/aqi/aqi-basics/",
	},
];

export const GLOSSARY_HEADING = "What these words mean";

export function glossaryFor(source: string, rendered: ReadonlySet<string>): readonly GlossaryEntry[] {
	return GLOSSARY.filter(
		(entry) =>
			entry.triggers.some((trigger) => rendered.has(trigger)) ||
			(entry.sources ?? []).some((one) => one === source),
	);
}
