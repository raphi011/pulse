import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/modules/jira/jira", () => ({ runJira: vi.fn(), jiraJson: vi.fn() }));
import { jiraJson } from "@/modules/jira/jira";
import { normalizeIssue, fetchJql, type JiraRawIssue } from "@/modules/jira/jql";
import fixture from "../fixtures/jira/jql.json";

const mockJson = jiraJson as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => { mockJson.mockReset(); });

const rawInProgress = fixture.issues[0] as JiraRawIssue;

describe("normalizeIssue", () => {
  it("maps a raw issue to JiraIssue with a browse URL", () => {
    expect(normalizeIssue(rawInProgress)).toEqual({
      key: "CORE-101",
      summary: "Fix seizure edge case",
      status: "In Progress",
      statusCategory: "inprogress",
      assignee: "Raphael Gruber",
      url: "https://acme-jira.atlassian.net/browse/CORE-101",
    });
  });

  it("maps statusCategory keys new/indeterminate/done to todo/inprogress/done", () => {
    expect(normalizeIssue(fixture.issues[1] as JiraRawIssue).statusCategory).toBe("todo");
    expect(normalizeIssue(fixture.issues[2] as JiraRawIssue).statusCategory).toBe("done");
  });

  it("returns null assignee when unassigned", () => {
    expect(normalizeIssue(fixture.issues[1] as JiraRawIssue).assignee).toBeNull();
  });
});

describe("fetchJql", () => {
  it("runs the configured JQL with a paginate limit and normalizes every issue", async () => {
    mockJson.mockResolvedValueOnce(fixture);
    const data = await fetchJql({ jql: "project = CORE", limit: 25 });
    expect(data.issues).toHaveLength(3);
    expect(data.issues[0].key).toBe("CORE-101");
    const args = mockJson.mock.calls[0][0] as string[];
    expect(args).toEqual(["issue", "list", "-q", "project = CORE", "--paginate", "0:25"]);
  });

  it("returns an empty list when no issues match", async () => {
    mockJson.mockResolvedValueOnce({ issues: [], total: 0 });
    await expect(fetchJql({ jql: "project = CORE", limit: 10 })).resolves.toEqual({ issues: [] });
  });
});
