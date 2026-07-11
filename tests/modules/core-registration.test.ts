import { describe, it, expect } from "vitest";
import "@/modules/fetch";
import "@/modules/render";
import { getFetchWidget } from "@/modules/fetch-registry";
import { getRenderWidget } from "@/modules/render-registry";
import { STATUS_TYPE } from "@/modules/core/manifest";

describe("core registration barrels", () => {
  it("registers core.status on both sides", () => {
    expect(getFetchWidget(STATUS_TYPE)).toBeDefined();
    expect(getRenderWidget(STATUS_TYPE)?.manifest.title).toBe("System Status");
  });

  it("both sides share the same manifest object", () => {
    expect(getFetchWidget(STATUS_TYPE)!.manifest).toBe(getRenderWidget(STATUS_TYPE)!.manifest);
  });
});
