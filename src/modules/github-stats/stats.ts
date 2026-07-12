import type { Timeframe, StatsData, HeatmapData, HeatmapDay, SummaryConfig, HeatmapConfig } from "./manifest";
import { runGh } from "@/modules/github/gh";
import { CliError } from "@/server/cli";

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

export function toStatsData(raw: RawContributions): StatsData {
  const trend = raw.contributionCalendar.weeks.flatMap((w) =>
    w.contributionDays.map((d) => ({ date: d.date, count: d.contributionCount })),
  );
  return {
    commits: raw.totalCommitContributions,
    prs: raw.totalPullRequestContributions,
    reviews: raw.totalPullRequestReviewContributions,
    issues: raw.totalIssueContributions,
    total: raw.contributionCalendar.totalContributions,
    trend,
  };
}

const LEVELS: Record<ContributionLevel, HeatmapDay["level"]> = {
  NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4,
};

export function toHeatmapData(raw: RawContributions): HeatmapData {
  const weeks = raw.contributionCalendar.weeks.map((w) => ({
    days: w.contributionDays.map((d) => ({
      date: d.date,
      count: d.contributionCount,
      level: LEVELS[d.contributionLevel],
    })),
  }));
  return { total: raw.contributionCalendar.totalContributions, weeks };
}

type GraphqlResponse = {
  data?: { viewer?: { contributionsCollection?: RawContributions } };
  errors?: { message: string }[];
};

/** Runs the contributions query for a window; surfaces GraphQL `errors[]` (HTTP-200 case). */
export async function fetchContributions(from: string, to: string): Promise<RawContributions> {
  const stdout = await runGh([
    "api", "graphql",
    "-f", `query=${CONTRIB_QUERY}`,
    "-f", `from=${from}`,
    "-f", `to=${to}`,
  ]);
  let body: GraphqlResponse;
  try {
    body = JSON.parse(stdout);
  } catch {
    throw new CliError("GitHub returned non-JSON output", "failed");
  }
  if (body.errors?.length) throw new CliError(body.errors[0].message, "failed");
  const cc = body.data?.viewer?.contributionsCollection;
  if (!cc) throw new CliError("No contributions data in response", "failed");
  return cc;
}

export async function fetchSummary(config: SummaryConfig): Promise<StatsData> {
  const { from, to } = windowFor(config.timeframe, new Date());
  return toStatsData(await fetchContributions(from, to));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- config kept to match the registerFetch(config) => Promise<Data> shape
export async function fetchHeatmap(_config: HeatmapConfig): Promise<HeatmapData> {
  const { from, to } = yearWindow(new Date());
  return toHeatmapData(await fetchContributions(from, to));
}
