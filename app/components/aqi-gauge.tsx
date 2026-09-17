import { AQI_BANDS, bandOf } from "@/app/lib/scales";

export type AqiGaugeProps = {
	readonly aqi: number;
	readonly pollutant: string;
};

export function AqiGauge({ aqi, pollutant }: AqiGaugeProps) {
	const band = bandOf(aqi);
	const ceiling = 300;
	const at = Math.min(1, Math.max(0, aqi / ceiling));

	return (
		<figure
			className="m-0"
			role="group"
			aria-label={`Air quality index ${aqi} for ${pollutant} on AirNow's scale`}
		>
			<figcaption className="flex flex-wrap items-baseline justify-between gap-x-4">
				<span className="gt-label text-[var(--on-muted)]">{pollutant}</span>
				<span className="text-xs text-[var(--on-muted)]">{band === null ? "" : band.name}</span>
			</figcaption>

			<div className="mt-3 flex items-baseline gap-3">
				<span className="gt-display text-[2.5rem] leading-none">{aqi}</span>
			</div>

			<div className="relative mt-3">
				<div className="flex h-2 w-full overflow-hidden rounded-full">
					{AQI_BANDS.map((one) => {
						const top = one.to ?? ceiling + 60;
						const width = (Math.min(top, ceiling + 60) - one.from) / (ceiling + 60);
						return (
							<span
								key={one.name}
								style={{ width: `${width * 100}%` }}
								className="h-full border-r border-[var(--surface-card)] bg-[color-mix(in_srgb,var(--on-card)_18%,transparent)] last:border-r-0"
							/>
						);
					})}
				</div>

				<span
					aria-hidden="true"
					style={{ left: `${at * (ceiling / (ceiling + 60)) * 100}%` }}
					className="absolute -top-1 h-4 w-[3px] -translate-x-1/2 rounded-full bg-[var(--color-beacon)]"
				/>
			</div>

			<div className="mt-2 flex justify-between text-[0.6875rem] text-[var(--on-muted)]">
				{AQI_BANDS.slice(0, 5).map((one) => (
					<span key={one.name}>{one.from}</span>
				))}
				<span>{AQI_BANDS[5]?.from ?? 301}</span>
			</div>

		</figure>
	);
}
