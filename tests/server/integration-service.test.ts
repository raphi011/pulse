import { describe, it, expect, beforeEach, vi } from "vitest";
import { useTempDb } from "../helpers/db";

// Control which integrations & render widgets exist.
vi.mock("@/modules/integration-registry", () => {
  const map = new Map<string, unknown>();
  return {
    listIntegrations: () => [...map.values()],
    getIntegration: (id: string) => map.get(id),
    __seed: (arr: unknown[]) => { map.clear(); for (const i of arr) map.set((i as { id: string }).id, i); },
  };
});
vi.mock("@/modules/render-registry", () => ({
  listRenderWidgets: () => [
    { type: "t.a", title: "A", integration: "toolful" },
    { type: "t.none", title: "None" },
  ],
  getRenderWidget: () => undefined,
}));

import * as reg from "@/modules/integration-registry";
import { addWidget } from "@/server/config-repo";
import {
  resolveEnabled, getIntegrationStatuses, disableIntegration, enableIntegration,
  ConfirmRequiredError, __resetHealthCache,
} from "@/server/integration-service";

const seed = (reg as unknown as { __seed: (a: unknown[]) => void }).__seed;

beforeEach(() => {
  useTempDb();
  __resetHealthCache();
  seed([
    { id: "toolful", name: "Toolful", tool: { bin: "x", installHint: "i", authHint: "a" },
      checkHealth: async () => ({ installed: true, authed: true }) },
    { id: "toolless", name: "Toolless",
      checkHealth: async () => ({ installed: true, authed: "n/a" }) },
    { id: "missing", name: "Missing", tool: { bin: "y", installHint: "i", authHint: "a" },
      checkHealth: async () => ({ installed: false, authed: false }) },
  ]);
});

describe("resolveEnabled", () => {
  it("defaults on for tool-less and installed tools, off for missing", () => {
    expect(resolveEnabled(false, false, null)).toBe(true);  // no tool
    expect(resolveEnabled(true, true, null)).toBe(true);    // installed
    expect(resolveEnabled(true, false, null)).toBe(false);  // missing
  });
  it("override wins over the computed default", () => {
    expect(resolveEnabled(true, false, true)).toBe(true);
    expect(resolveEnabled(false, true, false)).toBe(false);
  });
});

describe("getIntegrationStatuses", () => {
  it("computes enabled and counts widgets per integration", async () => {
    await addWidget("t.a", {});
    await addWidget("t.a", {});
    const statuses = await getIntegrationStatuses(true);
    const byId = Object.fromEntries(statuses.map((s) => [s.id, s]));
    expect(byId.toolful.enabled).toBe(true);
    expect(byId.toolful.widgetCount).toBe(2);
    expect(byId.toolless.enabled).toBe(true);
    expect(byId.missing.enabled).toBe(false);
  });
});

describe("disable/enable", () => {
  it("refuses to disable with widgets unless deleteWidgets is set", async () => {
    await addWidget("t.a", {});
    await addWidget("t.a", {});
    try {
      await disableIntegration("toolful", false);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ConfirmRequiredError);
      expect((e as ConfirmRequiredError).widgetCount).toBe(2);
    }
  });
  it("deletes the integration's widgets on confirmed disable", async () => {
    await addWidget("t.a", {});
    const res = await disableIntegration("toolful", true);
    expect(res.deleted).toBe(1);
    const statuses = await getIntegrationStatuses(true);
    expect(statuses.find((s) => s.id === "toolful")!.enabled).toBe(false);
  });
  it("enable sets the override to true", async () => {
    await enableIntegration("missing");
    const statuses = await getIntegrationStatuses(true);
    expect(statuses.find((s) => s.id === "missing")!.enabled).toBe(true);
  });
});

describe("health cache", () => {
  it("caches health and re-probes only when forced", async () => {
    let calls = 0;
    seed([{ id: "spy", name: "Spy", tool: { bin: "x", installHint: "i", authHint: "a" },
      checkHealth: async () => { calls++; return { installed: true, authed: true }; } }]);
    await getIntegrationStatuses();      // miss -> 1
    await getIntegrationStatuses();      // hit  -> still 1
    await getIntegrationStatuses(true);  // forced -> 2
    expect(calls).toBe(2);
  });
});
