import type { GeocodeMatchView } from "@/app/lib/geocode-contract";
import { TopBar } from "./top-bar";

type CandidatesScreenProps = {
	readonly candidates: readonly GeocodeMatchView[];
	readonly onChoose: (match: GeocodeMatchView) => void;
	readonly onStartOver: () => void;
};

export function CandidatesScreen({ candidates, onChoose, onStartOver }: CandidatesScreenProps) {
	return (
		<div className="mx-auto w-full max-w-4xl px-5 pb-24 pt-10 sm:px-8 sm:pt-16">
			<TopBar>
				<button type="button" onClick={onStartOver} className="gt-ghost">
					Search another address
				</button>
			</TopBar>

			<h1 className="gt-display mt-12 text-4xl sm:text-5xl">Several matches</h1>
			<p className="mt-4 max-w-xl text-base text-[var(--on-ground-muted)]">
				The Census Geocoder found {candidates.length} possible matches. Choose the one you meant.
			</p>
			<p className="mt-3 max-w-xl text-sm text-[var(--on-ground-muted)]">
				Nothing is chosen for you here, and no match is described yet. The sentence that says which block a
				point sits on belongs to a match you confirmed, so it arrives after you pick one.
			</p>

			<ul className="mt-8 grid gap-4 sm:grid-cols-2">
				{candidates.map((candidate, index) => (
						<li key={candidate.matchedAddress}>
						<button
								type="button"
								onClick={() => onChoose(candidate)}
								className={`gt-card ${index % 2 === 1 ? "gt-card-dark" : ""} relative flex h-full w-full flex-col overflow-hidden text-left transition-transform hover:-translate-y-1`}
							>
								<span className="gt-watermark" aria-hidden="true">
									{String(index + 1).padStart(2, "0")}
								</span>
								<span className="gt-display relative block text-lg leading-snug">
									{candidate.matchedAddress}
								</span>
								<span className="relative mt-auto flex justify-end pt-6">
									<span className="gt-go" aria-hidden="true">
										<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
											<path d="M4 12h15M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
										</svg>
									</span>
								</span>
							</button>
						</li>
				))}
			</ul>

			<button type="button" onClick={onStartOver} className="gt-ghost mt-10">
				None of these -- start over
			</button>
		</div>
	);
}
