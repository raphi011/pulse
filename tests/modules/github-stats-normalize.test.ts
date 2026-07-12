import { describe, it, expect } from "vitest";
import { toStatsData, toHeatmapData, type RawContributions } from "@/modules/github-stats/stats";

const raw: RawContributions = {
  totalCommitContributions: 42,
  totalPullRequestContributions: 7,
  totalPullRequestReviewContributions: 5,
  totalIssueContributions: 3,
  contributionCalendar: {
    totalContributions: 57,
    weeks: [
      { contributionDays: [
        { date: "2026-07-06", contributionCount: 0, contributionLevel: "NONE" },
        { date: "2026-07-07", contributionCount: 4, contributionLevel: "SECOND_QUARTILE" },
      ] },
      { contributionDays: [
        { date: "2026-07-13", contributionCount: 12, contributionLevel: "FOURTH_QUARTILE" },
      ] },
    ],
  },
};

describe("toStatsData", () => {
  it("maps totals and flattens the calendar into a trend series", () => {
    expect(toStatsData(raw)).toEqual({
      commits: 42, prs: 7, reviews: 5, issues: 3, total: 57,
      trend: [
        { date: "2026-07-06", count: 0 },
        { date: "2026-07-07", count: 4 },
        { date: "2026-07-13", count: 12 },
      ],
    });
  });
});

describe("toHeatmapData", () => {
  it("keeps week columns and maps contribution levels to 0-4", () => {
    expect(toHeatmapData(raw)).toEqual({
      total: 57,
      weeks: [
        { days: [
          { date: "2026-07-06", count: 0, level: 0 },
          { date: "2026-07-07", count: 4, level: 2 },
        ] },
        { days: [
          { date: "2026-07-13", count: 12, level: 4 },
        ] },
      ],
    });
  });
});
