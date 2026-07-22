export const SYSTEM_STATS_TYPE = "system.stats";

/** Both fields render as number inputs in the auto-generated config form. */
export interface SystemStatsConfig {
  sampleIntervalSeconds: number;
  historySeconds: number;
}
export const systemStatsDefaultConfig: SystemStatsConfig = { sampleIntervalSeconds: 2, historySeconds: 120 };

/**
 * Guard against a stale/invalid config reaching the live sampler (see
 * use-system-stats.ts) — mirrors the bounds the server-side schema enforces.
 */
export function isValidSystemStatsConfig(config: unknown): config is SystemStatsConfig {
  if (typeof config !== "object" || config === null) return false;
  const c = config as Record<string, unknown>;
  const { sampleIntervalSeconds, historySeconds } = c;
  return (
    typeof sampleIntervalSeconds === "number" &&
    sampleIntervalSeconds >= 1 && sampleIntervalSeconds <= 10 &&
    typeof historySeconds === "number" &&
    historySeconds >= 30 && historySeconds <= 600
  );
}

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
