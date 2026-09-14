import type { GeocodeMatchView, OriginSentence } from "@/app/lib/geocode-contract";

type ConfirmScreenProps = {
	readonly match: GeocodeMatchView;
	readonly onStartOver: () => void;
};

/**
 * One sentence the server rendered, span by span. A span that carries a slot
 * is the rendered form of one field, and names it in `data-field` so the
 * trace panel (`docs/BRIEF.md` A3 screen 4, a later unit) has something to
 * hang a click on; a span with no slot is the template's own connective text
 * and gets no hook, because there is nothing behind it to show.
 */
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

/**
 * Screen 2. Every factual line on it is a sentence `lib/templates/origin.ts`
 * rendered from the `GeocodeMatch` on the server, with the Census field
 * behind each span -- the matched address, the block range, the street side,
 * the TIGER line, the mapped point.
 *
 * This screen writes no sentence of its own and holds no fallback for one it
 * was not given. A clause whose fields are missing drops in the kernel, and a
 * sentence whose clauses all dropped never arrives; either way this renders
 * one paragraph fewer. Substituting prose for a sentence the fields could not
 * support is exactly what the deleted precision-sentence builder in
 * `app/lib/geocode-contract.ts` used to do, and it was the one line on this
 * screen with no trace behind it.
 *
 * The heading, the privacy note and the button are not claims about the
 * reader's address: they are this tool talking about itself.
 */
export function ConfirmScreen({ match, onStartOver }: ConfirmScreenProps) {
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
