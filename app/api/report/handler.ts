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

const METERS_PER_MILE = 1609.344;

const FIVE_MILES_METERS = Math.round(5 * METERS_PER_MILE);

const FIFTY_KM_METERS = 50_000;

const AT_THE_POINT_METERS = 0;

const BOUNDARY_METERS: { readonly [S in ReportSource]: number } = {
	echo: FIVE_MILES_METERS,
	frs: FIVE_MILES_METERS,
	sems: FIVE_MILES_METERS,
	aqs: FIFTY_KM_METERS,
	airnow: AT_THE_POINT_METERS,
	fema: AT_THE_POINT_METERS,
};

const POLICIES: { readonly [S in ReportSource]: SourcePolicy } = {
	echo: ECHO_POLICY,
	frs: DEFAULT_POLICY,
	sems: DEFAULT_POLICY,
	aqs: DEFAULT_POLICY,
	airnow: DEFAULT_POLICY,
	fema: DEFAULT_POLICY,
};

const FRS_LOOKUPS = SHOWN_RECORDS;

const REPORT_VERSION: AdapterVersion = "report@1";

const CONFIRMED_POINT = "urn:ground-truth:confirmed-point";

const AIR_TEMPLATES: AirTemplates = { aqs: aqsMonitorSummary, airnow: airnowTemplates };

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

function messagesFor(store: EvidenceStore, placements: readonly Placement[]): readonly SentenceViewMessage[] {
	const out: SentenceViewMessage[] = [];
	for (const placement of placements) {
		const message = messageFor(store, placement);
		if (message !== null) out.push(message);
	}
	return out;
}

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

function registryIdsShown(build: CardBuild): readonly string[] {
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

function invalid(): Response {
	const body: ReportError = { status: "invalid" };
	return NextResponse.json(ReportErrorSchema.parse(body), { status: 400 });
}

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
		const abandoned = new AbortController();

		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				const emit = (event: ReportEvent): void => {
					if (!open) return;
					const line = encoder.encode(
						`${withoutSecretValues(JSON.stringify(ReportEventSchema.parse(event)))}\n`,
					);
					try {
						controller.enqueue(line);
					} catch {
						open = false;
					}
				};

				const settled: CardBuild[] = [];
				const shown = new Set<ReportSource>();
				let cardsLost = 0;

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

				const emitNotAsked = (source: ReportSource): void => {
					try {
						emit({ type: "card", card: notAskedView(source) });
						shown.add(source);
					} catch {
						cardsLost += 1;
					}
				};

				const run = async (): Promise<void> => {
					const point = confirmedPoint(body, requestSha256, io);
					const asked = LOCUS_SOURCES.map((registered) => ({ registered, adapter: registered.adapter(io) }));


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
						}
					})
					.finally(() => {
						try {
							controller.close();
						} catch {
						}
					});
			},
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
