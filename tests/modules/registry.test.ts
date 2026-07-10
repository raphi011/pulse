import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import {
  registerFetchWidget, getFetchWidget, listFetchTypes, __clearFetchRegistry,
} from "@/modules/fetch-registry";
import {
  registerRenderWidget, getRenderWidget, listRenderWidgets, __clearRenderRegistry,
} from "@/modules/render-registry";

beforeEach(() => {
  __clearFetchRegistry();
  __clearRenderRegistry();
});

describe("registries", () => {
  it("registers and resolves a fetch widget", () => {
    registerFetchWidget({
      type: "t.a", configSchema: z.object({}), defaultConfig: {},
      fetch: async () => 1,
    });
    expect(getFetchWidget("t.a")?.type).toBe("t.a");
    expect(listFetchTypes()).toContain("t.a");
  });

  it("throws on duplicate server registration", () => {
    const def = { type: "t.a", configSchema: z.object({}), defaultConfig: {}, fetch: async () => 1 };
    registerFetchWidget(def);
    expect(() => registerFetchWidget(def)).toThrow(/already registered/);
  });

  it("registers and lists a render widget", () => {
    registerRenderWidget({
      type: "t.a", title: "A", Component: () => null,
      configSchema: z.object({}), defaultConfig: {},
    });
    expect(getRenderWidget("t.a")?.title).toBe("A");
    expect(listRenderWidgets()).toEqual([{ type: "t.a", title: "A" }]);
  });

  it("render widgets carry an integration id where applicable", async () => {
    await import("@/modules/render");
    const { listRenderWidgets } = await import("@/modules/render-registry");
    const byType = Object.fromEntries(listRenderWidgets().map((w) => [w.type, w.integration]));
    expect(byType["github.prs"]).toBe("github");
    expect(byType["jira.jql"]).toBe("jira");
    expect(byType["gws.gmail"]).toBe("gws");
    expect(byType["core.status"]).toBeUndefined();
  });
});
