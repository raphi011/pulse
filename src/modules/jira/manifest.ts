import { z } from "zod";

export const JQL_TYPE = "jira.jql";

// .describe() drives the config-form field label.
export const jqlConfigSchema = z.object({
  jql: z.string().min(1).describe("JQL"),
  limit: z.number().int().min(1).max(100).default(10).describe("Max issues"),
});
export type JqlConfig = z.infer<typeof jqlConfigSchema>;
export const jqlDefaultConfig: JqlConfig = {
  jql: "assignee = currentUser() AND resolution = EMPTY ORDER BY updated DESC",
  limit: 10,
};

export type StatusCategory = "todo" | "inprogress" | "done";

export type JiraIssue = {
  key: string;              // e.g. "CORE-123"
  summary: string;
  status: string;           // status display name
  statusCategory: StatusCategory;
  assignee: string | null;  // displayName, null if unassigned
  url: string;              // <origin>/browse/<KEY>
};
export type JqlData = { issues: JiraIssue[] };
