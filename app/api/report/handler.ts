/**
 * The report route's logic, factored out of `route.ts` so a test can inject a
 * fixture-backed `SourceIo` instead of the real network implementation -- the
 * same substitution `app/api/geocode/handler.ts` makes, for the same reason.
 *
 * PRIVACY. The geocode route is the one server boundary that ever holds a raw
 * address. This one holds a coordinate, and the strongest privacy property in
 * the codebase is the shape of its request: **no address reaches this route at
 * all**. `ReportRequestSchema` is a strict object of two numbers, so a body
 * carrying an address, a matched address or a tiger line is refused rather than
 * stripped and acted on. docs/BRIEF.md B9 step 6 -- environmental adapters
 * receive coordinates and query parameters only -- is then true here by
 * construction and not by care: there is no address in this process to leak.
 *
 * The rest of B9's last paragraph, held here:
 *
 * 1. **No coordinate in any log line.** The geocode handler's rule holds: every
 *    log line this file writes is a fixed string, never an error's own
 *    `.message`, never a value derived from the request. Here the thing that
 *    must not leak is the coordinate.
 * 2. **No coordinate in any error payload.** The terminal event says `failed`
 *    and carries nothing else, and the one non-stream response is
 *    `{"status":"invalid"}`, the same body the geocode route returns.
 * 3. **No cache key tied to a user, session, IP or browser.** The report path
 *    *is* cached -- `app/api/report/route.ts` wraps the io it passes here in
 *    `lib/io/cache-source-io.ts`, so most of what this file asks for on a warm
 *    process is served from a map rather than the network. The property is not
 *    "no cache"; it is that the cache cannot key on any of those things,
 *    because the only seam it sits on carries a `URL` and a schema and there is
 *    no request, header, cookie or socket in its scope. That file's own module
 *    comment is where the argument and the heap-dump caveat live, and its tests
 *    assert the digest rather than the intention. Nothing about the cache
 *    reaches this file: it is one `SourceIo` standing in for another.
 * 4. **No payload URL carrying a key**, checked a second time in
 *    `app/lib/report-contract.ts` by the same parse that strips unknown keys.
 *
 * The coordinate does reach the browser inside the trace, and that is not a
 * leak but a round trip: docs/BRIEF.md B8 requires a calculated distance to
 * carry both coordinates and the formula, so the kernel's haversine provenance
 * names the mapped point by construction, and a five-mile query's payload URL
 * is the citation the trace panel exists to show. It goes back down the same
 * connection the browser sent it up. Nothing here writes it anywhere else.
 *
 * THE ORIGIN SENTENCES DO NOT COME FROM THIS ROUTE. A `GeocodeMatch` holds
 * `Sourced` values and there is no exported way to build one, so this route
 * cannot reconstruct the match from the two numbers the browser sends, and it
 * must not try. The rendered origin sentences arrive from the geocode route,
 * beside the match view it already returns; `app/api/geocode/handler.ts` is the
 * one place a match exists. That is why `app/lib/report-contract.ts` has no
 * origin arm on the wire at all.
 *
 * FRS RUNS AFTER SEMS, AND THAT IS A REAL DEPENDENCY. `lookupFrsFacility` takes
 * a registry ID, not a locus: a five-mile FRS query answers 6,915 interest rows
 * (docs/BRIEF.md B2), so FRS is an identity lookup and there is nothing to ask
 * it until something has named an identifier. The registry card therefore
 * depends on which Superfund records the report is showing, and cannot start
 * until SEMS has settled. Every other source starts at once.
 *
 * A FAILING SOURCE IS A CARD, NOT A STREAM ERROR. `runSource` never rejects; it
 * returns an unavailable outcome, which the selection policy turns into a
 * status sentence. The stream ends only when every source has settled or the
 * client disconnects.
 *
 * A DISCONNECT STOPS THE REQUESTS AS WELL AS THE EVENTS, SINCE 2026-09-17.
 * `cancel` sets `open` false, which stops this file building or sending
 * anything further, and fires `abandoned`, which stops the work itself.
 *
 * It did not, and the debt was measured rather than estimated. Against the
 * committed fixtures with every source answering 30 ms late, cancelling the
 * reader after the first card:
 *
 *     requests issued when the client cancelled: 3
 *     requests issued 2s later                 : 25
 *
 * Twenty-two requests to EPA hosts after the reader had gone -- the fifteen
 * Envirofacts status lookups, ECHO's second page, the registry lookups -- and an
 * abandoned tab ran until its slowest source spent its whole budget.
 * `tests/unit/app/cancellation.test.ts` reproduces exactly those numbers against
 * the old behaviour and asserts the count stops growing under the new one.
 *
 * THE FIX WAS A TENTH OF WHAT THIS COMMENT PREDICTED, and the prediction is
 * kept because the reasoning was the expensive part. It said the signal would
 * have to reach `SourceIo.get`, be honoured in `lib/io/fetch-source-io.ts`,
 * pass through `lib/io/cache-source-io.ts`, "and be threaded by every adapter
 * that loops -- SEMS over fifteen sites, ECHO over its pages, FRS over its
 * registry IDs". The first three were right. The last was not.
 *
 * An adapter calls `get` on whatever io it was handed and has no opinion about
 * cancellation, so `runSource` binds the signal into the io instead and every
 * loop inside every adapter becomes cancellable without changing a line of any
 * of them. The signal is per report, not per call, which is what made a
 * decorator enough where a parameter looked necessary. Not one adapter was
 * touched.
 *
 * `runSource` owning the controller closed the second half too. `withTimeout`
 * in `lib/evidence/source.ts` rejected its race without cancelling the loser,
 * so an adapter whose budget expired kept looping and kept issuing requests
 * after the card that gave up on it was sent. It now aborts whatever it
 * abandons.
 *
 * ONE REQUEST STILL ESCAPED, AND MEASURING IS THE ONLY REASON IT WAS FOUND.
 * With all of the above in place the count went from twenty-two to one, every
 * run, and it was always Esri's flood layer. `floodZoneOutcome` falls back to
 * the copy whenever the authoritative leg is unavailable, and it never asked
 * why: a cancelled first leg looked exactly like a refused one, so it opened a
 * second connection for a reader who had already gone. A fallback that does not
 * ask why it is falling back will do that wherever it appears.
 *
 * AND A CARD THAT CANNOT BE BUILT COSTS THAT CARD AND NO OTHER. A source
 * failing is an answer; a card failing to build is a defect -- a render with no
 * template for what it was given, a wire schema that refuses the event -- and
 * the two are not the same failure. The defect stays loud: the stream ends
 * `failed` and one fixed line is logged. What it may not do is take a sibling's
 * card with it, and it could. The registry card is emitted from inside the SEMS
 * task, so before `emitCard` confined it an unbuildable SEMS card rejected that
 * task and FRS -- which had nothing wrong with it -- got no event at all,
 * neither a card nor `not-asked`.
 *
 * NO CONDITIONAL ABOUT WHICH TEMPLATE OR WHICH RECORD IS WRITTEN HERE.
 * `lib/report/selection.ts` decides what appears; this renders what it decided,
 * against a live store, and puts it on the wire through
 * `lib/report/sentence-view.ts`.
 */

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import {
	AGENCY,
	complete,
	DEFAULT_POLICY,
	fieldsOf,
	NO_DATA_NOTE,
	render,
	runSource,
	sectionOrdering,
	storeOf,
	unavailableOf,
} from "@/lib/evidence";
import type {
	Adapter,
	AdapterVersion,
	Built,
	EvidenceRecord,
	EvidenceStore,
	GeoPoint,
	Kind,
	Locus,
	PayloadRef,
	Placement,
	RecordOf,
	Sealed,
	SourceIo,
	SourceOutcome,
	SourcePolicy,
	SourceUnavailable,
} from "@/lib/evidence";
import { airnowAdapter } from "@/lib/adapters/airnow";
import { aqsAdapter, latestLikelySummaryYear } from "@/lib/adapters/aqs";
import { ECHO_POLICY, echoAdapter } from "@/lib/adapters/echo";
import { floodZoneOutcome } from "@/lib/adapters/fema";
import { lookupFrsFacility } from "@/lib/adapters/frs";
import { semsAdapter } from "@/lib/adapters/sems";
import { groupRecords } from "@/lib/report/grouping";
import {
	airnowCard,
	aqsCard,
	carriedCount,
	groupsFor,
	echoCard,
	floodCard,
	frsCard,
	groupPlacements,
	NO_GROUPS,
	semsCard,
	SHOWN_RECORDS,
	type AirTemplates,
	type AnyListing,
	type Card,
	type ListingEntry,
	type ReportSource,
} from "@/lib/report/selection";
import { airnowTemplates } from "@/lib/templates/airnow";
import { aqsMonitorSummary } from "@/lib/templates/aqs";
import { sentenceView, type SentenceView } from "@/lib/report/sentence-view";
import {
	NDJSON_CONTENT_TYPE,
	ReportErrorSchema,
	ReportEventSchema,
	ReportRequestSchema,
	ReportSourceSchema,
	withoutSecretValues,
	type CardView,
	type ReportError,
	type ReportEvent,
	type ReportRequest,
	type SentenceViewMessage,
	type WireSentenceTrace,
} from "@/app/lib/report-contract";

/* -------------------------------------------------------------------------- */
/* The boundaries, out of docs/BRIEF.md B2                                    */
/* -------------------------------------------------------------------------- */

/** The international mile, which is the unit ECHO's `p_radius` is in. */
const METERS_PER_MILE = 1609.344;

/**
 * B2's boundary table: five miles for ECHO, SEMS and FRS. The radius is not in
 * the request and never will be -- it is a product decision per source, and a
 * radius a client could choose is a radius a client could use to probe.
 */
const FIVE_MILES_METERS = Math.round(5 * METERS_PER_MILE);

/** B2: the nearest qualified PM2.5 and ozone monitors within fifty kilometres. */
const FIFTY_KM_METERS = 50_000;

/**
 * B2: FEMA answers for the exact mapped point, and AirNow answers for a
 * reporting area it defines itself. Neither takes a radius, so neither has one.
 */
const AT_THE_POINT_METERS = 0;

/**
 * `Locus` carries one radius, so the report builds one locus per source rather
 * than passing a single radius around. Complete by construction: a mapped type
 * over `ReportSource` will not compile with a source missing.
 */
const BOUNDARY_METERS: { readonly [S in ReportSource]: number } = {
	echo: FIVE_MILES_METERS,
	frs: FIVE_MILES_METERS,
	sems: FIVE_MILES_METERS,
	aqs: FIFTY_KM_METERS,
	airnow: AT_THE_POINT_METERS,
	fema: AT_THE_POINT_METERS,
};

/**
 * B10: every source has an independent timeout. ECHO's is 45 seconds because
 * its five-mile query at the demo point answers 1,686 facilities from a host
 * that needs it (`lib/adapters/echo.ts`); everything else gets the kernel's
 * default, and no source's timeout can hold another's card.
 */
const POLICIES: { readonly [S in ReportSource]: SourcePolicy } = {
	echo: ECHO_POLICY,
	frs: DEFAULT_POLICY,
	sems: DEFAULT_POLICY,
	aqs: DEFAULT_POLICY,
	airnow: DEFAULT_POLICY,
	fema: DEFAULT_POLICY,
};

/**
 * How many registry lookups the FRS card makes.
 *
 * FRS is an identity lookup and each lookup is its own request, so the number
 * has to be bounded and the bound has to be defensible. It is B7's own: the
 * five records a section shows before "View all". The registry card resolves
 * the identity of records the reader can actually see; a lookup for a record
 * behind "View all" spends a request on a sentence nobody has asked for, and
 * bounding it at what the report carries instead would be fifty requests for
 * one card. The ids come from the Superfund card's own shown entries, in the
 * order it shows them, deduplicated -- two SEMS sites can share one registry
 * ID (docs/BRIEF.md B6 names a verified pair), and that is one facility.
 */
const FRS_LOOKUPS = SHOWN_RECORDS;

const REPORT_VERSION: AdapterVersion = "report@1";

/**
 * The payload the confirmed point is read from. Not a URL and not derived from
 * the coordinate: it names the request, so the trace can say the mapped point
 * came from the browser's own confirmation rather than from any agency.
 */
const CONFIRMED_POINT = "urn:ground-truth:confirmed-point";

/* -------------------------------------------------------------------------- */
/* The source table                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The templates the air cards speak with.
 *
 * One entry per kind, and they are shaped differently because the kinds are:
 * `lib/templates/aqs.ts` is one template declaring no requirement, so it speaks
 * for every monitor summary, while `lib/templates/airnow.ts` is two split on
 * whether the row carries an index, so the policy is handed both and chooses
 * per record. Passing `airnowTemplates` rather than naming its two members is
 * what makes a third template of that kind a change to that file alone.
 */
const AIR_TEMPLATES: AirTemplates = { aqs: aqsMonitorSummary, airnow: airnowTemplates };

/**
 * Every source a locus alone is enough to ask, with the card its outcome
 * becomes.
 *
 * `adapter` is a function of this request's `SourceIo` because one of them is:
 * `aqsAdapter` takes the summary year it reports on, since AQS lags collection
 * by six months or more and the year a card states has to be a decision the
 * caller made rather than one buried in a clock read (`lib/adapters/aqs.ts`).
 * The report's clock is `io.now()` -- the instant every payload's `retrievedAt`
 * already comes from, and the one a test fixes -- so the year is read off that
 * and never off a wall clock in here. Every other entry ignores the argument.
 *
 * FEMA is absent: `runSources`' shared fan-out would give the flood slot one
 * outcome with no way to say which of the two datasets answered, and that
 * distinction is the entire reason the flood card exists. FRS is absent because
 * it takes a registry ID rather than a locus.
 */
type LocusSource = {
	readonly source: ReportSource;
	readonly adapter: (io: SourceIo) => Adapter<Kind>;
	readonly card: (store: EvidenceStore, outcome: SourceOutcome) => Card;
};

const LOCUS_SOURCES: readonly LocusSource[] = [
	{ source: "sems", adapter: () => semsAdapter, card: (store, outcome) => semsCard(store, outcome, NO_GROUPS) },
	{ source: "echo", adapter: () => echoAdapter, card: (store, outcome) => echoCard(store, outcome, NO_GROUPS) },
	{
		source: "aqs",
		adapter: (io) => aqsAdapter(latestLikelySummaryYear(io.now())),
		card: (store, outcome) => aqsCard(store, outcome, AIR_TEMPLATES),
	},
	{ source: "airnow", adapter: () => airnowAdapter, card: (store, outcome) => airnowCard(store, outcome, AIR_TEMPLATES) },
];

const REPORT_SOURCES: readonly ReportSource[] = ReportSourceSchema.options;

/** Asked by a path of its own: FEMA through `floodZoneOutcome`, FRS through the registry ids SEMS named. */
const ASKED_SEPARATELY: readonly ReportSource[] = ["fema", "frs"];

/**
 * What the report says about a source with no adapter: that it was not asked.
 *
 * Not "no matching records" -- that is a source answering with nothing, and
 * B10 gives it its own wording. Not "unavailable" either: B10's unavailable row
 * offers the reader a Retry, and there is nothing to retry when no request was
 * ever made. A source nobody asked is neither, and `FailureCause` is right not
 * to have a member for it: nothing failed. So the card carries the source's
 * name, the `not-asked` state and no status sentence at all, because no
 * template speaks for a request that was not made and this file may not write
 * prose that no agency's fields produced.
 *
 * It is empty now, because every source in docs/BRIEF.md B2 has an adapter and
 * every one of them is registered above or asked by a path of its own. The
 * state is still reached, and still tested: FRS is asked only when a Superfund
 * record names a registry ID, so a report where nothing did emits exactly this
 * card for it. An air source with no key configured does **not** reach it --
 * that request was made, it failed before the network for a reason the card can
 * state, and `not-configured` is the cause that states it.
 */
const NOT_ASKED: readonly ReportSource[] = REPORT_SOURCES.filter(
	(source) =>
		!LOCUS_SOURCES.some((registered) => registered.source === source) && !ASKED_SEPARATELY.includes(source),
);

/* -------------------------------------------------------------------------- */
/* The mapped point                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The confirmed coordinate as a `GeoPoint`, so every distance the report
 * computes traces back to where the point came from.
 *
 * `sha256` is of the exact request bytes, the same "this is what we saw" record
 * `lib/io/fetch-source-io.ts` keeps for a response. The `url` names the request
 * and carries no coordinate.
 */
function confirmedPoint(body: ReportRequest, requestSha256: string, io: SourceIo): GeoPoint {
	const payload: PayloadRef = { url: CONFIRMED_POINT, sha256: requestSha256, retrievedAt: io.now() };
	const point = fieldsOf(
		{ raw: { latitude: body.latitude, longitude: body.longitude }, payload },
		"confirmed_point",
		REPORT_VERSION,
	).point("latitude", "longitude", {});
	if (point === null) throw new Error("report: the confirmed point has no coordinate");
	return point;
}

function locusFor(point: GeoPoint, source: ReportSource): Locus {
	return { point, radiusMeters: BOUNDARY_METERS[source] };
}

/* -------------------------------------------------------------------------- */
/* Rendering a card                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The wire form of one rendered sentence.
 *
 * An origin-scoped trace has no wire form, and reaching this with one is a
 * defect rather than a case: no origin placement is selected here, and
 * `SentenceTraceSchema` has no arm for one. Throwing makes that loud instead of
 * quietly shipping a sentence with its provenance dropped.
 */
function messageOf(view: SentenceView): SentenceViewMessage {
	const trace: WireSentenceTrace | null = ((): WireSentenceTrace | null => {
		if (view.trace === null) return null;
		if (view.trace.scope === "origin") {
			throw new Error("report: an origin sentence cannot cross the report wire");
		}
		return view.trace;
	})();
	return { templateId: view.templateId, spans: view.spans, trace };
}

function messageFor(store: EvidenceStore, placement: Placement): SentenceViewMessage | null {
	const sentence = render(store, placement);
	return sentence === null ? null : messageOf(sentenceView(store, sentence));
}

/** Every placement that rendered, in reading order. A placement that renders nothing leaves no text, per docs/BRIEF.md B8. */
function messagesFor(store: EvidenceStore, placements: readonly Placement[]): readonly SentenceViewMessage[] {
	const out: SentenceViewMessage[] = [];
	for (const placement of placements) {
		const message = messageFor(store, placement);
		if (message !== null) out.push(message);
	}
	return out;
}

/**
 * One list on a card, with its chrome numbers.
 *
 * All three reads -- the entries, the total and what the card carries -- are
 * taken from one live store in one synchronous block, which is what makes them
 * agree. `lib/report/selection.ts` holds the argument: a count beside a list
 * frozen at plan time could not be made to agree with it, so a `Listing` holds
 * no records and rebuilds them from the ordering on every call. Nothing here
 * caches the result.
 */
type ListingView = CardView["listings"][number];
type EntryView = ListingView["shown"][number];

function entryView(store: EvidenceStore, entry: ListingEntry): EntryView {
	return {
		recordId: { kind: entry.recordId.kind, sourceRecordId: entry.recordId.sourceRecordId },
		sentences: messagesFor(store, entry.placements),
	};
}

function listingView(store: EvidenceStore, listing: AnyListing): ListingView {
	const entries = listing.entries(store);
	return {
		kind: listing.section.kind,
		boundary: listing.section.boundary,
		ordering: listing.ordering,
		total: sectionOrdering(store, listing.section).length,
		carried: carriedCount(store, listing.section),
		shown: entries.shown.map((entry) => entryView(store, entry)),
		rest: entries.rest.map((entry) => entryView(store, entry)),
	};
}

/**
 * What the card is about, in the words its own status sentence uses. FEMA is
 * one source and two layers, so a card the Esri copy answered is labelled for
 * Esri's copy and not for FEMA's own service.
 */
function agencyOf(card: Card): string {
	return card.status.agency ?? AGENCY[card.source];
}

function cardView(store: EvidenceStore, card: Card): CardView {
	return {
		source: card.source,
		agency: agencyOf(card),
		state: "asked",
		status: messageFor(store, card.status),
		priorAttempts: messagesFor(store, card.priorAttempts),
		headlines: messagesFor(store, card.headlines),
		listings: card.listings.map((listing) => listingView(store, listing)),
	};
}

function notAskedView(source: ReportSource): CardView {
	return {
		source,
		agency: AGENCY[source],
		state: "not-asked",
		status: null,
		priorAttempts: [],
		headlines: [],
		listings: [],
	};
}

/* -------------------------------------------------------------------------- */
/* Asking one source                                                          */
/* -------------------------------------------------------------------------- */

/**
 * One settled source: its card, and the store that card was rendered against.
 *
 * The store holds that source's records and no others. Every section a card
 * reads is filtered to one kind, so a per-source store answers every question
 * the card asks, and building it that way means a card cannot depend on which
 * other sources happened to settle first.
 */
type CardBuild = {
	readonly card: Card;
	readonly store: EvidenceStore;
	readonly records: readonly Sealed<EvidenceRecord>[];
};

function recordsOf(outcome: SourceOutcome): readonly Sealed<EvidenceRecord>[] {
	return outcome.status === "ok" ? outcome.records : [];
}

function buildCard(records: readonly Sealed<EvidenceRecord>[], make: (store: EvidenceStore) => Card): CardBuild {
	const store = storeOf(records);
	return { card: make(store), store, records };
}

/**
 * The registry IDs the Superfund card is showing, in the order it shows them,
 * bounded at `FRS_LOOKUPS`.
 *
 * `entries(store)` is the only usable form of a listing for a caller holding a
 * card, and it is a read of the same store the card was rendered against, so
 * these are exactly the records that reached the reader.
 */
function registryIdsShown(build: CardBuild): readonly string[] {
	// Read back out of the store by kind, which is what keeps the record typed
	// without an assertion: a listing entry carries an id of any kind.
	const sites = new Map(build.store.ofKind("sems-site").map((record) => [record.id.sourceRecordId, record]));
	const ids: string[] = [];
	for (const listing of build.card.listings) {
		for (const entry of listing.entries(build.store).shown) {
			const record = sites.get(entry.recordId.sourceRecordId);
			if (record === undefined) continue;
			const registryId = record.frsRegistryId.value;
			if (registryId === null || registryId === "" || ids.includes(registryId)) continue;
			ids.push(registryId);
			if (ids.length === FRS_LOOKUPS) return ids;
		}
	}
	return ids;
}

type FrsAnswer =
	| { readonly built: readonly Built<"frs-facility">[] }
	| { readonly failed: SourceUnavailable };

/**
 * The registry lookups, as one source outcome.
 *
 * `runSource` cannot run this: FRS is not an `Adapter` and takes no locus, so
 * the timeout that bounds it is the one `SourceIo` applies per request, and the
 * lookup count is bounded instead. A lookup that fails belongs to its own
 * registry ID and is classified by the kernel exactly as a failed source would
 * be; the card reports unavailable only when nothing at all was built, because
 * a card that says "unavailable" over records it is also listing says two
 * things at once.
 */
async function askFrs(locus: Locus, io: SourceIo, registryIds: readonly string[]): Promise<SourceOutcome> {
	const answers = await Promise.all(
		registryIds.map(async (registryId): Promise<FrsAnswer> => {
			try {
				return { built: await lookupFrsFacility(registryId, io) };
			} catch (error) {
				return { failed: unavailableOf(error) };
			}
		}),
	);
	const records: Sealed<RecordOf<"frs-facility">>[] = [];
	let failed: SourceUnavailable | null = null;
	for (const answer of answers) {
		if ("failed" in answer) {
			failed ??= answer.failed;
			continue;
		}
		for (const one of answer.built) records.push(complete(locus, one));
	}
	const [first, ...rest] = records;
	if (first !== undefined) return { status: "ok", records: [first, ...rest], retrievedAt: io.now() };
	if (failed !== null) return failed;
	return { status: "no-data", note: NO_DATA_NOTE, retrievedAt: io.now() };
}

/* -------------------------------------------------------------------------- */
/* The groups                                                                 */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* The handler                                                                */
/* -------------------------------------------------------------------------- */

function invalid(): Response {
	// Nothing about what was sent is read, logged or echoed: a malformed-JSON
	// message can quote the body it failed on and a zod issue can carry a
	// received value, and here that value is a coordinate.
	const body: ReportError = { status: "invalid" };
	return NextResponse.json(ReportErrorSchema.parse(body), { status: 400 });
}

/**
 * Builds the route's `POST` handler against whatever `SourceIo` it is given.
 * `route.ts` supplies the real, network-touching one; tests supply fixtures.
 *
 * `policies` overrides a source's timeout. Production passes none and gets
 * `POLICIES` above; a test passes a short one so a timeout case does not cost
 * the suite forty-five seconds.
 */
export function createReportHandler(io: SourceIo, policies: Partial<Record<ReportSource, SourcePolicy>> = {}) {
	const policyFor = (source: ReportSource): SourcePolicy => policies[source] ?? POLICIES[source];

	return async function POST(request: Request): Promise<Response> {
		let body: ReportRequest;
		let requestSha256: string;
		try {
			const text = await request.text();
			requestSha256 = createHash("sha256").update(text, "utf8").digest("hex");
			const json: unknown = JSON.parse(text);
			body = ReportRequestSchema.parse(json);
		} catch {
			return invalid();
		}

		const encoder = new TextEncoder();
		let open = true;
		// One controller for this report. `cancel` fires it, `runSource` binds it
		// into the io it hands each adapter, and every request in flight is
		// abandoned. Per request and never shared: the io is a module-level
		// singleton built once in `route.ts`, so a signal on the io itself would
		// have one reader's disconnect cancel every other reader's report.
		const abandoned = new AbortController();

		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				/** One event, parsed through the wire schema before a byte of it leaves. */
				const emit = (event: ReportEvent): void => {
					// Checked first: after the client has gone there is nothing to
					// build a line for, and building one costs a full schema parse of
					// a payload that can run to hundreds of kilobytes.
					if (!open) return;
					// Two redactions, and they fail differently. The schema's own
					// `withoutKeys` rewrites a credential-bearing query parameter in a
					// string that parses as a URL; `withoutSecretValues` replaces a
					// configured credential's own bytes wherever they sit, including
					// inside a source's verbatim error text, which reaches the card
					// through `SourceFailure.rawCode` and is not a URL.
					const line = encoder.encode(
						`${withoutSecretValues(JSON.stringify(ReportEventSchema.parse(event)))}\n`,
					);
					try {
						controller.enqueue(line);
					} catch {
						// The client went away between the check and the enqueue.
						open = false;
					}
				};

				const settled: CardBuild[] = [];
				/** The sources whose card reached the wire. No later event speaks for a card that did not. */
				const shown = new Set<ReportSource>();
				/** How many cards could not be built or sent: one report, one log line, however many were lost. */
				let cardsLost = 0;

				/**
				 * One card, built and put on the wire, with a throw from either step
				 * confined to this card.
				 *
				 * The build is handed back even when the event could not be sent, because
				 * the FRS lookups read the SEMS build: a card the reader never saw is a
				 * reason to report a failure, not a reason to leave a second source
				 * unasked.
				 */
				const emitCard = (make: () => CardBuild): CardBuild | null => {
					let build: CardBuild;
					try {
						build = make();
					} catch {
						cardsLost += 1;
						return null;
					}
					settled.push(build);
					try {
						emit({ type: "card", card: cardView(build.store, build.card) });
						shown.add(build.card.source);
					} catch {
						cardsLost += 1;
					}
					return build;
				};

				/** The same confinement for a card there was nothing to ask: one event, no records, no build. */
				const emitNotAsked = (source: ReportSource): void => {
					try {
						emit({ type: "card", card: notAskedView(source) });
						shown.add(source);
					} catch {
						cardsLost += 1;
					}
				};

				const run = async (): Promise<void> => {
					// Built inside the stream, so that a failure here is one event and
					// an ended stream rather than a request that never answers. This
					// is the "the whole thing failed before any card" case, and it is
					// the only way to reach it: everything below is a source, and a
					// source that fails is a card.
					const point = confirmedPoint(body, requestSha256, io);
					// Every locus source's adapter, built against this request's io
					// before any card is emitted. AQS's is why this is not a constant:
					// it takes the summary year it reports on, read from `io.now()`.
					// A clock that cannot be read fails the whole report here, which is
					// where `confirmedPoint` already puts it, rather than costing one
					// card outside the guard that confines a card's failure to itself.
					const asked = LOCUS_SOURCES.map((registered) => ({ registered, adapter: registered.adapter(io) }));

					for (const source of NOT_ASKED) emitNotAsked(source);

					const tasks: Promise<void>[] = asked.map(async ({ registered, adapter }) => {
						const outcome = await runSource(
							locusFor(point, registered.source),
							adapter,
							io,
							policyFor(registered.source),
							abandoned.signal,
						);
						const build = emitCard(() => buildCard(recordsOf(outcome), (store) => registered.card(store, outcome)));
						if (registered.source !== "sems") return;
						// FRS cannot start until SEMS has settled: it takes a registry
						// ID, and until now nothing had named one. With no registry ID
						// to resolve there is nothing to ask, and a source nobody asked
						// is not one that answered with nothing. A SEMS card that could not
						// be built named no registry ID either, and FRS is then unasked for
						// the same reason and says so on a card of its own.
						const ids = build === null ? [] : registryIdsShown(build);
						if (ids.length === 0) {
							emitNotAsked("frs");
							return;
						}
						const frs = await askFrs(locusFor(point, "frs"), io, ids);
						emitCard(() => buildCard(recordsOf(frs), (store) => frsCard(store, frs, NO_GROUPS)));
					});

					tasks.push(
						(async (): Promise<void> => {
							const result = await floodZoneOutcome(locusFor(point, "fema"), io, policyFor("fema"), abandoned.signal);
							emitCard(() => buildCard(recordsOf(result.outcome), (store) => floodCard(store, result)));
						})(),
					);

					const outcomes = await Promise.allSettled(tasks);

					const records = settled.flatMap((build) => [...build.records]);
					const store = storeOf(records);
					const leads = groupPlacements(groupRecords(records));
					// One entry per card that has something to say. A source with no
					// group is simply absent: an empty entry would be six lines of
					// nothing on every report, and the browser learns the same thing
					// from not finding its source here. A card that could not be built is
					// absent for a second reason: there is no card to put a group on. Its
					// records stay in the record set behind the grouping, so a card that
					// did reach the reader still states the identity it shares with them.
					emit({
						type: "groups",
						cards: REPORT_SOURCES.filter((source) => shown.has(source))
							.map((source) => {
								const groups = groupsFor(leads, source);
								return {
									source,
									groups: messagesFor(store, groups.placements),
									crossReferences: messagesFor(store, groups.crossReferences),
								};
							})
							.filter((card) => card.groups.length > 0 || card.crossReferences.length > 0),
					});

					if (cardsLost > 0 || outcomes.some((one) => one.status === "rejected")) {
						// A fixed string: not the error, not its message, nothing
						// derived from the request. One line per report, whether one card
						// was lost or a whole task rejected around one.
						console.error("report: a source card could not be built");
						emit({ type: "end", status: "failed" });
						return;
					}
					emit({ type: "end", status: "complete" });
				};

				void run()
					.catch(() => {
						console.error("report: run failed");
						try {
							emit({ type: "end", status: "failed" });
						} catch {
							// The terminal event itself could not be built. The stream
							// still closes below rather than being left open.
						}
					})
					.finally(() => {
						try {
							controller.close();
						} catch {
							// Already closed by `cancel`.
						}
					});
			},
			/**
			 * The disconnect path, and it now stops the requests as well as the
			 * events. `open` ends the stream; the abort reaches every adapter
			 * mid-flight, because `runSource` bound this signal into the io each
			 * one was handed.
			 *
			 * The comment this replaced said closing it would take an `AbortSignal`
			 * threaded through every adapter that loops. It did not. `runSource`
			 * hands each adapter an io, and an adapter calls `get` on whatever it
			 * was given, so binding the signal to the io reaches all of them at
			 * once. The loops never needed an opinion about cancellation.
			 */
			cancel() {
				open = false;
				abandoned.abort();
			},
		});

		return new Response(stream, {
			status: 200,
			headers: { "content-type": NDJSON_CONTENT_TYPE, "cache-control": "no-store" },
		});
	};
}
