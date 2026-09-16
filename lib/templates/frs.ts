import type { Template } from "@/lib/evidence/templates";
import { day, defineTemplate, sentence } from "@/lib/evidence/templates";

export const frsFacilityIdentity = defineTemplate("frs-facility", "frs-facility/identity@1", (field) => [
	sentence`EPA's facility registry lists ${field("subject")} under registry ID ${field("registryId")}.`,
	sentence`The latest update date on any of its programme-interest rows is ${day(field("sourceUpdatedAt"))}.`,
]);

export const frsFacilityCrossReference = defineTemplate("frs-facility", "frs-facility/cross-reference@1", (field) => [
	sentence`EPA's facility registry carries the name ${field("subject")} for registry ID ${field("registryId")}.`,
]);

export const frsTemplates: readonly [Template<"frs-facility">, ...Template<"frs-facility">[]] = [frsFacilityIdentity, frsFacilityCrossReference];
