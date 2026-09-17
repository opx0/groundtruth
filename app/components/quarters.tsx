export type QuartersProps = {
	readonly count: number;
	readonly of: number;
	readonly subject: string;
};

export const QUARTERS_NOTE = "ECHO reports how many of the last twelve quarters, not which.";

export function Quarters({ count, of, subject }: QuartersProps) {
	const filled = Math.max(0, Math.min(of, Math.round(count)));

	return (
		<div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
			<span className="flex gap-[3px]" role="img" aria-label={`${subject}: ${filled} of ${of} quarters`}>
				{Array.from({ length: of }, (_, index) => (
					<span
						key={index}
						className={`h-2.5 w-2 rounded-[2px] ${
							index < filled
								? "bg-[color-mix(in_srgb,var(--on-card)_62%,transparent)]"
								: "bg-[color-mix(in_srgb,var(--on-card)_14%,transparent)]"
						}`}
					/>
				))}
			</span>
			<span className="text-xs text-[var(--on-muted)]">{`${filled} of ${of} quarters`}</span>
		</div>
	);
}
