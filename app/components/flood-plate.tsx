import { FLOOD_SOURCE, FLOOD_TIERS, placeFlood } from "@/app/lib/scales";

export type FloodPlateProps = {
	readonly zone: string;
	readonly sfhaLabel: string;
	readonly subtype: string;
};

export function FloodPlate({ zone, sfhaLabel, subtype }: FloodPlateProps) {
	const placement = placeFlood(zone, sfhaLabel, subtype);

	return (
		<figure className="m-0" role="group" aria-label={`Flood zone ${zone}, ${sfhaLabel}`}>
			<div className="flex items-baseline gap-3">
				<span className="gt-display text-[2.75rem] leading-none">{zone}</span>
				<span className="text-sm text-[var(--on-muted)]">{sfhaLabel}</span>
			</div>

			<ol className="mt-4 flex flex-col-reverse gap-px overflow-hidden rounded-xl">
				{FLOOD_TIERS.map((tier) => {
					const here = placement.tier === tier.id;
					return (
						<li
							key={tier.id}
							aria-current={here ? "true" : undefined}
							className={`flex items-center gap-3 px-3 py-2.5 text-xs ${
								here
									? "bg-[color-mix(in_srgb,var(--color-beacon)_26%,transparent)] font-semibold"
									: "bg-[color-mix(in_srgb,var(--on-card)_7%,transparent)] text-[var(--on-muted)]"
							}`}
						>
							<span
								aria-hidden="true"
								className={`h-2.5 w-2.5 shrink-0 rotate-45 ${
									here ? "bg-[var(--color-beacon)]" : "bg-transparent"
								}`}
							/>
							<span>{tier.label}</span>
						</li>
					);
				})}
			</ol>

			{placement.tier === null ? (
				<p className="mt-3 text-xs text-[var(--on-muted)]">{placement.because}</p>
			) : null}

			<p className="mt-3 text-xs text-[var(--on-muted)]">
				The tiers are{" "}
				<a
					className="underline decoration-dotted underline-offset-2"
					href={FLOOD_SOURCE.url}
					rel="noreferrer"
					target="_blank"
				>
					{FLOOD_SOURCE.agency}
				</a>
				&apos;s own definitions.
			</p>
		</figure>
	);
}
