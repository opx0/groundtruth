export type BoundarySource = "echo" | "frs" | "sems" | "aqs" | "airnow" | "fema";

export type Boundary = {
	/** How the report words it in a sentence. */
	readonly label: string;
	/** Null when the boundary is not a radius, so nothing can draw an axis for it. */
	readonly meters: number | null;
};

export const BOUNDARIES: { readonly [S in BoundarySource]: Boundary } = {
	echo: { label: "5 miles", meters: 8046.72 },
	frs: { label: "the registry IDs this report looked up", meters: null },
	sems: { label: "5 miles", meters: 8046.72 },
	aqs: { label: "50 km", meters: 50_000 },
	airnow: { label: "the reporting area AirNow names", meters: null },
	fema: { label: "the mapped point", meters: null },
};

export type Radius = { readonly label: string; readonly meters: number };

/** A boundary that is a distance, or null for one that is not. */
export function radiusOf(source: string): Radius | null {
	const found = (BOUNDARIES as Readonly<Record<string, Boundary>>)[source];
	if (found === undefined || found.meters === null) return null;
	return { label: found.label, meters: found.meters };
}
