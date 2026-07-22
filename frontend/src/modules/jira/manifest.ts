import { z } from "zod";
import { defineManifest } from "@/modules/contracts";

export const JQL_TYPE = "jira.jql";

// .describe() drives the config-form field label.
export const jqlConfigSchema = z.object({
  jql: z.string().min(1).describe("JQL"),
  limit: z.number().int().min(1).max(100).default(10).describe("Max issues"),
});
export type JqlConfig = z.infer<typeof jqlConfigSchema>;
export const jqlDefaultConfig: JqlConfig = {
  jql: "assignee = currentUser() AND resolution = EMPTY",
  limit: 10,
};

export type JiraIssue = {
  key: string;              // e.g. "CORE-123"
  summary: string;
  status: string;           // status display name (no category available from `issue list --raw`)
  assignee: string | null;  // displayName, null if unassigned (empty string normalized to null)
  url: string;              // <server>/browse/<KEY>
};
export type JqlData = { issues: JiraIssue[] };

export const jqlManifest = defineManifest({
  type: JQL_TYPE, title: "Jira Query",
  configSchema: jqlConfigSchema, defaultConfig: jqlDefaultConfig,
  integration: "jira",
});
