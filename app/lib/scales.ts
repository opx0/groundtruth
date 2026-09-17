export type AqiBand = {
	readonly from: number;
	readonly to: number | null;
	readonly name: string;
};

export const AQI_BANDS: readonly AqiBand[] = [
	{ from: 0, to: 50, name: "Good" },
	{ from: 51, to: 100, name: "Moderate" },
	{ from: 101, to: 150, name: "Unhealthy for Sensitive Groups" },
	{ from: 151, to: 200, name: "Unhealthy" },
	{ from: 201, to: 300, name: "Very Unhealthy" },
	{ from: 301, to: null, name: "Hazardous" },
];

export const AQI_SOURCE = { agency: "AirNow", url: "https://www.airnow.gov/aqi/aqi-basics/" };

export function bandOf(aqi: number): AqiBand | null {
	if (!Number.isFinite(aqi) || aqi < 0) return null;
	return AQI_BANDS.find((band) => aqi >= band.from && (band.to === null || aqi <= band.to)) ?? null;
}

export type FloodTier = {
	readonly id: "sfha" | "between" | "above";
	readonly label: string;
	readonly definition: string;
};

export const FLOOD_TIERS: readonly FloodTier[] = [
	{
		id: "sfha",
		label: "Inside the Special Flood Hazard Area",
		definition:
			"The area that will be inundated by the flood event having a 1-percent chance of being equaled or exceeded in any given year.",
	},
	{
		id: "between",
		label: "Between the 1% and the 0.2% flood",
		definition:
			"Shaded Zone X covers areas between the limits of the base flood and the 0.2-percent-annual-chance (or 500-year) flood.",
	},
	{
		id: "above",
		label: "Above the 0.2% flood",
		definition:
			"Unshaded Zone X covers areas outside the SFHA and higher than the elevation of the 0.2-percent-annual-chance flood.",
	},
];

export const FLOOD_SOURCE = { agency: "FEMA", url: "https://www.fema.gov/glossary/flood-zones" };

export type FloodPlacement =
	| { readonly tier: FloodTier["id"] }
	| { readonly tier: null; readonly because: string };

export function placeFlood(zone: string, sfhaLabel: string, subtype: string): FloodPlacement {
	const inside = /\binside\b/i.test(sfhaLabel);
	const outside = /\boutside\b/i.test(sfhaLabel);
	const code = zone.trim().toUpperCase();
	const sub = subtype.toUpperCase();

	if (inside) return { tier: "sfha" };
	if (code === "D") return { tier: null, because: "FEMA maps zone D as an area of undetermined flood hazard." };
	if (sub.includes("LEVEE")) {
		return { tier: null, because: "FEMA's levee subtype says this is outside the SFHA without saying which side of the 0.2% flood it falls on." };
	}
	if (outside && sub.includes("0.2")) return { tier: "between" };
	if (outside && sub.includes("MINIMAL")) return { tier: "above" };
	if (outside) return { tier: null, because: "The record puts this outside the SFHA without a subtype that places it further." };
	return { tier: null, because: "The record does not say which side of the Special Flood Hazard Area this point falls on." };
}
