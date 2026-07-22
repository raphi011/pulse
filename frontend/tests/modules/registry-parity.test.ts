import { describe, it, expect } from "vitest";
import widgetTypes from "@/widget-types.gen.json";
import "@/modules/render";
import { listRenderWidgets } from "@/modules/render-registry";

/**
 * Guards against the frontend render registry and the Go-generated
 * frontend/src/widget-types.gen.json drifting apart. Both sides (this test
 * and internal/module/parity_test.go) must agree on the same set of widget
 * types. On a mismatch, run `go run ./cmd/gen-widget-types` and commit the
 * result.
 */
describe("widget type parity with the Go registry", () => {
  it("registers exactly the types listed in widget-types.gen.json", () => {
    const got = new Set(listRenderWidgets().map((w) => w.type));
    const want = new Set(widgetTypes as string[]);

    const missingFromRegistry = [...want].filter((t) => !got.has(t)).sort();
    const missingFromGenJson = [...got].filter((t) => !want.has(t)).sort();

    expect(missingFromRegistry, "in widget-types.gen.json but not registered").toEqual([]);
    expect(missingFromGenJson, "registered but not in widget-types.gen.json").toEqual([]);
  });
});
