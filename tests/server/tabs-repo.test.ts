import { describe, it, expect, beforeEach } from "vitest";
import { useTempDb } from "../helpers/db";
import { FIXTURE_TYPE } from "../helpers/fixture-widget";
import * as tabs from "@/server/tabs-repo";
import * as widgetsRepo from "@/server/config-repo";
import * as cache from "@/server/cache-repo";

beforeEach(() => useTempDb());

describe("tabs-repo", () => {
  it("seeds a default tab from the migration", async () => {
    const all = await tabs.getTabs();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: "default", name: "Dashboard", order: 0 });
  });

  it("adds tabs with an incrementing order", async () => {
    const a = await tabs.addTab("Work");
    const b = await tabs.addTab("Personal");
    expect(a.order).toBe(1);
    expect(b.order).toBe(2);
    expect(await tabs.getTabs()).toHaveLength(3);
  });

  it("renames a tab", async () => {
    const a = await tabs.addTab("Work");
    await tabs.renameTab(a.id, "Focus");
    expect((await tabs.getTabs()).find((t) => t.id === a.id)!.name).toBe("Focus");
  });

  it("reorders tabs", async () => {
    const a = await tabs.addTab("A");
    const b = await tabs.addTab("B");
    await tabs.setTabOrder([{ id: a.id, order: 5 }, { id: b.id, order: 4 }]);
    const got = await tabs.getTabs();
    expect(got.find((t) => t.id === b.id)!.order).toBe(4);
    expect(got.find((t) => t.id === a.id)!.order).toBe(5);
  });

  it("deleting a tab removes the tab and its widgets atomically", async () => {
    const a = await tabs.addTab("Work");
    const w = await widgetsRepo.addWidget(FIXTURE_TYPE, {}, a.id);
    const other = await widgetsRepo.addWidget(FIXTURE_TYPE, {}, "default");
    await tabs.deleteTab(a.id);
    expect((await tabs.getTabs()).some((t) => t.id === a.id)).toBe(false);
    expect(await widgetsRepo.getWidget(w.id)).toBeUndefined();
    expect(await widgetsRepo.getWidget(other.id)).toBeDefined();
  });

  it("deleting a tab also drops its widgets' cache rows", async () => {
    const a = await tabs.addTab("Work");
    const w = await widgetsRepo.addWidget(FIXTURE_TYPE, {}, a.id);
    await cache.set(w.id, { status: "ok", payload: { n: 1 }, error: null });
    await tabs.deleteTab(a.id);
    expect(await cache.get(w.id)).toBeUndefined();
  });

  it("refuses to delete the last remaining tab", async () => {
    // Only the seeded "default" tab exists.
    await expect(tabs.deleteTab("default")).rejects.toThrow(/last remaining tab/);
    expect(await tabs.getTabs()).toHaveLength(1);
  });

  it("addWidget assigns the given tab and setWidgetTab moves it", async () => {
    const a = await tabs.addTab("Work");
    const w = await widgetsRepo.addWidget(FIXTURE_TYPE, {}, a.id);
    expect((await widgetsRepo.getWidget(w.id))!.tabId).toBe(a.id);
    await widgetsRepo.setWidgetTab(w.id, "default");
    expect((await widgetsRepo.getWidget(w.id))!.tabId).toBe("default");
  });

  it("addWidget defaults to the 'default' tab", async () => {
    const w = await widgetsRepo.addWidget(FIXTURE_TYPE, {});
    expect((await widgetsRepo.getWidget(w.id))!.tabId).toBe("default");
  });
});
