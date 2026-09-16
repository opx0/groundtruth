import { z } from "zod";
import type {
	Adapter,
	AdapterVersion,
	Built,
	Fetched,
	Locus,
	PayloadRef,
	QueryProvenance,
	SourceIo,
} from "@/lib/evidence";
import { coalesce, fieldsOf, fromQuery, haversine, ReaderInvariant, SourceFailure, urlFrom } from "@/lib/evidence";

export const AQS_VERSION: AdapterVersion = "aqs@1";

const DATASET = "aqs_annual_summary";

export const ENDPOINT = "https://aqs.epa.gov/data/api/annualData/byBox";

const EMAIL_PARAM = "email";
const KEY_PARAM = "key";

export const EMAIL_ENV = "AQS_EMAIL";
export const KEY_ENV = "AQS_KEY";

export const NO_KEY = "no-api-key";

export const AQS_RADIUS_METERS = 50_000;

export const REDACTED_ECHO = "[redacted: the source's answer carried this deployment's credential]";

type Scrub = (text: string) => string;

function scrubbing(secrets: readonly string[]): Scrub {
	const forms: readonly string[] = secrets.flatMap((secret) => [secret, encodeURIComponent(secret)]);
	return (text) => (forms.some((form) => text.includes(form)) ? REDACTED_ECHO : text);
}

const METERS_PER_DEGREE = (Math.PI * 6371008.8) / 180;

const MIN_COSINE = 0.01;

export type Pollutant = "PM2.5" | "Ozone";

export const AQS_PARAMETERS: Readonly<Record<string, Pollutant>> = {
	"88101": "PM2.5",
	"44201": "Ozone",
};

export function pollutantOf(parameterCode: string): Pollutant | null {
	if (!Object.hasOwn(AQS_PARAMETERS, parameterCode)) return null;
	return AQS_PARAMETERS[parameterCode] ?? null;
}

export const AQS_PARAM_CODES: readonly string[] = ["88101", "44201"];

export const STATISTIC = "annual arithmetic mean";

export const ANNUAL_FILE_URL = "https://aqs.epa.gov/aqsweb/airdata/annual_conc_by_monitor_{id}.zip";

const CAVEATS: readonly string[] = [
	"AQS data lags collection by six months or more.",
	"The monitor measures its own location, not this address.",
	"AQS returns more than one annual summary row for a monitor and year, and the columns that tell those rows apart"
		+ " are not published. This is the first row the service returned for this site and parameter.",
];

export const AnnualSummaryRow = z.object({
	state_code: z.string(),
	county_code: z.string(),
	site_number: z.string(),
	parameter_code: z.string(),
	poc: z.number(),
	latitude: z.number(),
	longitude: z.number(),
	datum: z.string(),
	parameter: z.string(),
	units_of_measure: z.string(),
	date_of_last_change: z.string().nullable(),
	arithmetic_mean: z.number(),
	observation_count: z.number().nullable(),
});
export type AnnualSummaryRow = z.infer<typeof AnnualSummaryRow>;

const AqsFailedHeader = z.object({ status: z.string(), error: z.array(z.string()) });

const AqsOkHeader = z.object({ status: z.string() });

export const AqsHeaderEntry = z.union([AqsFailedHeader, AqsOkHeader]);
export type AqsHeaderEntry = z.infer<typeof AqsHeaderEntry>;

// Do not declare `Header[].url`: AQS echoes the request back in it, credentials
// and all, and zod strips only what it was never told about.
export const AqsResponse = z.object({
	Header: z.array(AqsHeaderEntry),
	Data: z.array(AnnualSummaryRow),
});
export type AqsResponse = z.infer<typeof AqsResponse>;

export function headerErrors(header: readonly AqsHeaderEntry[]): readonly string[] | null {
	for (const entry of header) {
		if ("error" in entry && entry.error.length > 0) return entry.error;
	}
	return null;
}

function radians(degrees: number): number {
	return (degrees * Math.PI) / 180;
}

function clamp(value: number, low: number, high: number): number {
	return Math.min(high, Math.max(low, value));
}

function degrees(value: number): string {
	return value.toFixed(6);
}

export function boundingBox(locus: Locus): {
	readonly minlat: string;
	readonly maxlat: string;
	readonly minlon: string;
	readonly maxlon: string;
} {
	const latitude = locus.point.latitude.value;
	const longitude = locus.point.longitude.value;
	const latSpan = AQS_RADIUS_METERS / METERS_PER_DEGREE;
	const cosine = Math.cos(radians(latitude));
	const lonSpan = cosine < MIN_COSINE ? 180 : latSpan / cosine;
	return {
		minlat: degrees(clamp(latitude - latSpan, -90, 90)),
		maxlat: degrees(clamp(latitude + latSpan, -90, 90)),
		minlon: degrees(clamp(longitude - lonSpan, -180, 180)),
		maxlon: degrees(clamp(longitude + lonSpan, -180, 180)),
	};
}

export function annualSummaryQueryUrl(locus: Locus, year: number): URL {
	const url = new URL(ENDPOINT);
	const box = boundingBox(locus);
	url.searchParams.set("param", AQS_PARAM_CODES.join(","));
	url.searchParams.set("bdate", `${year}0101`);
	url.searchParams.set("edate", `${year}1231`);
	url.searchParams.set("minlat", box.minlat);
	url.searchParams.set("maxlat", box.maxlat);
	url.searchParams.set("minlon", box.minlon);
	url.searchParams.set("maxlon", box.maxlon);
	return url;
}

function keyedRequestUrl(citable: URL, email: string, key: string): URL {
	const url = new URL(citable.toString());
	url.searchParams.set(EMAIL_PARAM, email);
	url.searchParams.set(KEY_PARAM, key);
	return url;
}

function credentialsOrFail(): { readonly email: string; readonly key: string; readonly scrub: Scrub } {
	const email = process.env[EMAIL_ENV];
	const key = process.env[KEY_ENV];
	if (email === undefined || email === "" || key === undefined || key === "") {
		throw new SourceFailure("not-configured", NO_KEY);
	}
	return { email, key, scrub: scrubbing([email, key]) };
}

export function latestLikelySummaryYear(retrievedAt: string): number {
	const year = new Date(retrievedAt).getUTCFullYear();
	if (Number.isNaN(year)) throw new ReaderInvariant(`"${retrievedAt}" is not an instant this clock can read`);
	return year - 1;
}

export type AqsQuery = {
	readonly service: QueryProvenance;
	readonly period: QueryProvenance;
	readonly year: number;
};

function scrubbedRow(row: AnnualSummaryRow, scrub: Scrub): AnnualSummaryRow {
	return {
		...row,
		state_code: scrub(row.state_code),
		county_code: scrub(row.county_code),
		site_number: scrub(row.site_number),
		parameter_code: scrub(row.parameter_code),
		datum: scrub(row.datum),
		parameter: scrub(row.parameter),
		units_of_measure: scrub(row.units_of_measure),
		date_of_last_change: row.date_of_last_change === null ? null : scrub(row.date_of_last_change),
	};
}

function monitorIdOf(row: Fetched<AnnualSummaryRow>) {
	const fields = fieldsOf(row, DATASET, AQS_VERSION);
	return coalesce(
		fields.join(["state_code", "county_code", "site_number", "parameter_code"], "-"),
		fields.text("site_number"),
	);
}

export function annualSummaryBuilt(
	row: Fetched<AnnualSummaryRow>,
	pollutant: Pollutant,
	selection: QueryProvenance,
	query: AqsQuery,
): Built<"aqs-monitor-summary"> {
	const fields = fieldsOf(row, DATASET, AQS_VERSION);
	const monitorId = monitorIdOf(row);
	const period = fromQuery(query.period, String(query.year));
	return {
		kind: "aqs-monitor-summary",
		source: "aqs",
		sourceRecordId: monitorId.value,
		sourceUrl: urlFrom(ANNUAL_FILE_URL, period),
		subject: monitorIdOf(row),
		location: fields.point("latitude", "longitude", {}),
		effectiveAt: period,
		sourceUpdatedAt: fields.date("date_of_last_change"),
		caveats: CAVEATS,
		monitorId,
		pollutant: fromQuery(selection, pollutant),
		period,
		statistic: fromQuery(query.service, STATISTIC),
		value: fields.number("arithmetic_mean"),
		unit: fields.text("units_of_measure"),
		observationCount: fields.number("observation_count"),
	};
}

export function noMonitorsNote(year: number): string {
	return (
		`EPA's Air Quality System returned no ${year} annual summary for a PM2.5 or ozone monitor within`
		+ ` ${AQS_RADIUS_METERS / 1000} km of the mapped point. AQS lags collection by six months or more, so a recent`
		+ " year may not be loaded yet."
	);
}

export type AqsAdapter = Adapter<"aqs-monitor-summary"> & { readonly summaryYear: number };

function withinBoundary(locus: Locus, built: Built<"aqs-monitor-summary">): boolean {
	const location = built.location;
	if (location === null) return false;
	return haversine(locus.point, location).value <= AQS_RADIUS_METERS;
}

function firstPerMonitor(
	built: readonly Built<"aqs-monitor-summary">[],
): readonly Built<"aqs-monitor-summary">[] {
	const seen = new Set<string>();
	const kept: Built<"aqs-monitor-summary">[] = [];
	for (const record of built) {
		if (seen.has(record.sourceRecordId)) continue;
		seen.add(record.sourceRecordId);
		kept.push(record);
	}
	return kept;
}

export function aqsAdapter(summaryYear: number): AqsAdapter {
	return {
		kind: "aqs-monitor-summary",
		source: "aqs",
		version: AQS_VERSION,
		summaryYear,
		noDataNote: noMonitorsNote(summaryYear),
		async run(locus: Locus, io: SourceIo): Promise<readonly Built<"aqs-monitor-summary">[]> {
			const { email, key, scrub } = credentialsOrFail();
			const citable = annualSummaryQueryUrl(locus, summaryYear);
			const fetched = await io.get(keyedRequestUrl(citable, email, key), AqsResponse);
			const payload: PayloadRef = {
				url: citable.toString(),
				sha256: fetched.payload.sha256,
				retrievedAt: fetched.payload.retrievedAt,
			};
			const errors = headerErrors(fetched.raw.Header);
			if (errors !== null) throw new SourceFailure("http", errors.map(scrub));

			const query: AqsQuery = {
				service: io.query("service", ENDPOINT, AQS_VERSION, payload),
				period: io.query("bdate", `${summaryYear}0101`, AQS_VERSION, payload),
				year: summaryYear,
			};
			const selections = new Map<string, QueryProvenance>();
			for (const code of AQS_PARAM_CODES) {
				selections.set(code, io.query("param", code, AQS_VERSION, payload));
			}

			const built: Built<"aqs-monitor-summary">[] = [];
			for (const sent of fetched.raw.Data) {
				const row = scrubbedRow(sent, scrub);
				const pollutant = pollutantOf(row.parameter_code);
				const selection = selections.get(row.parameter_code);
				if (pollutant === null || selection === undefined) continue;
				built.push(annualSummaryBuilt({ raw: row, payload }, pollutant, selection, query));
			}
			return firstPerMonitor(built.filter((record) => withinBoundary(locus, record)));
		},
	};
}
