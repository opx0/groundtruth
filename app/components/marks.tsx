type MarkProps = { readonly className?: string };

const STROKE = {
	fill: "none",
	stroke: "currentColor",
	strokeWidth: 3,
	strokeLinecap: "round",
	strokeLinejoin: "round",
} as const;

export function ChimneyMark({ className }: MarkProps) {
	return (
		<svg className={className} viewBox="0 0 100 100" aria-hidden="true" {...STROKE}>
			<path d="M14 84h72" />
			<path d="M26 84V44l18-9v49" />
			<path d="M44 84V30l18-9v63" />
			<path d="M62 84V46h20v38" />
			<path d="M32 24c0-6 7-6 7-12M50 16c0-6 7-6 7-12" />
		</svg>
	);
}

export function WaveMark({ className }: MarkProps) {
	return (
		<svg className={className} viewBox="0 0 100 100" aria-hidden="true" {...STROKE}>
			<path d="M8 40c9-9 18-9 27 0s18 9 27 0 18-9 27 0" />
			<path d="M8 58c9-9 18-9 27 0s18 9 27 0 18-9 27 0" />
			<path d="M8 76c9-9 18-9 27 0s18 9 27 0 18-9 27 0" />
		</svg>
	);
}

export function SkylineMark({ className }: MarkProps) {
	return (
		<svg className={className} viewBox="0 0 100 100" aria-hidden="true" {...STROKE}>
			<path d="M10 86h80" />
			<path d="M18 86V52h16v34" />
			<path d="M40 86V28h18v58" />
			<path d="M64 86V44h18v42" />
			<path d="M24 62h4M24 72h4M46 40h6M46 54h6M46 68h6M70 56h6M70 70h6" />
		</svg>
	);
}

export function LensMark({ className }: MarkProps) {
	return (
		<svg className={className} viewBox="0 0 100 100" aria-hidden="true" {...STROKE}>
			<circle cx="44" cy="44" r="26" />
			<path d="M63 63l23 23" />
			<path d="M34 44h20" strokeDasharray="4 6" />
		</svg>
	);
}

export function Spinner({ className }: MarkProps) {
	return (
		<svg
			className={`${className ?? ""} motion-safe:animate-spin`}
			viewBox="0 0 24 24"
			aria-hidden="true"
			fill="none"
			stroke="currentColor"
			strokeWidth="2.5"
			strokeLinecap="round"
		>
			<circle cx="12" cy="12" r="9" opacity="0.25" />
			<path d="M21 12a9 9 0 0 0-9-9" />
		</svg>
	);
}

export const GROUP_MARKS: Readonly<Record<string, (props: MarkProps) => React.JSX.Element>> = {
	"Heavy industry close by": ChimneyMark,
	"Inside a mapped flood zone": WaveMark,
	"A city centre, dense with facilities": SkylineMark,
	"Where the record is thin, or breaks": LensMark,
};
