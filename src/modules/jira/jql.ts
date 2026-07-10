import "server-only";
import { jiraJson } from "./jira";
import type { JiraIssue, JqlData, JqlConfig, StatusCategory } from "./manifest";

export type JiraRawIssue = {
  key: string;
  self: string;
  fields: {
    summary: string;
    status?: { name?: string; statusCategory?: { key?: string } };
    assignee?: { displayName?: string } | null;
  };
};

function toCategory(key: string | undefined): StatusCategory {
  if (key === "done") return "done";
  if (key === "indeterminate") return "inprogress";
  return "todo"; // "new" or anything unexpected
}

function browseUrl(self: string, key: string): string {
  return `${new URL(self).origin}/browse/${key}`;
}

export function normalizeIssue(raw: JiraRawIssue): JiraIssue {
  return {
    key: raw.key,
    summary: raw.fields.summary,
    status: raw.fields.status?.name ?? "Unknown",
    statusCategory: toCategory(raw.fields.status?.statusCategory?.key),
    assignee: raw.fields.assignee?.displayName ?? null,
    url: browseUrl(raw.self, raw.key),
  };
}

export async function fetchJql(config: JqlConfig): Promise<JqlData> {
  const raw = await jiraJson<{ issues: JiraRawIssue[] }>([
    "issue", "list", "-q", config.jql, "--paginate", `0:${config.limit}`,
  ]);
  return { issues: raw.issues.map(normalizeIssue) };
}
