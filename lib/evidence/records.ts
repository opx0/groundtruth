/**
 * The record kinds of docs/BRIEF.md B4, and the store that holds them.
 *
 * A record is built in two steps. The adapter returns a `Built<K>`: every field
 * it can read from the source. The kernel then fills the three fields no
 * adapter may write, `id`, `distanceMeters`, and `payloads`, and seals the
 * result. `Built<K>` forbids those three by type, so an adapter that tries to
 * supply its own distance does not compile.
 *
 * Only the kinds this unit needs are listed. Adding a kind is one entry in
 * `Kinds` and one map in `emptyMaps`; the compiler names anything else missed.
 */

import type { GeoPoint, PayloadRef, Sealed, Sourced } from "./sourced";

export type SourceId = "census" | "echo" | "frs" | "sems" | "aqs" | "airnow" | "fema";

/** Kind -> the source it comes from and the fields only that kind has. */
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
			readonly nplStatus: Sourced<string | null>;
			readonly nonNplStatus: Sourced<string | null> | null;
			readonly statusDate: Sourced<string | null> | null;
			readonly archived: Sourced<boolean | null> | null;
			readonly semsCoordinate: GeoPoint | null;
		};
	};
	readonly "fema-flood-zone": {
		readonly source: "fema";
		readonly fields: {
			readonly dataset: Sourced<"NFHL" | "ESRI_REDUCED_SET">;
			readonly zoneCode: Sourced<string>;
			readonly zoneSubtype: Sourced<string | null>;
			readonly specialFloodHazardArea: Sourced<boolean | null>;
			readonly firmPanelId: Sourced<string | null>;
			readonly floodAreaId: Sourced<string | null>;
			readonly sourceCitation: Sourced<string | null>;
		};
	};
};

export type Kind = keyof Kinds;
export type SourceOf<K extends Kind> = Kinds[K]["source"];

export const KINDS: readonly [Kind, ...Kind[]] = ["sems-site", "fema-flood-zone"];

export const AGENCY: { readonly [S in SourceId]: string } = {
	census: "US Census Bureau Geocoder",
	echo: "EPA Enforcement and Compliance History Online",
	frs: "EPA Facility Registry Service",
	sems: "EPA Superfund Enterprise Management System",
	aqs: "EPA Air Quality System",
	airnow: "EPA AirNow",
	fema: "FEMA National Flood Hazard Layer",
};

/** A record identity: the kind and the source's own identifier. Not a secret; the store answers only for ids it holds. */
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

/** What the adapter writes. */
type Provided<K extends Kind> = {
	readonly kind: K;
	readonly source: SourceOf<K>;
	readonly sourceRecordId: string;
	readonly sourceUrl: string;
	readonly subject: Sourced<string>;
	readonly location: GeoPoint | null;
	readonly effectiveAt: Sourced<string | null>;
	readonly sourceUpdatedAt: Sourced<string | null>;
	readonly caveats: readonly string[];
};

/** What only the kernel writes. */
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

/** The Census match. Not an EvidenceRecord: it holds the address and never reaches an adapter. */
export type GeocodeMatch = {
	readonly matchedAddress: Sourced<string>;
	readonly point: GeoPoint;
	readonly addressRange: Sourced<{ readonly from: string; readonly to: string }>;
	readonly tigerLineId: Sourced<string>;
	readonly streetSide: Sourced<string>;
	readonly candidateCount: number;
	readonly payload: PayloadRef;
};

type KindMaps = { readonly [K in Kind]: ReadonlyMap<string, Sealed<RecordOf<K>>> };

function emptyMaps(): KindMaps {
	return {
		"sems-site": new Map(),
		"fema-flood-zone": new Map(),
	};
}

/**
 * Immutable. `without` is the only "delete" and returns a new store, so a
 * sentence rendered against the old store is re-derived, never patched.
 */
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
		"fema-flood-zone": new Map(),
	};
	for (const record of records) insert(maps, record.kind, record);
	return storeFromMaps(maps);
}

export const emptyStore: EvidenceStore = storeFromMaps(emptyMaps());
