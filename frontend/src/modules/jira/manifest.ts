export const JQL_TYPE = "jira.jql";

// Config shape mirrors the Go manifest (form is generated server-side).
export interface JqlConfig {
  jql: string;
  limit: number;
}

export type JiraIssue = {
  key: string;              // e.g. "CORE-123"
  summary: string;
  status: string;           // status display name
  assignee: string | null;  // displayName, null if unassigned
  url: string;              // <server>/browse/<KEY>
};
export type JqlData = { issues: JiraIssue[] };
