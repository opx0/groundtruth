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

type ReportCardProps = {
	readonly card: CardView;
	readonly groups: CardGroupsView | null;
	readonly expanded: readonly string[];
	readonly onToggleListing: (key: string) => void;
	readonly onOpenTrace: OpenTrace;
	readonly onRetry: () => void;
};

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
