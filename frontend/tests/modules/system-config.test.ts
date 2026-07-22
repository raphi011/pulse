import { describe, it, expect } from "vitest";
import {
  isValidSystemStatsConfig,
  systemStatsDefaultConfig,
  SYSTEM_STATS_TYPE,
} from "@/modules/system/manifest";

// The Zod schema (and the manifest object itself) moved server-side (Go); this
// guard is the frontend's last line of defense before handing config to the
// live sampler timer (see use-system-stats.ts).
describe("isValidSystemStatsConfig", () => {
  it("accepts the default config", () => {
    expect(isValidSystemStatsConfig(systemStatsDefaultConfig)).toBe(true);
  });

  it("rejects out-of-bounds sampleIntervalSeconds", () => {
    expect(isValidSystemStatsConfig({ sampleIntervalSeconds: 0, historySeconds: 120 })).toBe(false);
    expect(isValidSystemStatsConfig({ sampleIntervalSeconds: 11, historySeconds: 120 })).toBe(false);
  });

  it("rejects out-of-bounds historySeconds", () => {
    expect(isValidSystemStatsConfig({ sampleIntervalSeconds: 2, historySeconds: 10 })).toBe(false);
    expect(isValidSystemStatsConfig({ sampleIntervalSeconds: 2, historySeconds: 601 })).toBe(false);
  });

  it("rejects missing fields, non-objects, and null", () => {
    expect(isValidSystemStatsConfig({})).toBe(false);
    expect(isValidSystemStatsConfig(null)).toBe(false);
    expect(isValidSystemStatsConfig("nope")).toBe(false);
  });

  it("has the right type identity", () => {
    expect(SYSTEM_STATS_TYPE).toBe("system.stats");
    expect(systemStatsDefaultConfig).toEqual({ sampleIntervalSeconds: 2, historySeconds: 120 });
  });
});
