import { jiraJson, jiraServerUrl } from "./jira";
import { CliError } from "@/server/cli";
import type { JiraIssue, JqlData, JqlConfig } from "./manifest";

export type JiraRawIssue = {
  key: string;
  fields: {
    summary: string;
    status?: { name?: string };
    assignee?: { displayName?: string } | null;
  };
};

export function normalizeIssue(raw: JiraRawIssue, serverUrl: string): JiraIssue {
  const displayName = raw.fields.assignee?.displayName?.trim();
  return {
    key: raw.key,
    summary: raw.fields.summary,
    status: raw.fields.status?.name ?? "Unknown",
    assignee: displayName ? displayName : null,
    url: `${serverUrl}/browse/${raw.key}`,
  };
}

export async function fetchJql(config: JqlConfig): Promise<JqlData> {
  // jira-cli appends its own ORDER BY, so a trailing ORDER BY in the JQL is a syntax error.
  const jql = config.jql.replace(/\s+order\s+by\s+[\s\S]+$/i, "").trim();
  try {
    const raw = await jiraJson<JiraRawIssue[]>([
      "issue", "list", "-q", jql, "--order-by", "updated", "--paginate", `0:${config.limit}`,
    ]);
    const server = await jiraServerUrl();
    return { issues: raw.map((r) => normalizeIssue(r, server)) };
  } catch (err) {
    // jira-cli exits non-zero with this message when a query matches nothing.
    if (err instanceof CliError && /no result found/i.test(err.message)) {
      return { issues: [] };
    }
    throw err;
  }
}
