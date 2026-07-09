import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import {
  registerServerWidget, getServerWidget, listServerTypes, __clearServerRegistry,
} from "@/modules/server-registry";
import {
  registerClientWidget, getClientWidget, listClientWidgets, __clearClientRegistry,
} from "@/modules/client-registry";

beforeEach(() => {
  __clearServerRegistry();
  __clearClientRegistry();
});

describe("registries", () => {
  it("registers and resolves a server widget", () => {
    registerServerWidget({
      type: "t.a", configSchema: z.object({}), defaultConfig: {},
      fetch: async () => 1,
    });
    expect(getServerWidget("t.a")?.type).toBe("t.a");
    expect(listServerTypes()).toContain("t.a");
  });

  it("throws on duplicate server registration", () => {
    const def = { type: "t.a", configSchema: z.object({}), defaultConfig: {}, fetch: async () => 1 };
    registerServerWidget(def);
    expect(() => registerServerWidget(def)).toThrow(/already registered/);
  });

  it("registers and lists a client widget", () => {
    registerClientWidget({ type: "t.a", title: "A", Component: () => null });
    expect(getClientWidget("t.a")?.title).toBe("A");
    expect(listClientWidgets()).toEqual([{ type: "t.a", title: "A" }]);
  });
});
