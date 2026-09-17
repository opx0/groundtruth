"use client";

import { useId, type CSSProperties } from "react";

export type OrbitSource = {
	readonly name: string;
	readonly tags: readonly string[];
};

export type SourceOrbitProps = {
	readonly sources?: readonly OrbitSource[];
	readonly className?: string;
};

export const ORBIT_SOURCES: readonly OrbitSource[] = [
	{ name: "EPA AirNow", tags: ["current conditions", "reporting area"] },
	{ name: "EPA AQS", tags: ["PM2.5", "ozone", "50 km"] },
	{ name: "FEMA NFHL", tags: ["flood zone", "the mapped point"] },
	{ name: "EPA SEMS", tags: ["Superfund sites", "5 miles"] },
	{ name: "EPA ECHO", tags: ["facilities", "violations", "5 miles"] },
	{ name: "EPA FRS", tags: ["facility identity", "registry IDs"] },
];

const ORBIT_X = 36;
const ORBIT_Y = 34;

type Tone = { readonly className: string; readonly style?: CSSProperties };

const LIGHTER: Tone = { className: "gt-card-dark", style: { background: "var(--color-moss)" } };
const BARK: Tone = { className: "gt-card-dark" };
const SAND: Tone = { className: "gt-card-sand" };

const SAND_SEAT = 3;

function toneAt(index: number): Tone {
	if (index === SAND_SEAT) return SAND;
	return index % 2 === 0 ? BARK : LIGHTER;
}

function seatAt(index: number, count: number): { readonly left: string; readonly top: string } {
	const radians = ((-90 + (index * 360) / count) * Math.PI) / 180;
	return {
		left: `${(50 + ORBIT_X * Math.cos(radians)).toFixed(3)}%`,
		top: `${(50 + ORBIT_Y * Math.sin(radians)).toFixed(3)}%`,
	};
}

function indexLabel(index: number): string {
	return String(index + 1).padStart(2, "0");
}

function PinShape({ transform }: { readonly transform?: string }) {
	return (
		<g
			transform={transform}
			fill="none"
			stroke="currentColor"
			strokeWidth="1.8"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M12 21s7-6.7 7-11.4A7 7 0 0 0 5 9.6C5 14.3 12 21 12 21z" />
			<circle cx="12" cy="9.5" r="2.6" />
		</g>
	);
}

function CentreBadge({ pathId, className }: { readonly pathId: string; readonly className: string }) {
	return (
		<svg className={className} viewBox="0 0 200 200" role="img" aria-label="one address">
			<circle cx="100" cy="100" r="98" fill="var(--color-beacon)" />
			<circle
				cx="100"
				cy="100"
				r="60"
				fill="none"
				stroke="var(--color-ink)"
				strokeOpacity="0.3"
				strokeWidth="1"
				strokeDasharray="3 7"
			/>
			<path id={pathId} d="M100,100 m-78,0 a78,78 0 1,1 156,0 a78,78 0 1,1 -156,0" fill="none" />
			<text fill="var(--color-ink)" fontSize="12.5" fontWeight="600" letterSpacing="2.1">
				<textPath href={`#${pathId}`} startOffset="1.5%">
					ONE ADDRESS · ONE ADDRESS · ONE ADDRESS ·
				</textPath>
			</text>
			<g style={{ color: "var(--color-ink)" }}>
				<PinShape transform="translate(76 76) scale(2)" />
			</g>
		</svg>
	);
}

function OrbitField() {
	return (
		<svg
			className="pointer-events-none absolute inset-0 h-full w-full"
			viewBox="0 0 1000 750"
			fill="none"
			aria-hidden="true"
		>
			<ellipse
				cx="500"
				cy="375"
				rx="360"
				ry="255"
				stroke="var(--color-beacon)"
				strokeOpacity="0.3"
				strokeWidth="1.25"
			/>
			<ellipse
				cx="500"
				cy="375"
				rx="430"
				ry="302"
				stroke="var(--color-beacon)"
				strokeOpacity="0.16"
				strokeWidth="1"
				strokeDasharray="4 11"
				transform="rotate(-14 500 375)"
			/>
			<ellipse
				cx="500"
				cy="375"
				rx="248"
				ry="186"
				stroke="var(--color-sage)"
				strokeOpacity="0.22"
				strokeWidth="1"
				transform="rotate(11 500 375)"
			/>
			<ellipse cx="500" cy="375" rx="472" ry="344" stroke="var(--color-sage)" strokeOpacity="0.13" strokeWidth="1" />

			<circle cx="86" cy="140" r="9" fill="var(--color-beacon)" fillOpacity="0.55" />
			<circle cx="944" cy="238" r="5" fill="var(--color-frond)" fillOpacity="0.45" />
			<circle cx="168" cy="668" r="4" fill="var(--color-beacon)" fillOpacity="0.4" />
			<circle cx="868" cy="650" r="13" fill="var(--color-bark)" />
			<circle cx="868" cy="650" r="13" stroke="var(--color-beacon)" strokeOpacity="0.5" strokeWidth="1" />
			<ellipse
				cx="868"
				cy="650"
				rx="26"
				ry="8"
				stroke="var(--color-beacon)"
				strokeOpacity="0.3"
				strokeWidth="1"
				transform="rotate(-22 868 650)"
			/>
		</svg>
	);
}

function TagList({ tags, className }: { readonly tags: readonly string[]; readonly className: string }) {
	return (
		<ul className={className}>
			{tags.map((tag) => (
				<li
					key={tag}
					className="rounded-full border border-[var(--hairline)] px-2.5 py-1 text-[0.6875rem] leading-none text-[var(--on-muted)]"
				>
					{tag}
				</li>
			))}
		</ul>
	);
}

export function SourceOrbit({ sources = ORBIT_SOURCES, className }: SourceOrbitProps) {
	// React mints the id, so two orbits on one page cannot collide on the textPath.
	const idPrefix = useId();
	return (
		<div className={className}>
			<div className="relative mx-auto hidden aspect-[4/3] w-full max-w-5xl lg:block">
				<OrbitField />

				<CentreBadge
					pathId={`${idPrefix}-arc-wide`}
					className="absolute left-1/2 top-1/2 h-[clamp(9rem,14vw,12rem)] w-[clamp(9rem,14vw,12rem)] -translate-x-1/2 -translate-y-1/2"
				/>

				<ul className="absolute inset-0">
					{sources.map((source, index) => {
						const tone = toneAt(index);
						const seat = seatAt(index, sources.length);
						return (
							<li
								key={source.name}
								className="absolute -translate-x-1/2 -translate-y-1/2"
								style={{ left: seat.left, top: seat.top }}
							>
								<div
									className={`${tone.className} flex h-[clamp(10rem,17vw,13.5rem)] w-[clamp(10rem,17vw,13.5rem)] flex-col items-center justify-center rounded-full px-5 text-center`}
									style={tone.style}
								>
									<span className="gt-display text-[1.3rem] leading-tight">{source.name}</span>
									<TagList tags={source.tags} className="mt-3 flex flex-wrap items-center justify-center gap-1.5" />
								</div>
							</li>
						);
					})}
				</ul>
			</div>

			<div className="lg:hidden">
				<p className="inline-flex items-center gap-2 rounded-full bg-[var(--color-beacon)] py-2 pl-4 pr-5 text-[var(--color-ink)]">
					<svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden="true">
						<PinShape />
					</svg>
					<span className="gt-display text-lg">one address</span>
				</p>

				<ul className="gt-spine mt-5 flex flex-col gap-3">
					{sources.map((source, index) => {
						const tone = toneAt(index);
						return (
							<li key={source.name} className="gt-node">
								<div className={`${tone.className} rounded-[24px] p-5`} style={tone.style}>
									<span className="gt-index">{indexLabel(index)}</span>
									<p className="gt-display mt-1 text-xl leading-tight">{source.name}</p>
									<TagList tags={source.tags} className="mt-3 flex flex-wrap gap-1.5" />
								</div>
							</li>
						);
					})}
				</ul>
			</div>
		</div>
	);
}
