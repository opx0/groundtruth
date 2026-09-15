/**
 * AirNow current preliminary conditions at the mapped point. Server-only.
 *
 * Read this before reading the code: the success shape was derived rather than
 * documented, and a real response has since confirmed it. The file is still
 * built so that being wrong is loud rather than quiet, because that is what the
 * derivation was betting on.
 *
 * WHAT IS RECORDED. Three responses, all real bytes from this machine.
 *
 * `tests/fixtures/airnow/current-observations-houston.json`, captured
 * 2026-09-16 with a key an operator registered that day, at the
 * demonstration's own coordinate: three rows, O3, PM2.5 and PM10, each
 * carrying an index. `tests/fixtures/airnow/no-observations.json` is the same
 * query where AirNow has no reporting area — a bare `[]`, which is the
 * answered-with-nothing state and not a failure.
 * `tests/fixtures/airnow/unauthenticated.json` is the error envelope, HTTP 401,
 * `www-authenticate: proprietary`, body
 * `{"WebServiceError":[{"Message":"Request not authenticated."}]}`.
 *
 * THE DOCUMENTATION IS STILL NOT. `docs/BRIEF.md` B2 marked the success shape
 * unverified and it was, for the whole of the build: AirNow's per-service
 * documentation is behind a login —
 * `https://docs.airnowapi.org/CurrentObservationsByLatLon/docs` answers 302 to
 * `/login`, as do `/files` and `/feeds`, checked 2026-09-16 — and the one
 * public page, `https://docs.airnowapi.org/webservices`, describes this service
 * in a single line ("Get current AQI values and categories for a reporting area
 * by latitude and longitude") and names no response field. It also lists this
 * service under "Web Services that will be retired in the fall of 2026", which
 * is worth knowing before anyone builds further on it.
 *
 * So `AirNowObservation` carries four keys and no more, chosen before any
 * response existed: the three that `lib/evidence/records.ts` forces to be
 * non-null on this kind, and the one nullable field that public line supports.
 * All four came back spelled exactly as derived. `Category`, `Concentration`,
 * `Unit` and any coordinate are read as `absent` and stay that way — the
 * recording carries `Category` as an object, which is precisely the shape a
 * guess about it would have had to invent, so the rule that kept it out earned
 * its keep rather than merely being cautious.
 *
 * AND THAT RULE IS APPLIED ASYMMETRICALLY HERE, WHICH IS WORTH SAYING OUT LOUD.
 * `.dev/briefs/U1.6-U1.7-air.md` rule 2 says that where the documentation does
 * not say, do not invent. Nothing published names *any* column of this service,
 * so read strictly the rule empties the schema and this adapter cannot exist.
 * The four keys that stay are not better documented than the three that go:
 * `ReportingArea`, `ParameterName` and `DateObserved` are kept because
 * `lib/evidence/records.ts` declares `reportingArea`, `pollutant` and
 * `observedAt` non-null on this kind and a record cannot be built without them,
 * and `AQI` is kept because it is the one field the public one-line description
 * names that the kind also holds. `Category` is named by that same line and is
 * still dropped, because nothing requires it and nothing said whether it was a
 * string or an object — so a guess about it would have been a guess this report
 * did not have to make, and the recording shows it would have been wrong: it
 * arrives as `{"Number":1,"Name":"Good"}`. That is the exception, stated: the
 * kind's own requirements are what the four names were derived against, and the
 * three omissions are what rule 2 gets where nothing forces a name.
 *
 * BEING WRONG IS LOUD. A narrow schema is the point. If AirNow's keys differ
 * from these, `z.safeParse` in `lib/io/fetch-source-io.ts` fails and the source
 * reports `malformed` — the card says AirNow could not be read, and no record
 * exists carrying a value this file guessed at. The failure mode of a wide,
 * permissive schema is the opposite one, and it is the one that puts a wrong
 * number on screen. Until 2026-09-16 every record built here also carried a
 * caveat saying the shape had never been checked against a real response, and
 * both templates in `lib/templates/airnow.ts` carried it as a clause because an
 * audit found `caveats` reaches the trace panel and never the card. The
 * response arrived, all four names were right, and those three statements are
 * gone. What is left is the two caveats that are about AirNow rather than about
 * this repository's confidence in itself.
 *
 * B12's UNKNOWN-STATUS CASE IS NOT REACHABLE FOR THIS SOURCE. `docs/BRIEF.md`
 * B12 asks each adapter to cover a status it has never seen, which for ECHO is
 * `Message` and for AQS is `Header[].status`. AirNow's modelled success shape
 * has no status field at all — nothing public names one, so rule 2 keeps one
 * out — and the recorded 401 has none either: its envelope is
 * `WebServiceError`, a message and nothing more. What stands in its place is
 * the other kind of vocabulary AirNow can send: a `ParameterName` outside
 * `AIRNOW_PARAMETERS`, which drops its own row and costs the rows beside it
 * nothing, and an area name or date format this file has never seen, which
 * survive verbatim. `tests/unit/adapters/airnow.test.ts` names that case for
 * what it is rather than for the case it stands in for.
 *
 * THE KEY. `AIRNOW_KEY` — the name `scripts/setup.sh` and `.env.example`
 * already use — is read from `process.env` inside `run` and nowhere else. It
 * is never read at module load and never stored. The request URL has to carry
 * it, which is exactly the problem `lib/adapters/census.ts` solves for the raw
 * address, and this file solves it the same way and for the same reason: a
 * payload URL that carried a live key would put that key in the trace panel, on
 * screen, for every reader. `observationQueryUrl` builds the URL without the
 * key and is what every returned value cites; `keyedRequestUrl` clones it and
 * adds the key, and that object never leaves the one line that fetches with it.
 * Nothing is rebuilt from `fetched.payload.url` — that is whatever `SourceIo`
 * chose to record, and this file does not trust another module to have redacted
 * for it.
 *
 * AND THE SOURCE'S OWN WORDS CAN CARRY IT BACK. Keeping the key out of what
 * this file constructs is only half of it. `run` forwards AirNow's `Message`
 * verbatim into `SourceFailure.rawCode`, and `lib/templates/sources.ts` renders
 * that as "It answered {rawCode}." — on the card, not only in the trace. A host
 * that echoes the request it could not authenticate puts the key on screen, and
 * a test proving this file does not *construct* a leak would read as proving it
 * *filters* one. `app/lib/report-contract.ts`'s `withoutSecretValues` is a
 * backstop at the wire, but the adapter is the only code holding the secret
 * while the response is in hand, so the scrub belongs here. `keyOrFail` returns
 * the key and a `Scrub` built from it, and every string that came from AirNow
 * passes through that scrub before it reaches a record, a provenance or a
 * thrown error: the agency's message, and every string column of every row,
 * because `ReportingArea` and `ParameterName` are joined into `sourceRecordId`.
 * A string carrying the key is replaced whole rather than patched, so no
 * mangled remainder of a credential is left on screen and no partial match can
 * miss a re-encoded copy of it.
 *
 * AN ABSENT KEY IS NOT AN EMPTY ANSWER. Without a key the source was never
 * asked, which must not read as "AirNow holds nothing for this address". So
 * `run` throws before it fetches and the kernel reports `unavailable`, which is
 * a different screen state from `no-data` by construction.
 *
 * AND THE CAUSE IS NO LONGER THE HONEST PROBLEM IN THIS FILE. It was, and this
 * comment argued the wrong way out of it until 2026-09-16, so the argument is
 * left here rather than deleted: `FailureCause` in `lib/evidence/source.ts` was
 * a closed enum of six, `refused` would have asserted a host refused a
 * connection nobody opened and `http` would have asserted the source answered —
 * both false claims about AirNow — so this file settled for `unknown`, which
 * asserts nothing about AirNow at all, and said the enum wanted a seventh
 * member that was not this unit's to add.
 *
 * The seventh member was added in `295e639`, after three separate units reached
 * that same conclusion and settled the same way. `run` throws `not-configured`
 * and `lib/evidence/sentence.ts` words it as "this deployment holds no
 * credential for it", where `unknown` had the card saying the reason was not
 * known when it was the one thing that was. Reading the paragraph above as a
 * live argument would undo that commit. `NO_KEY` stays the `rawCode`, now for
 * the trace alone: the cause is what makes the outcome machine-distinguishable.
 *
 * NO DISTANCE. B2's boundary row for AirNow is "the reporting area AirNow
 * returns", and an area contains the mapped point rather than sitting some way
 * from it. Nothing reachable says this service returns a coordinate either, so
 * `location` is null and the kernel computes no `distanceMeters`. This is the
 * same decision `lib/adapters/fema.ts` makes for a polygon.
 *
 * `pollutant` IS OUR WORD, NOT AIRNOW'S. The kind types it
 * `Sourced<"PM2.5" | "Ozone">`, no field reader produces a literal union, and
 * neither agency sends that vocabulary. It is the parameter this report covers,
 * so it is built by `fromQuery` against a query provenance, exactly as
 * `lib/adapters/fema.ts` sources its `dataset`. `pollutantOf` selects the rows
 * against `AIRNOW_PARAMETERS`: a `ParameterName` outside it parses fine and
 * simply produces no record, because the kind has two members and this file may
 * not add a third. It is an own-property read rather than an index, and the
 * comment on `pollutantOf` says what an index cost before 2026-09-16. AirNow's
 * own parameter string does reach the trace, through `subject`, which is the
 * reporting area and the parameter joined — that is the only slot on this kind
 * that can hold the agency's own word for what was measured.
 *
 * No type assertions, no non-null assertions, no `any`. Lint enforces it.
 */

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

/** The `dataset` stamped on every field's provenance. Names the service, not the agency. */
const DATASET = "airnow_current_observations";

/**
 * `docs/BRIEF.md` B2's path, on the host B2's own host redirects to. This is
 * the `sourceUrl` printed on every AirNow record, so it may not be a URL nobody
 * has confirmed resolves; checked from this machine on 2026-09-16:
 *
 *   GET https://airnowapi.org/aq/observation/latLong/current?...
 *     -> HTTP/2 301, server: awselb/2.0,
 *        location: https://www.airnowapi.org:443/aq/observation/latLong/current?...
 *   GET https://www.airnowapi.org/aq/observation/latLong/current?...
 *     -> HTTP/2 401, www-authenticate: proprietary,
 *        {"WebServiceError":[{"Message":"Request not authenticated."}]}
 *
 * — the same bytes `tests/fixtures/airnow/unauthenticated.json` holds. So B2's
 * `airnowapi.org` is a redirect and `www.` is the host that answers; citing the
 * redirect would cite a URL that does not serve this service, and following one
 * silently would print a URL the reader cannot repeat. The trailing slash is
 * this file's and B2 does not carry it; both forms answered the same 401.
 * The parameter names below are not B2's and are not verified.
 */
const ENDPOINT = "https://www.airnowapi.org/aq/observation/latLong/current/";

/** The query parameter the key travels in. Unverified, like the rest of the request. */
const KEY_PARAM = "API_KEY";

/** The environment variable `scripts/setup.sh` writes and `.env.example` declares. Read in `run`, never at module load. */
export const KEY_ENV = "AIRNOW_KEY";

/**
 * The `rawCode` of the outcome an unconfigured deployment produces. A marker of
 * ours, not something AirNow said. It was the only thing separating this
 * outcome from any other `unknown` failure until `not-configured` existed; now
 * the cause carries that and this is what the trace shows beside it. Never a
 * key and never a fragment of one.
 */
export const NO_KEY = "no-api-key";

/**
 * What a string from AirNow is replaced by when it carries this deployment's
 * key. Our words, never the agency's, and they say which of the two happened:
 * the source quoted the credential back, rather than this file printing one.
 */
export const REDACTED_ECHO = "[redacted: the source's answer carried this deployment's key]";

/** Replaces a string carrying the credential, whole. Applied to everything AirNow sent. */
type Scrub = (text: string) => string;

/**
 * Both forms the key can arrive in: as sent, and percent-encoded the way a host
 * echoing the request URL back inside a message would carry it.
 */
function scrubbing(key: string): Scrub {
	const forms: readonly string[] = [key, encodeURIComponent(key)];
	return (text) => (forms.some((form) => text.includes(form)) ? REDACTED_ECHO : text);
}

export type Pollutant = "PM2.5" | "Ozone";

/**
 * AirNow's parameter string to the two-word vocabulary `docs/BRIEF.md` B4 fixes
 * for this kind. Not a `z.enum` and not a validation: a row whose parameter is
 * absent from this table is dropped, not rejected, so an unfamiliar parameter
 * never costs the report the rows beside it.
 *
 * Read it through `pollutantOf` and never by indexing it. See there for why.
 */
export const AIRNOW_PARAMETERS: Readonly<Record<string, Pollutant>> = {
	"PM2.5": "PM2.5",
	O3: "Ozone",
};

/**
 * The pollutant this report covers a row's parameter as, or null for every
 * other string AirNow can send.
 *
 * `Object.hasOwn` and not `!== undefined`, because the table above is an object
 * literal and an index into one reaches `Object.prototype`:
 *
 *   AIRNOW_PARAMETERS["NO2"]         -> undefined         (dropped)
 *   AIRNOW_PARAMETERS["constructor"] -> [Function Object]  (kept, until 2026-09-16)
 *   AIRNOW_PARAMETERS["__proto__"]   -> {}                 (kept, until 2026-09-16)
 *
 * A row kept that way built a record with a function or an object in
 * `pollutant.value`, which this kind types as one of two words. The wire schema
 * in `app/lib/report-contract.ts` then refused the record and the whole AirNow
 * card was lost — no `card:airnow` event at all, so the reader got "Sources
 * settled: 5 of 6" with nothing naming the source that went missing. One string
 * in one row, and the guard against it was one word.
 *
 * `lib/adapters/aqs.ts` has the same table and now the same read. There the row
 * was dropped anyway, by the `selections` lookup beside it rather than by the
 * table, which is a guard against this by coincidence and not by intent.
 */
export function pollutantOf(parameterName: string): Pollutant | null {
	if (!Object.hasOwn(AIRNOW_PARAMETERS, parameterName)) return null;
	return AIRNOW_PARAMETERS[parameterName] ?? null;
}

/**
 * One current observation. Four keys, every one of them derived before any
 * response existed and every one of them confirmed by
 * `tests/fixtures/airnow/current-observations-houston.json` on 2026-09-16.
 *
 * `ReportingArea`, `ParameterName` and `DateObserved` are `z.string()` and
 * never an enum or a date shape: an area name, a parameter and a timestamp
 * format this file has never seen all survive verbatim. `AQI` is nullable out
 * of caution rather than from documentation — nothing reachable says what
 * AirNow sends for a reporting area with no current index, and the recording
 * carries an index on every row, so `derived-null-aqi.json` is still an
 * authored body and the record built from it still says so.
 */
export const AirNowObservation = z.object({
	ReportingArea: z.string(),
	ParameterName: z.string(),
	DateObserved: z.string(),
	AQI: z.number().nullable(),
});
export type AirNowObservation = z.infer<typeof AirNowObservation>;

/**
 * The one shape here backed by recorded bytes:
 * `tests/fixtures/airnow/unauthenticated.json`, captured live 2026-09-16.
 */
export const AirNowWebServiceError = z.object({
	WebServiceError: z.array(z.object({ Message: z.string() })),
});
export type AirNowWebServiceError = z.infer<typeof AirNowWebServiceError>;

/**
 * The recorded error envelope arrived with HTTP 401, so `lib/io/fetch-source-io.ts`
 * turns it into a failure before this union is ever consulted. The union is here
 * for the other case: ECHO and ArcGIS both deliver errors at HTTP 200, and if
 * AirNow ever does, an error envelope must not be read as a list of
 * observations.
 */
export const AirNowResponse = z.union([AirNowWebServiceError, z.array(AirNowObservation)]);
export type AirNowResponse = z.infer<typeof AirNowResponse>;

/**
 * The citable URL: everything the request carries except the key. This is what
 * every payload, provenance and returned value in this file quotes, and it is
 * built before the key exists rather than by deleting the key afterwards.
 */
export function observationQueryUrl(locus: Locus): URL {
	const url = new URL(ENDPOINT);
	url.searchParams.set("format", "application/json");
	url.searchParams.set("latitude", String(locus.point.latitude.value));
	url.searchParams.set("longitude", String(locus.point.longitude.value));
	return url;
}

/**
 * The URL actually fetched. The returned object is used on one line and is
 * never stored, returned, stamped on a payload or named in an error.
 */
function keyedRequestUrl(locus: Locus, key: string): URL {
	const url = observationQueryUrl(locus);
	url.searchParams.set(KEY_PARAM, key);
	return url;
}

// The caveat that stood at the head of this list until 2026-09-16 -- "No
// response from this service has been recorded yet" -- is gone, because one
// was. AirNow's per-service documentation is still behind a login and its field
// list is still not published, but every field this adapter reads is now read
// off a real response rather than guessed: `ReportingArea`, `ParameterName`,
// `DateObserved` and `AQI` all arrived exactly as derived, which is the one
// case where a guess being right is worth recording.
// `tests/fixtures/airnow/current-observations-houston.json` is that response.
const CAVEATS: readonly string[] = [
	// docs/BRIEF.md B2: "Current preliminary conditions", "Observations update hourly."
	"AirNow reports preliminary current conditions and updates them hourly.",
	// Also stated in a clause of lib/templates/airnow.ts, so it qualifies the
	// value on screen; kept here too so a reader who arrived through the trace
	// rather than through the sentence still meets it. fema.ts does the same.
	"The values describe AirNow's own reporting area, which covers more than the mapped point.",
];

/**
 * One record from one row.
 *
 * `selection` is the provenance of the pollutant this report asked about, and
 * `request` the provenance of the key-free request URL. Both are query
 * provenances because neither value was sent by AirNow: one is our vocabulary,
 * the other is our request.
 */
export function airnowObservationBuilt(
	row: Fetched<AirNowObservation>,
	pollutant: Pollutant,
	selection: QueryProvenance,
	request: QueryProvenance,
): Built<"airnow-observation"> {
	const fields = fieldsOf(row, DATASET, AIRNOW_VERSION);
	// The key-free URL the request provenance states. `QueryProvenance.value` is
	// a `JsonValue`, so it is narrowed rather than asserted; the payload's own
	// URL is the fallback, and in `run` the two are the same string.
	const requestUrl = typeof request.value === "string" ? request.value : request.payload.url;
	return {
		kind: "airnow-observation",
		source: "airnow",
		// AirNow sends no row identifier. The area and the parameter are the
		// natural key of a current observation, one per pollutant per area.
		sourceRecordId: `${row.raw.ReportingArea}/${row.raw.ParameterName}`,
		// No per-area page on airnow.gov can be built from four fields without
		// inventing a fifth, so the link is the request that produced the row,
		// key-free. It is the only URL this adapter can name truthfully.
		sourceUrl: fromQuery(request, requestUrl),
		// The reporting area and AirNow's own parameter string. This is the one
		// slot on this kind that can hold the agency's word for what was
		// measured, since `pollutant` is fixed to our two. `join` is null only
		// when both columns are empty, and `coalesce` keeps the slot non-null.
		subject: coalesce(fields.join(["ReportingArea", "ParameterName"], " "), fields.text("ReportingArea")),
		// An area contains the mapped point; no distance is claimed, and nothing
		// reachable says this service returns a coordinate.
		location: null,
		// The observation's own time is what this record is effective at. The
		// same column read twice, which is what the trace will show.
		effectiveAt: fields.date("DateObserved"),
		sourceUpdatedAt: fields.absent("SourceUpdatedAt"),
		caveats: CAVEATS,
		reportingArea: fields.text("ReportingArea"),
		pollutant: fromQuery(selection, pollutant),
		observedAt: fields.date("DateObserved"),
		aqi: fields.number("AQI"),
		// Three fields left out of the schema because no reachable document
		// names them. `absent` is why the trace says the dataset has no such
		// field, rather than showing a null with no origin.
		category: fields.absent("Category"),
		concentration: fields.absent("Concentration"),
		unit: fields.absent("Unit"),
	};
}

/**
 * One row with every string column checked. All three reach a reader:
 * `ReportingArea` and `ParameterName` are joined into `sourceRecordId` and into
 * `subject`, and `DateObserved` is the record's `observedAt`. A credential has
 * no business in any of them — but "has no business" is not something this file
 * gets to assume about bytes from a service it has never had a successful
 * answer from, and the raw string reaches the trace as well as the value.
 */
function scrubbedRow(row: AirNowObservation, scrub: Scrub): AirNowObservation {
	return {
		ReportingArea: scrub(row.ReportingArea),
		ParameterName: scrub(row.ParameterName),
		DateObserved: scrub(row.DateObserved),
		AQI: row.AQI,
	};
}

/** Every row whose parameter this report has a record field for, in the order AirNow sent them. */
function selected(rows: readonly AirNowObservation[]): readonly { row: AirNowObservation; pollutant: Pollutant }[] {
	const out: { row: AirNowObservation; pollutant: Pollutant }[] = [];
	for (const row of rows) {
		const pollutant = pollutantOf(row.ParameterName);
		if (pollutant !== null) out.push({ row, pollutant });
	}
	return out;
}

/**
 * The key and the scrub built from it, or a failure that says the source was
 * never asked. Reads `process.env` at the point of use. The two come back
 * together because this is the one place that holds the secret, and everything
 * AirNow says back has to be checked against it.
 */
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
		// Rebuilt from the key-free URL, never from `fetched.payload.url`: that
		// is the URL SourceIo fetched, and this file does not trust another
		// module to have redacted the key out of it.
		const payload = { url: citable.toString(), sha256: fetched.payload.sha256, retrievedAt: fetched.payload.retrievedAt };
		const body = fetched.raw;
		if (!Array.isArray(body)) {
			const [first] = body.WebServiceError;
			// AirNow's own words, never mapped into ours — but scrubbed, because
			// `lib/templates/sources.ts` prints this on the card, and a host that
			// echoed back the request it rejected would print the key with it. The
			// recorded envelope arrives with 401, so `http` is the cause every case
			// seen so far has.
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
