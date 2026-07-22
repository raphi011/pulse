import type { WidgetManifest } from "@/modules/contracts";
import { registerRender, getRenderWidget } from "@/modules/render-registry";

/**
 * A minimal widget type used only by tests as a generic stand-in, independent
 * of any real module. Manifests are server-owned in the new (Go) architecture,
 * so this fixture provides both halves a test might need:
 *  - `fixtureManifest`: a `WidgetManifest` shaped exactly like what
 *    `Dashboard.Manifests()` would return for this type (mock `fetchManifests`
 *    with it where a component reads manifests, e.g. `useManifest`).
 *  - `registerFixtureRenderWidget()`: registers the render-registry half
 *    (Component/icon/etc.) that `getRenderWidget`/`listRenderWidgets` resolve.
 *
 * Not wired into vitest.setup.ts: the render registry is a module-level
 * singleton, and a global registration would leak "test.fixture" into
 * tests/modules/registry-parity.test.ts, which asserts the registry's type
 * set matches widget-types.gen.json exactly. Call it explicitly from the
 * handful of tests that need it.
 */
export const FIXTURE_TYPE = "test.fixture";

export const fixtureManifest: WidgetManifest = {
  type: FIXTURE_TYPE,
  title: "Test Fixture",
  configFields: [{ key: "label", label: "Label", kind: "string", def: "Fixture" }],
  refreshable: true,
};

/** Constant payload the fixture's fetch resolves to — asserted on by data tests. */
export const fixturePayload = { platform: "macos", osVersion: "15.0", arch: "aarch64" };

/** Idempotent: safe to call from multiple tests within the same module instance. */
export function registerFixtureRenderWidget(): void {
  if (!getRenderWidget(FIXTURE_TYPE)) registerRender(FIXTURE_TYPE, { Component: () => null });
}
