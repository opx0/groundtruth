import { SOURCE_DOCS, type SourceDoc } from "@/app/lib/sources";

export type SourceListProps = {
	readonly docs?: readonly SourceDoc[];
	readonly className?: string;
};

const HEADING = "Where every answer comes from";

const LEDE =
	"The host that gave each reply, the boundary it was asked within, and what every query parameter means. Read off a live report rather than from documentation, so it says what this application sends and not what it is supposed to send.";

function Seal({ count }: { readonly count: number }) {
	const radius = 44;
	const circumference = Math.round(2 * Math.PI * radius);

	return (
		<svg
			viewBox="0 0 120 120"
			className="h-28 w-28 shrink-0 text-[var(--color-sage)] opacity-70 motion-safe:animate-[spin_70s_linear_infinite] max-lg:hidden"
			aria-hidden="true"
		>
			<defs>
				<path
					id="gt-source-seal-path"
					fill="none"
					d={`M 60 60 m -${radius} 0 a ${radius} ${radius} 0 1 1 ${radius * 2} 0 a ${radius} ${radius} 0 1 1 -${radius * 2} 0`}
				/>
			</defs>
			<circle cx="60" cy="60" r="58" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.45" />
			<circle
				cx="60"
				cy="60"
				r="31"
				fill="none"
				stroke="currentColor"
				strokeWidth="1"
				strokeDasharray="3 6"
				opacity="0.6"
			/>
			<path
				d="M60 44v32M46 54l14-10 14 10"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
				opacity="0.7"
			/>
			<text fill="currentColor" fontSize="9">
				<textPath
					href="#gt-source-seal-path"
					startOffset="0"
					textLength={circumference}
					lengthAdjust="spacing"
				>
					{`· ${count} FEDERAL SYSTEMS · ONE ADDRESS ·`}
				</textPath>
			</text>
		</svg>
	);
}

function Chevron() {
	return (
		<span
			className="ml-auto mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--edge)] transition-transform duration-200 group-hover:text-[var(--color-beacon)] group-open:rotate-90 group-open:border-[var(--color-beacon)] group-open:text-[var(--color-beacon)]"
			aria-hidden="true"
		>
			<svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
				<path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
			</svg>
		</span>
	);
}

export function SourceList({ docs = SOURCE_DOCS, className }: SourceListProps) {
	return (
		<section id="sources" className={className}>
			<div className="flex items-end justify-between gap-8">
				<div>
					<h2 className="gt-display text-4xl sm:text-5xl">{HEADING}</h2>
					<p className="mt-3 max-w-2xl text-sm text-[var(--on-ground-muted)]">{LEDE}</p>
				</div>
				<Seal count={docs.length} />
			</div>

			<ol className="mt-10 list-none overflow-hidden rounded-[var(--radius-card)] border border-[var(--edge)]">
				{docs.map((doc, index) => (
					<li
						key={doc.agency}
						className={`relative overflow-hidden border-t border-[var(--edge)] first:border-t-0 ${
							index % 2 === 1 ? "bg-bark" : ""
						}`}
					>
						<details id={`source-${doc.id}`} className="group scroll-mt-24" open={index === 0}>
							<summary className="flex cursor-pointer list-none items-start gap-4 px-5 py-5 transition-colors hover:bg-moss/25 focus-visible:[outline-offset:-4px] sm:gap-6 sm:px-8 [&::-webkit-details-marker]:hidden">
								<span className="gt-index w-9 shrink-0 pt-1.5 tabular-nums">
									{String(index + 1).padStart(2, "0")}
								</span>
								<span className="min-w-0 flex-1">
									<h3 className="gt-display text-xl leading-tight sm:text-2xl">{doc.agency}</h3>
									<span className="mt-1.5 block text-sm text-[var(--on-ground-muted)]">
										{doc.answers}
									</span>
								</span>
								<Chevron />
							</summary>

							<div className="relative px-5 pb-8 sm:pl-[5.75rem] sm:pr-8">
								<span
									className="pointer-events-none absolute -bottom-14 right-3 select-none font-display text-[10rem] leading-none opacity-[0.06] sm:text-[15rem]"
									aria-hidden="true"
								>
									{String(index + 1).padStart(2, "0")}
								</span>

								<div className="relative grid gap-6">
									<dl className="grid gap-x-8 gap-y-2 sm:grid-cols-[auto_1fr]">
										<dt className="gt-label pt-1 text-[var(--on-ground-muted)]">Host</dt>
										<dd className="font-mono text-xs leading-6 break-all">{doc.host}</dd>
										<dt className="gt-label pt-1 text-[var(--on-ground-muted)]">Within</dt>
										<dd className="text-sm leading-6">{doc.boundary}</dd>
									</dl>

									<div className="gt-rule pt-5">
										<p className="gt-label text-[var(--on-ground-muted)]">Query parameters</p>
										<dl className="mt-4 grid gap-x-10 gap-y-5 sm:grid-cols-2">
											{doc.parameters.map((parameter) => (
												<div key={parameter.name}>
													<dt className="font-mono text-xs leading-5">{parameter.name}</dt>
													<dd className="mt-1 text-sm leading-6 text-[var(--on-ground-muted)]">
														{parameter.means}
													</dd>
												</div>
											))}
										</dl>
									</div>

									<a
										className="inline-flex w-fit items-center gap-2 text-sm underline decoration-dotted underline-offset-4"
										href={doc.docsUrl}
										rel="noreferrer"
										target="_blank"
									>
										The agency&apos;s own documentation
										<svg
											viewBox="0 0 24 24"
											className="h-3.5 w-3.5"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
											aria-hidden="true"
										>
											<path d="M7 17L17 7M9 7h8v8" strokeLinecap="round" strokeLinejoin="round" />
										</svg>
									</a>
								</div>
							</div>
						</details>
					</li>
				))}
			</ol>
		</section>
	);
}
