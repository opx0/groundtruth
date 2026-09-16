import type { GeocodeMatchView } from "@/app/lib/geocode-contract";

type CandidatesScreenProps = {
	readonly candidates: readonly GeocodeMatchView[];
	readonly onChoose: (match: GeocodeMatchView) => void;
	readonly onStartOver: () => void;
};

export function CandidatesScreen({ candidates, onChoose, onStartOver }: CandidatesScreenProps) {
	return (
		<div className="mx-auto max-w-xl px-4 py-12 sm:py-16">
			<h1 className="text-2xl font-semibold">Several matches</h1>
			<p className="mt-2 text-sm opacity-70">
				The Census Geocoder found {candidates.length} possible matches. Choose the one you meant.
			</p>

			<ul className="mt-6 flex flex-col gap-2">
				{candidates.map((candidate) => (
					<li key={candidate.matchedAddress}>
						<button
							type="button"
							onClick={() => onChoose(candidate)}
							className="w-full rounded-md border border-black/15 px-3 py-2 text-left text-sm hover:border-black/40 dark:border-white/20 dark:hover:border-white/40"
						>
							{candidate.matchedAddress}
						</button>
					</li>
				))}
			</ul>

			<button type="button" onClick={onStartOver} className="mt-6 text-sm underline underline-offset-2">
				None of these -- start over
			</button>
		</div>
	);
}
