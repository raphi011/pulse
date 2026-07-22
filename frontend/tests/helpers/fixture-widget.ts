import { z } from "zod";
import { defineManifest } from "@/modules/contracts";
import { registerFetch, getFetchWidget } from "@/modules/fetch-registry";
import { registerRender, getRenderWidget } from "@/modules/render-registry";

/**
 * A minimal, registry-registered widget used only by tests as a generic stand-in
 * (it replaces the former `core.status` module in that role). Keeps tests
 * independent of any real integration module: a single string config field, a
 * Node-safe synchronous fetch, and no integration id.
 */
export const FIXTURE_TYPE = "test.fixture";

export const fixtureManifest = defineManifest({
  type: FIXTURE_TYPE,
  title: "Test Fixture",
  configSchema: z.object({ label: z.string().default("Fixture") }),
  defaultConfig: { label: "Fixture" },
});

/** Constant payload the fixture's fetch resolves to — asserted on by data tests. */
export const fixturePayload = { platform: "macos", osVersion: "15.0", arch: "aarch64" };

/**
 * Idempotent registration. setupFiles run once per test file while the registry
 * singletons persist per worker, and registry.test.ts clears them mid-run — so
 * guard on presence and (re)register only when absent.
 */
export function registerFixtureWidget(): void {
  if (!getFetchWidget(FIXTURE_TYPE)) registerFetch(fixtureManifest, { fetch: async () => fixturePayload });
  if (!getRenderWidget(FIXTURE_TYPE)) registerRender(fixtureManifest, { Component: () => null });
}
