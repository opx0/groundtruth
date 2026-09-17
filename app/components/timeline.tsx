import type { TimelineEvent } from "@/app/lib/timeline";

export type TimelineLane = { readonly id: string; readonly heading: string };

export type TimelineProps = {
	readonly events: readonly TimelineEvent[];
	readonly lanes: readonly TimelineLane[];
};

export const TIMELINE_HEADING = "What is on record here, by year";
export const TIMELINE_EMPTY_LANE = "No dated record";

export function Timeline({ events, lanes }: TimelineProps) {
	const years = events.map((event) => event.year);
	const first = Math.min(...years);
	const last = Math.max(...years);
	if (events.length === 0 || !Number.isFinite(first) || !Number.isFinite(last)) return null;

	const span = Math.max(1, last - first);
	const at = (year: number): number => ((year - first) / span) * 100;
	const ticks = tickYears(first, last);

	return (
		<figure className="m-0" role="group" aria-label={TIMELINE_HEADING}>
			<figcaption className="gt-label text-[var(--on-ground-muted)]">{TIMELINE_HEADING}</figcaption>

			<div className="mt-5 flex flex-col gap-2">
				{lanes.map((lane) => {
					const mine = events.filter((event) => event.section === lane.id);
					return (
						<div key={lane.id} className="grid grid-cols-[9.5rem_1fr] items-center gap-4 max-sm:grid-cols-1 max-sm:gap-1">
							<span className="truncate text-xs text-[var(--on-ground-muted)]">{lane.heading}</span>
							<div className="relative h-7 rounded-full bg-[color-mix(in_srgb,var(--on-ground)_7%,transparent)]">
								{mine.length === 0 ? (
									<span className="absolute inset-y-0 left-3 flex items-center text-[0.6875rem] text-[var(--on-ground-muted)]">
										{TIMELINE_EMPTY_LANE}
									</span>
								) : (
									mine.map((event) => (
										<span
											key={`${event.source}:${event.subject}:${event.date}:${event.what}`}
											style={{ left: `${at(event.year)}%` }}
											className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-beacon)] opacity-60"
										>
											<span className="sr-only">{`${event.subject}, ${event.what}, ${event.date}`}</span>
										</span>
									))
								)}
							</div>
						</div>
					);
				})}
			</div>

			<div className="mt-2 grid grid-cols-[9.5rem_1fr] gap-4 max-sm:grid-cols-1">
				<span />
				<div className="relative h-4">
					{ticks.map((year) => (
						<span
							key={year}
							style={{ left: `${at(year)}%` }}
							className="absolute -translate-x-1/2 text-[0.6875rem] text-[var(--on-ground-muted)]"
						>
							{year}
						</span>
					))}
				</div>
			</div>
		</figure>
	);
}

function tickYears(first: number, last: number): readonly number[] {
	const span = last - first;
	if (span <= 0) return [first];
	const step = [1, 2, 5, 10, 20, 25, 50].find((one) => span / one <= 6) ?? 100;
	const gap = Math.max(1, Math.round(span * 0.06));
	const out = [first];
	for (let year = Math.ceil(first / step) * step; year < last; year += step) {
		if (year - first >= gap && last - year >= gap) out.push(year);
	}
	out.push(last);
	return out;
}
