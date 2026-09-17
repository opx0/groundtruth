import type { ReactNode } from "react";
import { GLOSSARY_HEADING, glossaryFor } from "@/app/lib/glossary";
import { radiusOf } from "@/lib/boundaries";
import { AQI_SOURCE } from "@/app/lib/scales";
import { AqiGauge } from "./aqi-gauge";
import { DistanceStrip, type DistanceStripRecord } from "./distance-strip";
import { FloodPlate } from "./flood-plate";
import { Quarters, QUARTERS_NOTE } from "./quarters";
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

function isFigure(text: string): boolean {
	return /^[\d][\d,]*$/.test(text);
}

function sentenceNode(
	sentence: SentenceViewMessage,
	key: string,
	onOpenTrace: OpenTrace,
	variant: "body" | "headline" = "body",
): ReactNode {
	const headline = variant === "headline";
	return (
		<p key={key} className={headline ? "text-sm leading-snug text-[var(--on-muted)]" : "text-[0.9375rem] leading-[1.7]"}>
			{sentence.spans.map((span, index) =>
				span.slot === null ? (
					<span key={`${key}:${index}`}>{span.text}</span>
				) : (
					<button
						key={`${key}:${index}`}
						type="button"
						data-field={span.slot.field}
						onClick={() => onOpenTrace(sentence, index)}
						className={
							headline && isFigure(span.text)
								? "gt-slot gt-display align-baseline text-[2.25rem] leading-none text-[var(--on-card)] sm:text-[2.75rem]"
								: "gt-slot"
						}
					>
						{span.text}
					</button>
				),
			)}
		</p>
	);
}

function sentenceNodes(
	sentences: readonly SentenceViewMessage[],
	key: string,
	onOpenTrace: OpenTrace,
	variant: "body" | "headline" = "body",
): ReactNode {
	return sentences.map((sentence, index) => sentenceNode(sentence, `${key}:${index}`, onOpenTrace, variant));
}

type EntryView = CardView["listings"][number]["shown"][number];

function entryNode(entry: EntryView, key: string, onOpenTrace: OpenTrace): ReactNode {
	const values = entry.sentences.flatMap((sentence) => sentence.trace?.values ?? []);
	const found = values.find((value) => value.field === "quartersInNoncompliance");
	const quarters = typeof found?.normalized === "number" ? found.normalized : null;
	const subject = values.find((value) => value.field === "subject")?.normalized;
	return (
		<div key={key} data-record={entry.recordId.sourceRecordId} className="border-l-2 border-[var(--hairline)] pl-4">
			{sentenceNodes(entry.sentences, key, onOpenTrace)}
			{quarters === null ? null : <Quarters count={quarters} of={12} subject={typeof subject === "string" ? subject : entry.recordId.sourceRecordId} />}
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
					className="gt-ghost self-start"
				>
					{open ? "Hide the rest" : "Show the rest"}
				</button>
			) : null}
		</div>
	);
}

const FRAME: { readonly [S in CardState]: string } = {
	records: "gt-card-reached",
	"no-records": "gt-card-reached",
	unavailable: "gt-card-silent",
	"not-asked": "gt-card-idle",
};

function renderedValues(card: CardView, groups: CardGroupsView | null): ReadonlySet<string> {
	const out = new Set<string>();
	const take = (sentences: readonly SentenceViewMessage[]): void => {
		for (const sentence of sentences) {
			for (const span of sentence.spans) if (span.slot !== null) out.add(span.text);
		}
	};
	if (card.status !== null) take([card.status]);
	take(card.priorAttempts);
	take(card.headlines);
	for (const listing of card.listings) {
		for (const entry of [...listing.shown, ...listing.rest]) take(entry.sentences);
	}
	if (groups !== null) take([...groups.groups, ...groups.crossReferences]);
	return out;
}

function valuesByField(card: CardView, field: string): readonly { readonly displayed: string; readonly normalized: unknown }[] {
	const out: { displayed: string; normalized: unknown }[] = [];
	for (const listing of card.listings) {
		for (const entry of [...listing.shown, ...listing.rest]) {
			for (const sentence of entry.sentences) {
				for (const value of sentence.trace?.values ?? []) {
					if (value.field === field && value.displayed !== null) {
						out.push({ displayed: value.displayed, normalized: value.normalized });
					}
				}
			}
		}
	}
	return out;
}

function floodOf(card: CardView): { readonly zone: string; readonly sfhaLabel: string; readonly subtype: string } | null {
	const zone = valuesByField(card, "zoneCode")[0];
	const sfha = valuesByField(card, "sfhaLabel")[0];
	if (zone === undefined || sfha === undefined) return null;
	return { zone: zone.displayed, sfhaLabel: sfha.displayed, subtype: valuesByField(card, "zoneSubtype")[0]?.displayed ?? "" };
}

function readingsOf(card: CardView): readonly { readonly aqi: number; readonly pollutant: string }[] {
	const out: { aqi: number; pollutant: string }[] = [];
	for (const listing of card.listings) {
		for (const entry of [...listing.shown, ...listing.rest]) {
			for (const sentence of entry.sentences) {
				const values = sentence.trace?.values ?? [];
				const aqi = values.find((value) => value.field === "aqi");
				const pollutant = values.find((value) => value.field === "pollutant");
				if (typeof aqi?.normalized !== "number" || pollutant?.displayed == null) continue;
				out.push({ aqi: aqi.normalized, pollutant: pollutant.displayed });
				break;
			}
		}
	}
	return out;
}


function distancesOf(card: CardView): readonly DistanceStripRecord[] {
	const out: DistanceStripRecord[] = [];
	for (const listing of card.listings) {
		for (const entry of [...listing.shown, ...listing.rest]) {
			for (const sentence of entry.sentences) {
				const values = sentence.trace?.values ?? [];
				const distance = values.find((value) => value.field === "distanceMeters");
				if (distance === undefined || typeof distance.normalized !== "number") continue;
				const subject = values.find((value) => value.field === "subject");
				out.push({
					label: subject?.displayed ?? entry.recordId.sourceRecordId,
					meters: distance.normalized,
				});
				break;
			}
		}
	}
	return out;
}

export function ReportCard({ card, groups, expanded, onToggleListing, onOpenTrace, onRetry }: ReportCardProps) {
	const state = cardStateOf(card);
	const caveats = caveatsOf(card);
	const glossary = state === "records" ? glossaryFor(card.source, renderedValues(card, groups)) : [];
	const radius = radiusOf(card.source);
	const distances = radius === null || state !== "records" ? [] : distancesOf(card);
	const flood = state === "records" && card.source === "fema" ? floodOf(card) : null;
	const readings = state === "records" && card.source === "airnow" ? readingsOf(card) : [];
	return (
		<article
			data-source={card.source}
			data-card-state={state}
			className={`gt-card gt-node ${FRAME[state]}`}
		>
			<h2 className="gt-display text-2xl leading-tight">{card.agency}</h2>

			<div className="mt-5 grid gap-x-10 gap-y-6 lg:grid-cols-[1.4fr_1fr]">
				<div className="flex min-w-0 flex-col gap-2.5 lg:col-start-1 lg:row-start-1">
					{state === "not-asked" ? (
						<p className="text-sm text-[var(--on-muted)]">This source was not asked.</p>
					) : null}
					{card.status === null ? null : sentenceNode(card.status, `${card.source}:status`, onOpenTrace)}
					{sentenceNodes(card.priorAttempts, `${card.source}:prior`, onOpenTrace)}
				</div>

				{card.headlines.length > 0 || distances.length > 1 || flood !== null || readings.length > 0 ? (
					<aside className="min-w-0 lg:sticky lg:top-8 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start lg:border-l lg:border-[var(--hairline)] lg:pl-10">
						<h3 className="gt-label text-[var(--on-muted)]">At a glance</h3>

						{flood === null ? null : (
							<div className="mt-4">
								<FloodPlate zone={flood.zone} sfhaLabel={flood.sfhaLabel} subtype={flood.subtype} />
							</div>
						)}

						{readings.length === 0 ? null : (
							<div className="mt-4">
								<div className="flex flex-col gap-7">
									{readings.map((reading) => (
										<AqiGauge key={reading.pollutant} aqi={reading.aqi} pollutant={reading.pollutant} />
									))}
								</div>
								<p className="mt-4 text-xs text-[var(--on-muted)]">
									The bands and their names are{" "}
									<a
										className="underline decoration-dotted underline-offset-2"
										href={AQI_SOURCE.url}
										rel="noreferrer"
										target="_blank"
									>
										{AQI_SOURCE.agency}
									</a>
									&apos;s own.
								</p>
							</div>
						)}

						{card.source === "echo" ? (
							<p className="mt-4 text-xs text-[var(--on-muted)]">{QUARTERS_NOTE}</p>
						) : null}

						{card.headlines.length > 0 ? (
							<div className={flood !== null || readings.length > 0 ? "gt-rule mt-6 flex flex-col gap-5 pt-5" : "mt-4 flex flex-col gap-5"}>
								{sentenceNodes(card.headlines, `${card.source}:headline`, onOpenTrace, "headline")}
							</div>
						) : null}

						{radius !== null && distances.length > 1 ? (
							<div className={card.headlines.length > 0 ? "gt-rule mt-6 pt-5" : "mt-4"}>
								<DistanceStrip
									records={distances}
									boundaryMeters={radius.meters}
									boundaryLabel={radius.label}
								/>
							</div>
						) : null}
					</aside>
				) : null}

				<div className="min-w-0 lg:col-start-1 lg:row-start-2">
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
				</div>
			</div>

			{glossary.length > 0 || caveats.length > 0 ? (
				<div className="gt-rule mt-6 grid gap-6 pt-5 lg:grid-cols-2">
					{glossary.length > 0 ? (
						<div>
							<h3 className="gt-label text-[var(--on-muted)]">{GLOSSARY_HEADING}</h3>
							<dl className="mt-3 flex flex-col gap-3">
								{glossary.map((entry) => (
									<div key={entry.term} data-gloss={entry.term}>
										<dt className="text-sm font-semibold">{entry.term}</dt>
										<dd className="mt-1 text-sm text-[var(--on-muted)]">
											<span>{entry.quote}</span>{" "}
											<a
												className="underline decoration-dotted underline-offset-2"
												href={entry.sourceUrl}
												rel="noreferrer"
												target="_blank"
											>
												{entry.agency}
											</a>
										</dd>
									</div>
								))}
							</dl>
						</div>
					) : null}

					{caveats.length > 0 ? (
						<div>
							<h3 className="gt-label text-[var(--on-muted)]">Limits</h3>
							<ul className="mt-3 flex flex-col gap-2">
								{caveats.map((caveat) => (
									<li key={caveat} className="gt-check text-sm text-[var(--on-muted)]">
										<svg viewBox="0 0 20 20" aria-hidden="true" fill="currentColor" className="text-[var(--on-muted)]">
											<path
												fillRule="evenodd"
												d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v5a1 1 0 102 0V6zm-1 9.5a1.1 1.1 0 100-2.2 1.1 1.1 0 000 2.2z"
												clipRule="evenodd"
											/>
										</svg>
										<span>{caveat}</span>
									</li>
								))}
							</ul>
						</div>
					) : null}
				</div>
			) : null}

			{state === "unavailable" ? (
				<button
					type="button"
					data-retry={card.source}
					onClick={onRetry}
					className="gt-ghost mt-5"
				>
					Retry
				</button>
			) : null}
		</article>
	);
}
