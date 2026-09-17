import type { GeocodeMatchView, OriginSentence } from "@/app/lib/geocode-contract";
import { SOURCE_DOCS } from "@/app/lib/sources";
import { TopBar } from "./top-bar";

type ConfirmScreenProps = {
	readonly match: GeocodeMatchView;
	readonly onStartOver: () => void;
	readonly onSeeReport?: () => void;
};

function RenderedSentence({ sentence, className }: { readonly sentence: OriginSentence; readonly className: string }) {
	return (
		<p className={className}>
			{sentence.spans.map((span, index) => (
				<span key={`${sentence.templateId}:${index}`} data-field={span.slot?.field}>
					{span.text}
				</span>
			))}
		</p>
	);
}

const NEXT = SOURCE_DOCS.filter((doc) => doc.agency !== "US Census Geocoder");

export function ConfirmScreen({ match, onStartOver, onSeeReport }: ConfirmScreenProps) {
	return (
		<div className="mx-auto w-full max-w-4xl px-5 pb-24 pt-10 sm:px-8 sm:pt-16">
			<TopBar>
				<button type="button" onClick={onStartOver} className="gt-ghost">
					Search another address
				</button>
			</TopBar>

			<h1 className="gt-display mt-12 text-4xl sm:text-5xl">Match confirmed</h1>

			<div className="mt-8 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
				<div className="gt-card flex flex-col gap-3">
					{match.origin.map((sentence, index) => (
						<RenderedSentence
							key={sentence.templateId}
							sentence={sentence}
							className={index === 0 ? "text-base" : "text-sm text-[var(--on-muted)]"}
						/>
					))}
				</div>

				<div className="gt-card gt-card-dark">
					<h2 className="gt-label text-[var(--on-muted)]">What confirming asks</h2>
					<p className="mt-3 text-sm">
						Six systems, each with the mapped point and a distance only. Nothing you typed travels on.
					</p>
					<ul className="gt-rule mt-4 flex flex-col gap-2 pt-4">
						{NEXT.map((doc) => (
							<li key={doc.agency} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
								<span className="text-sm font-semibold">{doc.agency}</span>
								<span className="text-xs text-[var(--on-muted)]">{doc.boundary}</span>
							</li>
						))}
					</ul>
				</div>
			</div>

			<p className="gt-rule mt-8 max-w-2xl pt-4 text-xs text-[var(--on-ground-muted)]">
				From here on, this tool holds the point above and this match&apos;s details -- not the address you typed.
			</p>

			<div className="mt-6 flex flex-wrap gap-3">
				{onSeeReport === undefined ? null : (
					<button
						type="button"
						onClick={onSeeReport}
						className="gt-pill"
					>
						See the report
					</button>
				)}

				<button
					type="button"
					onClick={onStartOver}
					className="gt-ghost"
				>
					Search another address
				</button>
			</div>
		</div>
	);
}
