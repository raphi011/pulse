import { describe, it, expect, beforeEach } from "vitest";
import { FiCpu } from "react-icons/fi";
import {
  registerRender, getRenderWidget, listRenderWidgets, __clearRenderRegistry,
} from "@/modules/render-registry";

// The fetch registry (and manifest-sharing between fetch/render halves) moved
// server-side (Go); only the render registry remains client-side, so this
// covers just its API. Real-module registration (system.stats, bookmarks.links)
// is covered by tests/modules/registry-parity.test.ts.
beforeEach(() => __clearRenderRegistry());

describe("render registry", () => {
  it("registers and resolves a render widget", () => {
    registerRender("t.a", { Component: () => null });
    expect(getRenderWidget("t.a")?.type).toBe("t.a");
    expect(listRenderWidgets().map((w) => w.type)).toContain("t.a");
  });

  it("throws on duplicate registration", () => {
    registerRender("t.a", { Component: () => null });
    expect(() => registerRender("t.a", { Component: () => null })).toThrow(/already registered/);
  });

  it("returns undefined for an unregistered type", () => {
    expect(getRenderWidget("nope")).toBeUndefined();
  });

  it("lists type and icon only", () => {
    registerRender("t.a", { Component: () => null, icon: { Icon: FiCpu } });
    expect(listRenderWidgets()).toEqual([{ type: "t.a", icon: { Icon: FiCpu } }]);
  });
});
