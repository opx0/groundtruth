import { defineTemplate, sentence } from "@/lib/evidence/templates";

export const originMatch = defineTemplate("origin", "origin/match@1", (field) => [
	sentence`Matched: ${field("matchedAddress")}.`,
	sentence`The point sits on the ${field("blockFrom")} to ${field("blockTo")} block, street side ${field("streetSide")}, interpolated by the Census Geocoder along TIGER line ${field("tigerLineId")}. It marks the block, not the parcel.`,
]);

export const originPoint = defineTemplate("origin", "origin/point@1", (field) => [
	sentence`Mapped point: ${field("latitude")}, ${field("longitude")}.`,
]);

export const originTemplates = [originMatch, originPoint];
