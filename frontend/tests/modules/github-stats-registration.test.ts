import { describe, it, expect } from "vitest";
import "@/modules/fetch";
import "@/modules/render";
import { getFetchWidget } from "@/modules/fetch-registry";
import { getRenderWidget } from "@/modules/render-registry";
import { SUMMARY_TYPE, HEATMAP_TYPE } from "@/modules/github-stats/manifest";

describe("github-stats registration barrels", () => {
  it("registers both widgets on both sides with a shared manifest", () => {
    for (const t of [SUMMARY_TYPE, HEATMAP_TYPE]) {
      expect(getFetchWidget(t), `fetch ${t}`).toBeDefined();
      expect(getRenderWidget(t), `render ${t}`).toBeDefined();
      expect(getFetchWidget(t)!.manifest).toBe(getRenderWidget(t)!.manifest);
    }
  });
});
