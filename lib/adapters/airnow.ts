import { z } from "zod";
import type {
	Adapter,
	AdapterVersion,
	Built,
	Fetched,
	JsonValue,
	Locus,
	QueryProvenance,
	SourceIo,
} from "@/lib/evidence";
import { coalesce, fieldsOf, fromQuery, SourceFailure } from "@/lib/evidence";

export const AIRNOW_VERSION: AdapterVersion = "airnow@1";

const DATASET = "airnow_current_observations";

const ENDPOINT = "https://www.airnowapi.org/aq/observation/latLong/current/";

const KEY_PARAM = "API_KEY";

export const KEY_ENV = "AIRNOW_KEY";

export const NO_KEY = "no-api-key";

export const REDACTED_ECHO = "[redacted: the source's answer carried this deployment's key]";

type Scrub = (text: string) => string;

function scrubbing(key: string): Scrub {
	const forms: readonly string[] = [key, encodeURIComponent(key)];
	return (text) => (forms.some((form) => text.includes(form)) ? REDACTED_ECHO : text);
}

export type Pollutant = "PM2.5" | "Ozone";

export const AIRNOW_PARAMETERS: Readonly<Record<string, Pollutant>> = {
	"PM2.5": "PM2.5",
	O3: "Ozone",
};

export function pollutantOf(parameterName: string): Pollutant | null {
	if (!Object.hasOwn(AIRNOW_PARAMETERS, parameterName)) return null;
	return AIRNOW_PARAMETERS[parameterName] ?? null;
}

export const AirNowObservation = z.object({
	ReportingArea: z.string(),
	ParameterName: z.string(),
	DateObserved: z.string(),
	AQI: z.number().nullable(),
});
export type AirNowObservation = z.infer<typeof AirNowObservation>;

export const AirNowWebServiceError = z.object({
	WebServiceError: z.array(z.object({ Message: z.string() })),
});
export type AirNowWebServiceError = z.infer<typeof AirNowWebServiceError>;

export const AirNowResponse = z.union([AirNowWebServiceError, z.array(AirNowObservation)]);
export type AirNowResponse = z.infer<typeof AirNowResponse>;

export function observationQueryUrl(locus: Locus): URL {
	const url = new URL(ENDPOINT);
	url.searchParams.set("format", "application/json");
	url.searchParams.set("latitude", String(locus.point.latitude.value));
	url.searchParams.set("longitude", String(locus.point.longitude.value));
	return url;
}

function keyedRequestUrl(locus: Locus, key: string): URL {
	const url = observationQueryUrl(locus);
	url.searchParams.set(KEY_PARAM, key);
	return url;
}

const CAVEATS: readonly string[] = [
	"AirNow reports preliminary current conditions and updates them hourly.",
	"The values describe AirNow's own reporting area, which covers more than the mapped point.",
];

export function airnowObservationBuilt(
	row: Fetched<AirNowObservation>,
	pollutant: Pollutant,
	selection: QueryProvenance,
	request: QueryProvenance,
): Built<"airnow-observation"> {
	const fields = fieldsOf(row, DATASET, AIRNOW_VERSION);
	const requestUrl = typeof request.value === "string" ? request.value : request.payload.url;
	return {
		kind: "airnow-observation",
		source: "airnow",
		sourceRecordId: `${row.raw.ReportingArea}/${row.raw.ParameterName}`,
		sourceUrl: fromQuery(request, requestUrl),
		subject: coalesce(fields.join(["ReportingArea", "ParameterName"], " "), fields.text("ReportingArea")),
		location: null,
		effectiveAt: fields.date("DateObserved"),
		sourceUpdatedAt: fields.absent("SourceUpdatedAt"),
		caveats: CAVEATS,
		reportingArea: fields.text("ReportingArea"),
		pollutant: fromQuery(selection, pollutant),
		observedAt: fields.date("DateObserved"),
		aqi: fields.number("AQI"),
		category: fields.absent("Category"),
		concentration: fields.absent("Concentration"),
		unit: fields.absent("Unit"),
	};
}

function scrubbedRow(row: AirNowObservation, scrub: Scrub): AirNowObservation {
	return {
		ReportingArea: scrub(row.ReportingArea),
		ParameterName: scrub(row.ParameterName),
		DateObserved: scrub(row.DateObserved),
		AQI: row.AQI,
	};
}

function selected(rows: readonly AirNowObservation[]): readonly { row: AirNowObservation; pollutant: Pollutant }[] {
	const out: { row: AirNowObservation; pollutant: Pollutant }[] = [];
	for (const row of rows) {
		const pollutant = pollutantOf(row.ParameterName);
		if (pollutant !== null) out.push({ row, pollutant });
	}
	return out;
}

function keyOrFail(): { readonly key: string; readonly scrub: Scrub } {
	const key = process.env[KEY_ENV];
	if (key === undefined || key === "") throw new SourceFailure("not-configured", NO_KEY);
	return { key, scrub: scrubbing(key) };
}

export const airnowAdapter: Adapter<"airnow-observation"> = {
	kind: "airnow-observation",
	source: "airnow",
	version: AIRNOW_VERSION,
	async run(locus: Locus, io: SourceIo): Promise<readonly Built<"airnow-observation">[]> {
		const { key, scrub } = keyOrFail();
		const citable = observationQueryUrl(locus);
		const fetched = await io.get(keyedRequestUrl(locus, key), AirNowResponse);
		const payload = { url: citable.toString(), sha256: fetched.payload.sha256, retrievedAt: fetched.payload.retrievedAt };
		const body = fetched.raw;
		if (!Array.isArray(body)) {
			const [first] = body.WebServiceError;
			const message: JsonValue = first === undefined ? null : scrub(first.Message);
			throw new SourceFailure("http", message);
		}
		const request = io.query("request", payload.url, AIRNOW_VERSION, payload);
		return selected(body.map((row) => scrubbedRow(row, scrub))).map(({ row, pollutant }) =>
			airnowObservationBuilt(
				{ raw: row, payload },
				pollutant,
				io.query("pollutant", pollutant, AIRNOW_VERSION, payload),
				request,
			),
		);
	},
};
