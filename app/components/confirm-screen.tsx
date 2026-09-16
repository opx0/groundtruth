import type { GeocodeMatchView, OriginSentence } from "@/app/lib/geocode-contract";

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

export function ConfirmScreen({ match, onStartOver, onSeeReport }: ConfirmScreenProps) {
	return (
		<div className="mx-auto max-w-xl px-4 py-12 sm:py-16">
			<h1 className="text-2xl font-semibold">Match confirmed</h1>

			<div className="mt-6 flex flex-col gap-3">
				{match.origin.map((sentence, index) => (
					<RenderedSentence
						key={sentence.templateId}
						sentence={sentence}
						className={index === 0 ? "text-base" : "text-sm opacity-80"}
					/>
				))}
			</div>

			<p className="mt-8 border-t border-black/10 pt-4 text-xs opacity-70 dark:border-white/15">
				From here on, this tool holds the point above and this match&apos;s details -- not the address you typed.
			</p>

			<div className="mt-6 flex flex-wrap gap-3">
				{onSeeReport === undefined ? null : (
					<button
						type="button"
						onClick={onSeeReport}
						className="rounded-md border border-black/15 bg-black/[0.04] px-4 py-2 text-sm font-medium dark:border-white/20 dark:bg-white/[0.06]"
					>
						See the report
					</button>
				)}

				<button
					type="button"
					onClick={onStartOver}
					className="rounded-md border border-black/15 px-4 py-2 text-sm font-medium dark:border-white/20"
				>
					Search another address
				</button>
			</div>
		</div>
	);
}
