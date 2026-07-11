import { describe, it, expect } from "vitest";
import "@/modules/fetch";
import { getFetchWidget } from "@/modules/fetch-registry";
import { SYSTEM_STATS_TYPE, systemStatsDefaultConfig } from "@/modules/system/manifest";

describe("system fetch registration", () => {
  it("registers system.stats on the fetch registry with defaults", () => {
    const def = getFetchWidget(SYSTEM_STATS_TYPE);
    expect(def).toBeDefined();
    expect(def!.manifest.defaultConfig).toEqual(systemStatsDefaultConfig);
    expect(typeof def!.fetch).toBe("function");
  });

  it("fetch returns an empty payload (data comes from the live sampler)", async () => {
    const def = getFetchWidget(SYSTEM_STATS_TYPE);
    await expect(def!.fetch(systemStatsDefaultConfig)).resolves.toEqual({});
  });
});

import "@/modules/render";
import { getRenderWidget } from "@/modules/render-registry";

describe("system render registration", () => {
  it("registers system.stats on the render registry as a live, non-refreshable widget", () => {
    const def = getRenderWidget(SYSTEM_STATS_TYPE);
    expect(def).toBeDefined();
    expect(def!.manifest.title).toBe("System");
    expect(def!.manifest.refreshable).toBe(false);
    expect(def!.Component).toBeDefined();
    expect(def!.icon).toBeDefined();
  });

  it("both sides share the same manifest object", () => {
    expect(getFetchWidget(SYSTEM_STATS_TYPE)!.manifest).toBe(getRenderWidget(SYSTEM_STATS_TYPE)!.manifest);
  });
});
