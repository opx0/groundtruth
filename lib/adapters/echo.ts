/**
 * EPA ECHO: facilities near a point, with their compliance and enforcement
 * history.
 *
 * ECHO takes two calls. `get_facilities` runs the spatial query and answers
 * with counts and a `QueryID`; `get_qid` returns the rows for that QueryID one
 * page at a time. Both calls must carry the same `qcolumns` list, because ECHO
 * omits `FacLong` from its default response while including `FacLat` — a
 * facility then arrives with a latitude, no longitude, and no computable
 * distance. The list here is the one `scripts/capture-us-fixtures.sh` records
 * with, and `tests/unit/adapters/echo.test.ts` checks it against ECHO's own
 * column metadata.
 *
 * Nothing ECHO sends is a JSON number. Counts, quarters and coordinates are
 * numeric strings, which the kernel's `number` and `point` readers parse while
 * keeping the original string as the trace's raw value. The penalty amount is
 * a currency string, "$0", read by `currency` so the trace reports the dollar
 * sign ECHO sent. Dates are month/day/year, read by `usDate`, which never
 * guesses at the order: 08/12/2024 is August and the trace keeps the string.
 *
 * Neither call's `Message` means anything about success: the first says
 * "Success" and the second says "Working". A failure arrives as HTTP 200 with
 * `Results.Error.ErrorMessage`, a different shape from the ArcGIS error body,
 * so this check cannot be shared with the FEMA and SEMS adapters.
 */

import { z } from "zod";
import { coalesce, fieldsOf, SourceFailure, urlFrom } from "@/lib/evidence";
import type {
	Adapter,
	AdapterVersion,
	Built,
	Fetched,
	JsonObject,
	Locus,
	SourceIo,
	SourcePolicy,
} from "@/lib/evidence";

export const ECHO_VERSION: AdapterVersion = "echo@1";

const BASE = "https://echodata.epa.gov/echo/echo_rest_services";

/** The reader's link, on EPA's own site. */
export const FACILITY_REPORT_URL = "https://echo.epa.gov/detailed-facility-report?fid={id}";

/**
 * ECHO column IDs, sent on every call. 17 and 18 are FAC_LAT and FAC_LONG;
 * dropping 18 is how a facility loses its distance.
 */
export const QCOLUMNS = "1,2,3,4,5,6,9,15,16,17,18,34,35,36,37,38,39,40,43,55,56,61,62,63,95,96";

const METERS_PER_MILE = 1609.344;

const DATASET_SUMMARY = "echo_get_facilities";
const DATASET_ROWS = "echo_get_qid";

/** ECHO is slow to open and sometimes resets the connection. `DEFAULT_POLICY` is far too tight for it. */
export const ECHO_POLICY: SourcePolicy = { timeoutMs: 45_000 };

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 400;

/** A guard on the page loop, not a row budget: the loop already stops when a page adds nothing new. */
const MAX_PAGES = 20;

export const ECHO_CAVEATS: readonly string[] = [
	"ECHO reports what a facility told EPA under its permits. A facility listed here is regulated and reporting, not necessarily polluting.",
	"Compliance status covers the last twelve quarters of federally reported data and is not a statement about conditions today.",
	"ECHO sends dates as month/day/year. They are shown as year-month-day, and the trace keeps the string ECHO sent.",
];

/* -------------------------------------------------------------------------- */
/* Response shapes                                                            */
/* -------------------------------------------------------------------------- */

/** ECHO's failure body, delivered with HTTP 200. */
const ErrorResults = z.object({
	Error: z.object({ ErrorMessage: z.string() }),
});

/** `get_facilities`: counts and the QueryID the second call needs. `Message` is "Success" and is not a verdict. */
const SummaryResults = z.object({
	Message: z.string(),
	Version: z.string(),
	QueryRows: z.string(),
	QueryID: z.string(),
});
type SummaryResults = z.infer<typeof SummaryResults>;

const FacilitiesResponse = z.object({ Results: z.union([SummaryResults, ErrorResults]) });

/**
 * One facility row. Every column is a string or null; status columns are
 * `z.string()` and never `z.enum()`, so a status ECHO has never sent before
 * still reaches the screen unchanged.
 */
const FacilityRow = z.object({
	FacName: z.string().nullable(),
	FacStreet: z.string().nullable(),
	FacCity: z.string().nullable(),
	FacState: z.string().nullable(),
	FacZip: z.string().nullable(),
	RegistryID: z.string(),
	FacFederalFlg: z.string().nullable(),
	FacSICCodes: z.string().nullable(),
	FacNAICSCodes: z.string().nullable(),
	FacLat: z.string().nullable(),
	FacLong: z.string().nullable(),
	FacSNCFlg: z.string().nullable(),
	FacQtrsWithNC: z.string().nullable(),
	FacComplianceStatus: z.string().nullable(),
	CAAComplianceStatus: z.string().nullable(),
	CWAComplianceStatus: z.string().nullable(),
	RCRAComplianceStatus: z.string().nullable(),
	SDWAComplianceStatus: z.string().nullable(),
	FacDateLastInspection: z.string().nullable(),
	FacDateLastFormalAction: z.string().nullable(),
	CAAFormalActionCount: z.string().nullable(),
	FacPenaltyCount: z.string().nullable(),
	FacDateLastPenalty: z.string().nullable(),
	FacLastPenaltyAmt: z.string().nullable(),
	FacActiveFlag: z.string().nullable(),
	FacMyrtkUniverse: z.string().nullable(),
});
type FacilityRow = z.infer<typeof FacilityRow>;

/** `get_qid`: the rows. `Message` is "Working", which also is not a verdict. */
const PageResults = z.object({
	Message: z.string(),
	QueryRows: z.string(),
	QueryID: z.string(),
	PageNo: z.string(),
	Facilities: z.array(FacilityRow),
});

const PageResponse = z.object({ Results: z.union([PageResults, ErrorResults]) });

/* -------------------------------------------------------------------------- */
/* Requests                                                                   */
/* -------------------------------------------------------------------------- */

/** ECHO takes a radius in miles. */
function radiusMiles(meters: number): string {
	const miles = Math.round((meters / METERS_PER_MILE) * 100) / 100;
	return String(Math.max(miles, 0.05));
}

export function facilitiesUrl(locus: Locus): URL {
	const url = new URL(`${BASE}.get_facilities`);
	url.searchParams.set("output", "JSON");
	url.searchParams.set("p_lat", String(locus.point.latitude.value));
	url.searchParams.set("p_long", String(locus.point.longitude.value));
	url.searchParams.set("p_radius", radiusMiles(locus.radiusMeters));
	url.searchParams.set("qcolumns", QCOLUMNS);
	return url;
}

export function qidUrl(queryId: string, pageNo: number): URL {
	const url = new URL(`${BASE}.get_qid`);
	url.searchParams.set("output", "JSON");
	url.searchParams.set("qid", queryId);
	url.searchParams.set("pageno", String(pageNo));
	url.searchParams.set("qcolumns", QCOLUMNS);
	return url;
}

/* -------------------------------------------------------------------------- */
/* Reading a row                                                              */
/* -------------------------------------------------------------------------- */

function buildFacility(row: Fetched<FacilityRow>, summary: Fetched<SummaryResults>): Built<"echo-facility"> {
	const f = fieldsOf(row, DATASET_ROWS, ECHO_VERSION);
	const head = fieldsOf(summary, DATASET_SUMMARY, ECHO_VERSION);

	return {
		kind: "echo-facility",
		source: "echo",
		sourceRecordId: row.raw.RegistryID,
		sourceUrl: urlFrom(FACILITY_REPORT_URL, f.text("RegistryID")),
		// FacName is nullable on a real row, and the registry ID is the only
		// other thing ECHO always sends.
		subject: coalesce(f.text("FacName"), f.text("RegistryID")),
		location: f.point("FacLat", "FacLong", {}),
		// ECHO has no as-of column. The most recent compliance event it names is
		// the closest honest thing, and the trace shows both candidates.
		effectiveAt: coalesce(f.usDate("FacDateLastFormalAction"), f.usDate("FacDateLastInspection")),
		// ECHO's own data-version stamp, which only the first call carries.
		sourceUpdatedAt: head.text("Version"),
		caveats: ECHO_CAVEATS,
		registryId: f.text("RegistryID"),
		complianceStatus: f.text("FacComplianceStatus"),
		significantNoncomplianceFlag: f.text("FacSNCFlg"),
		quartersInNoncompliance: f.number("FacQtrsWithNC"),
		lastFormalActionDate: f.usDate("FacDateLastFormalAction"),
		// ECHO exposes one formal-action count column, the Clean Air Act one.
		formalActionCount: f.number("CAAFormalActionCount"),
		penaltyCount: f.number("FacPenaltyCount"),
		lastPenaltyDate: f.usDate("FacDateLastPenalty"),
		// "$0" as sent; the trace's raw value is that string and the transform is named.
		lastPenaltyAmountUsd: f.currency("FacLastPenaltyAmt"),
		lastInspectionDate: f.usDate("FacDateLastInspection"),
		activeFlag: f.text("FacActiveFlag"),
		// One leaf per statute column; the acronyms are the prefixes of ECHO's
		// own column names, not a vocabulary of ours. A programme ECHO does not
		// track at this facility is a null leaf that still names its column.
		programStatuses: f.pick({
			CAA: "CAAComplianceStatus",
			CWA: "CWAComplianceStatus",
			RCRA: "RCRAComplianceStatus",
			SDWA: "SDWAComplianceStatus",
		}),
		naicsCodes: f.text("FacNAICSCodes"),
		sicCodes: f.text("FacSICCodes"),
	};
}

/* -------------------------------------------------------------------------- */
/* Fetching                                                                   */
/* -------------------------------------------------------------------------- */

type Attempts = { readonly attempts: number; readonly retryDelayMs: number };

/** Opening the connection is what fails, so a timeout or a reset is worth another try; a bad body is not. */
function retryable(error: unknown): boolean {
	if (!(error instanceof SourceFailure)) return false;
	return (
		error.reason === "timeout" ||
		error.reason === "refused" ||
		error.reason === "rate-limited" ||
		error.reason === "unknown"
	);
}

function pause(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry<Raw extends JsonObject>(
	io: SourceIo,
	url: URL,
	schema: z.ZodType<Raw>,
	limits: Attempts,
): Promise<Fetched<Raw>> {
	let last: unknown = null;
	for (let attempt = 1; attempt <= limits.attempts; attempt += 1) {
		try {
			return await io.get(url, schema);
		} catch (error) {
			// Rethrown, never swallowed: an unreachable EPA must not read as
			// "no facilities near this address".
			if (!retryable(error)) throw error;
			last = error;
			if (attempt < limits.attempts && limits.retryDelayMs > 0) await pause(limits.retryDelayMs);
		}
	}
	throw last instanceof Error ? last : new SourceFailure("unknown");
}

function rowCount(raw: string): number {
	const count = Number(raw);
	if (!Number.isInteger(count) || count < 0) throw new SourceFailure("malformed", raw);
	return count;
}

async function run(locus: Locus, io: SourceIo, limits: Attempts): Promise<readonly Built<"echo-facility">[]> {
	const first = await fetchWithRetry(io, facilitiesUrl(locus), FacilitiesResponse, limits);
	const results = first.raw.Results;
	if ("Error" in results) throw new SourceFailure("http", results.Error.ErrorMessage);

	// "Success" with QueryRows "0" is the no-data answer, not a failure.
	const expected = rowCount(results.QueryRows);
	if (expected === 0) return [];

	const summary: Fetched<SummaryResults> = { raw: results, payload: first.payload };
	const built = new Map<string, Built<"echo-facility">>();

	for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo += 1) {
		const page = await fetchWithRetry(io, qidUrl(results.QueryID, pageNo), PageResponse, limits);
		const rows = page.raw.Results;
		if ("Error" in rows) throw new SourceFailure("http", rows.Error.ErrorMessage);
		if (pageNo === 1 && rows.Facilities.length === 0) {
			// ECHO counted rows and then returned none. That is a broken answer,
			// not an empty neighbourhood.
			throw new SourceFailure("malformed", results.QueryRows);
		}
		const before = built.size;
		for (const facility of rows.Facilities) {
			if (built.has(facility.RegistryID)) continue;
			built.set(facility.RegistryID, buildFacility({ raw: facility, payload: page.payload }, summary));
		}
		if (built.size >= expected) break;
		// A page that adds no new facility is the end of the set, whatever the
		// count said.
		if (built.size === before) break;
	}

	return [...built.values()];
}

/* -------------------------------------------------------------------------- */
/* The adapter                                                                */
/* -------------------------------------------------------------------------- */

export type EchoOptions = { readonly attempts: number; readonly retryDelayMs: number };

export function createEchoAdapter(options: Partial<EchoOptions> = {}): Adapter<"echo-facility"> {
	const limits: Attempts = {
		attempts: options.attempts ?? DEFAULT_ATTEMPTS,
		retryDelayMs: options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
	};
	return {
		kind: "echo-facility",
		source: "echo",
		version: ECHO_VERSION,
		run: (locus, io) => run(locus, io, limits),
	};
}

export const echoAdapter: Adapter<"echo-facility"> = createEchoAdapter();
