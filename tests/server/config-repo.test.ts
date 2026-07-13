import { describe, it, expect, beforeEach } from "vitest";
import { useTempDb } from "../helpers/db";
import { FIXTURE_TYPE } from "../helpers/fixture-widget";
import * as repo from "@/server/config-repo";
import * as cache from "@/server/cache-repo";

beforeEach(() => useTempDb());

describe("config-repo", () => {
  it("appends widgets in order", async () => {
    const a = await repo.addWidget(FIXTURE_TYPE, { label: "A" });
    const b = await repo.addWidget(FIXTURE_TYPE, { label: "B" });
    expect(a.order).toBe(0);
    expect(b.order).toBe(1);
    expect(await repo.getWidgets()).toHaveLength(2);
  });

  it("persists positions", async () => {
    const a = await repo.addWidget(FIXTURE_TYPE, {});
    await repo.setPositions([{ id: a.id, order: 5, colSpan: 3, rowSpan: 8 }]);
    const got = (await repo.getWidget(a.id))!;
    expect(got.order).toBe(5);
    expect(got.colSpan).toBe(3);
    expect(got.rowSpan).toBe(8);
  });

  it("hides and removes widgets", async () => {
    const a = await repo.addWidget(FIXTURE_TYPE, {});
    await repo.setHidden(a.id, true);
    expect((await repo.getWidget(a.id))!.hidden).toBe(true);
    await repo.removeWidget(a.id);
    expect(await repo.getWidget(a.id)).toBeUndefined();
  });

  it("removeWidget also drops the widget's cache row", async () => {
    const a = await repo.addWidget(FIXTURE_TYPE, {});
    await cache.set(a.id, { status: "ok", payload: { n: 1 }, error: null });
    expect(await cache.get(a.id)).toBeDefined();
    await repo.removeWidget(a.id);
    expect(await cache.get(a.id)).toBeUndefined();
  });

  it("reads and writes prefs with defaults", async () => {
    expect(await repo.getPref("theme", "dark")).toBe("dark");
    await repo.setPref("theme", "light");
    expect(await repo.getPref("theme", "dark")).toBe("light");
  });

  it("integration override is null until set, then round-trips", async () => {
    expect(await repo.getIntegrationOverride("github")).toBeNull();
    await repo.setIntegrationOverride("github", false);
    expect(await repo.getIntegrationOverride("github")).toBe(false);
    await repo.setIntegrationOverride("github", true);
    expect(await repo.getIntegrationOverride("github")).toBe(true);
  });

  it("defaults accent to null and round-trips setAccent", async () => {
    const a = await repo.addWidget(FIXTURE_TYPE, {});
    expect((await repo.getWidget(a.id))!.accent).toBeNull();
    await repo.setAccent(a.id, "teal");
    expect((await repo.getWidget(a.id))!.accent).toBe("teal");
    await repo.setAccent(a.id, null);
    expect((await repo.getWidget(a.id))!.accent).toBeNull();
  });
});
