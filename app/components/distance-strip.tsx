export type DistanceUnit = "km" | "mi";

export type DistanceStripRecord = {
	readonly label: string;
	readonly meters: number;
};

export type DistanceStripProps = {
	readonly records: readonly DistanceStripRecord[];
	readonly boundaryMeters: number;
	readonly boundaryLabel: string;
	readonly unit?: DistanceUnit;
	readonly className?: string;
};

const METERS_PER_UNIT: { readonly [U in DistanceUnit]: number } = { km: 1000, mi: 1609.344 };

const MAPPED_X = 2.5;
const BOUNDARY_X = 90;
const BEYOND_X = 96.5;
const TAIL_X = 99;

const PIN_TOP_Y = 13;
const TRACK_Y = 26;
const AXIS_TICK_Y = 34;
const NUMBER_Y = 48;

const DOT_RADIUS = 3.5;

const TICK_MULTIPLES = [1, 2, 2.5, 5] as const;

function pct(value: number): string {
	return `${value.toFixed(3)}%`;
}

function toUnit(meters: number, unit: DistanceUnit): number {
	return meters / METERS_PER_UNIT[unit];
}

function trim(value: number): string {
	const places = Math.min(6, Math.max(0, 2 - Math.floor(Math.log10(Math.abs(value) || 1))));
	return String(Number(value.toFixed(places)));
}

function formatDistance(meters: number, unit: DistanceUnit): string {
	const value = toUnit(meters, unit);
	return `${value.toFixed(value < 10 ? 2 : 1)} ${unit}`;
}

function count(n: number, one: string, many: string): string {
	return `${n} ${n === 1 ? one : many}`;
}

function axisTicks(spanMeters: number, unit: DistanceUnit): readonly number[] {
	const limit = toUnit(spanMeters, unit) * 0.92;
	if (!(limit > 0)) return [];
	const decade = 10 ** Math.floor(Math.log10(limit));
	const step =
		[decade / 10, decade, decade * 10]
			.flatMap((scale) => TICK_MULTIPLES.map((multiple) => multiple * scale))
			.find((candidate) => Math.floor(limit / candidate) <= 3) ?? limit;
	const ticks: number[] = [];
	for (let value = step; value <= limit + 1e-9 && ticks.length < 3; value += step) ticks.push(value);
	return ticks;
}

type PlacedRecord = {
	readonly label: string;
	readonly meters: number;
	readonly beyond: boolean;
	readonly x: number;
};

function placeAlong(records: readonly DistanceStripRecord[], spanMeters: number): readonly PlacedRecord[] {
	return records
		.filter((record) => Number.isFinite(record.meters) && record.meters >= 0)
		.sort((a, b) => a.meters - b.meters)
		.map((record) => {
			const beyond = record.meters > spanMeters;
			const ratio = beyond ? 1 : record.meters / spanMeters;
			return {
				label: record.label,
				meters: record.meters,
				beyond,
				x: beyond ? BEYOND_X : MAPPED_X + ratio * (BOUNDARY_X - MAPPED_X),
			};
		});
}

function titleOf(record: PlacedRecord, unit: DistanceUnit): string {
	return `${record.label}, ${formatDistance(record.meters, unit)} from the mapped point`;
}

export function DistanceStrip({
	records,
	boundaryMeters,
	boundaryLabel,
	unit = "km",
	className,
}: DistanceStripProps) {
	const farthest = records.reduce(
		(max, record) => (Number.isFinite(record.meters) && record.meters > max ? record.meters : max),
		0,
	);
	const span = Number.isFinite(boundaryMeters) && boundaryMeters > 0 ? boundaryMeters : Math.max(farthest, 1);

	const placed = placeAlong(records, span);
	const beyondCount = placed.reduce((n, record) => (record.beyond ? n + 1 : n), 0);
	const withoutDistance = records.length - placed.length;
	const ticks = axisTicks(span, unit);

	const crowdedOnPhone = (index: number): boolean => ticks.length === 3 && index === 1;

	const tickX = (tick: number): number =>
		MAPPED_X + Math.min(1, (tick * METERS_PER_UNIT[unit]) / span) * (BOUNDARY_X - MAPPED_X);

	const note = `Distance only. Each record carries a distance and no direction, so nothing on this axis points anywhere. ${boundaryLabel} is where the search stopped.`;

	const exceptions: string[] = [];
	if (placed.length === 0) exceptions.push("No records to place on this axis.");
	if (beyondCount > 0) {
		exceptions.push(
			`${count(beyondCount, "record sits", "records sit")} beyond ${boundaryLabel}, drawn at the end of the axis rather than at the true distance.`,
		);
	}
	if (withoutDistance > 0) {
		exceptions.push(
			`${count(withoutDistance, "record carries", "records carry")} no distance this axis can draw.`,
		);
	}

	return (
		<figure
			role="figure"
			aria-label={`${count(placed.length, "record", "records")} by distance from the mapped point, out to ${boundaryLabel}`}
			data-distance-strip=""
			className={className}
		>
			<figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
				<span className="gt-label text-[var(--on-muted)]">Distance from the mapped point</span>
				<span className="text-[0.6875rem] text-[var(--on-muted)]">{count(placed.length, "record", "records")}</span>
			</figcaption>

			<svg className="mt-3 h-[54px] w-full overflow-visible">
				<g aria-hidden="true">
					<line
						x1={pct(MAPPED_X)}
						y1={TRACK_Y}
						x2={pct(BOUNDARY_X)}
						y2={TRACK_Y}
						stroke="currentColor"
						strokeWidth={1.5}
						strokeLinecap="round"
						opacity={0.3}
					/>

					{ticks.map((tick, index) => (
						<line
							key={`tick:${tick}`}
							x1={pct(tickX(tick))}
							y1={TRACK_Y}
							x2={pct(tickX(tick))}
							y2={AXIS_TICK_Y}
							stroke="currentColor"
							strokeWidth={1}
							opacity={0.3}
							className={crowdedOnPhone(index) ? "max-sm:hidden" : undefined}
						/>
					))}

					<line
						x1={pct(BOUNDARY_X)}
						y1={PIN_TOP_Y}
						x2={pct(BOUNDARY_X)}
						y2={AXIS_TICK_Y + 2}
						stroke="currentColor"
						strokeWidth={1.5}
						opacity={0.55}
					/>

					{beyondCount > 0 ? (
						<line
							x1={pct(BOUNDARY_X)}
							y1={TRACK_Y}
							x2={pct(TAIL_X)}
							y2={TRACK_Y}
							stroke="currentColor"
							strokeWidth={1.5}
							strokeLinecap="round"
							strokeDasharray="2 4"
							opacity={0.3}
						/>
					) : null}

					<circle cx={pct(MAPPED_X)} cy={TRACK_Y} r={5} className="fill-[var(--color-beacon)]" />
					<circle
						cx={pct(MAPPED_X)}
						cy={TRACK_Y}
						r={5}
						fill="none"
						stroke="currentColor"
						strokeWidth={1}
						opacity={0.35}
					/>
				</g>

				{placed.map((record, index) => (
					<g
						key={`${index}:${record.label}`}
						role="img"
						data-record-mark={record.label}
						data-beyond={record.beyond ? "true" : "false"}
					>
						<title>{titleOf(record, unit)}</title>
						<line
							x1={pct(record.x)}
							y1={PIN_TOP_Y}
							x2={pct(record.x)}
							y2={TRACK_Y}
							stroke="currentColor"
							strokeWidth={1}
							opacity={0.22}
						/>
						<circle cx={pct(record.x)} cy={TRACK_Y} r={DOT_RADIUS} fill="currentColor" opacity={0.55} />
					</g>
				))}

				{ticks.map((tick, index) => (
					<text
						key={`number:${tick}`}
						x={pct(tickX(tick))}
						y={NUMBER_Y}
						textAnchor="middle"
						fontSize={11}
						fill="currentColor"
						opacity={0.6}
						className={crowdedOnPhone(index) ? "max-sm:hidden" : undefined}
					>
						{`${trim(tick)} ${unit}`}
					</text>
				))}
			</svg>

			<div
				className="mt-1 flex items-baseline justify-between gap-4 text-[0.6875rem] text-[var(--on-muted)]"
				style={{ paddingRight: `${100 - BOUNDARY_X}%` }}
			>
				<span className="inline-flex items-center gap-1.5 whitespace-nowrap">
					<span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-beacon)]" />
					the mapped point
				</span>
				<span className="whitespace-nowrap">{boundaryLabel}</span>
			</div>

			<p className="mt-3 text-xs leading-relaxed text-[var(--on-muted)]">{note}</p>
			{exceptions.length > 0 ? (
				<p className="mt-1.5 text-xs leading-relaxed text-[var(--on-muted)]">{exceptions.join(" ")}</p>
			) : null}
		</figure>
	);
}
