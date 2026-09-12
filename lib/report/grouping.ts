/**
 * Facility grouping — docs/BRIEF.md B6.
 *
 * A pure function over sealed evidence records. It never merges records: every
 * member keeps its own source ID, its own name, its own coordinate and its own
 * link (`lib/evidence` already seals those; nothing here can change them). A
 * group is an annotation — a claim that some records appear to describe the
 * same facility, at a stated confidence — never a new, merged identity and
 * never a claim that an inferred match is one legal or physical facility.
 *
 * Four rules, in the order docs/BRIEF.md gives them, highest confidence first:
 *
 *   1. An exact FRS registry ID shared by two or more records: confirmed group.
 *      `frs-facility.registryId` and `echo-facility.registryId` are both FRS
 *      registry IDs; `sems-site.frsRegistryId` is the same ID as read off the
 *      FRS layer SEMS joins against. This is what lets
 *      `frs/arcgis-registry-110000462703-two-ids.json` (two Superfund EPA IDs
 *      under one registry ID) become one confirmed group of SEMS records.
 *   2. An exact programme ID shared by two or more records, when they are not
 *      already linked by rule 1: confirmed programme link. An FRS facility's
 *      `programInterests[].programId` and a SEMS site's own `epaSiteId` (and
 *      `semsSiteId`, when Envirofacts has one) are the same identifier system;
 *      registry 110000462703's programme interests literally list
 *      `TXN000607355` and `TXN000605303`, the two SEMS records' own IDs. In the
 *      committed fixtures this pair is already linked by rule 1 too, so this
 *      rule mostly reinforces rule 1 here; it exists for the case where two
 *      records agree on a programme ID without (yet) agreeing on a registry ID.
 *   3. A similar name plus a nearby coordinate, evaluated only between records
 *      that rules 1 and 2 left completely unlinked (see "Why suggested groups
 *      are always pairs" below): a suggested group, carrying the "Possible
 *      match" label structurally, never as a boolean a caller can ignore.
 *   4. When a group's members disagree on where the facility sits, the group's
 *      own distance reads from its FRS-sourced member (`frs-facility` or
 *      `sems-site`, whose `location` is always the FRS coordinate — see
 *      `lib/adapters/sems.ts`); every member's own coordinate stays exactly
 *      where `lib/evidence` put it. `anchoredDistanceMeters` is that read.
 *
 * Only `frs-facility`, `echo-facility` and `sems-site` are facility-identity
 * records with a registry ID or a programme ID; AQS monitors, AirNow
 * observations and FEMA flood zones are not facilities and never enter a
 * group. They still cannot be dropped, so they pass straight through to
 * `ungrouped`.
 *
 * ## The name/coordinate threshold for rule 3, and why
 *
 * A false "possible match" tells a reader two unrelated facilities might be
 * the same place, which is a claim they are being asked to act on. That is
 * worse than showing two separate records, so both halves of rule 3 are
 * deliberately strict, and both must hold — a close name with a far
 * coordinate, or a shared coordinate with a different name, is not enough on
 * its own:
 *
 *   - Name: token-set overlap (case-folded, punctuation-stripped words, with
 *     common corporate suffixes — INC, LLC, LP, CO, CORP, CORPORATION,
 *     COMPANY, LTD, PLC, LLP — removed before comparing, since two unrelated
 *     companies sharing "INC" proves nothing) must be at least
 *     `NAME_SIMILARITY_THRESHOLD` = 0.5: at least half of each name's
 *     meaningful words must appear in the other. Whole-string edit distance
 *     was tried first and rejected: "WESTWAY FEED PRODUCTS HOUSTON" and
 *     "WESTWAY FEED PRODUCTS LLC" — two real, distinct-registry-ID ECHO
 *     facilities at the identical coordinate in
 *     `tests/fixtures/echo/facilities-page-quarter-mi.json` — score only 0.76
 *     on normalized Levenshtein similarity but share 3 of their 4 meaningful
 *     words (Jaccard 0.75), while the genuine near-miss below shares none.
 *   - Coordinate: great-circle distance (the kernel's own `haversine`, so the
 *     number is `Sourced` and traceable) of at most
 *     `NEARBY_COORDINATE_METERS` = 250 meters between the two records' own
 *     locations — roughly a single industrial parcel on the Houston Ship
 *     Channel, big enough to tolerate two agencies siting the same facility by
 *     rooftop versus by parcel centroid, small enough that neighbouring but
 *     distinct facilities at a port complex do not pair up just for being
 *     close.
 *
 * The near-miss that must not group, and it is real fixture data, not
 * invented: "GRIZZLY VAEVSERVICES" (registry 110070365452) and "SOUTH-PORT
 * SYSTEMS, INC." (registry 110016765277), also from
 * `facilities-page-quarter-mi.json`, sit about 24 meters apart — well inside
 * the coordinate threshold — and share zero meaningful name tokens. If the
 * coordinate check alone decided this, two unrelated port facilities would be
 * told they might be the same place. The name check is what stops that.
 *
 * ## Why suggested groups are always pairs
 *
 * Rule 3 only compares two records when *neither* is already part of a
 * multi-member group from rules 1 or 2. A record already confirmed as part of
 * facility X does not get to also pick up a fuzzy "maybe this too" in this
 * version; that would let one shaky name/coordinate guess reshape an otherwise
 * confirmed group. A consequence, not a separate rule: a suggested group's
 * `members` always has exactly two records.
 */

import { haversine } from "@/lib/evidence";
import type { EvidenceRecord, GeoPoint, Kind, Sealed, Sourced } from "@/lib/evidence";

/** The three record kinds that carry a facility identity. Everything else cannot be grouped, only carried through untouched. */
const GROUPABLE_KINDS: ReadonlySet<Kind> = new Set(["frs-facility", "echo-facility", "sems-site"]);

const FRS_ANCHORED_KINDS: ReadonlySet<Kind> = new Set(["frs-facility", "sems-site"]);

/** At least this fraction of each name's meaningful words must appear in the other. See the module comment for why 0.5. */
export const NAME_SIMILARITY_THRESHOLD = 0.5;

/** At most this many meters between the two records' own coordinates. See the module comment for why 250. */
export const NEARBY_COORDINATE_METERS = 250;

const CORPORATE_SUFFIXES: ReadonlySet<string> = new Set([
	"INC",
	"LLC",
	"LP",
	"LTD",
	"CO",
	"CORP",
	"CORPORATION",
	"COMPANY",
	"PLC",
	"LLP",
]);

export type GroupMembers = readonly [Sealed<EvidenceRecord>, ...Sealed<EvidenceRecord>[]];

/**
 * `confidence` is structural, not a boolean a caller can skip past: only
 * `SuggestedGroup` carries `label`, so reading it off a `FacilityGroup`
 * without first narrowing on `confidence` does not compile. There is no way
 * to read a suggested group as though it were confirmed by accident.
 */
export type ConfirmedGroup = {
	readonly confidence: "confirmed";
	readonly reason: "registry-id" | "programme-id";
	/** The exact ID value shared by two or more members that confirmed this group. */
	readonly matchedId: string;
	readonly members: GroupMembers;
};

export type SuggestedGroup = {
	readonly confidence: "suggested";
	readonly reason: "similar-name-and-coordinate";
	readonly label: "Possible match";
	readonly members: GroupMembers;
	/** Token-set overlap of the two members' names, in [0, 1]. Not Sourced: a judgement this module made, not a value read from a source. */
	readonly nameSimilarity: number;
	/** Great-circle distance between the two members' own coordinates, via the kernel's own `haversine`. */
	readonly coordinateDistanceMeters: Sourced<number>;
};

export type FacilityGroup = ConfirmedGroup | SuggestedGroup;

export type GroupingResult = {
	readonly groups: readonly FacilityGroup[];
	/** Every groupable record that matched no other record, plus every record of a kind grouping does not consider. Never empty by construction when there is nothing to group; never missing a record. */
	readonly ungrouped: readonly Sealed<EvidenceRecord>[];
};

/**
 * Rule 4. A group's own distance — the one figure a summary or a sort would
 * use for "how far is this facility" — reads from whichever member is
 * `frs-facility` or `sems-site`, because that member's `location` (and so its
 * `distanceMeters`, which the kernel computed by haversine from that same
 * `location`) is always the FRS coordinate. This never touches any member's
 * own fields: an `echo-facility` member in the same group keeps its own
 * `location` and `distanceMeters` exactly as `lib/evidence` sealed them, still
 * reachable by inspecting that record on its own. Null when no member is
 * FRS-sourced, or the FRS-sourced member has no coordinate to measure from —
 * an honestly missing figure, never a guess from a non-FRS member.
 */
export function anchoredDistanceMeters(group: FacilityGroup): Sourced<number> | null {
	for (const member of group.members) {
		if (FRS_ANCHORED_KINDS.has(member.kind) && member.distanceMeters !== null) return member.distanceMeters;
	}
	return null;
}

/** FRS's own registry ID as this record carries it, or null when the kind has none (or FRS never assigned one, for a SEMS site). */
function registryIdOf(record: Sealed<EvidenceRecord>): string | null {
	switch (record.kind) {
		case "frs-facility":
			return record.registryId.value;
		case "echo-facility":
			return record.registryId.value;
		case "sems-site":
			return record.frsRegistryId.value;
		case "aqs-monitor-summary":
		case "airnow-observation":
		case "fema-flood-zone":
			return null;
	}
}

/** Every programme ID this record is itself known by. Only FRS and SEMS records carry one. */
function programmeIdsOf(record: Sealed<EvidenceRecord>): readonly string[] {
	switch (record.kind) {
		case "frs-facility":
			return record.programInterests.map((interest) => interest.programId.value);
		case "sems-site":
			return record.semsSiteId === null
				? [record.epaSiteId.value]
				: [record.epaSiteId.value, record.semsSiteId.value];
		case "echo-facility":
		case "aqs-monitor-summary":
		case "airnow-observation":
		case "fema-flood-zone":
			return [];
	}
}

/** Upper-cased, punctuation-stripped words, corporate-entity suffixes removed. Two unrelated companies both being "INC" must not count as agreement. */
function nameTokens(name: string): ReadonlySet<string> {
	const words = name
		.toUpperCase()
		.split(/[^A-Z0-9]+/)
		.filter((word) => word.length > 0 && !CORPORATE_SUFFIXES.has(word));
	return new Set(words);
}

/** Jaccard overlap of the two names' meaningful word sets. 0 when either name has no meaningful words left. */
export function nameTokenSimilarity(a: string, b: string): number {
	const ta = nameTokens(a);
	const tb = nameTokens(b);
	if (ta.size === 0 || tb.size === 0) return 0;
	let shared = 0;
	for (const token of ta) if (tb.has(token)) shared += 1;
	const union = new Set([...ta, ...tb]).size;
	return shared / union;
}

type SuggestedMatch = { readonly nameSimilarity: number; readonly distance: Sourced<number> };

/** Both halves of rule 3, evaluated together: null the moment either fails, so a near coordinate never covers for a dissimilar name or vice versa. */
function suggestedMatch(a: Sealed<EvidenceRecord>, b: Sealed<EvidenceRecord>): SuggestedMatch | null {
	const from: GeoPoint | null = a.location;
	const to: GeoPoint | null = b.location;
	if (from === null || to === null) return null;
	const nameSimilarity = nameTokenSimilarity(a.subject.value, b.subject.value);
	if (nameSimilarity < NAME_SIMILARITY_THRESHOLD) return null;
	const distance = haversine(from, to);
	if (distance.value > NEARBY_COORDINATE_METERS) return null;
	return { nameSimilarity, distance };
}

/* -------------------------------------------------------------------------- */
/* A small disjoint-set over array indices, with path compression.            */
/* -------------------------------------------------------------------------- */

function makeUnionFind(size: number): { readonly find: (i: number) => number; readonly union: (a: number, b: number) => void } {
	const parent = new Map<number, number>();
	for (let i = 0; i < size; i += 1) parent.set(i, i);

	function find(i: number): number {
		let root = i;
		for (;;) {
			const next = parent.get(root) ?? root;
			if (next === root) break;
			root = next;
		}
		let cursor = i;
		for (;;) {
			const next = parent.get(cursor) ?? cursor;
			parent.set(cursor, root);
			if (next === root) break;
			cursor = next;
		}
		return root;
	}

	function union(a: number, b: number): void {
		const ra = find(a);
		const rb = find(b);
		if (ra !== rb) parent.set(ra, rb);
	}

	return { find, union };
}

/* -------------------------------------------------------------------------- */
/* Post-hoc classification: what made a settled component a group.            */
/* -------------------------------------------------------------------------- */

/** The first ID that at least two distinct members share, or null. Runs rule 1 and rule 2 with the same shape: count occurrences, take one shared by more than one member. */
function firstSharedId(members: readonly Sealed<EvidenceRecord>[], idsOf: (record: Sealed<EvidenceRecord>) => readonly string[]): string | null {
	const counts = new Map<string, number>();
	for (const member of members) {
		for (const id of new Set(idsOf(member))) {
			if (id === "") continue;
			counts.set(id, (counts.get(id) ?? 0) + 1);
		}
	}
	for (const [id, count] of counts) if (count >= 2) return id;
	return null;
}

function toMembers(records: readonly Sealed<EvidenceRecord>[]): GroupMembers {
	const [first, ...rest] = records;
	if (first === undefined) throw new Error("grouping: a settled component has no members");
	return [first, ...rest];
}

function classifyComponent(records: readonly Sealed<EvidenceRecord>[]): FacilityGroup {
	const byRegistry = firstSharedId(records, (record) => {
		const id = registryIdOf(record);
		return id === null ? [] : [id];
	});
	if (byRegistry !== null) {
		return { confidence: "confirmed", reason: "registry-id", matchedId: byRegistry, members: toMembers(records) };
	}

	const byProgramme = firstSharedId(records, programmeIdsOf);
	if (byProgramme !== null) {
		return { confidence: "confirmed", reason: "programme-id", matchedId: byProgramme, members: toMembers(records) };
	}

	// Neither confirming rule fired, so this component can only exist because
	// rule 3 paired exactly two still-unlinked records (see the module comment,
	// "Why suggested groups are always pairs").
	const [a, b, extra] = records;
	if (a === undefined || b === undefined || extra !== undefined) {
		throw new Error(
			`grouping: a component with no shared registry or programme ID must be exactly the two records rule 3 paired, got ${records.length}`,
		);
	}
	const match = suggestedMatch(a, b);
	if (match === null) {
		throw new Error("grouping: an unconfirmed pair was linked without satisfying rule 3");
	}
	return {
		confidence: "suggested",
		reason: "similar-name-and-coordinate",
		label: "Possible match",
		members: toMembers(records),
		nameSimilarity: match.nameSimilarity,
		coordinateDistanceMeters: match.distance,
	};
}

/* -------------------------------------------------------------------------- */
/* The pure function.                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Groups records under docs/BRIEF.md B6. Pure: the same records always
 * produce the same groups, and no record is ever mutated, merged, or dropped
 * — every input record is reachable either inside `groups[i].members` or
 * inside `ungrouped`.
 */
export function groupRecords(records: readonly Sealed<EvidenceRecord>[]): GroupingResult {
	const groupable: Sealed<EvidenceRecord>[] = [];
	const notGroupable: Sealed<EvidenceRecord>[] = [];
	for (const record of records) {
		if (GROUPABLE_KINDS.has(record.kind)) groupable.push(record);
		else notGroupable.push(record);
	}

	const n = groupable.length;
	const { find, union } = makeUnionFind(n);

	function at(i: number): Sealed<EvidenceRecord> {
		const record = groupable[i];
		if (record === undefined) throw new Error(`grouping: no record at index ${i}`);
		return record;
	}

	// Rule 1: exact FRS registry ID, transitively — every record sharing one
	// registry ID lands in the same component, however many there are.
	const byRegistry = new Map<string, number[]>();
	for (let i = 0; i < n; i += 1) {
		const id = registryIdOf(at(i));
		if (id === null || id === "") continue;
		const bucket = byRegistry.get(id);
		if (bucket === undefined) byRegistry.set(id, [i]);
		else bucket.push(i);
	}
	for (const bucket of byRegistry.values()) {
		const [head, ...rest] = bucket;
		if (head === undefined) continue;
		for (const i of rest) union(head, i);
	}

	// Rule 2: exact programme ID, transitively. Re-unioning an already-linked
	// pair (common here, since the fixtures' programme-ID matches also share a
	// registry ID) is a harmless no-op.
	const byProgramme = new Map<string, number[]>();
	for (let i = 0; i < n; i += 1) {
		for (const id of new Set(programmeIdsOf(at(i)))) {
			if (id === "") continue;
			const bucket = byProgramme.get(id);
			if (bucket === undefined) byProgramme.set(id, [i]);
			else bucket.push(i);
		}
	}
	for (const bucket of byProgramme.values()) {
		const [head, ...rest] = bucket;
		if (head === undefined) continue;
		for (const i of rest) union(head, i);
	}

	// Rule 3: similar name plus nearby coordinate, only between records still
	// alone after rules 1 and 2. `consumed` keeps a suggested pairing from
	// reaching for a third record: suggested groups are always pairs.
	const singletons: number[] = [];
	for (let i = 0; i < n; i += 1) {
		const root = find(i);
		let size = 0;
		for (let j = 0; j < n; j += 1) if (find(j) === root) size += 1;
		if (size === 1) singletons.push(i);
	}
	const consumed = new Set<number>();
	for (let a = 0; a < singletons.length; a += 1) {
		const i = singletons[a];
		if (i === undefined || consumed.has(i)) continue;
		for (let b = a + 1; b < singletons.length; b += 1) {
			const j = singletons[b];
			if (j === undefined || consumed.has(j)) continue;
			if (suggestedMatch(at(i), at(j)) !== null) {
				union(i, j);
				consumed.add(i);
				consumed.add(j);
				break;
			}
		}
	}

	// Settle final components, in first-seen order, so output order tracks input order.
	const componentOrder: number[] = [];
	const components = new Map<number, number[]>();
	for (let i = 0; i < n; i += 1) {
		const root = find(i);
		const existing = components.get(root);
		if (existing === undefined) {
			components.set(root, [i]);
			componentOrder.push(root);
		} else {
			existing.push(i);
		}
	}

	const groups: FacilityGroup[] = [];
	const ungrouped: Sealed<EvidenceRecord>[] = [];
	for (const root of componentOrder) {
		const indices = components.get(root);
		if (indices === undefined) continue;
		if (indices.length === 1) {
			const [only] = indices;
			if (only === undefined) throw new Error("grouping: an empty component index list");
			ungrouped.push(at(only));
			continue;
		}
		groups.push(classifyComponent(indices.map((i) => at(i))));
	}

	return { groups, ungrouped: [...ungrouped, ...notGroupable] };
}
