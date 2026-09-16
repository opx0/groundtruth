type NoMatchScreenProps = {
	readonly onEdit: () => void;
};

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
