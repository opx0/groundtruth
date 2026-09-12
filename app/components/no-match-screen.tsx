type NoMatchScreenProps = {
	readonly onEdit: () => void;
};

/**
 * Screen for the no-match outcome.
 *
 * `docs/BRIEF.md` B10's fixture for this state, 9400 Clinton Dr, Houston, TX
 * 77029, is a real address that EPA lists facilities at -- the Census
 * Geocoder simply has no street-range entry that resolves it. The copy below
 * says that plainly: the limit is the geocoder's own address-range data, not
 * a finding about the place. It must never read as "this address does not
 * exist," and it says which parts of the address to add rather than asking
 * the reader to guess.
 */
export function NoMatchScreen({ onEdit }: NoMatchScreenProps) {
	return (
		<div className="mx-auto max-w-xl px-4 py-12 sm:py-16">
			<h1 className="text-2xl font-semibold">No match yet</h1>
			<p className="mt-4 text-sm">
				The Census Geocoder has no street-range entry that matches this address as typed. That is a gap in
				the geocoder&apos;s own address data, not a finding about whether the address exists.
			</p>
			<p className="mt-3 text-sm">
				Add the street number, street name, city, state, and ZIP code, exactly as they appear on mail sent to
				this address, and try again.
			</p>

			<button
				type="button"
				onClick={onEdit}
				className="mt-6 rounded-md bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
			>
				Edit the address
			</button>
		</div>
	);
}
