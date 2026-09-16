import type { CuratedExample } from "@/app/lib/geocode-contract";
import type { SearchError } from "@/app/lib/geocode-flow";

type SearchScreenProps = {
	readonly address: string;
	readonly pending: boolean;
	readonly error: SearchError | null;
	readonly examples: readonly CuratedExample[];
	readonly onAddressChange: (address: string) => void;
	readonly onSubmit: () => void;
	readonly onExampleSelect: (address: string) => void;
};

const ERROR_TEXT: Record<SearchError, string> = {
	invalid: "Enter a street address.",
	unavailable: "The Census Geocoder is not responding right now. Try again in a moment.",
};

export function SearchScreen(props: SearchScreenProps) {
	const { address, pending, error, examples, onAddressChange, onSubmit, onExampleSelect } = props;
	const canSubmit = address.trim().length > 0 && !pending;

	return (
		<div className="mx-auto max-w-xl px-4 py-12 sm:py-16">
			<h1 className="text-2xl font-semibold">Ground Truth</h1>
			<p className="mt-2 text-sm opacity-70">
				Type a US address. Read what the public environmental record says about it.
			</p>

			<form
				className="mt-8"
				onSubmit={(event) => {
					event.preventDefault();
					if (canSubmit) onSubmit();
				}}
			>
				<label htmlFor="address" className="block text-sm font-medium">
					Street address
				</label>
				<div className="mt-2 flex flex-col gap-2 sm:flex-row">
					<input
						id="address"
						name="address"
						type="text"
						inputMode="text"
						autoComplete="off"
						placeholder="9311 E Ave P, Houston, TX 77012"
						className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-base text-black outline-none focus:border-black/40 disabled:opacity-60 dark:border-white/20 dark:bg-black/20 dark:text-white"
						value={address}
						disabled={pending}
						onChange={(event) => onAddressChange(event.target.value)}
					/>
					<button
						type="submit"
						disabled={!canSubmit}
						className="shrink-0 rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
					>
						{pending ? "Searching…" : "Find this address"}
					</button>
				</div>
				{error !== null ? (
					<p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
						{ERROR_TEXT[error]}
					</p>
				) : null}
			</form>

			<div className="mt-8">
				<p className="text-sm font-medium">Try one of these</p>
				<ul className="mt-2 flex flex-col gap-2">
					{examples.map((example) => (
						<li key={example.address}>
							<button
								type="button"
								disabled={pending}
								onClick={() => onExampleSelect(example.address)}
								className="w-full rounded-md border border-black/10 px-3 py-2 text-left text-sm hover:border-black/30 disabled:opacity-40 dark:border-white/15 dark:hover:border-white/30"
							>
								<span className="font-medium">{example.address}</span>
								<span className="block opacity-70">{example.note}</span>
							</button>
						</li>
					))}
				</ul>
			</div>

			<p className="mt-10 border-t border-black/10 pt-4 text-xs opacity-70 dark:border-white/15">
				This address is sent to the US Census Bureau to find a point on the map, and nowhere else. Once a
				match is confirmed, every other source in this tool is asked with that point and a distance only --
				never with the address you typed.
			</p>
		</div>
	);
}
