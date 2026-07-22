export const SUMMARY_TYPE = "github-stats.summary";
export const HEATMAP_TYPE = "github-stats.heatmap";

export type Timeframe = "7d" | "30d" | "90d" | "year";

// Config shapes mirror the Go manifests (forms are generated server-side).
export interface SummaryConfig {
  timeframe: Timeframe;
}
export type HeatmapConfig = Record<string, never>;

// --- Data shapes (payloads produced by internal/modules/githubstats) ---
export type TrendPoint = { date: string; count: number };
export type StatsData = {
  commits: number;
  prs: number;
  reviews: number;
  issues: number;
  total: number;
  trend: TrendPoint[];
};

export type HeatmapDay = { date: string; count: number; level: 0 | 1 | 2 | 3 | 4 };
export type HeatmapWeek = { days: HeatmapDay[] };
export type HeatmapData = { total: number; weeks: HeatmapWeek[] };
