import { describe, it, expect } from "vitest";
import "@/modules/fetch";
import "@/modules/render";
import "@/modules/integrations";
import { getFetchWidget } from "@/modules/fetch-registry";
import { getRenderWidget } from "@/modules/render-registry";
import { getIntegration } from "@/modules/integration-registry";
import { CCUSAGE_SPEND_TYPE } from "@/modules/ccusage/manifest";

describe("ccusage registration barrels", () => {
  it("registers the widget on both sides with a shared manifest", () => {
    expect(getFetchWidget(CCUSAGE_SPEND_TYPE)).toBeDefined();
    expect(getRenderWidget(CCUSAGE_SPEND_TYPE)).toBeDefined();
    expect(getFetchWidget(CCUSAGE_SPEND_TYPE)!.manifest).toBe(getRenderWidget(CCUSAGE_SPEND_TYPE)!.manifest);
  });

  it("registers the ccusage integration", () => {
    expect(getIntegration("ccusage")).toBeDefined();
  });
});
