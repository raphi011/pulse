import { describe, it, expect } from "vitest";
import {
  summaryConfigSchema, summaryDefaultConfig,
  heatmapConfigSchema, heatmapDefaultConfig,
  summaryManifest, heatmapManifest,
  SUMMARY_TYPE, HEATMAP_TYPE,
} from "@/modules/github-stats/manifest";

describe("github-stats manifest", () => {
  it("parses the summary default config", () => {
    expect(summaryConfigSchema.parse(summaryDefaultConfig)).toEqual({ timeframe: "30d" });
  });

  it("backfills timeframe from an empty object via the default", () => {
    expect(summaryConfigSchema.parse({})).toEqual({ timeframe: "30d" });
  });

  it("rejects an unknown timeframe", () => {
    expect(() => summaryConfigSchema.parse({ timeframe: "5y" })).toThrow();
  });

  it("parses the empty heatmap config", () => {
    expect(heatmapConfigSchema.parse(heatmapDefaultConfig)).toEqual({});
  });

  it("exposes matching manifest types", () => {
    expect(summaryManifest.type).toBe(SUMMARY_TYPE);
    expect(heatmapManifest.type).toBe(HEATMAP_TYPE);
    expect(summaryManifest.integration).toBe("github");
  });
});
