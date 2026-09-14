import type { ReactNode } from "react";
import type { CardView, SentenceViewMessage } from "@/app/lib/report-contract";
import {
	cardStateOf,
	caveatsOf,
	listingKey,
	type CardGroupsView,
	type CardState,
	type OpenTrace,
} from "@/app/lib/report-flow";

/**
 * One source's card: what it answered, what it lists, and what it cannot tell
 * you.
 *
 * NOT ONE FACTUAL STRING IS WRITTEN HERE. Every sentence on a card is a
 * `SentenceViewMessage` the server rendered from an agency's own fields, and
 * this file puts its spans on screen with `data-field` intact, exactly as
 * `confirm-screen.tsx` does for the origin sentences. The strings this file
 * does write are about our own request or about this page -- "This source was
 * not asked.", "Retry", "Show the rest", "Hide the rest", "Limits" -- and none
 * of them could be made wrong by a government record changing, which is the
 * test the brief sets.
 *
 * NO SEVERITY. A Superfund card and a flood card get the same border, the same
 * weight and the same order. `data-card-state` distinguishes the four states of
 * docs/BRIEF.md B10 -- answered with records, answered with nothing, could not
 * be reached, never asked -- and the styling that goes with it says how the
 * retrieval went, never how bad the answer is. There is no colour in this file
 * that means a verdict, because ranking these sources is the score this product
 * refuses to compute.
 *
 * LIMITS SIT ON THE CARD (docs/BRIEF.md A5). A record's caveats are the
 * adapter's own words, carried on every record trace, and they are rendered at
 * the foot of the card that made the claim rather than in a page footer. The
 * other limits are already sentences: the not-shown sentence, the no-polygon
 * note that names its dataset, the prior attempt that says the authoritative
 * layer could not be reached. They render where they arrive, in reading order.
 *
 * WHY EVERY NODE BELOW IS A HOST ELEMENT. The click seam is the thing most
 * worth testing and this repository has no DOM in its unit tests
 * (`vitest.config.ts` runs in node). Calling `ReportCard(props)` returns a tree
 * of intrinsic elements only -- the helpers below are plain functions, not
 * components -- so a test can walk it, find every span carrying a `data-field`,
 * and call the `onClick` it was given for real.
 */

type ReportCardProps = {
	readonly card: CardView;
	/** The B6 groups whose lead member is one of this card's records, once every source has settled. */
	readonly groups: CardGroupsView | null;
	readonly expanded: readonly string[];
	readonly onToggleListing: (key: string) => void;
	readonly onOpenTrace: OpenTrace;
	/** docs/BRIEF.md B10: a source that could not be reached offers a retry. */
	readonly onRetry: () => void;
};

/**
 * One rendered sentence, span by span.
 *
 * A span that carries a slot is the rendered form of one field: it names that
 * field in `data-field` and is a button, because it is the thing the reader
 * clicks to open the trace. A span with no slot is the template's own
 * connective text and gets no hook, because there is nothing behind it to show.
 */
function sentenceNode(sentence: SentenceViewMessage, key: string, onOpenTrace: OpenTrace): ReactNode {
	return (
		<p key={key} className="text-sm leading-relaxed">
			{sentence.spans.map((span, index) =>
				span.slot === null ? (
					<span key={`${key}:${index}`}>{span.text}</span>
				) : (
					<button
						key={`${key}:${index}`}
						type="button"
						data-field={span.slot.field}
						onClick={() => onOpenTrace(sentence, index)}
						// `inline`, not the button default: a span like "Removal Only
						// Site (No Site Assessment Work Needed)" has to wrap inside the
						// sentence rather than sit in an unbreakable box off the edge
						// of a phone.
						className="inline cursor-pointer text-left underline decoration-dotted underline-offset-4 hover:decoration-solid"
					>
						{span.text}
					</button>
				),
			)}
		</p>
	);
}

function sentenceNodes(sentences: readonly SentenceViewMessage[], key: string, onOpenTrace: OpenTrace): ReactNode {
	return sentences.map((sentence, index) => sentenceNode(sentence, `${key}:${index}`, onOpenTrace));
}

type EntryView = CardView["listings"][number]["shown"][number];

function entryNode(entry: EntryView, key: string, onOpenTrace: OpenTrace): ReactNode {
	return (
		<div key={key} data-record={entry.recordId.sourceRecordId} className="border-l border-black/10 pl-3 dark:border-white/15">
			{sentenceNodes(entry.sentences, key, onOpenTrace)}
		</div>
	);
}

/**
 * One list on the card: the records it shows, and a way to see the rest it
 * carries.
 *
 * The button says "the rest" and not a number, because `rest` is exactly what
 * it opens. What the list *leaves out* is a different number and a different
 * claim, and the server already states it as `section/not-shown@1`, with a
 * trace, among the headlines above.
 */
function listingNode(
	listing: CardView["listings"][number],
	key: string,
	open: boolean,
	onToggleListing: (key: string) => void,
	onOpenTrace: OpenTrace,
): ReactNode {
	return (
		<div key={key} data-listing={key} className="mt-4 flex flex-col gap-3">
			{listing.shown.map((entry, index) => entryNode(entry, `${key}:shown:${index}`, onOpenTrace))}
			{open ? listing.rest.map((entry, index) => entryNode(entry, `${key}:rest:${index}`, onOpenTrace)) : null}
			{listing.rest.length > 0 ? (
				<button
					type="button"
					data-toggle={key}
					onClick={() => onToggleListing(key)}
					className="self-start rounded-md border border-black/15 px-3 py-1 text-xs font-medium dark:border-white/20"
				>
					{open ? "Hide the rest" : "Show the rest"}
				</button>
			) : null}
		</div>
	);
}

/** How the card is framed, per state. Retrieval, never severity: a dashed edge means we could not ask, not that the news is bad. */
const FRAME: { readonly [S in CardState]: string } = {
	records: "border-black/12 dark:border-white/18",
	"no-records": "border-black/12 dark:border-white/18",
	unavailable: "border-dashed border-black/25 dark:border-white/30",
	"not-asked": "border-dotted border-black/20 dark:border-white/20",
};

export function ReportCard({ card, groups, expanded, onToggleListing, onOpenTrace, onRetry }: ReportCardProps) {
	const state = cardStateOf(card);
	const caveats = caveatsOf(card);
	return (
		<article
			data-source={card.source}
			data-card-state={state}
			className={`rounded-lg border p-4 sm:p-5 ${FRAME[state]}`}
		>
			<h2 className="text-sm font-semibold tracking-wide">{card.agency}</h2>

			<div className="mt-3 flex flex-col gap-2">
				{/* No template speaks for a request that was never made, so the one
				    thing on this card is this screen saying what it did. */}
				{state === "not-asked" ? <p className="text-sm opacity-70">This source was not asked.</p> : null}
				{card.status === null ? null : sentenceNode(card.status, `${card.source}:status`, onOpenTrace)}
				{sentenceNodes(card.priorAttempts, `${card.source}:prior`, onOpenTrace)}
				{sentenceNodes(card.headlines, `${card.source}:headline`, onOpenTrace)}
			</div>

			{card.listings.map((listing, index) => {
				const key = listingKey(card.source, index);
				return listingNode(listing, key, expanded.includes(key), onToggleListing, onOpenTrace);
			})}

			{groups === null ? null : (
				<div className="mt-4 flex flex-col gap-2">
					{sentenceNodes(groups.groups, `${card.source}:group`, onOpenTrace)}
					{sentenceNodes(groups.crossReferences, `${card.source}:cross`, onOpenTrace)}
				</div>
			)}

			{caveats.length > 0 ? (
				<div className="mt-4 border-t border-black/10 pt-3 dark:border-white/15">
					<h3 className="text-xs font-semibold uppercase tracking-wide opacity-60">Limits</h3>
					<ul className="mt-1 flex flex-col gap-1">
						{caveats.map((caveat) => (
							<li key={caveat} className="text-xs opacity-75">
								{caveat}
							</li>
						))}
					</ul>
				</div>
			) : null}

			{state === "unavailable" ? (
				<button
					type="button"
					data-retry={card.source}
					onClick={onRetry}
					className="mt-4 rounded-md border border-black/15 px-3 py-1 text-xs font-medium dark:border-white/20"
				>
					Retry
				</button>
			) : null}
		</article>
	);
}
