import type { CuratedGroup } from "@/app/lib/geocode-contract";
import { AddressField, type AddressLookup } from "./address-field";
import { BarLink, TopBar } from "./top-bar";
import { TornEdge } from "./band-heading";
import { GROUP_MARKS, LensMark, Spinner } from "./marks";
import { SourceOrbit } from "./orbit";
import { SourceList } from "./source-list";
import type { SearchError } from "@/app/lib/geocode-flow";

type SearchScreenProps = {
	readonly address: string;
	readonly pending: boolean;
	readonly error: SearchError | null;
	readonly groups: readonly CuratedGroup[];
	readonly lookup: AddressLookup;
	readonly onAddressChange: (address: string) => void;
	readonly onSubmit: () => void;
	readonly onExampleSelect: (address: string) => void;
};

const ERROR_TEXT: Record<SearchError, string> = {
	invalid: "Enter a street address.",
	unavailable: "The Census Geocoder is not responding right now. Try again in a moment.",
};

const LIMITS: readonly { readonly heading: string; readonly body: string }[] = [
	{
		heading: "It does not grade the home",
		body: "Six sources with six meanings do not add up to one number, and a number would be the first thing a reader trusted and the last thing we could defend.",
	},
	{
		heading: "A source that fails says so",
		body: "It is never quietly replaced with a cached or recorded answer. The card names what could not be reached and offers a retry.",
	},
	{
		heading: "Nothing found is not nothing there",
		body: "No matching records means the source returned nothing within the boundary it was asked about, which is a fact about the search and not about the address.",
	},
];

const QUESTIONS: readonly {
	readonly heading: string;
	readonly lines: readonly string[];
	readonly tone: string;
}[] = [
	{
		heading: "The air here",
		tone: "",
		lines: [
			"Today's index for the reporting area AirNow names, and the pollutant it is for.",
			"Recorded annual summaries from every monitor within 50 km, from EPA's Air Quality System.",
			"How far each monitor is, and that it measures its own location rather than this address.",
		],
	},
	{
		heading: "Water and flooding",
		tone: "gt-card-dark",
		lines: [
			"The flood zone letter FEMA maps at the point, and its subtype, shown in FEMA's own words.",
			"Whether the point sits inside the Special Flood Hazard Area.",
			"Which layer answered: FEMA's own, or the reduced-set copy, named on the card either way.",
		],
	},
	{
		heading: "Land once contaminated",
		tone: "gt-card-sand",
		lines: [
			"Superfund sites EPA's inventory lists within 5 miles of the mapped point.",
			"Which of them are on the final National Priorities List, and which are not.",
			"How far each one is, measured from the point rather than reported by the source.",
		],
	},
	{
		heading: "Industry next door",
		tone: "",
		lines: [
			"Regulated facilities EPA ECHO lists within 5 miles, and how many there are.",
			"Which carry a violation in ECHO's twelve-quarter compliance history.",
			"Formal enforcement actions, their dates, and the penalties on record.",
		],
	},
];

function Check() {
	return (
		<svg viewBox="0 0 20 20" aria-hidden="true" fill="currentColor">
			<path
				fillRule="evenodd"
				d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.7-9.7a1 1 0 00-1.4-1.4L9 10.2 7.7 8.9a1 1 0 00-1.4 1.4l2 2a1 1 0 001.4 0l4-4z"
				clipRule="evenodd"
			/>
		</svg>
	);
}

function Scene() {
	return (
		<div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
			<div
				className="absolute inset-0"
				style={{ background: "linear-gradient(to bottom, var(--color-canopy) 35%, #1b4034 100%)" }}
			/>
			<div
				className="absolute bottom-[2%] right-[2%] h-[36rem] w-[36rem] max-lg:hidden"
				style={{ background: "radial-gradient(circle, rgba(237,195,43,0.16) 0%, transparent 62%)" }}
			/>
			<svg
				className="absolute inset-x-0 bottom-0 h-[64%] w-full"
				viewBox="0 0 1600 420"
				preserveAspectRatio="none"
			>
				<path d="M0 232 L210 118 L330 178 L520 52 L700 168 L880 86 L1080 190 L1290 104 L1460 196 L1600 140 L1600 420 L0 420Z" fill="#17382f" />
				<path d="M0 292 L180 206 L360 268 L560 168 L760 258 L960 186 L1160 272 L1380 194 L1600 268 L1600 420 L0 420Z" fill="#245044" />
				<path d="M0 352 L240 296 L470 344 L700 282 L940 342 L1180 290 L1420 346 L1600 306 L1600 420 L0 420Z" fill="#356e5a" />
			</svg>
		</div>
	);
}

function Ridge({ className }: { readonly className: string }) {
	return (
		<svg
			className={className}
			viewBox="0 0 1200 240"
			preserveAspectRatio="none"
			fill="none"
			stroke="var(--edge)"
			strokeWidth="2"
			aria-hidden="true"
		>
			<path d="M0 196 L180 96 L300 151 L470 36 L610 136 L760 66 L900 146 L1050 86 L1200 176" />
			<path d="M0 214 L180 124 L300 172 L470 72 L610 160 L760 98 L900 168 L1050 116 L1200 196" opacity="0.6" />
			<path d="M0 232 L150 172 L340 217 L520 137 L700 202 L880 152 L1060 207 L1200 162" opacity="0.4" />
		</svg>
	);
}

export function SearchScreen(props: SearchScreenProps) {
	const { address, pending, error, groups, lookup, onAddressChange, onSubmit, onExampleSelect } = props;
	const canSubmit = !pending;
	// The badge says what to do, so it does it: the first curated address.
	const first = groups[0]?.examples[0];

	return (
		<div className="flex flex-col">
			<section className="relative isolate pb-24 pt-6 sm:pb-32 sm:pt-10">
				<Scene />

				<div className="relative mx-auto w-full max-w-6xl px-5 sm:px-8">
					<TopBar>
						<BarLink href="#examples">Addresses</BarLink>
						<BarLink href="#questions">What it answers</BarLink>
						<BarLink href="#sources">Sources</BarLink>
					</TopBar>

					{first === undefined ? null : (
						<button
							type="button"
							disabled={pending}
							onClick={() => onExampleSelect(first.address)}
							aria-label={`Click any sentence, see the record. Start with ${first.address}.`}
							className="gt-seal absolute bottom-4 right-2 h-40 w-40 max-lg:hidden disabled:opacity-60 xl:right-6 xl:h-48 xl:w-48"
						>
							<svg viewBox="0 0 150 150" aria-hidden="true">
								<circle cx="75" cy="75" r="75" fill="var(--color-beacon)" />
								<circle cx="75" cy="75" r="56" fill="none" stroke="var(--color-ink)" strokeOpacity="0.25" strokeWidth="1" strokeDasharray="3 6" />
								<path id="gt-arc" d="M75,75 m-52,0 a52,52 0 1,1 104,0 a52,52 0 1,1 -104,0" fill="none" />
								<g className="gt-turning">
									<text fill="var(--color-ink)" fontSize="11.5" fontWeight="600" letterSpacing="1.2">
										<textPath href="#gt-arc" startOffset="3%">
											CLICK ANY SENTENCE · SEE THE RECORD ·
										</textPath>
									</text>
								</g>
								<path
									d="M67 75h16M77 69l6 6-6 6"
									fill="none"
									stroke="var(--color-ink)"
									strokeWidth="2.4"
									strokeLinecap="round"
									strokeLinejoin="round"
								/>
							</svg>
						</button>
					)}

					<p className="gt-hand mt-16 text-2xl sm:mt-24 sm:text-4xl">what the public record says</p>
					<h1 className="gt-display mt-1 max-w-[15ch] text-[clamp(3rem,9vw,7.5rem)] leading-[0.92]">
						the environmental record
						<span className="block text-[var(--color-frond)]">of one address</span>
					</h1>
					<p className="mt-8 max-w-xl text-base text-[var(--on-ground-muted)] sm:text-lg">
						Six federal systems, six search forms, and no way to ask any of them about one address. This asks
						all six and returns one report.
					</p>

					<form
						className="mt-10 max-w-2xl"
						onSubmit={(event) => {
							event.preventDefault();
							if (canSubmit) onSubmit();
						}}
					>
						<label htmlFor="address" className="gt-label block text-[var(--on-ground-muted)]">
							Street address
						</label>
						<div className="mt-2" />
						<AddressField
							address={address}
							pending={pending}
							groups={groups}
							lookup={lookup}
							browseHref="#examples"
							onAddressChange={onAddressChange}
							onPick={onExampleSelect}
						/>
						{error !== null ? (
							<p role="alert" className="mt-3 text-sm text-[var(--color-beacon)]">
								{ERROR_TEXT[error]}
							</p>
						) : null}
					</form>
				</div>

				<TornEdge fill="ground" className="absolute inset-x-0 bottom-0 h-8 sm:h-12" />
			</section>

			<div className="mx-auto w-full max-w-6xl px-5 pb-24 sm:px-8">
				<section className="mt-16">
					<h2 className="gt-display text-4xl sm:text-5xl">Six systems, one address</h2>
					<p className="mt-3 max-w-2xl text-sm text-[var(--on-ground-muted)]">
						Each of these has its own search form and its own vocabulary, and none of them can be asked about
						an address across all six. This asks all six with one point and a distance.
					</p>
					<SourceOrbit className="mt-8" />
				</section>

				<section id="examples" className="mt-16 scroll-mt-8">
					<h2 className="gt-display text-4xl">Start with one of these</h2>
					<p className="mt-3 max-w-2xl text-sm text-[var(--on-ground-muted)]">
						Public, non-residential addresses. Each was driven through this application against the live
						sources on 2026-09-17, and the line under it says what came back that day.
					</p>

					{groups.map((group, groupIndex) => {
						const Mark = GROUP_MARKS[group.heading] ?? LensMark;
						return (
							<div key={group.heading} className="mt-12">
								<h3 className="gt-label text-[var(--color-beacon)]">{group.heading}</h3>
								<ul className="mt-4 grid gap-4 sm:grid-cols-3">
									{group.examples.map((example, index) => {
										const tone = ["", "gt-card-dark", "gt-card-sand"][(groupIndex + index) % 3] ?? "";
										const number = String(groupIndex * 3 + index + 1).padStart(2, "0");
										return (
											<li key={example.address}>
												<button
													type="button"
													disabled={pending}
													onClick={() => onExampleSelect(example.address)}
													aria-busy={pending && example.address === address}
											className={`gt-card ${tone} relative flex h-full w-full flex-col overflow-hidden text-left transition-transform hover:-translate-y-1 disabled:opacity-40 aria-busy:opacity-100 aria-busy:ring-2 aria-busy:ring-[var(--color-beacon)]`}
												>
													<Mark className="gt-ghost-art" />
													<span className="gt-index relative">{number}</span>
													<span className="gt-display relative mt-3 block text-xl leading-snug">
														{example.address}
													</span>
													<span className="relative mt-3 block text-sm text-[var(--on-muted)]">
														{example.note}
													</span>
													<span className="relative mt-auto flex items-center justify-between gap-3 pt-6">
											{pending && example.address === address ? (
												<span className="flex items-center gap-2 text-xs text-[var(--on-muted)]">
													<Spinner className="h-3.5 w-3.5 text-[var(--color-beacon)]" />
													Asking the Census Geocoder…
												</span>
											) : (
												<span />
											)}
														<span className="gt-go" aria-hidden="true">
															<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
																<path d="M4 12h15M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
															</svg>
														</span>
													</span>
												</button>
											</li>
										);
									})}
								</ul>
							</div>
						);
					})}
				</section>

				<section id="questions" className="mt-24 scroll-mt-8">
					<h2 className="gt-display text-4xl sm:text-5xl">What the record can tell you</h2>
					<p className="mt-3 max-w-2xl text-sm text-[var(--on-ground-muted)]">
						Four questions, and the sentences the six systems actually answer them with. Every one opens to
						the field it was read from.
					</p>

					<ul className="mt-8 grid gap-4 lg:grid-cols-2">
						{QUESTIONS.map((question, index) => (
							<li key={question.heading} className={`gt-card ${question.tone} relative overflow-hidden`}>
								<span className="gt-watermark" aria-hidden="true">
									{String(index + 1).padStart(2, "0")}
								</span>
								<h3 className="gt-display relative text-3xl uppercase tracking-tight sm:text-4xl">
									{question.heading}
								</h3>
								<ul className="relative mt-5 flex flex-col gap-3">
									{question.lines.map((line) => (
										<li key={line} className="gt-check text-sm">
											<Check />
											<span>{line}</span>
										</li>
									))}
								</ul>
							</li>
						))}
					</ul>
				</section>

				<section className="mt-24">
					<h2 className="gt-display text-4xl">What it does not do</h2>
					<ul className="mt-6 grid gap-4 sm:grid-cols-3">
						{LIMITS.map((limit) => (
							<li key={limit.heading} className="gt-card">
								<h3 className="gt-display text-2xl leading-tight">{limit.heading}</h3>
								<p className="mt-3 text-sm text-[var(--on-card-muted)]">{limit.body}</p>
							</li>
						))}
					</ul>
				</section>

				<SourceList className="mt-24 scroll-mt-8" />

				<footer className="relative mt-24 overflow-hidden pt-12">
					<Ridge className="pointer-events-none absolute inset-x-0 bottom-0 h-24 opacity-50" />
					<p className="gt-rule relative max-w-3xl pt-5 text-xs text-[var(--on-ground-muted)]">
						This address is sent to the US Census Bureau to find a point on the map, and nowhere else. Once a
						match is confirmed, every other source in this tool is asked with that point and a distance only --
						never with the address you typed.
					</p>
				</footer>
			</div>
		</div>
	);
}
