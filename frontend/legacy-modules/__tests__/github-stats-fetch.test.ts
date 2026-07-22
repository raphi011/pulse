import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/modules/github/gh", () => ({ runGh: vi.fn(), ghJson: vi.fn() }));
import { runGh } from "@/modules/github/gh";
import { fetchSummary, fetchHeatmap } from "@/modules/github-stats/stats";

const mockRun = runGh as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => { mockRun.mockReset(); });

const okBody = JSON.stringify({
  data: { viewer: { contributionsCollection: {
    totalCommitContributions: 10,
    totalPullRequestContributions: 2,
    totalPullRequestReviewContributions: 1,
    totalIssueContributions: 0,
    contributionCalendar: {
      totalContributions: 13,
      weeks: [{ contributionDays: [
        { date: "2026-07-07", contributionCount: 4, contributionLevel: "SECOND_QUARTILE" },
      ] }],
    },
  } } },
});

describe("fetchSummary", () => {
  it("calls gh api graphql with the contributions query and returns StatsData", async () => {
    mockRun.mockResolvedValueOnce(okBody);
    const data = await fetchSummary({ timeframe: "30d" });
    expect(data).toEqual({
      commits: 10, prs: 2, reviews: 1, issues: 0, total: 13,
      trend: [{ date: "2026-07-07", count: 4 }],
    });
    const args = mockRun.mock.calls[0][0] as string[];
    expect(args[0]).toBe("api");
    expect(args[1]).toBe("graphql");
    expect(args.join(" ")).toContain("contributionsCollection");
    expect(args.some((a) => a.startsWith("from="))).toBe(true);
    expect(args.some((a) => a.startsWith("to="))).toBe(true);
  });
});

describe("fetchHeatmap", () => {
  it("returns HeatmapData with mapped levels", async () => {
    mockRun.mockResolvedValueOnce(okBody);
    const data = await fetchHeatmap({});
    expect(data.total).toBe(13);
    expect(data.weeks[0].days[0]).toEqual({ date: "2026-07-07", count: 4, level: 1 });
  });
});

describe("GraphQL error surfacing", () => {
  it("throws when the response body carries a GraphQL errors[] array", async () => {
    mockRun.mockResolvedValueOnce(JSON.stringify({ errors: [{ message: "Bad credentials" }] }));
    await expect(fetchSummary({ timeframe: "7d" })).rejects.toThrow("Bad credentials");
  });

  it("throws on non-JSON output", async () => {
    mockRun.mockResolvedValueOnce("not json");
    await expect(fetchSummary({ timeframe: "7d" })).rejects.toThrow();
  });
});
