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

export const FACILITY_REPORT_URL = "https://echo.epa.gov/detailed-facility-report?fid={id}";

// Column 18 is FAC_LONG; ECHO leaves it out of the default response while
// sending FAC_LAT, and a facility without it has no computable distance.
export const QCOLUMNS = "1,2,3,4,5,6,9,15,16,17,18,34,35,36,37,38,39,40,43,55,56,61,62,63,95,96";

const METERS_PER_MILE = 1609.344;

const DATASET_SUMMARY = "echo_get_facilities";
const DATASET_ROWS = "echo_get_qid";

export const ECHO_POLICY: SourcePolicy = { timeoutMs: 45_000 };

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 400;

const MAX_PAGES = 20;

export const ECHO_CAVEATS: readonly string[] = [
	"ECHO reports what a facility told EPA under its permits. A facility listed here is regulated and reporting, not necessarily polluting.",
	"Compliance status covers the last twelve quarters of federally reported data and is not a statement about conditions today.",
	"ECHO sends dates as month/day/year. They are shown as year-month-day, and the trace keeps the string ECHO sent.",
];

// ECHO delivers failures with HTTP 200, and its `Message` reads "Success" or
// "Working" on them too. Never branch on `Message`.
const ErrorResults = z.object({
	Error: z.object({ ErrorMessage: z.string() }),
});

const SummaryResults = z.object({
	Message: z.string(),
	Version: z.string(),
	QueryRows: z.string(),
	QueryID: z.string(),
});
type SummaryResults = z.infer<typeof SummaryResults>;

const FacilitiesResponse = z.object({ Results: z.union([SummaryResults, ErrorResults]) });

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

const PageResults = z.object({
	Message: z.string(),
	QueryRows: z.string(),
	QueryID: z.string(),
	PageNo: z.string(),
	Facilities: z.array(FacilityRow),
});

const PageResponse = z.object({ Results: z.union([PageResults, ErrorResults]) });

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

function buildFacility(row: Fetched<FacilityRow>, summary: Fetched<SummaryResults>): Built<"echo-facility"> {
	const f = fieldsOf(row, DATASET_ROWS, ECHO_VERSION);
	const head = fieldsOf(summary, DATASET_SUMMARY, ECHO_VERSION);

	return {
		kind: "echo-facility",
		source: "echo",
		sourceRecordId: row.raw.RegistryID,
		sourceUrl: urlFrom(FACILITY_REPORT_URL, f.text("RegistryID")),
		subject: coalesce(f.text("FacName"), f.text("RegistryID")),
		location: f.point("FacLat", "FacLong", {}),
		effectiveAt: coalesce(f.usDate("FacDateLastFormalAction"), f.usDate("FacDateLastInspection")),
		sourceUpdatedAt: head.text("Version"),
		caveats: ECHO_CAVEATS,
		registryId: f.text("RegistryID"),
		complianceStatus: f.text("FacComplianceStatus"),
		significantNoncomplianceFlag: f.text("FacSNCFlg"),
		quartersInNoncompliance: f.number("FacQtrsWithNC"),
		lastFormalActionDate: f.usDate("FacDateLastFormalAction"),
		formalActionCount: f.number("CAAFormalActionCount"),
		penaltyCount: f.number("FacPenaltyCount"),
		lastPenaltyDate: f.usDate("FacDateLastPenalty"),
		lastPenaltyAmountUsd: f.currency("FacLastPenaltyAmt"),
		lastInspectionDate: f.usDate("FacDateLastInspection"),
		activeFlag: f.text("FacActiveFlag"),
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

type Attempts = { readonly attempts: number; readonly retryDelayMs: number };

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

	const expected = rowCount(results.QueryRows);
	if (expected === 0) return [];

	const summary: Fetched<SummaryResults> = { raw: results, payload: first.payload };
	const built = new Map<string, Built<"echo-facility">>();

	for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo += 1) {
		const page = await fetchWithRetry(io, qidUrl(results.QueryID, pageNo), PageResponse, limits);
		const rows = page.raw.Results;
		if ("Error" in rows) throw new SourceFailure("http", rows.Error.ErrorMessage);
		if (pageNo === 1 && rows.Facilities.length === 0) {
			throw new SourceFailure("malformed", results.QueryRows);
		}
		const before = built.size;
		for (const facility of rows.Facilities) {
			if (built.has(facility.RegistryID)) continue;
			built.set(facility.RegistryID, buildFacility({ raw: facility, payload: page.payload }, summary));
		}
		if (built.size >= expected) break;
		if (built.size === before) break;
	}

	return [...built.values()];
}

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
