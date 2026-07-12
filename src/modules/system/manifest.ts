import { z } from "zod";
import { defineManifest } from "@/modules/contracts";

export const SYSTEM_STATS_TYPE = "system.stats";

/** Both fields render as number inputs in the auto-generated config form. */
export const systemStatsConfigSchema = z.object({
  sampleIntervalSeconds: z.number().min(1).max(10).default(2).describe("Sample interval (seconds)"),
  historySeconds: z.number().min(30).max(600).default(120).describe("History window (seconds)"),
});
export type SystemStatsConfig = z.infer<typeof systemStatsConfigSchema>;
export const systemStatsDefaultConfig: SystemStatsConfig = { sampleIntervalSeconds: 2, historySeconds: 120 };

/** Raw payload of the `system_stats` Tauri command (serde camelCase). */
export type SystemStatsPayload = {
  cpuPercent: number;
  memUsedBytes: number;
  memTotalBytes: number;
  netRxBytesPerSec: number;
  netTxBytesPerSec: number;
};

/** One sampler tick in the rolling history. `t` is Date.now() ms. */
export type SamplePoint = { t: number; cpu: number; memUsed: number; memTotal: number; rx: number; tx: number };

/**
 * The cache pipeline carries no data for this widget — it renders from the
 * live sampler (src/modules/system/sampler.ts), so fetch returns an empty object.
 */
export type SystemStatsData = Record<string, never>;

export const systemStatsManifest = defineManifest({
  type: SYSTEM_STATS_TYPE, title: "System",
  configSchema: systemStatsConfigSchema, defaultConfig: systemStatsDefaultConfig,
  refreshable: false,
});
