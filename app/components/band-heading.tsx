const DIGIT_PATHS: Readonly<Record<string, string>> = {
	"0": "M30 9C42 9 52 27 52 50C52 73 42 91 30 91C18 91 8 73 8 50C8 27 18 9 30 9Z",
	"1": "M12 28L30 9L30 91M13 91L47 91",
	"2": "M9 28C9 16 18 9 30 9C43 9 51 18 51 29C51 49 14 63 9 91L52 91",
	"3": "M10 20C15 13 22 9 31 9C43 9 51 16 51 27C51 38 43 45 31 45C45 45 54 53 54 66C54 80 43 91 29 91C19 91 12 86 8 78",
	"4": "M39 91L39 9L7 66L53 66",
	"5": "M49 9L17 9L13 45C19 40 25 38 31 38C45 38 54 48 54 64C54 80 43 91 29 91C19 91 12 86 8 79",
	"6": "M47 15C42 11 36 9 29 9C16 9 8 24 8 52C8 76 17 91 30 91C43 91 52 81 52 67C52 54 43 45 31 45C21 45 12 52 9 61",
	"7": "M8 9L52 9L27 91",
	"8": "M30 46C19 46 10 55 10 68C10 81 19 91 30 91C42 91 51 81 51 68C51 55 42 46 30 46C21 46 14 38 14 28C14 17 21 9 30 9C40 9 47 17 47 28C47 38 40 46 30 46Z",
	"9": "M13 85C18 89 24 91 31 91C44 91 52 76 52 48C52 24 43 9 30 9C17 9 8 19 8 32C8 45 16 55 29 55C39 55 48 48 51 40",
};

const DIGIT_ADVANCE = 58;

function GhostNumeral({ value, className }: { readonly value: string; readonly className: string }) {
	const digits = [...value];
	return (
		<svg
			className={className}
			viewBox={`-4 0 ${digits.length * DIGIT_ADVANCE + 8} 100`}
			preserveAspectRatio="xMinYMid meet"
			fill="none"
			stroke="currentColor"
			strokeWidth="2.25"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			focusable="false"
		>
			{digits.map((digit, index) => {
				const path = DIGIT_PATHS[digit];
				if (path === undefined) return null;
				return <path key={`${index}:${digit}`} d={path} transform={`translate(${index * DIGIT_ADVANCE} 0)`} />;
			})}
		</svg>
	);
}

export type BandHeadingProps = {
	readonly index: number;
	readonly heading: string;
	readonly label?: string;
	readonly id?: string;
};

export function BandHeading({ index, heading, label, id }: BandHeadingProps) {
	return (
		<div id={id} className="relative isolate overflow-hidden scroll-mt-6 pt-7 sm:pt-9">
			<GhostNumeral
				value={String(index).padStart(2, "0")}
				className="pointer-events-none absolute -left-4 -top-3 -z-10 h-32 w-auto opacity-[0.13] sm:-top-5 sm:h-44"
			/>
			{label === undefined ? null : <p className="gt-label mb-3 text-[var(--on-ground-muted)]">{label}</p>}
			<h2 className="gt-display max-w-[20ch] text-[clamp(2.1rem,5.4vw,3.6rem)] leading-[1.03]">{heading}</h2>
		</div>
	);
}

const TOKEN_FILL = {
	canopy: "var(--color-canopy)",
	bark: "var(--color-bark)",
	moss: "var(--color-moss)",
	frond: "var(--color-frond)",
	sage: "var(--color-sage)",
	bone: "var(--color-bone)",
	ink: "var(--color-ink)",
	ground: "var(--ground)",
	card: "var(--surface-card)",
	paper: "var(--surface-paper)",
} as const;


export type TornEdgeFill = keyof typeof TOKEN_FILL | (string & {});

export type TornEdgeProps = {
	readonly fill: TornEdgeFill;
	/** Which edge of its own box the tear bites into. */
	readonly edge?: "top" | "bottom";
	readonly className?: string;
};

const TORN_EDGE =
	"M0 25.6L28.2 23.2L60.3 29.4L89 28.2L112 22.2L140.2 17.6L159.6 26.5L191.3 28.6L197.3 26.1L217.1 24L237.1 20.5L260.8 27.9L278.4 28.1L293.3 25.7L325.1 23L343.1 18L363.8 27.5L388.9 25.4L395 34.3L410.1 29.9L442.1 30.7L467.8 23.6L483.2 23.7L498 24.3L510.6 25.6L543.4 15.8L566.9 24.7L587.4 25.4L609.2 21.7L638.4 29.3L663.8 33.5L690.6 25.1L721.9 25L746.1 24.6L754.8 23L767.8 33.1L780.5 23.4L803.5 26.6L826.5 23.7L842.7 30.2L859.2 33.7L878.1 27L910.1 23.8L916.1 34.6L928.3 30.2L949 14.6L965.1 28.1L992.9 23.3L1005.2 26.7L1013.6 33.2L1027.1 35.2L1060 24.6L1073.9 24.8L1099.8 25.2L1130.9 26L1135.4 16.8L1165.7 24.5L1185.2 28.6L1200 26.1L1107.7 -17L1015.4 -20.7L923.1 -19.1L830.8 -19.2L738.5 -15.2L646.2 -17.2L553.8 -18L461.5 -17.6L369.2 -16.8L276.9 -17.9L184.6 -18.5L92.3 -18.9L0 -16.5Z";

const TORN_FIBRE =
	"M0 30.2L17.4 28.6L56.1 26.5L92.2 25.7L128.5 39.1L164.3 31.6L168.9 31.6L211 28.7L251.7 38.2L292.5 29.3L328.6 33.1L335.9 38.4L352.9 39.6L358 38.7L364.8 38.2L399.2 30.4L402.9 27.6L445.4 30.5L464.7 34.8L507.3 31.6L523.9 24.4L549.9 35.6L569.8 26.2L604 29.5L643.2 18.5L664.2 28.6L684.6 31.1L720.5 27.7L746.9 21.1L764.4 34.5L788.8 36.4L827.7 25.8L866.9 24.7L907.5 31.3L915.4 38.5L923.2 36.7L949.6 39.3L974.4 36.1L980.5 33L1010.6 33.2L1050 37.3L1074 32L1094.2 33.1L1099.6 20.5L1131.1 39.2L1138.5 28.7L1145.5 33.3L1167 28.6L1185.5 23.6L1200 28.9L1107.7 -15L1015.4 -21.6L923.1 -19.2L830.8 -16.5L738.5 -17.7L646.2 -18.7L553.8 -15.6L461.5 -14.3L369.2 -18.2L276.9 -19.8L184.6 -18L92.3 -16.3L0 -18.3Z";

/**
 * The height is a presentation attribute rather than a base utility class: with
 * no height at all the SVG takes its height from the viewBox ratio, so the tear
 * would shrink to a scratch on a phone and swell on a wide screen. An attribute
 * loses to any `h-*` the caller passes -- a class would instead race one in
 * Tailwind's generated order.
 */
export function TornEdge({ fill, edge = "bottom", className }: TornEdgeProps) {
	const colour = (TOKEN_FILL as Readonly<Record<string, string>>)[fill] ?? fill;
	return (
		<svg
			className={className === undefined ? "block w-full" : `block w-full ${className}`}
			viewBox="0 0 1200 40"
			height={40}
			preserveAspectRatio="none"
			aria-hidden="true"
			focusable="false"
		>
			<g fill={colour} transform={edge === "top" ? "translate(0 40) scale(1 -1)" : undefined}>
				<path d={TORN_FIBRE} opacity="0.55" />
				<path d={TORN_EDGE} />
			</g>
		</svg>
	);
}
