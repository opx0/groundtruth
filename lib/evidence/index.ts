export {
	coalesce,
	fieldsOf,
	fromQuery,
	haversine,
	isSealed,
	isSourced,
	KERNEL_VERSION,
	ReaderInvariant,
	seal,
	UnbrandedValue,
	urlFrom,
} from "./sourced";
export type {
	AbsentProvenance,
	AdapterVersion,
	ComputationInput,
	ComputationProvenance,
	Fetched,
	FieldProvenance,
	FieldReader,
	Formula,
	GeoPoint,
	JsonObject,
	JsonValue,
	KeysWhere,
	PayloadRef,
	Provenance,
	QueryProvenance,
	Sealed,
	Sourced,
	TransformName,
} from "./sourced";

export { AGENCY, emptyStore, KINDS, recordId, sameId, storeOf } from "./records";
export type {
	Built,
	EvidenceRecord,
	EvidenceStore,
	FemaFloodZoneRecord,
	GeocodeMatch,
	Kind,
	RecordId,
	RecordOf,
	SemsSiteRecord,
	SourceId,
	SourceOf,
} from "./records";

export { defineTemplate, fallback, isSlotRef, km, sentence } from "./templates";
export type {
	AnyRef,
	Clause,
	DisplayFormat,
	FieldRef,
	NumericKeys,
	SlotRef,
	SourcedKeys,
	Template,
	TemplateRegistry,
} from "./templates";

export { formatValue, KindMismatch, render, renderAll, trace, verify } from "./sentence";
export type { Placement, Sentence, Span, Trace, ValueTrace } from "./sentence";

export {
	complete,
	DEFAULT_POLICY,
	NoPayload,
	runSource,
	runSources,
	SourceFailure,
	storeOfSources,
} from "./source";
export type {
	Adapter,
	FailureCause,
	Locus,
	SourceIo,
	SourceMap,
	SourceOutcome,
	SourcePolicy,
	SourceUnavailable,
} from "./source";
