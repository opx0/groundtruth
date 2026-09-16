import { defineTemplate, sentence } from "@/lib/evidence/templates";

export const sourceUnavailable = defineTemplate("source", "source/unavailable@1", (field) => [
	sentence`${field("agency")} could not be reached: ${field("cause")}.`,
	sentence`It answered ${field("rawCode")}.`,
	sentence`Retry after ${field("retryAfter")}.`,
]);

export const sourceRetrieved = defineTemplate("source", "source/retrieved@1", (field) => [
	sentence`${field("agency")} answered ${field("status")}, retrieved ${field("retrievedAt")}.`,
]);

export const sourceTemplates = [sourceUnavailable, sourceRetrieved];
