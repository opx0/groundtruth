/**
 * EPA AQS annual monitor summaries near the mapped point. Server-only.
 *
 * Read this before reading the code: one fact here is recorded, the envelope is
 * published, and the row is not. The file is built so that being wrong about
 * the row is loud rather than quiet.
 *
 * WHAT IS RECORDED. `tests/fixtures/aqs/rate-limited.json`, real bytes captured
 * live on 2026-09-16 from EPA's own published shared test account
 * (`email=test@aqs.api&key=test`), which is exhausted: HTTP 429,
 * `Retry-After: 86400`, body `{"error":"Daily limit for account use exceeded.
 * Retry later."}`. Re-checked once from this machine on 2026-09-16 against
 * `metaData/fieldsByService`, which answered the same 429 with the same
 * `Retry-After`. `lib/io/fetch-source-io.ts` turns that into
 * `SourceFailure("rate-limited", 429, "86400")` before any parse, so the
 * rate-limit case of `docs/BRIEF.md` B12 is backed by bytes.
 *
 * WHAT IS PUBLISHED. The envelope, at
 * `https://aqs.epa.gov/aqsweb/documents/data_api.html`, read 2026-09-16. Two
 * top-level arrays, `Header` and `Body`. `Header` carries `status`,
 * `request_time`, `url` and either `rows` or an `error` array; `Body` is one
 * object per row. It is `Body` and not `Data` — EPA's own OpenAPI file at
 * `https://aqs.epa.gov/aqsweb/documents/aqs_api_specification.json` says `Data`
 * in every response schema, which contradicts the page and its worked examples.
 * The page wins here, because the page carries the actual JSON. That conflict
 * is a live hazard rather than trivia, so
 * `tests/fixtures/aqs/derived-annual-summary-data-envelope.json` pins it:
 * a body whose second array is `Data` fails `AqsResponse` and the source
 * reports `malformed`, which is the loud failure, not a silent empty answer.
 *
 * WHAT IS NOT PUBLISHED. The columns. The page states that "the columns of data
 * returned are different for each query" and points at `metaData/fieldsByService`
 * for the per-service list — and that service needs a working key, which is the
 * thing this deployment does not have. So **no annualData column name is
 * published anywhere reachable from here**. Ten of the thirteen keys in
 * `AnnualSummaryRow` are EPA's own spelling — published for `sampleData`, in
 * the page's one worked row, and therefore published for a *different service*
 * of this API rather than for this one. The other three —`arithmetic_mean`,
 * `observation_count` and the singular spelling of `unit_of_measure` — are this
 * repository's own spelling of fields EPA names in prose and in its AirData
 * annual-summary file format, and no response has ever confirmed any of the
 * thirteen. `tests/fixtures/aqs/derived-annual-summary-houston.source.md`
 * argues every one of them, and every record built here carries a caveat saying
 * the shape has never been checked against a real response — worded for what is
 * actually true here, which is weaker than what `lib/adapters/fema.ts` can say
 * for NFHL: FEMA publishes the field names of S_Fld_Haz_Ar, and EPA publishes
 * no column list for `annualData` at all. `lib/templates/aqs.ts` carries the
 * same disclosure as a clause, so the reader meets it on the card and not only
 * in the trace.
 *
 * BEING WRONG IS LOUD. The schema is narrow on purpose: unknown columns are
 * stripped, but a declared column that is missing or differently typed fails
 * `z.safeParse` in `lib/io/fetch-source-io.ts` and the card says AQS could not
 * be read. The opposite failure — a permissive schema that puts a guessed
 * number on screen — is the one this product cannot afford.
 *
 * THE CREDENTIALS. AQS authenticates with two values, `AQS_EMAIL` and
 * `AQS_KEY`, the names `scripts/setup.sh` already writes. Both are read from
 * `process.env` inside `run` and nowhere else, never at module load, and
 * neither reaches a returned value. The email matters as much as the key: it is
 * the operator's own address, and a payload URL carrying it would print it in
 * the trace panel for every reader. This is the problem `lib/adapters/census.ts`
 * solves for the raw address and the solution is the same:
 * `annualSummaryQueryUrl` builds the URL without credentials and is what every
 * payload, provenance and value cites; `keyedRequestUrl` clones it, adds the
 * two, and that object never leaves the line that fetches with it. Nothing is
 * rebuilt from `fetched.payload.url`, because that is whatever `SourceIo` chose
 * to record and this file does not trust another module to have redacted for
 * it.
 *
 * AND EPA'S OWN WORDS CAN CARRY THEM BACK. Building the URL without the two is
 * only half of it. `run` forwards the header's `error` array verbatim into
 * `SourceFailure.rawCode`, and `lib/templates/sources.ts` renders that as "It
 * answered {rawCode}." — on the card, not only in the trace. EPA's failed
 * header echoes the request (`Header[0].url` carries the whole query string,
 * credentials included, which is why that key is not in the schema), and a
 * message naming what was wrong with `email` or `key` could quote the value.
 * `app/lib/report-contract.ts`'s `withoutSecretValues` is a backstop at the
 * wire, but this file is the only code holding the two while the response is in
 * hand, so the scrub belongs here: `credentialsOrFail` returns them together
 * with a `Scrub` built from both, and every string that came from EPA passes
 * through it before it reaches a record, a provenance or a thrown error — the
 * error array, and every string column of every row, because four of them are
 * joined into `sourceRecordId`. A string carrying a credential is replaced
 * whole rather than patched, so no fragment survives and no partial match can
 * miss a percent-encoded copy.
 *
 * AN ABSENT CREDENTIAL IS NOT AN EMPTY ANSWER. Without them the source was
 * never asked, which must not read as "AQS holds no monitor near this address",
 * so `run` throws before it fetches and the kernel reports `unavailable` — a
 * different screen state from `no-data` by construction, and one that costs no
 * request against a rate limit that is already exhausted.
 *
 * AND THE CAUSE IS NO LONGER THE HONEST PROBLEM. It was, and this comment
 * argued the wrong way out of it until 2026-09-16, so the argument is left here
 * rather than deleted: `FailureCause` in `lib/evidence/source.ts` was a closed
 * enum of six, `refused` would have asserted a host refused a connection nobody
 * opened and `http` would have asserted AQS answered — both false claims about
 * EPA — so this file settled for `unknown`, which asserts nothing about AQS at
 * all, and said the enum wanted a seventh member that was not this unit's to
 * add. `lib/adapters/airnow.ts` reached that same conclusion independently.
 *
 * The seventh member was added in `295e639` precisely because three units had
 * reached it. `run` throws `not-configured` and `lib/evidence/sentence.ts`
 * words it as "this deployment holds no credential for it", where `unknown`
 * had the card saying the reason was not known when it was the one thing that
 * was. Reading the paragraph above as a live argument would undo that commit.
 * `NO_KEY` stays the `rawCode`, now for the trace alone: the cause is what makes
 * the outcome machine-distinguishable.
 *
 * `pollutant` IS OUR WORD, NOT EPA'S. The kind types it
 * `Sourced<"PM2.5" | "Ozone">`, no field reader produces a literal union, and
 * AQS's own vocabulary is `88101` and `44201` with `parameter_name` spelling
 * them "PM2.5 - Local Conditions" and "Ozone". So it is built by `fromQuery`
 * against the `param` we sent, exactly as `lib/adapters/fema.ts` sources its
 * `dataset`. A row whose `parameter_code` is outside the two parses fine and
 * simply produces no record: the kind has two members and this file may not add
 * a third.
 *
 * `period` AND `statistic` ARE OUR WORDS TOO, AND FOR THE SAME REASON. The page
 * documents that for annual data "only the year portion of the bdate and edate
 * are used and only whole years of data are returned", so the year of a row is
 * the year we asked for; it is `fromQuery` over the `bdate` we sent rather than
 * a column, which is honest and needs no undocumented key. `statistic` is
 * `fromQuery` over the service we called: it names which of the service's
 * columns this record read, the way `datasetLabel` names which service answered
 * FEMA. Neither is a value EPA sent, and the trace says so.
 *
 * THE MONITOR ID IS SHORT BY ONE FIELD. AQS identifies a monitor by state,
 * county, site, parameter and POC. `poc` is a number in EPA's published row
 * (`"poc": 1.0`) and the kernel's `join` reads text fields only, so the id this
 * record carries is the site-and-parameter id without the occurrence code. The
 * consequence is stated rather than hidden: rows are deduplicated on that same
 * id, so two collocated instruments at one site contribute one record — the
 * first the service returned — and a caveat on every record says so. Making the
 * POC part of the id needs a kernel reader that can join a numeric column, and
 * this unit may not add one.
 *
 * ONE ROW PER MONITOR, AND WHY THE FIRST. `annualData` returns several rows for
 * one monitor and year: different sample durations, pollutant standards and
 * exceptional-event treatments. The columns that tell them apart
 * (`sample_duration`, `pollutant_standard`, `event_type` in the AirData file's
 * names) are not published for this service, so this file cannot select among
 * them without inventing three more key names. It keeps the first row for each
 * monitor and says so in a caveat. The alternative — emitting all of them —
 * would put several different means for one monitor on one card with nothing on
 * screen able to distinguish them.
 *
 * THE BOUNDARY IS B2's, NOT THE LOCUS'S. `docs/BRIEF.md` B2 fixes AQS at 50 km
 * and the report's `Locus.radiusMeters` is the five-mile facility boundary, so
 * this adapter uses its own constant. The bounding box the service takes is a
 * superset of that circle; `haversine` from the kernel does the actual
 * boundary, so a monitor in the box corner is dropped rather than shown as
 * "within 50 km".
 *
 * No type assertions, no non-null assertions, no `any`. Lint enforces it.
 */

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

/** The `dataset` stamped on every field's provenance. Names the service, not the agency. */
const DATASET = "aqs_annual_summary";

/** `docs/BRIEF.md` B2's endpoint. The credential-free form of it is what every value cites. */
export const ENDPOINT = "https://aqs.epa.gov/data/api/annualData/byBox";

/** The two request parameters the credentials travel in. AQS calls neither a password; both are secrets here. */
const EMAIL_PARAM = "email";
const KEY_PARAM = "key";

/** The environment variables `scripts/setup.sh` writes. Read in `run`, never at module load. */
export const EMAIL_ENV = "AQS_EMAIL";
export const KEY_ENV = "AQS_KEY";

/**
 * The `rawCode` of the outcome an unconfigured deployment produces. A marker of
 * ours, not something EPA said. It was the only thing separating this outcome
 * from any other `unknown` failure until `not-configured` existed; now the
 * cause carries that and this is what the trace shows beside it. Never a
 * credential and never a fragment of one.
 */
export const NO_KEY = "no-api-key";

/** `docs/BRIEF.md` B2's boundary table: AQS is 50 km, whatever radius the locus carries. */
export const AQS_RADIUS_METERS = 50_000;

/**
 * What a string from EPA is replaced by when it carries one of the two
 * credentials. Our words, never the agency's, and they say which of the two
 * happened: the source quoted a credential back, rather than this file printing
 * one. Never a credential and never a fragment of one.
 */
export const REDACTED_ECHO = "[redacted: the source's answer carried this deployment's credential]";

/** Replaces a string carrying either credential, whole. Applied to everything EPA sent. */
type Scrub = (text: string) => string;

/**
 * Both forms each credential can arrive in: as sent, and percent-encoded the
 * way a header that echoes the request URL back carries them — which is exactly
 * what EPA's own `Header[0].url` does.
 */
function scrubbing(secrets: readonly string[]): Scrub {
	const forms: readonly string[] = secrets.flatMap((secret) => [secret, encodeURIComponent(secret)]);
	return (text) => (forms.some((form) => text.includes(form)) ? REDACTED_ECHO : text);
}

/**
 * Metres in one degree of latitude on the sphere `haversine` uses
 * (R = 6371008.8 m). Only the request box is built from it, and a degree of
 * longitude is never longer than a degree of latitude, so the box always
 * contains the circle.
 */
const METERS_PER_DEGREE = (Math.PI * 6371008.8) / 180;

/** Near the poles the longitude span diverges; past this the box takes the whole meridian range instead. */
const MIN_COSINE = 0.01;

export type Pollutant = "PM2.5" | "Ozone";

/**
 * `docs/BRIEF.md` B2 names both codes. Not a `z.enum` and not a validation: a
 * row whose `parameter_code` is absent from this table is dropped, not
 * rejected, so an unfamiliar parameter never costs the report the rows beside
 * it.
 *
 * Read it through `pollutantOf` and never by indexing it. See there for why.
 */
export const AQS_PARAMETERS: Readonly<Record<string, Pollutant>> = {
	"88101": "PM2.5",
	"44201": "Ozone",
};

/**
 * The pollutant this report covers a row's `parameter_code` as, or null for
 * every other code EPA can send.
 *
 * `Object.hasOwn` and not `!== undefined`, because the table above is an object
 * literal and an index into one reaches `Object.prototype`:
 * `AQS_PARAMETERS["constructor"]` is a function and `["__proto__"]` is an
 * object. Until 2026-09-16 the guard here was the index alone, and such a row
 * was dropped only because `run` asks the `selections` map for the same code on
 * the next line and a `Map` has no prototype keys — a guard by coincidence
 * rather than by intent. `lib/adapters/airnow.ts` had the identical index with
 * nothing beside it, and there a `ParameterName` of `"constructor"` built a
 * record with a function in `pollutant.value` and cost the reader the whole
 * AirNow card. The comment on `pollutantOf` in that file has the trace.
 */
export function pollutantOf(parameterCode: string): Pollutant | null {
	if (!Object.hasOwn(AQS_PARAMETERS, parameterCode)) return null;
	return AQS_PARAMETERS[parameterCode] ?? null;
}

/** The order they are requested in, and the `param` value: "88101,44201". The page allows up to five. */
export const AQS_PARAM_CODES: readonly string[] = ["88101", "44201"];

/** Which column of the service this record reads. Our words for our own choice, never EPA's. */
export const STATISTIC = "annual arithmetic mean";

/**
 * EPA's published annual summary file for one year, which contains this
 * monitor's row. AQS has no public per-monitor page and its own API URL cannot
 * be a link, because a usable one carries a key; this is the one EPA address
 * that holds the record and needs no credential. Its id is the year, which is
 * the record's `period`.
 */
export const ANNUAL_FILE_URL = "https://aqs.epa.gov/aqsweb/airdata/annual_conc_by_monitor_{id}.zip";

const CAVEATS: readonly string[] = [
	// The brief's rule 3, in the register lib/adapters/fema.ts uses for NFHL —
	// but not in its words. NFHL's "follows FEMA's published field names" is
	// true of FEMA; EPA's worked example is a `sampleData` row and the page
	// publishes no column list for `annualData`, so the strongest honest claim
	// is the one below. lib/templates/aqs.ts says it on the card as well.
	"No response from this service has been recorded yet. The parse follows field names EPA publishes for a different"
		+ " service of the same API, and is unverified against real bytes.",
	// And the part fema.ts does not have to say: the field names are published
	// for a different service of the same API.
	"EPA publishes no column list for the annual summary service, so the mean, the observation count and the unit are"
		+ " read from column names this report derived: arithmetic_mean, observation_count and unit_of_measure.",
	// docs/BRIEF.md A2 and B2, and the API page's own first paragraph. Also
	// stated in the clause of lib/templates/aqs.ts that prints the year and the
	// value, so it qualifies them on screen; kept here too so a reader who
	// arrived through the trace rather than through the sentence still meets it.
	// fema.ts does the same with its parcel caveat.
	"AQS data lags collection by six months or more.",
	// A2's other caveat, in the clause that prints the distance for the same
	// reason, and here for the same one.
	"The monitor measures its own location, not this address.",
	"AQS returns more than one annual summary row for a monitor and year, and the columns that tell those rows apart"
		+ " are not published. This is the first row the service returned for this site and parameter.",
];

/* -------------------------------------------------------------------------- */
/* The response                                                               */
/* -------------------------------------------------------------------------- */

/**
 * One annual summary row.
 *
 * Ten of the thirteen keys are EPA's own, copied from the published row in the
 * "Output Format - JSON" section of `data_api.html` — which is a `sampleData`
 * row, so they are published for this API and not for this service. Three are
 * derived, and `unit_of_measure` is one of the three rather than one of the
 * ten: the published row's spelling is singular and EPA's own annual-summary
 * file format spells the same field plural, so choosing between them for this
 * service is this repository's choice and not EPA's statement.
 *
 *   arithmetic_mean    the page names no mean column; the AirData annual
 *                      summary file calls the field "Arithmetic Mean".
 *   observation_count  the page names "the 'observation count' field on the
 *                      annualData service" in prose and never spells it.
 *   unit_of_measure    the published row's singular spelling. The annual
 *                      summary file calls the same field "Units of Measure",
 *                      so this is the coin-flip most likely to be wrong, and
 *                      being wrong means `malformed`, not a wrong unit.
 *
 * Every string is `z.string()`, never `z.enum()`: a unit or a parameter name
 * this file has never seen reaches the screen unchanged. `date_of_last_change`
 * is nullable out of caution — the published row shows a date, and `uncertainty`
 * on the same row shows that nulls occur. Columns the service certainly sends
 * and this file does not read (`year`, `sample_duration`, `pollutant_standard`,
 * `event_type`, `local_site_name`, …) are left out and stripped by zod, because
 * the rule is that an undocumented column stays out of the schema and out of
 * the record.
 */
export const AnnualSummaryRow = z.object({
	state_code: z.string(),
	county_code: z.string(),
	site_number: z.string(),
	parameter_code: z.string(),
	/** A number in EPA's published row ("poc": 1.0). Validated, and not on the record: `join` reads text only. */
	poc: z.number(),
	latitude: z.number(),
	longitude: z.number(),
	/** Validated and unread, like FEMA's STATIC_BFE: the record kind has no datum field to put it on. */
	datum: z.string(),
	parameter_name: z.string(),
	unit_of_measure: z.string(),
	date_of_last_change: z.string().nullable(),
	arithmetic_mean: z.number(),
	observation_count: z.number().nullable(),
});
export type AnnualSummaryRow = z.infer<typeof AnnualSummaryRow>;

/**
 * The failed header the page documents: status, and an array of error messages
 * in place of a row count. It arrives with HTTP 400, so
 * `lib/io/fetch-source-io.ts` fails the request before this is ever consulted —
 * but ECHO and ArcGIS both deliver errors at HTTP 200, and if AQS ever does,
 * an error header must not be read as a successful empty answer.
 */
const AqsFailedHeader = z.object({ status: z.string(), error: z.array(z.string()) });

/** Any other header. `status` is `z.string()`: an unknown status survives verbatim and is never mapped. */
const AqsOkHeader = z.object({ status: z.string() });

export const AqsHeaderEntry = z.union([AqsFailedHeader, AqsOkHeader]);
export type AqsHeaderEntry = z.infer<typeof AqsHeaderEntry>;

/**
 * `Body`, not `Data`. EPA's OpenAPI file says `Data` and the documentation page
 * and its worked examples say `Body`; the page carries the actual JSON, so the
 * page wins and a `Data` envelope is a parse failure rather than an empty
 * answer. `request_time`, `url` and the row count are documented and unread, so
 * they are not declared — and the page's own prose calls the count `row` while
 * both its examples call it `rows`, which is one more reason not to depend on
 * it. The truth about how many rows arrived is `Body.length`.
 */
export const AqsResponse = z.object({
	Header: z.array(AqsHeaderEntry),
	Body: z.array(AnnualSummaryRow),
});
export type AqsResponse = z.infer<typeof AqsResponse>;

/**
 * Whatever the header said went wrong, verbatim and never mapped into our
 * vocabulary. Null when nothing did. Typed as the array of EPA's own strings it
 * is rather than as `JsonValue`, so `run` can scrub each one before it becomes
 * a `rawCode` the card prints.
 */
export function headerErrors(header: readonly AqsHeaderEntry[]): readonly string[] | null {
	for (const entry of header) {
		if ("error" in entry && entry.error.length > 0) return entry.error;
	}
	return null;
}

/* -------------------------------------------------------------------------- */
/* The request                                                                */
/* -------------------------------------------------------------------------- */

function radians(degrees: number): number {
	return (degrees * Math.PI) / 180;
}

function clamp(value: number, low: number, high: number): number {
	return Math.min(high, Math.max(low, value));
}

/** Six decimals, so the citable URL is stable and a test can assert it whole. */
function degrees(value: number): string {
	return value.toFixed(6);
}

/**
 * The box `byBox` takes, around the mapped point, big enough to contain the
 * 50 km circle. The circle itself is enforced afterwards by `haversine`.
 */
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

/**
 * The citable URL: everything the request carries except the two credentials.
 * This is what every payload, provenance and returned value quotes, and it is
 * built before the credentials exist rather than by deleting them afterwards.
 */
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

/**
 * The URL actually fetched. The returned object is used on one line and is
 * never stored, returned, stamped on a payload or named in an error.
 */
function keyedRequestUrl(citable: URL, email: string, key: string): URL {
	const url = new URL(citable.toString());
	url.searchParams.set(EMAIL_PARAM, email);
	url.searchParams.set(KEY_PARAM, key);
	return url;
}

/**
 * Both credentials and the scrub built from them, or a failure that says the
 * source was never asked. Reads `process.env` at the point of use. The three
 * come back together because this is the one place that holds the secrets, and
 * everything EPA says back has to be checked against them.
 */
function credentialsOrFail(): { readonly email: string; readonly key: string; readonly scrub: Scrub } {
	const email = process.env[EMAIL_ENV];
	const key = process.env[KEY_ENV];
	if (email === undefined || email === "" || key === undefined || key === "") {
		throw new SourceFailure("not-configured", NO_KEY);
	}
	return { email, key, scrub: scrubbing([email, key]) };
}

/**
 * The most recent calendar year AQS can plausibly hold a whole annual summary
 * for. The page's own first paragraph says "it can take 6 months or more from
 * the time data is collected until it is in AQS", so the current year is never
 * complete and the previous one is the most recent that can be. A year AQS has
 * not loaded yet answers with no rows, and the adapter's no-data note names the
 * year so that silence is readable.
 */
export function latestLikelySummaryYear(retrievedAt: string): number {
	const year = new Date(retrievedAt).getUTCFullYear();
	// Not a `SourceFailure`: nothing about AQS went wrong. A clock that cannot be
	// read is our own invariant, and the alternative is a request for year NaN.
	if (Number.isNaN(year)) throw new ReaderInvariant(`"${retrievedAt}" is not an instant this clock can read`);
	return year - 1;
}

/* -------------------------------------------------------------------------- */
/* The record                                                                 */
/* -------------------------------------------------------------------------- */

/** The three query provenances every record of one run shares, and the year behind two of them. */
export type AqsQuery = {
	/** parameter `service`, value the credential-free endpoint. Behind `statistic`. */
	readonly service: QueryProvenance;
	/** parameter `bdate`, value `YYYY0101`. Behind `period` and `effectiveAt`. */
	readonly period: QueryProvenance;
	readonly year: number;
};

/**
 * One row with every string column checked. Four of them — `state_code`,
 * `county_code`, `site_number`, `parameter_code` — are joined into
 * `sourceRecordId`, which is the record's identity and reaches the card, and
 * `unit_of_measure` is printed beside the mean. A credential has no business in
 * any of them — but "has no business" is not something this file gets to assume
 * about bytes from a service it has never had a successful answer from, and the
 * raw string reaches the trace as well as the value.
 */
function scrubbedRow(row: AnnualSummaryRow, scrub: Scrub): AnnualSummaryRow {
	return {
		...row,
		state_code: scrub(row.state_code),
		county_code: scrub(row.county_code),
		site_number: scrub(row.site_number),
		parameter_code: scrub(row.parameter_code),
		datum: scrub(row.datum),
		parameter_name: scrub(row.parameter_name),
		unit_of_measure: scrub(row.unit_of_measure),
		date_of_last_change: row.date_of_last_change === null ? null : scrub(row.date_of_last_change),
	};
}

/**
 * AQS's own monitor id, minus the POC: state, county, site and parameter joined
 * as EPA writes them. `coalesce` keeps the slot non-null — `join` returns null
 * only when all four columns are empty — so the id can be the record's identity
 * as well as a slot a template prints.
 */
function monitorIdOf(row: Fetched<AnnualSummaryRow>) {
	const fields = fieldsOf(row, DATASET, AQS_VERSION);
	return coalesce(
		fields.join(["state_code", "county_code", "site_number", "parameter_code"], "-"),
		fields.text("site_number"),
	);
}

/**
 * One record from one row.
 *
 * `selection` is the provenance of the `param` this report asked about,
 * `query.service` of the service we called, and `query.period` of the year we
 * asked for. All three are query provenances because none of the three values
 * was sent by EPA: one is our vocabulary, one names the column we read, and one
 * is the year in our own request.
 */
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
		// The id read a second time. AQS publishes no site-name column for this
		// service, so the id is the only name this record can carry.
		subject: monitorIdOf(row),
		location: fields.point("latitude", "longitude", {}),
		// An annual summary is effective for the year it summarises, and that
		// year is the one we asked for. The same value as `period`, so the trace
		// shows one provenance under both names.
		effectiveAt: period,
		sourceUpdatedAt: fields.date("date_of_last_change"),
		caveats: CAVEATS,
		monitorId,
		pollutant: fromQuery(selection, pollutant),
		period,
		statistic: fromQuery(query.service, STATISTIC),
		value: fields.number("arithmetic_mean"),
		unit: fields.text("unit_of_measure"),
		observationCount: fields.number("observation_count"),
	};
}

/* -------------------------------------------------------------------------- */
/* The adapter                                                                */
/* -------------------------------------------------------------------------- */

/** B2's boundary and the year asked for, in the wording B10 gives an empty answer. */
export function noMonitorsNote(year: number): string {
	return (
		`EPA's Air Quality System returned no ${year} annual summary for a PM2.5 or ozone monitor within`
		+ ` ${AQS_RADIUS_METERS / 1000} km of the mapped point. AQS lags collection by six months or more, so a recent`
		+ " year may not be loaded yet."
	);
}

export type AqsAdapter = Adapter<"aqs-monitor-summary"> & { readonly summaryYear: number };

/** Within 50 km of the locus, by the kernel's own formula. A record with no coordinate cannot be inside a boundary. */
function withinBoundary(locus: Locus, built: Built<"aqs-monitor-summary">): boolean {
	const location = built.location;
	if (location === null) return false;
	return haversine(locus.point, location).value <= AQS_RADIUS_METERS;
}

/** The first record for each monitor id, in the order the service sent them. */
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

/**
 * One adapter per summary year, so the year a card reports on is a decision the
 * caller made and can state, not one buried in a clock read. `noDataNote` names
 * it, which is the only way an empty AQS answer can say which year it was
 * empty for: `lib/report/selection.ts` reads that note onto the card.
 */
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
			// Rebuilt from the credential-free URL, never from
			// `fetched.payload.url`: that is the URL SourceIo fetched, and this
			// file does not trust another module to have redacted it.
			const payload: PayloadRef = {
				url: citable.toString(),
				sha256: fetched.payload.sha256,
				retrievedAt: fetched.payload.retrievedAt,
			};
			const errors = headerErrors(fetched.raw.Header);
			// EPA's own words, never mapped into ours — but scrubbed, because
			// `lib/templates/sources.ts` prints this on the card, and a header that
			// echoes the request it rejected would print a credential with it.
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
			for (const sent of fetched.raw.Body) {
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
