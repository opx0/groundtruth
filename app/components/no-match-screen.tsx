import { TopBar } from "./top-bar";
type NoMatchScreenProps = {
	readonly onEdit: () => void;
};

export function NoMatchScreen({ onEdit }: NoMatchScreenProps) {
	return (
		<div className="mx-auto w-full max-w-2xl px-5 pb-24 pt-10 sm:px-8 sm:pt-16">
			<TopBar>
				<button type="button" onClick={onEdit} className="gt-ghost">
					Search another address
				</button>
			</TopBar>

			<h1 className="gt-display mt-12 text-4xl sm:text-5xl">No match yet</h1>
			<p className="mt-6 max-w-xl text-sm text-[var(--on-ground-muted)]">
				The Census Geocoder has no street-range entry that matches this address as typed. That is a gap in
				the geocoder&apos;s own address data, not a finding about whether the address exists.
			</p>
			<p className="mt-3 max-w-xl text-sm text-[var(--on-ground-muted)]">
				Add the street number, street name, city, state, and ZIP code, exactly as they appear on mail sent to
				this address, and try again.
			</p>

			<button
				type="button"
				onClick={onEdit}
				className="gt-pill mt-8"
			>
				Edit the address
			</button>
		</div>
	);
}
