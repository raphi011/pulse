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

/**
 * Strip a trailing `ORDER BY` clause. jira-cli appends its own ORDER BY, so a trailing one
 * in the user's JQL is a syntax error. The match must ignore `order by` inside quoted string
 * literals (e.g. `summary ~ "sort order by date"`), so we blank quoted spans to a non-whitespace
 * sentinel (\0) — preserving indices, and non-whitespace so the clause's leading `\s+` can't span
 * across a blanked literal — before locating the clause, then cut the original at that index.
 */
export function stripTrailingOrderBy(jql: string): string {
  let masked = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < jql.length; i++) {
    const ch = jql[i];
    if (quote) {
      if (ch === "\\" && i + 1 < jql.length) {
        masked += "\0\0"; // blank the backslash and the char it escapes
        i++;
        continue;
      }
      masked += "\0";
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      masked += "\0";
      quote = ch;
    } else {
      masked += ch;
    }
  }
  const m = masked.match(/\s+order\s+by\s+[\s\S]+$/i);
  return (m ? jql.slice(0, m.index) : jql).trim();
}

export async function fetchJql(config: JqlConfig): Promise<JqlData> {
  const jql = stripTrailingOrderBy(config.jql);
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
