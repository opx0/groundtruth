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

import type { SourceUnavailable } from "./source";
import type { GeoPoint, PayloadRef, Sealed, Sourced } from "./sourced";

export type SourceId = "census" | "echo" | "frs" | "sems" | "aqs" | "airnow" | "fema";

/**
 * How the Envirofacts status request for one SEMS site went. The same three
 * outcomes the report makes for a whole source, one level down: the inventory
 * answered with a row, answered with none, or could not be asked. Only the
 * second means "the inventory holds no status row for this site"; after the
 * third, every Envirofacts-side field is null because nothing was retrieved.
 */
export type StatusRowOutcome =
	| { readonly status: "joined" }
	| { readonly status: "no-row" }
	| SourceUnavailable;

/** ECHO's four statute columns. Each leaf traces to its own column; null is what ECHO sent for a programme it does not track at the facility. */
export type EchoProgramStatuses = {
	readonly CAA: Sourced<string | null>;
	readonly CWA: Sourced<string | null>;
	readonly RCRA: Sourced<string | null>;
	readonly SDWA: Sourced<string | null>;
};

/** One FRS programme-interest row, every field its own leaf. */
export type FrsProgramInterest = {
	readonly program: Sourced<string>;
	readonly programId: Sourced<string>;
	readonly interestType: Sourced<string | null>;
	readonly activeStatus: Sourced<string | null>;
};

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
			/** Whether the Envirofacts row joined, was absent, or could not be fetched. Decides which template may print. */
			readonly statusRow: StatusRowOutcome;
			/** Envirofacts `npl_status_name`. Null when no Envirofacts row joined; never filled from FRS. */
			readonly semsNplStatus: Sourced<string> | null;
			/**
			 * The FRS layer's `ACTIVE_STATUS`. The layer's own field description
			 * calls it "the status of the environmental interest at the facility
			 * or site", and the interest here is Superfund: `PGM_SYS_ACRNM` is
			 * `SEMS` on every row of `FRS_INTERESTS_SEMS`. So this is not a
			 * different agency's vocabulary, as this comment claimed until
			 * 2026-09-16 -- on all fifteen recorded Houston sites it is
			 * `npl_status_name` upper-cased, differing on none. It is still not a
			 * stand-in for the Superfund status: it belongs to the interest, it
			 * survives a failed Envirofacts join, and a template that prints it
			 * must say whose interest it is the status of.
			 */
			readonly frsActiveStatus: Sourced<string | null>;
			readonly nonNplStatus: Sourced<string | null> | null;
			readonly statusDate: Sourced<string | null> | null;
			readonly archived: Sourced<boolean | null> | null;
			/**
			 * `archived_ind` read a second time, as the word EPA's own indicator
			 * stands for. `archived` is a boolean and a boolean cannot be
			 * printed, so the archived state was on the record and nowhere on the
			 * card: `tests/fixtures/sems/envirofacts-archived.json` shows a 1984
			 * non-NPL status with no sign that EPA archived the site twelve years
			 * later. This is `sfhaLabel` on `fema-flood-zone`, for the same
			 * reason and through the same `map` reader, with the indicator left
			 * on `archived` behind it.
			 *
			 * Mapped for `Y` alone, so `N` reads as null and the clause printing
			 * it drops. Both directions were considered, as `SFHA_TF` maps both
			 * letters: there the letter is the claim the flood card exists to
			 * make and neither state may be a silence, while here "not archived"
			 * would put a sentence under every unarchived site to say that
			 * nothing happened. An archive is an event with a date; its absence
			 * is not. `lib/templates/sems.ts` has the whole argument, including
			 * what the sentence may and may not say.
			 */
			readonly archivedLabel: Sourced<string | null> | null;
			/** `archived_date`, which is the point of printing any of this: it can postdate `statusDate` by years. Null on every unarchived row. */
			readonly archivedDate: Sourced<string | null> | null;
			readonly semsCoordinate: GeoPoint | null;
		};
	};
	readonly "echo-facility": {
		readonly source: "echo";
		readonly fields: {
			readonly registryId: Sourced<string>;
			/** `FacComplianceStatus`. Null on real rows in the fixture. Verbatim, never mapped. */
			readonly complianceStatus: Sourced<string | null>;
			/** `FacSNCFlg`. ECHO's significant-noncompliance flag, kept as the letter it sends. */
			readonly significantNoncomplianceFlag: Sourced<string | null>;
			/** `FacQtrsWithNC`, arrives as a string like "0". */
			readonly quartersInNoncompliance: Sourced<number | null>;
			readonly lastFormalActionDate: Sourced<string | null>;
			readonly formalActionCount: Sourced<number | null>;
			readonly penaltyCount: Sourced<number | null>;
			readonly lastPenaltyDate: Sourced<string | null>;
			/** `FacLastPenaltyAmt`, arrives as "$0" with the symbol attached; the trace keeps that string. */
			readonly lastPenaltyAmountUsd: Sourced<number | null>;
			readonly lastInspectionDate: Sourced<string | null>;
			readonly activeFlag: Sourced<string | null>;
			/** Per-programme compliance, each verbatim, each traced to its own column. */
			readonly programStatuses: EchoProgramStatuses;
			readonly naicsCodes: Sourced<string | null>;
			readonly sicCodes: Sourced<string | null>;
		};
	};
	readonly "frs-facility": {
		readonly source: "frs";
		readonly fields: {
			readonly registryId: Sourced<string>;
			/** One entry per programme-interest row, each field its own leaf. Registry 110000460885 has 38 of them across 15 programmes. */
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
			/** AQS lags collection by six months or more, so the reader is told how stale this is. */
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
			/** The same choice in words a reader can act on, so a card never has to print our enum. Its provenance is the request we made, like `dataset`'s. */
			readonly datasetLabel: Sourced<string>;
			readonly zoneCode: Sourced<string>;
			readonly zoneSubtype: Sourced<string | null>;
			readonly specialFloodHazardArea: Sourced<boolean | null>;
			/**
			 * `SFHA_TF` read as the words FEMA's own field description gives the
			 * letters. Whether a point is inside the Special Flood Hazard Area is
			 * the one phrase on the flood card a reader acts on, and a boolean
			 * cannot be printed, so without this the phrase would be connective
			 * text with no field behind it and nothing to click. Null for a letter
			 * the table does not hold.
			 */
			readonly sfhaLabel: Sourced<string | null>;
			/** The same column read verbatim, so B10's rule for an unknown status -- show it as sent, say the meaning is not mapped -- can be met when `sfhaLabel` is null. */
			readonly sfhaFlag: Sourced<string | null>;
			/**
			 * `DFIRM_ID`. FEMA's own field description calls it "Study Identifier"
			 * — the state and county FIPS codes plus "C" — and says it is
			 * identical for every polygon in a FIRM database. Named `firmStudyId`
			 * rather than for a map panel: a panel is a different field,
			 * `S_FIRM_Pan.FIRM_PAN`, shaped like `48201C0810L` and specific to one
			 * polygon, where this value covers a whole county. `docs/BRIEF.md` A2
			 * carries the dated correction that forced this rename; see
			 * lib/templates/fema.ts.
			 */
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
	/** The agency's own page for this record. Sourced, so the one link the reader clicks has a trace like every other value. */
	readonly sourceUrl: Sourced<string>;
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

/**
 * The Census match. Not an EvidenceRecord: it holds the address and never
 * reaches an adapter. `addressRange` is a container of two leaves, built by
 * `pick`, so each end of the range traces to its own field. How many
 * candidates a lookup produced is the shape of the outcome that carries the
 * match, not a number on the match itself.
 */
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
