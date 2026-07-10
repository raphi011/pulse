import { describe, it, expect, beforeEach, vi } from "vitest";
import { useTempDb } from "../helpers/db";

// Control which integrations & client widgets exist.
vi.mock("@/modules/integration-registry", () => {
  const map = new Map<string, unknown>();
  return {
    listIntegrations: () => [...map.values()],
    getIntegration: (id: string) => map.get(id),
    __seed: (arr: unknown[]) => { map.clear(); for (const i of arr) map.set((i as { id: string }).id, i); },
  };
});
vi.mock("@/modules/client-registry", () => ({
  listClientWidgets: () => [
    { type: "t.a", title: "A", integration: "toolful" },
    { type: "t.none", title: "None" },
  ],
  getClientWidget: () => undefined,
}));

import * as reg from "@/modules/integration-registry";
import { addWidget } from "@/server/config-repo";
import {
  resolveEnabled, getIntegrationStatuses, disableIntegration, enableIntegration,
} from "@/server/integration-service";

const seed = (reg as unknown as { __seed: (a: unknown[]) => void }).__seed;

beforeEach(() => {
  useTempDb();
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
    addWidget("t.a", {});
    addWidget("t.a", {});
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
    addWidget("t.a", {});
    expect(() => disableIntegration("toolful", false)).toThrow(/confirm/);
  });
  it("deletes the integration's widgets on confirmed disable", async () => {
    addWidget("t.a", {});
    const res = disableIntegration("toolful", true);
    expect(res.deleted).toBe(1);
    const statuses = await getIntegrationStatuses(true);
    expect(statuses.find((s) => s.id === "toolful")!.enabled).toBe(false);
  });
  it("enable sets the override to true", async () => {
    enableIntegration("missing");
    const statuses = await getIntegrationStatuses(true);
    expect(statuses.find((s) => s.id === "missing")!.enabled).toBe(true);
  });
});
