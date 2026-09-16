import type { SourceUnavailable } from "./source";
import type { GeoPoint, PayloadRef, Sealed, Sourced } from "./sourced";

export type SourceId = "census" | "echo" | "frs" | "sems" | "aqs" | "airnow" | "fema";

export type StatusRowOutcome =
	| { readonly status: "joined" }
	| { readonly status: "no-row" }
	| SourceUnavailable;

export type EchoProgramStatuses = {
	readonly CAA: Sourced<string | null>;
	readonly CWA: Sourced<string | null>;
	readonly RCRA: Sourced<string | null>;
	readonly SDWA: Sourced<string | null>;
};

export type FrsProgramInterest = {
	readonly program: Sourced<string>;
	readonly programId: Sourced<string>;
	readonly interestType: Sourced<string | null>;
	readonly activeStatus: Sourced<string | null>;
};

type Kinds = {
	readonly "sems-site": {
		readonly source: "sems";
		readonly fields: {
			readonly epaSiteId: Sourced<string>;
			readonly semsSiteId: Sourced<string> | null;
			readonly frsRegistryId: Sourced<string | null>;
			readonly frsName: Sourced<string>;
			readonly semsName: Sourced<string> | null;
			readonly interestType: Sourced<string>;
			readonly statusRow: StatusRowOutcome;
			readonly semsNplStatus: Sourced<string> | null;
			readonly frsActiveStatus: Sourced<string | null>;
			readonly nonNplStatus: Sourced<string | null> | null;
			readonly statusDate: Sourced<string | null> | null;
			readonly archived: Sourced<boolean | null> | null;
			readonly archivedLabel: Sourced<string | null> | null;
			readonly archivedDate: Sourced<string | null> | null;
			readonly semsCoordinate: GeoPoint | null;
		};
	};
	readonly "echo-facility": {
		readonly source: "echo";
		readonly fields: {
			readonly registryId: Sourced<string>;
			readonly complianceStatus: Sourced<string | null>;
			readonly significantNoncomplianceFlag: Sourced<string | null>;
			readonly quartersInNoncompliance: Sourced<number | null>;
			readonly lastFormalActionDate: Sourced<string | null>;
			readonly formalActionCount: Sourced<number | null>;
			readonly penaltyCount: Sourced<number | null>;
			readonly lastPenaltyDate: Sourced<string | null>;
			readonly lastPenaltyAmountUsd: Sourced<number | null>;
			readonly lastInspectionDate: Sourced<string | null>;
			readonly activeFlag: Sourced<string | null>;
			readonly programStatuses: EchoProgramStatuses;
			readonly naicsCodes: Sourced<string | null>;
			readonly sicCodes: Sourced<string | null>;
		};
	};
	readonly "frs-facility": {
		readonly source: "frs";
		readonly fields: {
			readonly registryId: Sourced<string>;
			readonly programInterests: readonly FrsProgramInterest[];
		};
	};
	readonly "aqs-monitor-summary": {
		readonly source: "aqs";
		readonly fields: {
			readonly monitorId: Sourced<string>;
			readonly pollutant: Sourced<"PM2.5" | "Ozone">;
			readonly period: Sourced<string>;
			readonly statistic: Sourced<string>;
			readonly value: Sourced<number>;
			readonly unit: Sourced<string>;
			readonly observationCount: Sourced<number | null>;
		};
	};
	readonly "airnow-observation": {
		readonly source: "airnow";
		readonly fields: {
			readonly reportingArea: Sourced<string>;
			readonly pollutant: Sourced<"PM2.5" | "Ozone">;
			readonly observedAt: Sourced<string>;
			readonly aqi: Sourced<number | null>;
			readonly category: Sourced<string | null>;
			readonly concentration: Sourced<number | null>;
			readonly unit: Sourced<string | null>;
		};
	};
	readonly "fema-flood-zone": {
		readonly source: "fema";
		readonly fields: {
			readonly dataset: Sourced<"NFHL" | "ESRI_REDUCED_SET">;
			readonly datasetLabel: Sourced<string>;
			readonly zoneCode: Sourced<string>;
			readonly zoneSubtype: Sourced<string | null>;
			readonly specialFloodHazardArea: Sourced<boolean | null>;
			readonly sfhaLabel: Sourced<string | null>;
			readonly sfhaFlag: Sourced<string | null>;
			readonly firmStudyId: Sourced<string | null>;
			readonly floodAreaId: Sourced<string | null>;
			readonly sourceCitation: Sourced<string | null>;
		};
	};
};

export type Kind = keyof Kinds;
export type SourceOf<K extends Kind> = Kinds[K]["source"];

export const KINDS: readonly [Kind, ...Kind[]] = [
	"sems-site",
	"echo-facility",
	"frs-facility",
	"aqs-monitor-summary",
	"airnow-observation",
	"fema-flood-zone",
];

export const AGENCY: { readonly [S in SourceId]: string } = {
	census: "US Census Bureau Geocoder",
	echo: "EPA Enforcement and Compliance History Online",
	frs: "EPA Facility Registry Service",
	sems: "EPA Superfund Enterprise Management System",
	aqs: "EPA Air Quality System",
	airnow: "EPA AirNow",
	fema: "FEMA National Flood Hazard Layer",
};

export type RecordId<K extends Kind = Kind> = {
	readonly kind: K;
	readonly sourceRecordId: string;
};

export function recordId<K extends Kind>(kind: K, sourceRecordId: string): RecordId<K> {
	return Object.freeze({ kind, sourceRecordId });
}

export function sameId(a: RecordId, b: RecordId): boolean {
	return a.kind === b.kind && a.sourceRecordId === b.sourceRecordId;
}

type Provided<K extends Kind> = {
	readonly kind: K;
	readonly source: SourceOf<K>;
	readonly sourceRecordId: string;
	readonly sourceUrl: Sourced<string>;
	readonly subject: Sourced<string>;
	readonly location: GeoPoint | null;
	readonly effectiveAt: Sourced<string | null>;
	readonly sourceUpdatedAt: Sourced<string | null>;
	readonly caveats: readonly string[];
};

type Filled<K extends Kind> = {
	readonly id: RecordId<K>;
	readonly distanceMeters: Sourced<number> | null;
	readonly payloads: readonly [PayloadRef, ...PayloadRef[]];
};

/** The three kernel fields, forbidden. `?: never` rejects them even on a non-literal object. */
type Unfilled = {
	readonly id?: never;
	readonly distanceMeters?: never;
	readonly payloads?: never;
};

type BuiltTable = { readonly [K in Kind]: Provided<K> & Kinds[K]["fields"] & Unfilled };
type RecordTable = { readonly [K in Kind]: Provided<K> & Kinds[K]["fields"] & Filled<K> };

export type Built<K extends Kind> = BuiltTable[K];
export type RecordOf<K extends Kind> = RecordTable[K];
export type EvidenceRecord = RecordTable[Kind];

export type SemsSiteRecord = RecordOf<"sems-site">;
export type FemaFloodZoneRecord = RecordOf<"fema-flood-zone">;

export type GeocodeMatch = {
	readonly matchedAddress: Sourced<string>;
	readonly point: GeoPoint;
	readonly addressRange: { readonly from: Sourced<string>; readonly to: Sourced<string> };
	readonly tigerLineId: Sourced<string>;
	readonly streetSide: Sourced<string>;
	readonly payload: PayloadRef;
};

type KindMaps = { readonly [K in Kind]: ReadonlyMap<string, Sealed<RecordOf<K>>> };

function emptyMaps(): KindMaps {
	return {
		"sems-site": new Map(),
		"echo-facility": new Map(),
		"frs-facility": new Map(),
		"aqs-monitor-summary": new Map(),
		"airnow-observation": new Map(),
		"fema-flood-zone": new Map(),
	};
}

export type EvidenceStore = {
	get<K extends Kind>(id: RecordId<K>): Sealed<RecordOf<K>> | undefined;
	ofKind<K extends Kind>(kind: K): readonly Sealed<RecordOf<K>>[];
	without(id: RecordId): EvidenceStore;
	readonly size: number;
};

function storeFromMaps(maps: KindMaps): EvidenceStore {
	let size = 0;
	for (const kind of KINDS) size += maps[kind].size;
	return {
		get(id) {
			return maps[id.kind].get(id.sourceRecordId);
		},
		ofKind(kind) {
			return [...maps[kind].values()];
		},
		without(id) {
			const copies: { [K in Kind]: Map<string, Sealed<RecordOf<K>>> } = {
				"sems-site": new Map(maps["sems-site"]),
				"echo-facility": new Map(maps["echo-facility"]),
				"frs-facility": new Map(maps["frs-facility"]),
				"aqs-monitor-summary": new Map(maps["aqs-monitor-summary"]),
				"airnow-observation": new Map(maps["airnow-observation"]),
				"fema-flood-zone": new Map(maps["fema-flood-zone"]),
			};
			copies[id.kind].delete(id.sourceRecordId);
			return storeFromMaps(copies);
		},
		size,
	};
}

function insert<K extends Kind>(
	maps: { readonly [J in Kind]: Map<string, Sealed<RecordOf<J>>> },
	kind: K,
	record: Sealed<RecordOf<K>>,
): void {
	maps[kind].set(record.id.sourceRecordId, record);
}

export function storeOf(records: Iterable<Sealed<EvidenceRecord>>): EvidenceStore {
	const maps: { readonly [K in Kind]: Map<string, Sealed<RecordOf<K>>> } = {
		"sems-site": new Map(),
		"echo-facility": new Map(),
		"frs-facility": new Map(),
		"aqs-monitor-summary": new Map(),
		"airnow-observation": new Map(),
		"fema-flood-zone": new Map(),
	};
	for (const record of records) insert(maps, record.kind, record);
	return storeFromMaps(maps);
}

export const emptyStore: EvidenceStore = storeFromMaps(emptyMaps());
