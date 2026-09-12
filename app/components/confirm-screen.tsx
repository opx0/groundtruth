import { buildPrecisionSentence, type GeocodeMatchView } from "@/app/lib/geocode-contract";

type ConfirmScreenProps = {
	readonly match: GeocodeMatchView;
	readonly onStartOver: () => void;
};

/**
 * Screen 2. The matched address, the mapped point, and the precision
 * sentence built from `match`'s own fields by `buildPrecisionSentence` --
 * never a fixed string, so a different range or side produces different
 * text.
 */
export function ConfirmScreen({ match, onStartOver }: ConfirmScreenProps) {
	return (
		<div className="mx-auto max-w-xl px-4 py-12 sm:py-16">
			<h1 className="text-2xl font-semibold">Match confirmed</h1>

			<p className="mt-6 text-base">
				Matched: <strong>{match.matchedAddress}</strong>
			</p>
			<p className="mt-3 text-sm opacity-80">{buildPrecisionSentence(match)}</p>

			<dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
				<dt className="opacity-60">Latitude</dt>
				<dd>{match.latitude}</dd>
				<dt className="opacity-60">Longitude</dt>
				<dd>{match.longitude}</dd>
			</dl>

			<p className="mt-8 border-t border-black/10 pt-4 text-xs opacity-70 dark:border-white/15">
				From here on, this tool holds the point above and this match&apos;s details -- not the address you typed.
			</p>

			<button
				type="button"
				onClick={onStartOver}
				className="mt-6 rounded-md border border-black/15 px-4 py-2 text-sm font-medium dark:border-white/20"
			>
				Search another address
			</button>
		</div>
	);
}
