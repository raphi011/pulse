import { describe, it, expect, beforeEach } from "vitest";
import {
  registerIntegration, getIntegration, listIntegrations, __clearIntegrationRegistry,
} from "@/modules/integration-registry";

const fake = () => ({
  id: "x", name: "X", checkHealth: async () => ({ installed: true, authed: true as const }),
});

beforeEach(() => __clearIntegrationRegistry());

describe("integration registry", () => {
  it("registers and looks up by id", () => {
    registerIntegration(fake());
    expect(getIntegration("x")?.name).toBe("X");
    expect(listIntegrations()).toHaveLength(1);
  });

  it("throws on duplicate id", () => {
    registerIntegration(fake());
    expect(() => registerIntegration(fake())).toThrow(/already registered/);
  });
});
