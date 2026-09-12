/**
 * Origin templates: the geocode match, per docs/BRIEF.md A2 screen 2.
 *
 *   Matched: 9311 E AVE P, HOUSTON, TX, 77012. The point sits on the 9301 to
 *   9399 block, street side L, interpolated by the Census Geocoder along TIGER
 *   line 96085986. It marks the block, not the parcel.
 *
 * The block range is the honest precision signal: the Census response carries
 * no match type and no confidence score, so the report shows what is actually
 * there. The street side prints as the Census sent it, "L" or "R", because
 * mapping it to "left" would be this codebase inventing a vocabulary the
 * source does not use.
 *
 * "It marks the block, not the parcel" is connective text inside a clause that
 * carries references, so the block-not-parcel notice cannot outlive the range
 * it is about: if the range drops, so does the notice.
 */

import { defineTemplate, sentence } from "@/lib/evidence/templates";

export const originMatch = defineTemplate("origin", "origin/match@1", (field) => [
	sentence`Matched: ${field("matchedAddress")}.`,
	sentence`The point sits on the ${field("blockFrom")} to ${field("blockTo")} block, street side ${field("streetSide")}, interpolated by the Census Geocoder along TIGER line ${field("tigerLineId")}. It marks the block, not the parcel.`,
]);

/** The mapped point itself, for the confirm screen's coordinate line. */
export const originPoint = defineTemplate("origin", "origin/point@1", (field) => [
	sentence`Mapped point: ${field("latitude")}, ${field("longitude")}.`,
]);

export const originTemplates = [originMatch, originPoint];
