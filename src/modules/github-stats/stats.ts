import type { Timeframe } from "./manifest";

const DAY_MS = 86_400_000;

/** Preset window: `to` is always `now`; `year` means Jan 1 of now's UTC year. */
export function windowFor(timeframe: Timeframe, now: Date): { from: string; to: string } {
  const to = now.toISOString();
  if (timeframe === "year") {
    return { from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString(), to };
  }
  const days = timeframe === "7d" ? 7 : timeframe === "30d" ? 30 : 90;
  return { from: new Date(now.getTime() - days * DAY_MS).toISOString(), to };
}

/** Trailing 12 months (~53 weeks) for the classic heatmap. */
export function yearWindow(now: Date): { from: string; to: string } {
  const from = new Date(now);
  from.setUTCFullYear(now.getUTCFullYear() - 1);
  return { from: from.toISOString(), to: now.toISOString() };
}

export const CONTRIB_QUERY = `query($from: DateTime!, $to: DateTime!) {
  viewer {
    contributionsCollection(from: $from, to: $to) {
      totalCommitContributions
      totalPullRequestContributions
      totalPullRequestReviewContributions
      totalIssueContributions
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays { date contributionCount contributionLevel }
        }
      }
    }
  }
}`;

export type ContributionLevel =
  | "NONE" | "FIRST_QUARTILE" | "SECOND_QUARTILE" | "THIRD_QUARTILE" | "FOURTH_QUARTILE";

export type RawContributionDay = {
  date: string;
  contributionCount: number;
  contributionLevel: ContributionLevel;
};
export type RawWeek = { contributionDays: RawContributionDay[] };
export type RawContributions = {
  totalCommitContributions: number;
  totalPullRequestContributions: number;
  totalPullRequestReviewContributions: number;
  totalIssueContributions: number;
  contributionCalendar: { totalContributions: number; weeks: RawWeek[] };
};
