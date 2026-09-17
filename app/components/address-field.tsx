"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { CuratedGroup, GeocodeApiResponse } from "@/app/lib/geocode-contract";
import { Spinner } from "./marks";

export type AddressLookup = (address: string, signal: AbortSignal) => Promise<GeocodeApiResponse>;

export type AddressFieldProps = {
	readonly address: string;
	readonly pending: boolean;
	readonly groups: readonly CuratedGroup[];
	readonly lookup: AddressLookup;
	readonly browseHref: string;
	readonly onAddressChange: (address: string) => void;
	readonly onPick: (address: string) => void;
};

type Suggestion = { readonly address: string; readonly note: string; readonly curated: boolean };

/**
 * WHAT THE CENSUS GEOCODER WILL AND WILL NOT DO, measured on 2026-09-17.
 *
 * It is not an autocomplete service and it completes nothing: "9311 E Ave" and
 * "100 Main St" both come back as no match. What it does do is resolve an
 * address whose street is complete even when the rest is missing, so "1700
 * Convention Center" and "200 N Spring St, Los Angeles" both matched without a
 * city, a state or a ZIP.
 */
const LOOKS_COMPLETE = /\d.*[a-z]{3}/i;
const DEBOUNCE_MS = 400;

/** Below this the geocoder has never returned anything, so asking only costs a request. */
const MIN_LOOKUP_LENGTH = 8;

function curatedMatches(groups: readonly CuratedGroup[], typed: string): readonly Suggestion[] {
	const needle = typed.trim().toLowerCase();
	if (needle.length === 0) return [];
	return groups
		.flatMap((group) => group.examples)
		.filter((example) => example.address.toLowerCase().includes(needle))
		.slice(0, 4)
		.map((example) => ({ address: example.address, note: example.note, curated: true }));
}

export function AddressField(props: AddressFieldProps) {
	const { address, pending, groups, lookup, browseHref, onAddressChange, onPick } = props;
	const [open, setOpen] = useState(false);
	const [live, setLive] = useState<readonly Suggestion[]>([]);
	const [looking, setLooking] = useState(false);
	const [asked, setAsked] = useState("");
	const panelId = useId();
	const box = useRef<HTMLDivElement>(null);

	const typed = address.trim();
	const worthAsking = typed.length >= MIN_LOOKUP_LENGTH && LOOKS_COMPLETE.test(typed);

	useEffect(() => {
		if (!worthAsking) return;
		const controller = new AbortController();
		const timer = setTimeout(() => {
			setLooking(true);
			lookup(typed, controller.signal)
				.then((response) => {
					setAsked(typed);
					if (response.status === "matched") {
						setLive([{ address: response.match.matchedAddress, note: "The Census Geocoder matches this.", curated: false }]);
					} else if (response.status === "ambiguous") {
						setLive(
							response.candidates.slice(0, 6).map((candidate) => ({
								address: candidate.matchedAddress,
								note: "One of several the Census Geocoder returned.",
								curated: false,
							})),
						);
					} else {
						setLive([]);
					}
				})
				.catch(() => setLive([]))
				.finally(() => setLooking(false));
		}, DEBOUNCE_MS);
		return () => {
			controller.abort();
			clearTimeout(timer);
		};
	}, [typed, worthAsking, lookup]);

	useEffect(() => {
		const away = (event: MouseEvent): void => {
			if (box.current !== null && !box.current.contains(event.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", away);
		return () => document.removeEventListener("mousedown", away);
	}, []);

	const suggestions = worthAsking ? live : [];
	const matches = curatedMatches(groups, address);
	const nothingFound = worthAsking && !looking && suggestions.length === 0 && matches.length === 0 && asked === typed;
	const showPanel = open && !pending;

	const take = (picked: string): void => {
		setOpen(false);
		onPick(picked);
	};

	return (
		<div ref={box} className="relative">
			<div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
				<div className="gt-paper gt-control flex flex-1 flex-col gap-2 rounded-[24px] p-2 shadow-2xl sm:flex-row sm:items-center sm:rounded-full sm:pl-4">
					<input
						id="address"
						name="address"
						type="text"
						inputMode="text"
						autoComplete="off"
						role="combobox"
						aria-expanded={showPanel}
						aria-controls={panelId}
						aria-autocomplete="list"
						placeholder="9311 E Ave P, Houston, TX 77012"
						className="gt-field"
						value={address}
						disabled={pending}
						onChange={(event) => {
							setOpen(true);
							onAddressChange(event.target.value);
						}}
						onFocus={() => setOpen(true)}
					/>
					<button type="submit" disabled={pending} className="gt-pill shrink-0 gap-2 sm:px-7 sm:py-3">
						{pending ? <Spinner className="h-4 w-4" /> : null}
						{pending ? "Searching…" : "Find this address"}
					</button>
				</div>

				<a href={browseHref} className="gt-ghost shrink-0 justify-center sm:px-6">
					Browse addresses				</a>
			</div>

			{showPanel && (matches.length > 0 || suggestions.length > 0 || looking || nothingFound) ? (
				<div
					id={panelId}
					className="gt-paper absolute inset-x-0 top-full z-30 mt-3 max-h-[26rem] overflow-y-auto rounded-[24px] p-2 shadow-2xl"
				>
					{looking ? (
						<p className="flex items-center gap-2 px-6 py-3 text-sm text-[var(--on-muted)]">
							<Spinner className="h-4 w-4 text-[var(--color-ink)]" />
							Asking the Census Geocoder…
						</p>
					) : null}

					{suggestions.length > 0 ? (
						<div className="px-3 pb-3 pt-3">
							<p className="gt-label text-[var(--on-muted)]">From the Census Geocoder, live</p>
							<ul className="mt-1">
								{suggestions.map((suggestion) => (
									<li key={suggestion.address}>
										<button
											type="button"
											onClick={() => take(suggestion.address)}
											className="w-full rounded-2xl px-3 py-2 text-left hover:bg-[color-mix(in_srgb,var(--color-ink)_7%,transparent)]"
										>
											<span className="block text-sm font-semibold">{suggestion.address}</span>
											<span className="block text-xs text-[var(--on-muted)]">{suggestion.note}</span>
										</button>
									</li>
								))}
							</ul>
						</div>
					) : null}

					{matches.length > 0 ? (
						<div className="px-3 pb-2 pt-3">
							<p className="gt-label text-[var(--on-muted)]">From this page&apos;s examples</p>
							<ul className="mt-1">
								{matches.map((suggestion) => (
									<li key={suggestion.address}>
										<button
											type="button"
											onClick={() => take(suggestion.address)}
											className="w-full rounded-2xl px-3 py-2 text-left hover:bg-[color-mix(in_srgb,var(--color-ink)_7%,transparent)]"
										>
											<span className="block text-sm font-semibold">{suggestion.address}</span>
											<span className="block text-xs text-[var(--on-muted)]">{suggestion.note}</span>
										</button>
									</li>
								))}
							</ul>
						</div>
					) : null}

					{nothingFound ? (
						<p className="px-6 py-3 text-sm text-[var(--on-muted)]">
							The Census Geocoder has no street-range entry for this yet. It completes nothing, so a street
							name has to be whole before it will answer.
						</p>
					) : null}
				</div>
			) : null}
		</div>
	);
}
