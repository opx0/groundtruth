import type { CardView } from "@/app/lib/report-contract";
import { REPORT_SECTIONS } from "@/app/lib/report-flow";

export type TimelineEvent = {
	readonly section: string;
	readonly source: string;
	readonly date: string;
	readonly year: number;
	readonly subject: string;
	readonly what: string;
};

export const DATED: Readonly<Record<string, string>> = {
	statusDate: "status recorded",
	lastFormalActionDate: "formal enforcement action",
	lastPenaltyDate: "penalty recorded",
	lastInspectionDate: "inspection",
	observedAt: "observed",
	period: "annual summary",
};

export const FALLBACK: Readonly<Record<string, string>> = {
	effectiveAt: "recorded",
	sourceUpdatedAt: "record updated",
};

const ISO = /^(\d{4})(?:-\d{2}-\d{2})?$/;

function yearOf(value: unknown): number | null {
	if (typeof value !== "string") return null;
	const matched = ISO.exec(value);
	if (matched?.[1] === undefined) return null;
	const year = Number(matched[1]);
	return year >= 1970 && year <= 2035 ? year : null;
}

function sectionOf(source: string): string | null {
	return REPORT_SECTIONS.find((section) => (section.sources as readonly string[]).includes(source))?.id ?? null;
}

export function eventsOf(cards: readonly CardView[]): readonly TimelineEvent[] {
	const events: TimelineEvent[] = [];
	const seen = new Set<string>();

	for (const card of cards) {
		const section = sectionOf(card.source);
		if (section === null) continue;

		for (const listing of card.listings) {
			for (const entry of [...listing.shown, ...listing.rest]) {
				for (const sentence of entry.sentences) {
					const trace = sentence.trace;
					if (trace === null || trace.scope !== "record") continue;
					const subject =
						trace.values.find((value) => value.field === "subject")?.displayed ?? entry.recordId.sourceRecordId;

					const specific: TimelineEvent[] = [];
					const fallback: TimelineEvent[] = [];
					for (const value of trace.values) {
						const year = yearOf(value.normalized);
						if (year === null || typeof value.normalized !== "string") continue;
						const named = DATED[value.field];
						const spare = FALLBACK[value.field];
						const what = named ?? spare;
						if (what === undefined) continue;
						const event = { section, source: card.source, date: value.normalized, year, subject, what };
						if (named === undefined) fallback.push(event);
						else specific.push(event);
					}

					for (const event of specific.length > 0 ? specific : fallback) {
						const key = `${event.source}|${event.subject}|${event.date}|${event.what}`;
						if (seen.has(key)) continue;
						seen.add(key);
						events.push(event);
					}
				}
			}
		}
	}

	return events.sort((a, b) => a.date.localeCompare(b.date));
}
