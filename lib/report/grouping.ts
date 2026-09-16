import { haversine } from "@/lib/evidence";
import type { EvidenceRecord, GeoPoint, Kind, Sealed, Sourced } from "@/lib/evidence";

const GROUPABLE_KINDS: ReadonlySet<Kind> = new Set(["frs-facility", "echo-facility", "sems-site"]);

const FRS_ANCHORED_KINDS: ReadonlySet<Kind> = new Set(["frs-facility", "sems-site"]);

export const NAME_SIMILARITY_THRESHOLD = 0.5;

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

export type ConfirmedGroup = {
	readonly confidence: "confirmed";
	readonly reason: "registry-id" | "programme-id";
	readonly matchedId: string;
	readonly members: GroupMembers;
};

export type SuggestedGroup = {
	readonly confidence: "suggested";
	readonly reason: "similar-name-and-coordinate";
	readonly label: "Possible match";
	readonly members: GroupMembers;
	readonly nameSimilarity: number;
	readonly coordinateDistanceMeters: Sourced<number>;
};

export type FacilityGroup = ConfirmedGroup | SuggestedGroup;

export type GroupingResult = {
	readonly groups: readonly FacilityGroup[];
	readonly ungrouped: readonly Sealed<EvidenceRecord>[];
};

export function anchoredDistanceMeters(group: FacilityGroup): Sourced<number> | null {
	for (const member of group.members) {
		if (FRS_ANCHORED_KINDS.has(member.kind) && member.distanceMeters !== null) return member.distanceMeters;
	}
	return null;
}

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

function nameTokens(name: string): ReadonlySet<string> {
	const words = name
		.toUpperCase()
		.split(/[^A-Z0-9]+/)
		.filter((word) => word.length > 0 && !CORPORATE_SUFFIXES.has(word));
	return new Set(words);
}

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
