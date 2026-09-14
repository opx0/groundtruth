/**
 * The FRS adapter against the committed fixtures.
 *
 * FRS's job is an identity lookup keyed by registry ID, not a list: a
 * five-mile radius around the demo point answers 6,915 programme-interest
 * rows, so this adapter is never driven by a locus. These tests call it the
 * way an ECHO or SEMS resolution step will, one registry ID at a time,
 * against a `SourceIo` that serves the committed ArcGIS bytes instead of the
 * network.
 *
 * No committed fixture happens to disagree on a facility's identity across its
 * own rows — both recorded registries agree on name and coordinate everywhere.
 * The disagreement tests below build that case from the real fixture rows by
 * perturbing one field in memory, the same way `echo.test.ts` perturbs one
 * status string to exercise the "code has never seen this" path no fixture
 * demonstrates.
 *
 * FRS IS ASKED FIVE TIMES FOR ONE CARD, so the transport cases are asserted at
 * that width and not one lookup at a time. A rate limit is the one failure this
 * shape invites: every other source spends one request on a report and FRS
 * spends `SHOWN_RECORDS` of them on one government endpoint, so the tests below
 * assert what a single throttled lookup costs the other four, and what is left
 * of the reader's answer when the limit is already spent. No ArcGIS throttle has
 * ever been recorded from this machine; the failure is driven through the io the
 * way `lib/io/fetch-source-io.ts` raises one, and what is asserted is that the
 * source's own code and `Retry-After` survive as far as the reader.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Built, JsonValue, PayloadRef, RecordOf, Sealed, SourceIo, SourceUnavailable } from "@/lib/evidence";
import { complete, SourceFailure, unavailableOf } from "@/lib/evidence";
import { SHOWN_RECORDS } from "@/lib/report/selection";
import { houstonLocus } from "@/tests/unit/evidence/helpers/sems-fixtures";
import {
	ArcgisResponse,
	FRS_CAVEATS,
	frsFacility,
	identityMismatches,
	lookupFrsFacility,
	registryQueryUrl,
} from "@/lib/adapters/frs";

const fixturesRoot = fileURLToPath(new URL("../../fixtures/", import.meta.url));
const RETRIEVED_AT = "2026-09-16T12:00:00Z";

type FrsRecord = Sealed<RecordOf<"frs-facility">>;

function bytesOf(relative: string): Buffer {
	return readFileSync(`${fixturesRoot}${relative}`);
}

function payloadOf(relative: string, bytes: Buffer): PayloadRef {
	return { url: `fixture:${relative}`, sha256: createHash("sha256").update(bytes).digest("hex"), retrievedAt: RETRIEVED_AT };
}

/**
 * What the endpoint answers one request with.
 *
 * `body` and `status` are written by a test, never filed as a fixture and never
 * a claim about bytes ArcGIS has been seen to send; the recorded ArcGIS shapes
 * are the `fixture` arm. `hang` never settles, which is what a request with no
 * clock on it looks like from here.
 */
type Step =
	| { readonly fixture: string }
	| { readonly body: string }
	| { readonly status: number; readonly retryAfter: string | null }
	| { readonly fail: SourceFailure }
	| { readonly hang: true };

/** Mirrors `lib/io/fetch-source-io.ts`'s order: status first, then JSON, then the schema. */
function ioFor(stepFor: (url: URL) => Step): { readonly io: SourceIo; readonly calls: URL[] } {
	const calls: URL[] = [];
	const io: SourceIo = {
		get<Raw extends JsonValue>(url: URL, schema: z.ZodType<Raw>) {
			calls.push(url);
			const step = stepFor(url);
			if ("hang" in step) return new Promise<never>(() => undefined);
			if ("fail" in step) return Promise.reject(step.fail);
			if ("status" in step) {
				return Promise.reject(
					step.status === 429
						? new SourceFailure("rate-limited", step.status, step.retryAfter)
						: new SourceFailure("http", step.status),
				);
			}
			const bytes = "body" in step ? Buffer.from(step.body, "utf8") : bytesOf(step.fixture);
			const payload: PayloadRef =
				"body" in step
					? { url: url.toString(), sha256: createHash("sha256").update(bytes).digest("hex"), retrievedAt: RETRIEVED_AT }
					: payloadOf(step.fixture, bytes);
			let json: unknown;
			try {
				json = JSON.parse(bytes.toString("utf8"));
			} catch {
				return Promise.reject(new SourceFailure("malformed", null));
			}
			const parsed = schema.safeParse(json);
			if (!parsed.success) return Promise.reject(new SourceFailure("malformed", null));
			return Promise.resolve({ raw: parsed.data, payload });
		},
		query(parameter, value, adapterVersion, payload) {
			return { kind: "query", parameter, value, adapterVersion, payload };
		},
		now: () => RETRIEVED_AT,
	};
	return { io, calls };
}

function stubIo(step: Step): { readonly io: SourceIo; readonly calls: URL[] } {
	return ioFor(() => step);
}

/** The registry ID a request was for, read back out of the `where` clause the adapter built. */
function registryIdOf(url: URL): string {
	const where = url.searchParams.get("where") ?? "";
	const quoted = where.slice("REGISTRY_ID='".length, -1);
	return quoted.replace(/''/g, "'");
}

/** The failed lookup as the kernel classifies it — the same call `app/api/report/handler.ts` makes per registry ID. */
async function unavailableFrom(step: Step, registryId = "110000460885"): Promise<SourceUnavailable> {
	const { io } = stubIo(step);
	try {
		await lookupFrsFacility(registryId, io);
	} catch (error) {
		return unavailableOf(error);
	}
	throw new Error("the lookup resolved; a failure must never come back as an answer");
}

/** The layer's parsed features and the payload they were read from, for the tests that build `Built` values by hand. */
function loadLayer(relative: string) {
	const bytes = bytesOf(relative);
	const parsed = ArcgisResponse.parse(JSON.parse(bytes.toString("utf8")));
	if (!("features" in parsed)) throw new Error(`${relative} is an error body, not a layer`);
	return { features: parsed.features, payload: payloadOf(relative, bytes) };
}

async function facilityFrom(fixture: string, registryId: string): Promise<FrsRecord> {
	const { io } = stubIo({ fixture });
	const [built] = await lookupFrsFacility(registryId, io);
	if (built === undefined) throw new Error(`expected a facility for ${registryId}`);
	return complete(houstonLocus(), built);
}

const HOUSTON_REFINERY = "frs/arcgis-registry-110000460885.json";
const TWO_IDS = "frs/arcgis-registry-110000462703-two-ids.json";
/** A real ArcGIS query that matched nothing. FRS's layer is the same service SEMS's is. */
const NO_ROWS = "sems/arcgis-no-records-nevada.json";

const HOUSTON_REGISTRY = "110000460885";
const TWO_IDS_REGISTRY = "110000462703";

/**
 * The five registry IDs one report asks FRS about. `app/api/report/handler.ts`
 * bounds the lookups at `SHOWN_RECORDS`, so this is the real fan-out width: one
 * request per ID, five requests to one government endpoint for one card.
 */
const REGISTRY_IDS: readonly string[] = [HOUSTON_REGISTRY, TWO_IDS_REGISTRY, "999999999001", "999999999002", "999999999003"];

/** What the recorded bytes answer each of those IDs: two facilities and three IDs FRS holds no row for. */
function recordedAnswer(registryId: string): Step {
	if (registryId === HOUSTON_REGISTRY) return { fixture: HOUSTON_REFINERY };
	if (registryId === TWO_IDS_REGISTRY) return { fixture: TWO_IDS };
	return { fixture: NO_ROWS };
}

/** All five lookups in flight at once, each settled on its own, the way `askFrs` issues them. */
async function lookupAll(stepFor: (registryId: string) => Step): Promise<{
	readonly answers: readonly PromiseSettledResult<readonly Built<"frs-facility">[]>[];
	readonly calls: readonly URL[];
}> {
	const { io, calls } = ioFor((url) => stepFor(registryIdOf(url)));
	const answers = await Promise.allSettled(REGISTRY_IDS.map((registryId) => lookupFrsFacility(registryId, io)));
	return { answers, calls };
}

function builtFrom(answers: readonly PromiseSettledResult<readonly Built<"frs-facility">[]>[]): readonly Built<"frs-facility">[] {
	return answers.flatMap((answer) => (answer.status === "fulfilled" ? answer.value : []));
}

function failuresFrom(answers: readonly PromiseSettledResult<readonly Built<"frs-facility">[]>[]): readonly SourceUnavailable[] {
	return answers.flatMap((answer) => (answer.status === "rejected" ? [unavailableOf(answer.reason)] : []));
}

describe("the request", () => {
	it("filters the FRS_INTERESTS layer on REGISTRY_ID, with no geometry returned", () => {
		expect(registryQueryUrl("110000460885").toString()).toBe(
			"https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/FRS_INTERESTS/FeatureServer/0/query" +
				"?where=REGISTRY_ID%3D%27110000460885%27&outFields=*&returnGeometry=false&f=json",
		);
	});

	it("doubles an embedded quote the way a SQL-like where clause escapes one", () => {
		expect(registryQueryUrl("11'0").searchParams.get("where")).toBe("REGISTRY_ID='11''0'");
	});
});

describe("a facility with 38 programme-interest rows across 15 programmes", () => {
	it("collapses every row into one record, keyed by the registry ID", async () => {
		const record = await facilityFrom(HOUSTON_REFINERY, "110000460885");

		expect(record.kind).toBe("frs-facility");
		expect(record.source).toBe("frs");
		expect(record.sourceRecordId).toBe("110000460885");
		expect(record.registryId.value).toBe("110000460885");
		expect(record.subject.value).toBe("HOUSTON REFINERY");
		expect(record.sourceUrl.value).toBe("https://echo.epa.gov/detailed-facility-report?fid=110000460885");
		expect(record.location?.latitude.value).toBe(29.722274);
		expect(record.location?.longitude.value).toBe(-95.254401);
		// The most recently updated row's UPDATE_DATE, not the first row's.
		expect(record.sourceUpdatedAt.value).toBe("2024-03-14T10:51:51Z");
		expect(record.effectiveAt.value).toBeNull();
		expect(record.caveats).toEqual(FRS_CAVEATS);

		expect(record.programInterests).toHaveLength(38);
		expect(new Set(record.programInterests.map((interest) => interest.program.value)).size).toBe(15);
	});

	it("carries the coordinate's own quality fields into location, null on this real facility", async () => {
		const record = await facilityFrom(HOUSTON_REFINERY, "110000460885");

		expect(record.location?.accuracyMeters.value).toBeNull();
		expect(record.location?.collectionMethod.value).toBeNull();
		expect(record.location?.referencePoint.value).toBe("CENTER OF A FACILITY OR STATION");
	});

	it("passes an active-status code it has never catalogued through unchanged", async () => {
		const record = await facilityFrom(HOUSTON_REFINERY, "110000460885");

		const tsca = record.programInterests.find((interest) => interest.programId.value === "TSCA10169492");
		if (tsca === undefined) throw new Error("expected the TSCA10169492 programme-interest row");
		expect(tsca.program.value).toBe("TSCA");
		expect(tsca.interestType.value).toBe("TSCA SUBMITTER");
		expect(tsca.activeStatus.value).toBe("***UNCHANGED***");
	});

	it("traces a single programme interest's status to its own row's column, not to a request parameter", async () => {
		const record = await facilityFrom(HOUSTON_REFINERY, "110000460885");

		const tsca = record.programInterests.find((interest) => interest.programId.value === "TSCA10169492");
		if (tsca === undefined) throw new Error("expected the TSCA10169492 programme-interest row");
		expect(tsca.activeStatus.provenance).toEqual([
			{
				kind: "field",
				dataset: "frs_interests",
				sourceField: "ACTIVE_STATUS",
				rawValue: "***UNCHANGED***",
				transform: "identity",
				adapterVersion: "frs@1",
				payload: record.payloads[0],
			},
		]);
		expect(tsca.programId.provenance[0]).toMatchObject({ sourceField: "PGM_SYS_ID", rawValue: "TSCA10169492" });
		// Every leaf of every row is a field read; none is a query parameter.
		for (const interest of record.programInterests) {
			for (const leaf of Object.values(interest)) {
				expect(leaf.provenance.every((p) => p.kind === "field")).toBe(true);
			}
		}
	});

	it("names exactly the one payload it was built from", async () => {
		const record = await facilityFrom(HOUSTON_REFINERY, "110000460885");

		expect(record.payloads).toHaveLength(1);
		expect(record.payloads[0]?.url).toBe(`fixture:${HOUSTON_REFINERY}`);
	});

	it("builds the link from the registry ID it read, not a literal", async () => {
		const record = await facilityFrom(HOUSTON_REFINERY, "110000460885");

		const [computation] = record.sourceUrl.provenance;
		if (computation.kind !== "computation") throw new Error("sourceUrl is not a url-template computation");
		expect(computation.formula).toBe("url-template");
		expect(computation.inputs.map((input) => input.value)).toEqual([
			"https://echo.epa.gov/detailed-facility-report?fid={id}",
			"110000460885",
		]);
	});
});

describe("one registry ID, two Superfund site IDs", () => {
	it("keeps both EPA IDs as separate programme-interest rows under the one registry ID", async () => {
		const record = await facilityFrom(TWO_IDS, "110000462703");

		expect(record.sourceRecordId).toBe("110000462703");
		expect(record.subject.value).toBe("PASADENA REFINING SYSTEM, INC.");
		expect(
			record.programInterests.map((interest) => ({
				program: interest.program.value,
				programId: interest.programId.value,
				interestType: interest.interestType.value,
				activeStatus: interest.activeStatus.value,
			})),
		).toEqual([
			{ program: "SEMS", programId: "TXN000607355", interestType: "SUPERFUND (NON-NPL)", activeStatus: "NOT ON THE NPL" },
			{ program: "SEMS", programId: "TXN000605303", interestType: "SUPERFUND (NON-NPL)", activeStatus: "NOT ON THE NPL" },
		]);
		// The two rows' UPDATE_DATE values differ by two seconds; the later one wins.
		expect(record.sourceUpdatedAt.value).toBe("2021-11-24T13:48:56Z");
	});
});

describe("a registry ID FRS has no row for", () => {
	it("is zero results, not a failure", async () => {
		const { io, calls } = stubIo({ fixture: "sems/arcgis-no-records-nevada.json" });

		const built = await lookupFrsFacility("999999999999", io);

		expect(built).toEqual([]);
		expect(calls).toHaveLength(1);
	});
});

describe("the source's error body", () => {
	it("is unavailable, not an empty result, even though ArcGIS answers it with HTTP 200", async () => {
		const { io } = stubIo({ fixture: "fema/esri-error-bad-geometry.json" });

		await expect(lookupFrsFacility(HOUSTON_REGISTRY, io)).rejects.toMatchObject(new SourceFailure("http", 400));
		// And the code ArcGIS put in the body is what the reader is shown, not a code of ours.
		expect(await unavailableFrom({ fixture: "fema/esri-error-bad-geometry.json" })).toEqual({
			status: "unavailable",
			cause: "http",
			rawCode: 400,
			retryAfter: null,
		});
	});
});

describe("a body the schema rejects", () => {
	it("is malformed when the bytes are not JSON at all", async () => {
		// Not ArcGIS's own error envelope: a gateway's page, which is what a 200
		// carrying no JSON looks like. The adapter must not read it as no records.
		expect(await unavailableFrom({ body: "<html><head><title>502 Bad Gateway</title></head><body>502</body></html>" })).toEqual({
			status: "unavailable",
			cause: "malformed",
			rawCode: null,
			retryAfter: null,
		});
	});

	it("is malformed when a row has no PGM_SYS_ACRNM, rather than a facility carrying a nameless programme", async () => {
		const row = {
			REGISTRY_ID: HOUSTON_REGISTRY,
			PRIMARY_NAME: "HOUSTON REFINERY",
			PGM_SYS_ID: "TSCA10169492",
			INTEREST_TYPE: "TSCA SUBMITTER",
			ACTIVE_STATUS: "***UNCHANGED***",
			LATITUDE83: 29.722274,
			LONGITUDE83: -95.254401,
			ACCURACY_VALUE: null,
			COLLECT_MTH_DESC: null,
			REF_POINT_DESC: null,
			UPDATE_DATE: null,
		};

		expect(await unavailableFrom({ body: JSON.stringify({ features: [{ attributes: row }] }) })).toEqual({
			status: "unavailable",
			cause: "malformed",
			rawCode: null,
			retryAfter: null,
		});

		// The same bytes with that one column present are a facility, so it is
		// the missing column the schema refused and not the shape around it.
		const { io } = stubIo({ body: JSON.stringify({ features: [{ attributes: { ...row, PGM_SYS_ACRNM: "TSCA" } }] }) });
		const [built] = await lookupFrsFacility(HOUSTON_REGISTRY, io);
		expect(built?.programInterests[0]?.program.value).toBe("TSCA");
	});
});

describe("timeout", () => {
	it("is unavailable and never an empty answer: 'we could not ask' is not 'FRS holds no row'", async () => {
		expect(await unavailableFrom({ fail: new SourceFailure("timeout") })).toEqual({
			status: "unavailable",
			cause: "timeout",
			rawCode: null,
			retryAfter: null,
		});

		// The same adapter and the same registry ID against a source that really
		// answered empty. Both cost the reader zero records; only one of them is
		// a fact about the facility.
		const { io } = stubIo({ fixture: NO_ROWS });
		expect(await lookupFrsFacility(HOUSTON_REGISTRY, io)).toEqual([]);
	});

	it("is bounded by SourceIo's own clock and by nothing in the adapter", async () => {
		// FRS is not an `Adapter`, so `runSource`'s `withTimeout` never sees it:
		// a hung lookup ends when `createFetchSourceIo` aborts it and not before.
		const { io, calls } = stubIo({ hang: true });
		const lookup = lookupFrsFacility(HOUSTON_REGISTRY, io);

		const raced = await Promise.race<string>([
			lookup.then(
				() => "settled",
				() => "settled",
			),
			new Promise<string>((resolve) => setTimeout(() => resolve("still waiting"), 20)),
		]);

		expect(raced).toBe("still waiting");
		expect(calls).toHaveLength(1);
	});
});

/* -------------------------------------------------------------------------- */
/* Rate limit: five requests to one endpoint for one card                     */
/* -------------------------------------------------------------------------- */

const RETRY_AFTER = "86400";
/** A transport 429 with a retry hint, the shape `aqs/rate-limited.json` recorded from EPA and `fetch-source-io.ts` turns into a failure. */
const THROTTLED: Step = { status: 429, retryAfter: RETRY_AFTER };

describe("rate limit", () => {
	it("carries the source's own code and retry hint out, never flattened into unknown", async () => {
		const outcome = await unavailableFrom(THROTTLED);

		expect(outcome).toEqual({ status: "unavailable", cause: "rate-limited", rawCode: 429, retryAfter: RETRY_AFTER });
		// The two ways this hint could be lost: a cause of "unknown", which tells
		// the reader nothing, and a resolved empty array, which tells them FRS has
		// no record of a facility it was never asked about.
		expect(outcome.cause).not.toBe("unknown");
	});

	it("asks once per registry ID, bounded at the five records a section shows", async () => {
		expect(REGISTRY_IDS).toHaveLength(SHOWN_RECORDS);

		const { calls } = await lookupAll(recordedAnswer);

		// One request each, in the order the ids were given, and no retry.
		expect(calls.map(registryIdOf)).toEqual(REGISTRY_IDS);
		expect(calls).toHaveLength(SHOWN_RECORDS);
	});

	it("costs exactly the one facility when one of the five lookups is throttled", async () => {
		const { answers, calls } = await lookupAll((registryId) =>
			registryId === TWO_IDS_REGISTRY ? THROTTLED : recordedAnswer(registryId),
		);

		// The failure is confined to its own registry ID.
		expect(failuresFrom(answers)).toEqual([
			{ status: "unavailable", cause: "rate-limited", rawCode: 429, retryAfter: RETRY_AFTER },
		]);

		// What it cost is PASADENA REFINING SYSTEM, INC. and nothing else: the
		// other four lookups answered, and the one facility among them is whole.
		const built = builtFrom(answers);
		expect(built.map((one) => one.sourceRecordId)).toEqual([HOUSTON_REGISTRY]);
		const [survivor] = built;
		if (survivor === undefined) throw new Error("expected the unthrottled lookups to still build");
		const record = complete(houstonLocus(), survivor);
		expect(record.subject.value).toBe("HOUSTON REFINERY");
		expect(record.sourceUpdatedAt.value).toBe("2024-03-14T10:51:51Z");
		expect(record.programInterests).toHaveLength(38);
		expect(record.payloads[0]?.url).toBe(`fixture:${HOUSTON_REFINERY}`);
		// The throttled ID was asked once. A retry would spend a sibling's budget.
		expect(calls).toHaveLength(SHOWN_RECORDS);
	});

	it("costs every card once the limit is spent, and each lookup still names the code and the hint", async () => {
		const { answers, calls } = await lookupAll(() => THROTTLED);

		expect(builtFrom(answers)).toEqual([]);
		expect(failuresFrom(answers)).toEqual(
			REGISTRY_IDS.map(() => ({ status: "unavailable", cause: "rate-limited", rawCode: 429, retryAfter: RETRY_AFTER })),
		);
		expect(calls).toHaveLength(SHOWN_RECORDS);

		// Five genuinely empty answers cost the reader the same number of records
		// — zero — and are a different fact. A throttle is the thing most likely
		// to collapse that distinction, because it hits all five at once.
		const empty = await lookupAll(() => ({ fixture: NO_ROWS }));
		expect(builtFrom(empty.answers)).toEqual([]);
		expect(failuresFrom(empty.answers)).toEqual([]);
	});

	it("loses the retry hint when the throttle arrives in ArcGIS's error envelope instead of the status line", async () => {
		// These bytes are written by this test, not recorded: no ArcGIS throttle
		// has been captured from this machine. What is pinned is what the adapter
		// does with a code it finds in the body, which is the one shape ArcGIS is
		// known to deliver a failure in (tests/fixtures/README.md).
		const outcome = await unavailableFrom({ body: JSON.stringify({ error: { code: 429, message: "Too many requests" } }) });

		expect(outcome).toEqual({ status: "unavailable", cause: "http", rawCode: 429, retryAfter: null });
	});
});

describe("facility-identity fields that disagree across a registry ID's rows", () => {
	it("is surfaced as a caveat rather than silently taking the first row", () => {
		const layer = loadLayer(HOUSTON_REFINERY);
		const [first, ...rest] = layer.features;
		if (first === undefined) throw new Error("fixture has no features");
		const disagreeing = { attributes: { ...first.attributes, PRIMARY_NAME: "HOUSTON REFINERY ANNEX" } };

		expect(identityMismatches([disagreeing.attributes, ...rest.map((feature) => feature.attributes)])).toEqual([
			"PRIMARY_NAME",
		]);

		const built = frsFacility([disagreeing, ...rest], layer.payload);
		expect(built.caveats).toContain(
			"FRS's own programme-interest rows disagree on PRIMARY_NAME for this registry ID; the first row's values are shown.",
		);
		// The identity fields still come from the first row, not an average or a guess.
		expect(built.subject.value).toBe("HOUSTON REFINERY ANNEX");
	});

	it("adds no caveat when every row agrees, which is every committed fixture", () => {
		const layer = loadLayer(HOUSTON_REFINERY);

		expect(identityMismatches(layer.features.map((feature) => feature.attributes))).toEqual([]);

		const [first, ...rest] = layer.features;
		if (first === undefined) throw new Error("fixture has no features");
		const built = frsFacility([first, ...rest], layer.payload);
		expect(built.caveats).toEqual(FRS_CAVEATS);
	});
});
