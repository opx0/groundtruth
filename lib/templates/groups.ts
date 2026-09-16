import { defineTemplate, sentence } from "@/lib/evidence/templates";

export const groupSharedIdentifier = defineTemplate("group", "group/shared-identifier@1", (field) => [
	sentence`${field("subject")} and ${field("otherSubject")} share one EPA facility registry ID, ${field("groupedBy")}.`,
]);

export const groupMemberCount = defineTemplate(
	"group",
	"group/member-count@1",
	(field) => [sentence`Records grouped under ${field("groupedBy")}: ${field("members")}.`],
	[{ slot: "members", atLeast: 2 }],
);

export const groupTemplates = [groupSharedIdentifier, groupMemberCount];
