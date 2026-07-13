import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/modules/jira/jira", () => ({
  runJira: vi.fn(), jiraJson: vi.fn(), jiraServerUrl: vi.fn(() => "https://x.atlassian.net"),
}));
import { jiraJson } from "@/modules/jira/jira";
import { CliError } from "@/server/cli";
import { normalizeIssue, fetchJql, stripTrailingOrderBy, type JiraRawIssue } from "@/modules/jira/jql";
import fixture from "../fixtures/jira/jql.json";

const mockJson = jiraJson as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => { mockJson.mockReset(); });

describe("normalizeIssue", () => {
  it("maps a raw issue to JiraIssue with a browse URL from the server base", () => {
    expect(normalizeIssue(fixture[0] as JiraRawIssue, "https://x.atlassian.net")).toEqual({
      key: "CORE-101",
      summary: "Fix seizure edge case",
      status: "In Progress",
      assignee: "Raphael Gruber",
      url: "https://x.atlassian.net/browse/CORE-101",
    });
  });

  it("normalizes an empty-string assignee to null", () => {
    expect(normalizeIssue(fixture[1] as JiraRawIssue, "https://x.atlassian.net").assignee).toBeNull();
  });

  it("normalizes a null assignee to null", () => {
    expect(normalizeIssue(fixture[2] as JiraRawIssue, "https://x.atlassian.net").assignee).toBeNull();
  });
});

describe("stripTrailingOrderBy", () => {
  it("strips a trailing ORDER BY clause", () => {
    expect(stripTrailingOrderBy("project = CORE ORDER BY updated DESC")).toBe("project = CORE");
  });

  it("is case-insensitive and trims", () => {
    expect(stripTrailingOrderBy("project = CORE order by created")).toBe("project = CORE");
  });

  it("leaves JQL without an ORDER BY untouched", () => {
    expect(stripTrailingOrderBy("project = CORE AND status = Open")).toBe("project = CORE AND status = Open");
  });

  it("does NOT strip an 'order by' inside a double-quoted literal", () => {
    expect(stripTrailingOrderBy('summary ~ "sort order by date"')).toBe('summary ~ "sort order by date"');
  });

  it("does NOT strip an 'order by' inside a single-quoted literal", () => {
    expect(stripTrailingOrderBy("summary ~ 'order by clause'")).toBe("summary ~ 'order by clause'");
  });

  it("strips the real trailing clause but keeps a quoted one", () => {
    expect(stripTrailingOrderBy('summary ~ "order by date" ORDER BY updated')).toBe('summary ~ "order by date"');
  });

  it("handles an escaped quote inside a literal without ending the string early", () => {
    expect(stripTrailingOrderBy('summary ~ "a \\" order by b" ORDER BY updated'))
      .toBe('summary ~ "a \\" order by b"');
  });
});

describe("fetchJql", () => {
  it("maps the top-level array and passes JQL with --order-by updated (no --raw here)", async () => {
    mockJson.mockResolvedValueOnce(fixture);
    const data = await fetchJql({ jql: "project = CORE", limit: 25 });
    expect(data.issues).toHaveLength(3);
    expect(data.issues[0].url).toBe("https://x.atlassian.net/browse/CORE-101");
    expect(mockJson.mock.calls[0][0]).toEqual(
      ["issue", "list", "-q", "project = CORE", "--order-by", "updated", "--paginate", "0:25"],
    );
  });

  it("strips a trailing ORDER BY clause from the user's JQL", async () => {
    mockJson.mockResolvedValueOnce(fixture);
    await fetchJql({ jql: "project = CORE ORDER BY updated DESC", limit: 10 });
    const args = mockJson.mock.calls[0][0] as string[];
    expect(args[3]).toBe("project = CORE");
  });

  it("returns an empty list when jira-cli reports no results", async () => {
    mockJson.mockRejectedValueOnce(
      new CliError('No result found for given query in project "CORE"', "failed"),
    );
    await expect(fetchJql({ jql: "project = CORE", limit: 10 })).resolves.toEqual({ issues: [] });
  });

  it("rethrows other CLI errors", async () => {
    mockJson.mockRejectedValueOnce(new CliError("Not authenticated — run `jira init`", "auth"));
    await expect(fetchJql({ jql: "project = CORE", limit: 10 })).rejects.toThrow(/Not authenticated/);
  });
});
