import type { Template } from "@/lib/evidence";
import type { SubjectKey, TemplateRegistry } from "@/lib/evidence/templates";
import { airnowTemplates } from "./airnow";
import { aqsTemplates } from "./aqs";
import { echoTemplates } from "./echo";
import { femaTemplates } from "./fema";
import { frsTemplates } from "./frs";
import { semsTemplates } from "./sems";

export const TEMPLATES: TemplateRegistry = {
	"sems-site": semsTemplates,
	"echo-facility": echoTemplates,
	"frs-facility": frsTemplates,
	"aqs-monitor-summary": aqsTemplates,
	"airnow-observation": airnowTemplates,
	"fema-flood-zone": femaTemplates,
};

export const RECORD_TEMPLATES: readonly Template<SubjectKey>[] = Object.values(TEMPLATES).flat();
