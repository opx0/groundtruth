import type { JsonValue } from "@/lib/evidence";
import type { WireComputationInput, WirePayloadRef, WireProvenance } from "@/app/lib/report-contract";
import type { TraceSelection } from "@/app/lib/report-flow";
import { traceView, type IdentifierRelation, type TraceRow, type TraceValueRow } from "@/app/lib/trace-view";

/**
 * Screen 4 of `docs/BRIEF.md` A2: what stands behind the span the reader
 * clicked. `app/lib/trace-view.ts` decides which of A3's rows this scope can
 * fill and what goes in each; this file is the rendering of that decision and
 * decides nothing else.
 *
 * TWO KINDS OF STRING ON THIS SCREEN, AND THE MARKUP KEEPS THEM APART. Every
 * `<dt>`, every `<h2>` and the one `<button>` is chrome: a label this component
 * wrote, none of which can become wrong because a government record changed.
 * Everything else -- every `<dd>`, every `<li>`, every span of the sentence --
 * is a string the server put on the wire: a rendered span, a field name, a raw
 * value, a dataset, an agency, a status enum as the kernel sent it. That split
 * is not a convention to be remembered, it is what
 * `tests/unit/app/trace-panel.test.ts` asserts: it collects the text of every
 * `<dt>` and checks the list against the enumerated chrome, and collects every
 * other text node and checks each one came off the wire.
 *
 * So there is no formatting here that composes a sentence. A3's rows read
 * "`non_npl_status_date` = `2022-02-08 00:00:00`, transform `normalize-date`",
 * and the temptation is to join those three wire strings into that one string.
 * This renders them as three labelled values instead. The reader gets the same
 * three facts; no component gets a template.
 *
 * WHAT A COUNT SENTENCE AND A STATUS SENTENCE OPEN. 27 of the report's 172
 * slotted spans resolve to a value with an empty `provenance` array -- every
 * `section` span and every `source` span. There is nothing wrong with them and
 * the panel is not empty for them: a count opens on the agency, the kind
 * counted, the boundary, and every record the count counted by kind and ID; a
 * status opens on the agency, the status enum, the retrieval time, and, when a
 * source could not be reached, the failure cause and the raw code it sent. The
 * grounding is the header, and the header is the first thing rendered.
 *
 * `docs/BRIEF.md` C2 is absent by construction: the only words this file writes
 * are the `CHROME` list below, and no colour here means a verdict -- one
 * palette, no severity, because ranking sources is the score this product
 * refuses to compute.
 */

/* -------------------------------------------------------------------------- */
/* Chrome                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Every string this component writes. The test greps the rendered panel and
 * asserts nothing outside this list survived the subtraction of the wire's own
 * strings, so this constant is the reviewable surface of "no component writes a
 * factual sentence".
 */
export const CHROME = {
	panel: "Trace",
	close: "Close",
	agency: "Agency",
	recordKind: "Record kind",
	source: "Source",
	thisRecord: "Record IDs",
	counted: "Records counted",
	grouped: "Records grouped",
	originalRecord: "Original record",
	boundary: "Boundary",
	status: "Status",
	cause: "Cause",
	code: "Code",
	retryAfter: "Retry after",
	groupedBy: "Grouped by",
	field: "Field",
	asShown: "As shown",
	normalized: "Normalized",
	dataset: "Dataset",
	rawField: "Raw field",
	rawValue: "Raw value",
	transform: "Transform",
	adapter: "Adapter",
	parameter: "Parameter",
	formula: "Formula",
	computedBy: "Computed by",
	input: "Input",
	value: "Value",
	payload: "Payload",
	sha256: "SHA-256",
	retrieved: "Retrieved",
	recordDate: "Record date",
	sourceUpdated: "Source updated",
	caveats: "Caveats",
	context: "Not shown in this sentence",
};

const RELATION_LABEL: { readonly [R in IdentifierRelation]: string } = {
	"this-record": CHROME.thisRecord,
	counted: CHROME.counted,
	grouped: CHROME.grouped,
};

/* -------------------------------------------------------------------------- */
/* Leaves                                                                     */
/* -------------------------------------------------------------------------- */

/** A raw value as the wire sent it. A string is shown as itself; anything else as its JSON, which is what it is. */
function jsonText(value: JsonValue): string {
	return typeof value === "string" ? value : JSON.stringify(value);
}

/** One labelled value: `dt` is chrome, `dd` is the wire. Nothing on this screen breaks that rule. */
function Field({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
	return (
		<div className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1 py-0.5 max-sm:grid-cols-1">
			<dt className="text-xs uppercase tracking-wide opacity-60">{label}</dt>
			<dd className="min-w-0 break-words text-sm">{children}</dd>
		</div>
	);
}

function Payload({ payload }: { readonly payload: WirePayloadRef }) {
	return (
		<dl className="mt-1 border-l border-black/10 pl-3 dark:border-white/15">
			<Field label={CHROME.payload}>
				<span className="break-all font-mono text-xs">{payload.url}</span>
			</Field>
			<Field label={CHROME.sha256}>
				<span className="break-all font-mono text-xs">{payload.sha256}</span>
			</Field>
			<Field label={CHROME.retrieved}>{payload.retrievedAt}</Field>
		</dl>
	);
}

function ComputationInput({ input }: { readonly input: WireComputationInput }) {
	return (
		<div data-input={input.name} className="mt-2 border-l border-black/10 pl-3 dark:border-white/15">
			<dl>
				<Field label={CHROME.input}>{input.name}</Field>
				<Field label={CHROME.value}>{jsonText(input.value)}</Field>
			</dl>
			{input.provenance.map((entry, index) => (
				<Provenance key={index} provenance={entry} />
			))}
		</div>
	);
}

/**
 * One provenance entry. The arm's own discriminant is on `data-provenance`
 * rather than spelled out in a word of ours: `absent` is the wire saying the
 * dataset has no such field, and the row shows the dataset and the field with
 * no value line under it, which is that fact rendered rather than restated.
 */
function Provenance({ provenance }: { readonly provenance: WireProvenance }) {
	if (provenance.kind === "computation") {
		return (
			<div data-provenance="computation" className="mt-2">
				<dl>
					<Field label={CHROME.formula}>{provenance.formula}</Field>
					<Field label={CHROME.computedBy}>{provenance.computedBy}</Field>
				</dl>
				{provenance.inputs.map((input, index) => (
					<ComputationInput key={`${input.name}:${index}`} input={input} />
				))}
			</div>
		);
	}
	if (provenance.kind === "query") {
		return (
			<div data-provenance="query" className="mt-2">
				<dl>
					<Field label={CHROME.parameter}>{provenance.parameter}</Field>
					<Field label={CHROME.value}>{jsonText(provenance.value)}</Field>
					<Field label={CHROME.adapter}>{provenance.adapterVersion}</Field>
				</dl>
				<Payload payload={provenance.payload} />
			</div>
		);
	}
	return (
		<div data-provenance={provenance.kind} className="mt-2">
			<dl>
				<Field label={CHROME.dataset}>{provenance.dataset}</Field>
				<Field label={CHROME.rawField}>
					<span className="font-mono text-xs">{provenance.sourceField}</span>
				</Field>
				{provenance.kind === "field" ? <Field label={CHROME.rawValue}>{jsonText(provenance.rawValue)}</Field> : null}
				{provenance.kind === "field" ? <Field label={CHROME.transform}>{provenance.transform}</Field> : null}
				<Field label={CHROME.adapter}>{provenance.adapterVersion}</Field>
			</dl>
			<Payload payload={provenance.payload} />
		</div>
	);
}

/** A3's rows 4 to 8: one displayed value, what it was read from, and how. */
function Value({ value, label }: { readonly value: TraceValueRow; readonly label: string }) {
	return (
		<div
			data-row="value"
			data-field={value.field}
			data-presence={value.presence}
			className={
				value.presence === "clicked"
					? "mt-3 rounded-md border border-black/20 p-3 dark:border-white/30"
					: "mt-3 rounded-md border border-black/10 p-3 dark:border-white/15"
			}
		>
			<dl>
				<Field label={label}>
					<span className="font-mono text-xs">{value.field}</span>
				</Field>
				{value.displayed === null ? null : <Field label={CHROME.asShown}>{value.displayed}</Field>}
				<Field label={CHROME.normalized}>{jsonText(value.normalized)}</Field>
			</dl>
			{value.provenance.map((entry, index) => (
				<Provenance key={index} provenance={entry} />
			))}
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/* The rows                                                                   */
/* -------------------------------------------------------------------------- */

function Row({ row }: { readonly row: TraceRow }) {
	switch (row.row) {
		case "agency-and-kind":
			return (
				<div data-row="agency-and-kind">
					<dl>
						{row.agency === null ? null : <Field label={CHROME.agency}>{row.agency}</Field>}
						{row.recordKind === null ? null : <Field label={CHROME.recordKind}>{row.recordKind}</Field>}
						{row.source === null ? null : <Field label={CHROME.source}>{row.source}</Field>}
					</dl>
				</div>
			);
		case "record-ids":
			return (
				<div data-row="record-ids" data-relation={row.relation}>
					<dl>
						<Field label={RELATION_LABEL[row.relation]}>
							<ul>
								{row.ids.map((id) => (
									<li key={`${id.label}:${id.value}`} className="flex flex-wrap items-baseline gap-x-2">
										<span className="font-mono text-xs opacity-70">{id.label}</span>
										<span className="font-mono text-xs">{id.value}</span>
									</li>
								))}
							</ul>
						</Field>
					</dl>
				</div>
			);
		case "original-record":
			return (
				<div data-row="original-record">
					<dl>
						<Field label={CHROME.originalRecord}>
							{typeof row.value.normalized === "string" ? (
								<a className="break-all underline" href={row.value.normalized} rel="noreferrer" target="_blank">
									{row.value.normalized}
								</a>
							) : (
								jsonText(row.value.normalized)
							)}
						</Field>
					</dl>
					{row.value.provenance.map((entry, index) => (
						<Provenance key={index} provenance={entry} />
					))}
				</div>
			);
		case "boundary":
			return (
				<div data-row="boundary">
					<dl>
						<Field label={CHROME.boundary}>{row.boundary}</Field>
					</dl>
					{row.query === null ? null : <Provenance provenance={row.query} />}
				</div>
			);
		case "outcome":
			return (
				<div data-row="outcome">
					<dl>
						<Field label={CHROME.status}>{row.status}</Field>
						{row.cause === null ? null : <Field label={CHROME.cause}>{row.cause}</Field>}
						{row.rawCode === null ? null : <Field label={CHROME.code}>{jsonText(row.rawCode)}</Field>}
						{row.retryAfter === null ? null : <Field label={CHROME.retryAfter}>{row.retryAfter}</Field>}
					</dl>
				</div>
			);
		case "grouped-by":
			return (
				<div data-row="grouped-by">
					<dl>
						<Field label={CHROME.groupedBy}>
							<span className="font-mono text-xs">{row.field}</span>
						</Field>
					</dl>
				</div>
			);
		case "value":
			return <Value value={row.value} label={CHROME.field} />;
		case "record-date":
			return <Value value={row.value} label={CHROME.recordDate} />;
		case "source-updated":
			return <Value value={row.value} label={CHROME.sourceUpdated} />;
		case "retrieved":
			return (
				<div data-row="retrieved">
					<dl>
						{row.at.map((at) => (
							<Field key={at} label={CHROME.retrieved}>
								{at}
							</Field>
						))}
						{row.adapters.map((adapter) => (
							<Field key={adapter} label={CHROME.adapter}>
								{adapter}
							</Field>
						))}
					</dl>
					{row.payloads.map((payload) => (
						<Payload key={`${payload.url}:${payload.sha256}`} payload={payload} />
					))}
				</div>
			);
		case "caveats":
			return (
				<div data-row="caveats">
					<dl>
						<Field label={CHROME.caveats}>
							<ul className="flex flex-col gap-1">
								{row.caveats.map((caveat) => (
									<li key={caveat}>{caveat}</li>
								))}
							</ul>
						</Field>
					</dl>
				</div>
			);
	}
}

/* -------------------------------------------------------------------------- */
/* The panel                                                                  */
/* -------------------------------------------------------------------------- */

export type TracePanelProps = {
	/**
	 * What the reader clicked: the sentence as the report route sent it, and
	 * which of its spans. `TraceSelection` is `app/lib/report-flow.ts`'s type,
	 * the same one `OpenTrace` produces and `report-screen.tsx` holds, so the
	 * seam has one definition and the panel does not restate it.
	 */
	readonly selection: TraceSelection;
	readonly onClose: () => void;
};

export function TracePanel({ selection, onClose }: TracePanelProps) {
	const view = traceView(selection.sentence, selection.spanIndex);
	if (view === null) return null;

	// Where the values this sentence does not show begin, found before the map
	// rather than tracked through it: a variable reassigned during render is a
	// second source of truth for the same thing the rows already say.
	const firstContext = view.rows.findIndex((row) => row.row === "value" && row.value.presence === "context");

	return (
		<aside
			role="dialog"
			aria-label={CHROME.panel}
			data-scope={view.scope}
			data-template={view.templateId}
			className="flex h-full flex-col overflow-y-auto border-l border-black/10 bg-white p-4 dark:border-white/15 dark:bg-black sm:p-6"
		>
			<div className="flex items-baseline justify-between gap-4">
				<h2 className="text-lg font-semibold">{CHROME.panel}</h2>
				<button
					type="button"
					onClick={onClose}
					className="rounded-md border border-black/15 px-3 py-1 text-sm dark:border-white/20"
				>
					{CHROME.close}
				</button>
			</div>

			<p className="mt-4 text-base">
				{view.spans.map((span, index) => (
					<span
						key={`${view.templateId}:${index}`}
						data-field={span.slot === null ? undefined : span.slot.field}
						data-clicked={index === view.clickedSpan ? "true" : undefined}
						className={index === view.clickedSpan ? "bg-black/10 dark:bg-white/20" : undefined}
					>
						{span.text}
					</span>
				))}
			</p>

			<div className="mt-4 flex flex-col gap-2">
				{view.rows.map((row, index) => (
					<div key={`${row.row}:${index}`}>
						{index === firstContext ? (
							<h3 className="mt-4 text-xs uppercase tracking-wide opacity-60">{CHROME.context}</h3>
						) : null}
						<Row row={row} />
					</div>
				))}
			</div>
		</aside>
	);
}

/**
 * The panel as `app/components/report-screen.tsx`'s `renderTrace` wants it:
 * a selection and a close callback. Structural rather than an import of that
 * screen's own type, so neither file has to be edited when the other moves.
 */
export function renderTracePanel(selection: TraceSelection, close: () => void) {
	return <TracePanel selection={selection} onClose={close} />;
}
