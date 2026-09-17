import { BOUNDARIES } from "@/lib/boundaries";

export type SourceParameter = { readonly name: string; readonly means: string };

export type SourceDoc = {
	readonly agency: string;
	readonly answers: string;
	readonly host: string;
	readonly boundary: string;
	readonly parameters: readonly SourceParameter[];
	readonly docsUrl: string;
};

export const SOURCE_DOCS: readonly SourceDoc[] = [
	{
		agency: "US Census Geocoder",
		answers: "Which mapped point an address resolves to, and how precisely.",
		host: "geocoding.geo.census.gov",
		boundary: "the street block the address falls in, never the parcel",
		parameters: [
			{ name: "address", means: "the one line a reader typed, sent here and to no other source" },
			{ name: "benchmark", means: "which vintage of the Census address file to match against" },
			{ name: "vintage", means: "which vintage of the geography to return with the match" },
		],
		docsUrl: "https://geocoding.geo.census.gov/geocoder/",
	},
	{
		agency: "EPA ECHO",
		answers: "Regulated facilities, their compliance status, violations and enforcement.",
		host: "echodata.epa.gov",
		boundary: BOUNDARIES.echo.label,
		parameters: [
			{ name: "p_lat, p_long", means: "the mapped point the search is centred on" },
			{ name: "p_radius", means: "the search radius, in miles" },
			{ name: "qcolumns", means: "which columns to return, by index, including the longitude ECHO omits by default" },
		],
		docsUrl: "https://echo.epa.gov/tools/web-services",
	},
	{
		agency: "EPA FRS",
		answers: "Facility identity: the name, the coordinate, and the programme systems that track it.",
		host: "services.arcgis.com",
		boundary: BOUNDARIES.frs.label,
		parameters: [
			{ name: "where", means: "a filter on REGISTRY_ID, so only facilities already named by another source are fetched" },
			{ name: "outFields", means: "which attributes of the facility record to return" },
		],
		docsUrl: "https://www.epa.gov/frs",
	},
	{
		agency: "EPA SEMS",
		answers: "Superfund assessment and cleanup sites, with their NPL status.",
		host: "services.arcgis.com and ofmpub.epa.gov",
		boundary: BOUNDARIES.sems.label,
		parameters: [
			{ name: "geometry", means: "the mapped point, as longitude and latitude" },
			{ name: "distance, units", means: "how far from that point to search, and in what unit" },
			{ name: "epa_id", means: "the site identifier used to join the layer to the Envirofacts status row" },
		],
		docsUrl: "https://www.epa.gov/enviro/sems-overview",
	},
	{
		agency: "FEMA NFHL",
		answers: "The flood zone designation at the mapped point.",
		host: "hazards.fema.gov, with services.arcgis.com as the named fallback",
		boundary: BOUNDARIES.fema.label,
		parameters: [
			{ name: "geometry", means: "the mapped point, as longitude and latitude" },
			{ name: "spatialRel", means: "esriSpatialRelIntersects: return the polygon the point falls inside" },
			{ name: "outFields", means: "FLD_ZONE, ZONE_SUBTY, SFHA_TF and the study identifiers shown on the card" },
		],
		docsUrl: "https://www.fema.gov/flood-maps/national-flood-hazard-layer",
	},
	{
		agency: "EPA AQS",
		answers: "Recorded annual summaries from the monitors nearest the point.",
		host: "aqs.epa.gov",
		boundary: BOUNDARIES.aqs.label,
		parameters: [
			{ name: "param", means: "88101 is PM2.5, 44201 is ozone" },
			{ name: "bdate, edate", means: "the start and end of the summary year, which AQS requires to be one year" },
			{ name: "minlat, maxlat, minlon, maxlon", means: "the box around the point that AQS searches" },
			{ name: "email, key", means: "the credential, held server-side and redacted everywhere it would otherwise be shown" },
		],
		docsUrl: "https://aqs.epa.gov/aqsweb/documents/data_api.html",
	},
	{
		agency: "AirNow",
		answers: "Current preliminary air conditions for the reporting area.",
		host: "www.airnowapi.org",
		boundary: BOUNDARIES.airnow.label,
		parameters: [
			{ name: "latitude, longitude", means: "the mapped point AirNow resolves to a reporting area" },
			{ name: "format", means: "application/json" },
			{ name: "API_KEY", means: "the credential, held server-side and redacted everywhere it would otherwise be shown" },
		],
		docsUrl: "https://docs.airnowapi.org/",
	},
];
