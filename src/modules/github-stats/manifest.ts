import { z } from "zod";
import { defineManifest } from "@/modules/contracts";

export const SUMMARY_TYPE = "github-stats.summary";
export const HEATMAP_TYPE = "github-stats.heatmap";

export type Timeframe = "7d" | "30d" | "90d" | "year";

// --- Config schemas (.describe() drives form labels) ---
export const summaryConfigSchema = z.object({
  timeframe: z.enum(["7d", "30d", "90d", "year"]).default("30d").describe("Timeframe"),
});
export type SummaryConfig = z.infer<typeof summaryConfigSchema>;
export const summaryDefaultConfig: SummaryConfig = { timeframe: "30d" };

export const heatmapConfigSchema = z.object({});
export type HeatmapConfig = z.infer<typeof heatmapConfigSchema>;
export const heatmapDefaultConfig: HeatmapConfig = {};

// --- Data shapes ---
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

export const summaryManifest = defineManifest({
  type: SUMMARY_TYPE, title: "GitHub Stats",
  configSchema: summaryConfigSchema, defaultConfig: summaryDefaultConfig,
  integration: "github",
});
export const heatmapManifest = defineManifest({
  type: HEATMAP_TYPE, title: "Contribution Heatmap",
  configSchema: heatmapConfigSchema, defaultConfig: heatmapDefaultConfig,
  integration: "github",
});
