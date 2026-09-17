import {
	defineSection,
	sectionOrdering,
	type EvidenceRecord,
	type EvidenceStore,
	type GeocodeMatch,
	type GroupPlacement,
	type Kind,
	type OriginPlacement,
	type Placement,
	type RecordId,
	type RecordOf,
	type Requirement,
	type Sealed,
	type SectionPlacement,
	type SectionSpec,
	type SourceId,
	type QueryProvenance,
	type SourceOutcome,
	type SourcePlacement,
	type Template,
} from "@/lib/evidence";
import { BOUNDARIES } from "@/lib/boundaries";
import { FEMA_DATASETS, type FloodZoneResult } from "@/lib/adapters/fema";
import type { FacilityGroup, GroupingResult } from "@/lib/report/grouping";
import {
	echoFacilityFormalAction,
	echoFacilityNoFormalAction,
	echoFacilityNoStatus,
	echoFacilityNoncompliance,
	echoFacilitySummary,
} from "@/lib/templates/echo";
import { floodZoneSummary, floodZoneUnmappedFlag } from "@/lib/templates/fema";
import { frsFacilityCrossReference, frsFacilityIdentity } from "@/lib/templates/frs";
import { groupMemberCount, groupSharedIdentifier } from "@/lib/templates/groups";
import { originMatch, originPoint } from "@/lib/templates/origin";
import {
	aqsNoPollutantMonitor,
	echoFormalActionCount,
	echoNoncomplianceCount,
	echoSectionCount,
	sectionNoRecords,
	sectionNotShown,
	sectionRetrievedAt,
	semsNplSectionCount,
	semsSectionCount,
} from "@/lib/templates/sections";
import {
	semsSiteNpl,
	semsSiteRegistryOnly,
	semsSiteStatusUnavailable,
	semsSiteSummary,
} from "@/lib/templates/sems";
import { sourceRetrieved, sourceUnavailable } from "@/lib/templates/sources";

export type ReportSource = Exclude<SourceId, "census">;

export type RecordPlacementOf<K extends Kind> = {
	readonly scope: "record";
	readonly recordId: RecordId<K>;
	readonly template: Template<K>;
};

export type ListingEntryOf<K extends Kind> = {
	readonly recordId: RecordId<K>;
	readonly placements: readonly [RecordPlacementOf<K>, ...RecordPlacementOf<K>[]];
};

export type ListingEntry = { [K in Kind]: ListingEntryOf<K> }[Kind];

export type OrderingName = "distance" | "echo-b7";

export type ListingEntries<K extends Kind = Kind> = {
	readonly shown: readonly ListingEntryOf<K>[];
	readonly rest: readonly ListingEntryOf<K>[];
};

export type Listing<K extends Kind = Kind> = {
	readonly section: SectionSpec<K>;
	readonly ordering: OrderingName;
	readonly bounds: Bounds;
	readonly describe: (record: Sealed<RecordOf<K>>) => ListingEntryOf<K>;
	readonly entries: (store: EvidenceStore) => ListingEntries<K>;
};

export type AnyListing = { [K in Kind]: Listing<K> }[Kind];

export type Card = {
	readonly source: ReportSource;
	readonly status: SourcePlacement;
	readonly priorAttempts: readonly SourcePlacement[];
	readonly headlines: readonly SectionPlacement[];
	readonly listings: readonly AnyListing[];
	readonly groups: readonly GroupPlacement[];
	readonly crossReferences: readonly RecordPlacementOf<"frs-facility">[];
};

export type CardGroups = {
	readonly placements: readonly GroupPlacement[];
	readonly crossReferences: readonly RecordPlacementOf<"frs-facility">[];
};

export const NO_GROUPS: CardGroups = { placements: [], crossReferences: [] };

export type ReportPlan = {
	readonly origin: readonly [OriginPlacement, ...OriginPlacement[]];
	readonly cards: readonly [Card, ...Card[]];
};

export type AirTemplates = {
	readonly aqs: Template<"aqs-monitor-summary">;
	readonly airnow: readonly Template<"airnow-observation">[];
};

export type ReportSources = { readonly [S in Exclude<ReportSource, "fema">]: SourceOutcome };

export type ReportInput = {
	readonly store: EvidenceStore;
	readonly match: GeocodeMatch;
	readonly sources: ReportSources;
	readonly flood: FloodZoneResult;
	readonly grouping: GroupingResult;
	readonly air: AirTemplates | null;
};

export type Bounds = {
	readonly shown: number;
	readonly carried: number;
};

export const SHOWN_RECORDS = 5;

export const CARRIED_RECORDS = 45;

export const NEAREST_MONITOR = 1;

export type Pollutant = "PM2.5" | "Ozone";

export const POLLUTANTS: readonly Pollutant[] = ["PM2.5", "Ozone"];

export const DEFAULT_BOUNDS: Bounds = { shown: SHOWN_RECORDS, carried: CARRIED_RECORDS };

type Declaring = { readonly id: string; readonly requires: readonly Requirement[] };

function requiredEquals(template: Declaring, slot: string): string {
	for (const requirement of template.requires) {
		if ("slot" in requirement && requirement.slot === slot && "equals" in requirement) {
			if (typeof requirement.equals === "string") return requirement.equals;
		}
	}
	throw new Error(`${template.id} no longer requires a string value at ${slot}`);
}

function requiredAtLeast(template: Declaring, slot: string): number {
	for (const requirement of template.requires) {
		if ("slot" in requirement && requirement.slot === slot && "atLeast" in requirement) return requirement.atLeast;
	}
	throw new Error(`${template.id} no longer requires a threshold at ${slot}`);
}

function requiredPresence(template: Declaring, slot: string): boolean | null {
	for (const requirement of template.requires) {
		if ("slot" in requirement && requirement.slot === slot && "present" in requirement) return requirement.present;
	}
	return null;
}

export const FINAL_NPL_STATUS: string = requiredEquals(semsSiteNpl, "semsNplStatus");

export const NONCOMPLIANCE_QUARTERS: number = requiredAtLeast(echoFacilityNoncompliance, "quartersInNoncompliance");

export const BOUNDARY: { readonly [S in ReportSource]: string } = {
	echo: BOUNDARIES.echo.label,
	frs: BOUNDARIES.frs.label,
	sems: BOUNDARIES.sems.label,
	aqs: BOUNDARIES.aqs.label,
	airnow: BOUNDARIES.airnow.label,
	fema: BOUNDARIES.fema.label,
};

const RADIUS_BOUNDARY: ReadonlySet<ReportSource> = new Set(["echo", "sems", "aqs"]);

function statusPlacement(
	source: ReportSource,
	outcome: SourceOutcome,
	agency: string | null = null,
): SourcePlacement {
	return {
		scope: "source",
		source,
		outcome,
		agency,
		template: outcome.status === "unavailable" ? sourceUnavailable : sourceRetrieved,
	};
}

function retrievedAtOf(outcome: SourceOutcome): string | null {
	return outcome.status === "unavailable" ? null : outcome.retrievedAt;
}

const NONE_CARRIED_NOTE = "None of this source's records are in this report.";

function noteOf(outcome: SourceOutcome): string {
	return outcome.status === "no-data" ? outcome.note : NONE_CARRIED_NOTE;
}

const FRS_NO_ROWS_NOTE =
	"EPA's facility registry holds no programme-interest row for the registry IDs this report looked up.";

export type AnyRecord = Sealed<EvidenceRecord>;

const FARTHEST = Number.POSITIVE_INFINITY;

export function byDistance(a: AnyRecord, b: AnyRecord): number {
	const x = a.distanceMeters === null ? FARTHEST : a.distanceMeters.value;
	const y = b.distanceMeters === null ? FARTHEST : b.distanceMeters.value;
	if (x === y) return 0;
	return x - y;
}

function byNewest(a: AnyRecord, b: AnyRecord): number {
	const x = a.effectiveAt.value;
	const y = b.effectiveAt.value;
	if (x === null) return y === null ? 0 : 1;
	if (y === null) return -1;
	return y.localeCompare(x);
}

function formalActionRank(record: AnyRecord): number {
	return record.kind === "echo-facility" && record.lastFormalActionDate.value !== null ? 0 : 1;
}

function noncomplianceRank(record: AnyRecord): number {
	if (record.kind !== "echo-facility") return 1;
	const quarters = record.quartersInNoncompliance.value;
	if (quarters === null) return 2;
	return quarters >= NONCOMPLIANCE_QUARTERS ? 0 : 1;
}

function byId(a: AnyRecord, b: AnyRecord): number {
	return a.sourceRecordId.localeCompare(b.sourceRecordId);
}

export const ORDERINGS: { readonly [N in OrderingName]: (a: AnyRecord, b: AnyRecord) => number } = {
	distance: (a, b) => byDistance(a, b) || byId(a, b),
	"echo-b7": (a, b) =>
		formalActionRank(a) - formalActionRank(b) ||
		noncomplianceRank(a) - noncomplianceRank(b) ||
		byDistance(a, b) ||
		byNewest(a, b) ||
		byId(a, b),
};

export function orderedRecords<K extends Kind>(
	store: EvidenceStore,
	section: SectionSpec<K>,
	ordering: OrderingName,
): readonly Sealed<RecordOf<K>>[] {
	const counted = new Set(sectionOrdering(store, section).map((record) => record.sourceRecordId));
	const kind: Kind = section.kind;
	const ofKind = new Map(store.ofKind(section.kind).map((record) => [record.sourceRecordId, record]));
	const inStoreOrder = store.ofKind(kind).filter((record) => counted.has(record.sourceRecordId));
	const out: Sealed<RecordOf<K>>[] = [];
	for (const record of [...inStoreOrder].sort(ORDERINGS[ordering])) {
		const typed = ofKind.get(record.sourceRecordId);
		if (typed !== undefined) out.push(typed);
	}
	return out;
}

export function carriedCount(store: EvidenceStore, section: SectionSpec): number {
	const total = sectionOrdering(store, section).length;
	return section.carried === null ? total : Math.min(total, section.carried);
}

function carriedBound(bounds: Bounds): number {
	return bounds.shown + bounds.carried;
}

function entryOf<K extends Kind>(
	recordId: RecordId<K>,
	templates: readonly [Template<K>, ...Template<K>[]],
): ListingEntryOf<K> {
	const place = (template: Template<K>): RecordPlacementOf<K> => ({ scope: "record", recordId, template });
	const [primary, ...secondaries] = templates;
	return { recordId, placements: [place(primary), ...secondaries.map(place)] };
}

function listingOf<K extends Kind>(
	section: SectionSpec<K>,
	ordering: OrderingName,
	bounds: Bounds,
	describe: (record: Sealed<RecordOf<K>>) => ListingEntryOf<K>,
): Listing<K> {
	if (section.carried !== carriedBound(bounds)) {
		throw new Error(
			`${section.kind} listing is bounded at ${carriedBound(bounds)} and its section carries ${String(section.carried)}`,
		);
	}
	return {
		section,
		ordering,
		bounds,
		describe,
		entries: (store) => {
			const records = orderedRecords(store, section, ordering);
			return {
				shown: records.slice(0, bounds.shown).map(describe),
				rest: records.slice(bounds.shown, carriedBound(bounds)).map(describe),
			};
		},
	};
}

function noRecordsHeadline(
	store: EvidenceStore,
	outcome: SourceOutcome,
	section: SectionSpec,
): readonly SectionPlacement[] {
	if (outcome.status !== "no-data") return [];
	if (sectionOrdering(store, section).length > 0) return [];
	return [{ scope: "section", section, template: sectionNoRecords }];
}

function notShownHeadline(store: EvidenceStore, listing: AnyListing): readonly SectionPlacement[] {
	const section: SectionSpec = listing.section;
	const bound = section.carried;
	if (bound === null || sectionOrdering(store, section).length <= bound) return [];
	return [{ scope: "section", section, template: sectionNotShown }];
}

function pollutantHeadline(
	store: EvidenceStore,
	all: SectionSpec<"aqs-monitor-summary">,
	section: SectionSpec<"aqs-monitor-summary">,
): readonly SectionPlacement[] {
	if (sectionOrdering(store, all).length === 0) return [];
	if (sectionOrdering(store, section).length > 0) return [];
	return [{ scope: "section", section, template: aqsNoPollutantMonitor }];
}

function refuseUndescribed(store: EvidenceStore, kind: Kind): void {
	const held = store.ofKind(kind).length;
	if (held > 0) throw new Error(`the report holds ${held} ${kind} records and has no template to describe them`);
}

function refuseAnsweredWithNone(store: EvidenceStore, outcome: SourceOutcome, kind: Kind): void {
	if (outcome.status !== "no-data") return;
	const held = store.ofKind(kind).length;
	if (held > 0) {
		throw new Error(`the report holds ${held} ${kind} records under a source that answered with no records`);
	}
}

function countHeadline(section: SectionSpec, template: Template<"section">): SectionPlacement {
	return { scope: "section", section, template };
}

function nplCountHeadline(store: EvidenceStore, section: SectionSpec<"sems-site">): readonly SectionPlacement[] {
	const unanswered = store.ofKind("sems-site").some((record) => record.statusRow.status === "unavailable");
	return unanswered ? [] : [countHeadline(section, semsNplSectionCount)];
}

function retrievedAtHeadline(source: ReportSource, section: SectionSpec): readonly SectionPlacement[] {
	if (!RADIUS_BOUNDARY.has(source) || section.retrievedAt === null) return [];
	return [{ scope: "section", section, template: sectionRetrievedAt }];
}

function semsPrimary(record: Sealed<RecordOf<"sems-site">>): Template<"sems-site"> {
	switch (record.statusRow.status) {
		case "joined":
			return semsSiteSummary;
		case "no-row":
			return semsSiteRegistryOnly;
		case "unavailable":
			return semsSiteStatusUnavailable;
	}
}

function echoTemplatesFor(
	record: Sealed<RecordOf<"echo-facility">>,
): readonly [Template<"echo-facility">, ...Template<"echo-facility">[]] {
	const primary = record.complianceStatus.value === null ? echoFacilityNoStatus : echoFacilitySummary;
	const formal =
		record.lastFormalActionDate.value === null ? echoFacilityNoFormalAction : echoFacilityFormalAction;
	const quarters = record.quartersInNoncompliance.value;
	const rest: Template<"echo-facility">[] = [formal];
	if (quarters !== null && quarters >= NONCOMPLIANCE_QUARTERS) rest.push(echoFacilityNoncompliance);
	return [primary, ...rest];
}

function floodTemplateFor(record: Sealed<RecordOf<"fema-flood-zone">>): Template<"fema-flood-zone"> {
	return record.sfhaLabel.value === null ? floodZoneUnmappedFlag : floodZoneSummary;
}

function airnowTemplateFor(
	record: Sealed<RecordOf<"airnow-observation">>,
	templates: readonly Template<"airnow-observation">[],
): Template<"airnow-observation"> {
	const stated = record.aqi.value !== null;
	const chosen = templates.find((template) => requiredPresence(template, "aqi") === stated);
	if (chosen === undefined) {
		throw new Error(
			`no airnow-observation template speaks for a row whose air quality index is ${stated ? "present" : "absent"}`,
		);
	}
	return chosen;
}

/**
 * The request behind a section's count, when there was one. An unavailable
 * source never got as far as a request that returned anything, so it has none.
 */
function queryOf(outcome: SourceOutcome): QueryProvenance | null {
	return outcome.status === "unavailable" ? null : outcome.query;
}

function semsSection(outcome: SourceOutcome, bounds: Bounds): SectionSpec<"sems-site"> {
	return defineSection({
		kind: "sems-site",
		source: "sems",
		boundary: BOUNDARY.sems,
		query: queryOf(outcome),
		retrievedAt: retrievedAtOf(outcome),
		filter: null,
		note: noteOf(outcome),
		carried: carriedBound(bounds),
	});
}

function semsNplSection(outcome: SourceOutcome, bounds: Bounds): SectionSpec<"sems-site"> {
	return defineSection({
		kind: "sems-site",
		source: "sems",
		boundary: BOUNDARY.sems,
		query: queryOf(outcome),
		retrievedAt: retrievedAtOf(outcome),
		filter: { field: "semsNplStatus", equals: FINAL_NPL_STATUS },
		note: noteOf(outcome),
		carried: carriedBound(bounds),
	});
}

function echoSection(outcome: SourceOutcome, bounds: Bounds): SectionSpec<"echo-facility"> {
	return defineSection({
		kind: "echo-facility",
		source: "echo",
		boundary: BOUNDARY.echo,
		query: queryOf(outcome),
		retrievedAt: retrievedAtOf(outcome),
		filter: null,
		note: noteOf(outcome),
		carried: carriedBound(bounds),
	});
}

function echoFormalActionSection(outcome: SourceOutcome): SectionSpec<"echo-facility"> {
	return defineSection({
		kind: "echo-facility",
		source: "echo",
		boundary: BOUNDARY.echo,
		query: queryOf(outcome),
		retrievedAt: retrievedAtOf(outcome),
		filter: { field: "lastFormalActionDate", present: true },
		note: noteOf(outcome),
		carried: null,
	});
}

function echoNoncomplianceSection(outcome: SourceOutcome): SectionSpec<"echo-facility"> {
	return defineSection({
		kind: "echo-facility",
		source: "echo",
		boundary: BOUNDARY.echo,
		query: queryOf(outcome),
		retrievedAt: retrievedAtOf(outcome),
		filter: { field: "quartersInNoncompliance", atLeast: NONCOMPLIANCE_QUARTERS },
		note: noteOf(outcome),
		carried: null,
	});
}

function frsSection(outcome: SourceOutcome, bounds: Bounds): SectionSpec<"frs-facility"> {
	return defineSection({
		kind: "frs-facility",
		source: "frs",
		boundary: BOUNDARY.frs,
		query: queryOf(outcome),
		retrievedAt: retrievedAtOf(outcome),
		filter: null,
		note: FRS_NO_ROWS_NOTE,
		carried: carriedBound(bounds),
	});
}

function floodSection(result: FloodZoneResult, bounds: Bounds): SectionSpec<"fema-flood-zone"> {
	return defineSection({
		kind: "fema-flood-zone",
		source: "fema",
		boundary: BOUNDARY.fema,
		query: queryOf(result.outcome),
		retrievedAt: retrievedAtOf(result.outcome),
		filter: null,
		note: noteOf(result.outcome),
		carried: carriedBound(bounds),
	});
}

function aqsSection(outcome: SourceOutcome): SectionSpec<"aqs-monitor-summary"> {
	return defineSection({
		kind: "aqs-monitor-summary",
		source: "aqs",
		boundary: BOUNDARY.aqs,
		query: queryOf(outcome),
		retrievedAt: retrievedAtOf(outcome),
		filter: null,
		note: noteOf(outcome),
		carried: null,
	});
}

function aqsPollutantSection(
	outcome: SourceOutcome,
	pollutant: Pollutant,
	bounds: Bounds,
): SectionSpec<"aqs-monitor-summary"> {
	return defineSection({
		kind: "aqs-monitor-summary",
		source: "aqs",
		boundary: BOUNDARY.aqs,
		query: queryOf(outcome),
		retrievedAt: retrievedAtOf(outcome),
		filter: { field: "pollutant", equals: pollutant },
		note: noteOf(outcome),
		carried: carriedBound(bounds),
	});
}

function airnowSection(outcome: SourceOutcome, bounds: Bounds): SectionSpec<"airnow-observation"> {
	return defineSection({
		kind: "airnow-observation",
		source: "airnow",
		boundary: BOUNDARY.airnow,
		query: queryOf(outcome),
		retrievedAt: retrievedAtOf(outcome),
		filter: null,
		note: noteOf(outcome),
		carried: carriedBound(bounds),
	});
}

export function idKey(id: RecordId): string {
	return `${id.kind}\u0000${id.sourceRecordId}`;
}

function groupedBySlot(member: AnyRecord, matchedId: string): string | null {
	switch (member.kind) {
		case "frs-facility":
			return member.registryId.value === matchedId ? "registryId" : null;
		case "echo-facility":
			return member.registryId.value === matchedId ? "registryId" : null;
		case "sems-site":
			if (member.frsRegistryId.value === matchedId) return "frsRegistryId";
			if (member.epaSiteId.value === matchedId) return "epaSiteId";
			if (member.semsSiteId !== null && member.semsSiteId.value === matchedId) return "semsSiteId";
			return null;
		case "aqs-monitor-summary":
		case "airnow-observation":
		case "fema-flood-zone":
			return null;
	}
}

export type LeadGroup = {
	readonly source: ReportSource;
	readonly placements: readonly GroupPlacement[];
	readonly crossReferences: readonly RecordPlacementOf<"frs-facility">[];
};

function registryIdentities(members: readonly AnyRecord[]): readonly RecordPlacementOf<"frs-facility">[] {
	const out: RecordPlacementOf<"frs-facility">[] = [];
	for (const member of members) {
		if (member.kind !== "frs-facility") continue;
		out.push({ scope: "record", recordId: member.id, template: frsFacilityCrossReference });
	}
	return out;
}

function leadGroupOf(group: FacilityGroup): LeadGroup | null {
	if (group.confidence !== "confirmed") return null;
	const sharing = group.members.filter((member) => !isRegistryRecordOf(member, group.matchedId));
	const registryRecords = group.members.filter((member) => isRegistryRecordOf(member, group.matchedId));
	const lead = sharing.find((member) => groupedBySlot(member, group.matchedId) !== null);
	if (lead === undefined) return null;
	const slot = groupedBySlot(lead, group.matchedId);
	if (slot === null) return null;
	const others = sharing.filter((member) => member !== lead);
	const shared: GroupPlacement = {
		scope: "group",
		members: [lead.id, ...others.map((member) => member.id), ...registryRecords.map((member) => member.id)],
		groupedBy: slot,
		template: groupSharedIdentifier,
	};
	const count: GroupPlacement = { ...shared, template: groupMemberCount };
	return {
		source: lead.source,
		placements: sharedIdentifierPlacements(shared, count, [lead, ...others], group.members.length),
		crossReferences: registryIdentities(group.members),
	};
}

function isRegistryRecordOf(member: AnyRecord, matchedId: string): boolean {
	return member.kind === "frs-facility" && member.registryId.value === matchedId;
}

function sharedIdentifierPlacements(
	shared: GroupPlacement,
	count: GroupPlacement,
	sharing: readonly AnyRecord[],
	members: number,
): readonly GroupPlacement[] {
	const [first, second] = sharing;
	if (first === undefined || second === undefined) return [];
	if (first.subject.value === second.subject.value) return [count];
	return members > 2 ? [shared, count] : [shared];
}

export function groupPlacements(result: GroupingResult): readonly LeadGroup[] {
	const out: LeadGroup[] = [];
	for (const group of result.groups) {
		const lead = leadGroupOf(group);
		if (lead !== null) out.push(lead);
	}
	return out;
}

export function groupsFor(groups: readonly LeadGroup[], source: ReportSource): CardGroups {
	const mine = groups.filter((group) => group.source === source);
	const seen = new Set<string>();
	const crossReferences: RecordPlacementOf<"frs-facility">[] = [];
	for (const group of mine) {
		for (const one of group.crossReferences) {
			const key = idKey(one.recordId);
			if (seen.has(key)) continue;
			seen.add(key);
			crossReferences.push(one);
		}
	}
	return { placements: mine.flatMap((group) => group.placements), crossReferences };
}

export function sourceCard(source: ReportSource, outcome: SourceOutcome, agency: string | null = null): Card {
	return {
		source,
		status: statusPlacement(source, outcome, agency),
		priorAttempts: [],
		headlines: [],
		listings: [],
		groups: [],
		crossReferences: [],
	};
}

export function semsCard(
	store: EvidenceStore,
	outcome: SourceOutcome,
	groups: CardGroups,
	bounds: Bounds = DEFAULT_BOUNDS,
): Card {
	const base = sourceCard("sems", outcome);
	if (outcome.status === "unavailable") {
		refuseUndescribed(store, "sems-site");
		return base;
	}
	refuseAnsweredWithNone(store, outcome, "sems-site");
	const section = semsSection(outcome, bounds);
	const npl = semsNplSection(outcome, bounds);
	const listings = [
		listingOf(section, "distance", bounds, (record) => entryOf(record.id, [semsPrimary(record)])),
		listingOf(npl, "distance", bounds, (record) => entryOf(record.id, [semsSiteNpl])),
	];
	return {
		...base,
		headlines: [
			countHeadline(section, semsSectionCount),
			...nplCountHeadline(store, npl),
			...listings.flatMap((listing) => notShownHeadline(store, listing)),
			...noRecordsHeadline(store, outcome, section),
		],
		listings,
		groups: groups.placements,
		crossReferences: groups.crossReferences,
	};
}

export function echoCard(
	store: EvidenceStore,
	outcome: SourceOutcome,
	groups: CardGroups,
	bounds: Bounds = DEFAULT_BOUNDS,
): Card {
	const base = sourceCard("echo", outcome);
	if (outcome.status === "unavailable") {
		refuseUndescribed(store, "echo-facility");
		return base;
	}
	refuseAnsweredWithNone(store, outcome, "echo-facility");
	const section = echoSection(outcome, bounds);
	const listing = listingOf(section, "echo-b7", bounds, (record) => entryOf(record.id, echoTemplatesFor(record)));
	return {
		...base,
		headlines: [
			countHeadline(section, echoSectionCount),
			countHeadline(echoFormalActionSection(outcome), echoFormalActionCount),
			countHeadline(echoNoncomplianceSection(outcome), echoNoncomplianceCount),
			...notShownHeadline(store, listing),
			...noRecordsHeadline(store, outcome, section),
		],
		listings: [listing],
		groups: groups.placements,
		crossReferences: groups.crossReferences,
	};
}

export function frsCard(
	store: EvidenceStore,
	outcome: SourceOutcome,
	groups: CardGroups,
	bounds: Bounds = DEFAULT_BOUNDS,
): Card {
	const base = sourceCard("frs", outcome);
	if (outcome.status === "unavailable") {
		refuseUndescribed(store, "frs-facility");
		return base;
	}
	refuseAnsweredWithNone(store, outcome, "frs-facility");
	const section = frsSection(outcome, bounds);
	const listing = listingOf(section, "distance", bounds, (record) => entryOf(record.id, [frsFacilityIdentity]));
	return {
		...base,
		headlines: [
			...retrievedAtHeadline("frs", section),
			...notShownHeadline(store, listing),
			...noRecordsHeadline(store, outcome, section),
		],
		listings: [listing],
		groups: groups.placements,
		crossReferences: groups.crossReferences,
	};
}

export function floodCard(store: EvidenceStore, result: FloodZoneResult, bounds: Bounds = DEFAULT_BOUNDS): Card {
	const base = sourceCard("fema", result.outcome, FEMA_DATASETS[result.dataset].label);
	const priorAttempts: readonly SourcePlacement[] =
		result.nfhl === null ? [] : [statusPlacement("fema", result.nfhl, FEMA_DATASETS.NFHL.label)];
	if (result.outcome.status === "unavailable") {
		refuseUndescribed(store, "fema-flood-zone");
		return { ...base, priorAttempts };
	}
	refuseAnsweredWithNone(store, result.outcome, "fema-flood-zone");
	const section = floodSection(result, bounds);
	const listing = listingOf(section, "distance", bounds, (record) => entryOf(record.id, [floodTemplateFor(record)]));
	return {
		...base,
		priorAttempts,
		headlines: [...notShownHeadline(store, listing), ...noRecordsHeadline(store, result.outcome, section)],
		listings: [listing],
	};
}

export function aqsCard(
	store: EvidenceStore,
	outcome: SourceOutcome,
	air: AirTemplates | null,
	bounds: Bounds = DEFAULT_BOUNDS,
): Card {
	const base = sourceCard("aqs", outcome);
	if (outcome.status === "unavailable" || air === null) {
		refuseUndescribed(store, "aqs-monitor-summary");
		return base;
	}
	refuseAnsweredWithNone(store, outcome, "aqs-monitor-summary");
	const section = aqsSection(outcome);
	const nearest: Bounds = { shown: NEAREST_MONITOR, carried: bounds.carried };
	const perPollutant = POLLUTANTS.map((pollutant) => aqsPollutantSection(outcome, pollutant, nearest));
	const listings = perPollutant.map((one) =>
		listingOf(one, "distance", nearest, (record) => entryOf(record.id, [air.aqs])),
	);
	return {
		...base,
		headlines: [
			...retrievedAtHeadline("aqs", section),
			...perPollutant.flatMap((one) => pollutantHeadline(store, section, one)),
			...listings.flatMap((listing) => notShownHeadline(store, listing)),
			...noRecordsHeadline(store, outcome, section),
		],
		listings,
	};
}

export function airnowCard(
	store: EvidenceStore,
	outcome: SourceOutcome,
	air: AirTemplates | null,
	bounds: Bounds = DEFAULT_BOUNDS,
): Card {
	const base = sourceCard("airnow", outcome);
	if (outcome.status === "unavailable" || air === null) {
		refuseUndescribed(store, "airnow-observation");
		return base;
	}
	refuseAnsweredWithNone(store, outcome, "airnow-observation");
	const section = airnowSection(outcome, bounds);
	const listing = listingOf(section, "distance", bounds, (record) =>
		entryOf(record.id, [airnowTemplateFor(record, air.airnow)]),
	);
	return {
		...base,
		headlines: [...notShownHeadline(store, listing), ...noRecordsHeadline(store, outcome, section)],
		listings: [listing],
	};
}

export function selectReport(input: ReportInput, bounds: Bounds = DEFAULT_BOUNDS): ReportPlan {
	const groups = groupPlacements(input.grouping);
	return {
		origin: [
			{ scope: "origin", match: input.match, template: originMatch },
			{ scope: "origin", match: input.match, template: originPoint },
		],
		cards: [
			semsCard(input.store, input.sources.sems, groupsFor(groups, "sems"), bounds),
			floodCard(input.store, input.flood, bounds),
			aqsCard(input.store, input.sources.aqs, input.air, bounds),
			airnowCard(input.store, input.sources.airnow, input.air, bounds),
			echoCard(input.store, input.sources.echo, groupsFor(groups, "echo"), bounds),
			frsCard(input.store, input.sources.frs, groupsFor(groups, "frs"), bounds),
		],
	};
}

export function listingPlacements(store: EvidenceStore, listing: AnyListing): readonly Placement[] {
	const entries = listing.entries(store);
	const out: Placement[] = [];
	for (const entry of [...entries.shown, ...entries.rest]) out.push(...entry.placements);
	return out;
}

export function cardPlacements(store: EvidenceStore, card: Card): readonly Placement[] {
	return [
		card.status,
		...card.priorAttempts,
		...card.headlines,
		...card.groups,
		...card.crossReferences,
		...card.listings.flatMap((listing) => listingPlacements(store, listing)),
	];
}

export function planPlacements(store: EvidenceStore, plan: ReportPlan): readonly Placement[] {
	return [...plan.origin, ...plan.cards.flatMap((card) => cardPlacements(store, card))];
}
