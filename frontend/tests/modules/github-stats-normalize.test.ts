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
  it("keeps week columns and levels each day by quartiles of its own count", () => {
    expect(toHeatmapData(raw)).toEqual({
      total: 57,
      weeks: [
        { days: [
          { date: "2026-07-06", count: 0, level: 0 },
          { date: "2026-07-07", count: 4, level: 1 },
        ] },
        { days: [
          { date: "2026-07-13", count: 12, level: 2 },
        ] },
      ],
    });
  });

  it("is outlier-proof: a single huge day doesn't collapse normal days to level 1", () => {
    const counts = [1, 5, 10, 20, 40, 385];
    const days = counts.map((count, i) => ({
      date: `2026-01-0${i + 1}`,
      contributionCount: count,
      // GitHub's own level would bucket most of these as FIRST_QUARTILE against the 385 max.
      contributionLevel: "FIRST_QUARTILE" as const,
    }));
    const outlierRaw: RawContributions = {
      ...raw,
      contributionCalendar: { totalContributions: 461, weeks: [{ contributionDays: days }] },
    };
    // Quartiles of the positive counts spread the days across levels instead.
    const levels = toHeatmapData(outlierRaw).weeks[0].days.map((d) => d.level);
    expect(levels).toEqual([1, 1, 2, 2, 3, 4]);
    expect(new Set(levels).size).toBeGreaterThan(1);
  });
});
