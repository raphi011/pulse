import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { defineManifest } from "@/modules/contracts";
import {
  registerFetch, getFetchWidget, listFetchTypes, __clearFetchRegistry,
} from "@/modules/fetch-registry";
import {
  registerRender, getRenderWidget, listRenderWidgets, __clearRenderRegistry,
} from "@/modules/render-registry";

const manifest = defineManifest({
  type: "t.a", title: "A", configSchema: z.object({}), defaultConfig: {},
});

beforeEach(() => {
  __clearFetchRegistry();
  __clearRenderRegistry();
});

describe("registries", () => {
  it("registers and resolves a fetch widget", () => {
    registerFetch(manifest, { fetch: async () => 1 });
    expect(getFetchWidget("t.a")?.manifest.type).toBe("t.a");
    expect(listFetchTypes()).toContain("t.a");
  });

  it("throws on duplicate fetch registration", () => {
    registerFetch(manifest, { fetch: async () => 1 });
    expect(() => registerFetch(manifest, { fetch: async () => 1 })).toThrow(/already registered/);
  });

  it("registers and lists a render widget", () => {
    registerRender(manifest, { Component: () => null });
    expect(getRenderWidget("t.a")?.manifest.title).toBe("A");
    expect(listRenderWidgets()).toEqual([{ type: "t.a", title: "A", integration: undefined, icon: undefined }]);
  });

  it("both registries share the same manifest object", () => {
    registerFetch(manifest, { fetch: async () => 1 });
    registerRender(manifest, { Component: () => null });
    expect(getFetchWidget("t.a")!.manifest).toBe(getRenderWidget("t.a")!.manifest);
  });

  it("render widgets carry an integration id where applicable", async () => {
    await import("@/modules/render");
    const { listRenderWidgets } = await import("@/modules/render-registry");
    const byType = Object.fromEntries(listRenderWidgets().map((w) => [w.type, w.integration]));
    expect(byType["github.prs"]).toBe("github");
    expect(byType["jira.jql"]).toBe("jira");
    expect(byType["gws.gmail"]).toBe("gws");
    expect(byType["system.stats"]).toBeUndefined();
  });
});
