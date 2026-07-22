import { describe, it, expect } from "vitest";
import {
  systemStatsConfigSchema,
  systemStatsDefaultConfig,
  systemStatsManifest,
  SYSTEM_STATS_TYPE,
} from "@/modules/system/manifest";

describe("system stats config schema", () => {
  it("fills defaults from an empty object", () => {
    expect(systemStatsConfigSchema.parse({})).toEqual({ sampleIntervalSeconds: 2, historySeconds: 120 });
    expect(systemStatsDefaultConfig).toEqual({ sampleIntervalSeconds: 2, historySeconds: 120 });
  });

  it("enforces bounds", () => {
    expect(() => systemStatsConfigSchema.parse({ sampleIntervalSeconds: 0 })).toThrow();
    expect(() => systemStatsConfigSchema.parse({ sampleIntervalSeconds: 11 })).toThrow();
    expect(() => systemStatsConfigSchema.parse({ historySeconds: 10 })).toThrow();
    expect(() => systemStatsConfigSchema.parse({ historySeconds: 601 })).toThrow();
  });

  it("manifest is live (non-refreshable) with the right identity", () => {
    expect(systemStatsManifest.type).toBe(SYSTEM_STATS_TYPE);
    expect(SYSTEM_STATS_TYPE).toBe("system.stats");
    expect(systemStatsManifest.title).toBe("System");
    expect(systemStatsManifest.refreshable).toBe(false);
    expect(systemStatsManifest.integration).toBeUndefined();
  });
});
