import { describe, it, expect, beforeEach } from "vitest";

import "@/modules/fetch";
import "@/modules/render";
import "@/modules/integrations";
import { useTempDb } from "../helpers/db";
import { FIXTURE_TYPE, registerFixtureWidget } from "../helpers/fixture-widget";
import * as data from "@/lib/dashboard-data";
import * as tabsRepo from "@/server/tabs-repo";

beforeEach(() => { useTempDb(); registerFixtureWidget(); });

describe("dashboard-data", () => {
  it("creates a widget and lists it", async () => {
    const w = await data.createWidget(FIXTURE_TYPE, "default");
    const layout = await data.fetchLayout();
    expect(layout.widgets.map((x) => x.id)).toContain(w.id);
    expect(layout.prefs.theme).toBe("dark");
  });

  it("updates title and rejects invalid config, accepts valid config", async () => {
    const w = await data.createWidget(FIXTURE_TYPE, "default");

    const res = await data.updateWidget(w.id, { title: "Hi" });
    expect(res.title).toBe("Hi");

    // Snapshot the stored config before the invalid write so we can prove validate-before-write.
    const before = (await data.fetchLayout()).widgets.find((x) => x.id === w.id)?.config;

    // The fixture's `label` field is typed as a string — a non-string value fails the schema.
    await expect(data.updateWidget(w.id, { config: { label: 42 } })).rejects.toThrow("Invalid config");

    // The rejected write must NOT have touched the stored config.
    const after = (await data.fetchLayout()).widgets.find((x) => x.id === w.id)?.config;
    expect(after).toEqual(before);

    const valid = await data.updateWidget(w.id, { config: { label: "Servers" } });
    expect(valid.config).toEqual({ label: "Servers" });
  });

  it("rejects a github repo that is not owner/name (repoSchema injection guard)", async () => {
    // github.failingActions.repos uses repoSchema, which guards against path/command
    // injection into `gh api` — a value with a `?`/`=` must fail regex validation.
    const w = await data.createWidget("github.failingActions", "default");
    const before = (await data.fetchLayout()).widgets.find((x) => x.id === w.id)?.config;

    await expect(
      data.updateWidget(w.id, { config: { repos: ["owner/name?x=1"], limit: 5 } }),
    ).rejects.toThrow("Invalid config");

    // The malformed repo must never be persisted.
    const after = (await data.fetchLayout()).widgets.find((x) => x.id === w.id)?.config;
    expect(after).toEqual(before);
  });

  it("hides a widget", async () => {
    const w = await data.createWidget(FIXTURE_TYPE, "default");
    await data.updateWidget(w.id, { hidden: true });
    const layout = await data.fetchLayout();
    expect(layout.widgets.find((x) => x.id === w.id)?.hidden).toBe(true);
  });

  it("deletes a widget", async () => {
    const w = await data.createWidget(FIXTURE_TYPE, "default");
    await data.deleteWidget(w.id);
    const layout = await data.fetchLayout();
    expect(layout.widgets.map((x) => x.id)).not.toContain(w.id);
  });

  it("saves positions", async () => {
    const a = await data.createWidget(FIXTURE_TYPE, "default");
    const b = await data.createWidget(FIXTURE_TYPE, "default");
    await data.savePositions([
      { id: a.id, order: 1, colSpan: 2, rowSpan: 3 },
      { id: b.id, order: 0, colSpan: 1, rowSpan: 1 },
    ]);
    const layout = await data.fetchLayout();
    const byId = Object.fromEntries(layout.widgets.map((w) => [w.id, w]));
    expect(byId[a.id]).toMatchObject({ order: 1, colSpan: 2, rowSpan: 3 });
    expect(byId[b.id]).toMatchObject({ order: 0, colSpan: 1, rowSpan: 1 });
  });

  it("toggleIntegration returns confirmRequired when disabling with widgets present", async () => {
    await data.toggleIntegration("github", true);
    await data.createWidget("github.prs", "default");

    const res = await data.toggleIntegration("github", false);
    expect(res.confirmRequired).toBe(1);
    expect(res.statuses.find((s) => s.id === "github")?.enabled).toBe(true);

    const confirmed = await data.toggleIntegration("github", false, true);
    expect(confirmed.confirmRequired).toBeUndefined();
    expect(confirmed.statuses.find((s) => s.id === "github")?.enabled).toBe(false);
  });

  it("fetchIntegrations lists a status per registered integration", async () => {
    const statuses = await data.fetchIntegrations();
    expect(statuses.map((s) => s.id).sort()).toEqual(["ccusage", "github", "gws", "jira"]);
  });

  it("createWidget rejects an unknown widget type", async () => {
    await expect(data.createWidget("does.not.exist", "default")).rejects.toThrow("Unknown widget type");
  });

  it("updateWidget echoes schema defaults applied to an omitted config field", async () => {
    // github.failingActions' `limit` defaults to 10 — omitting it should echo the default back.
    const w = await data.createWidget("github.failingActions", "default");
    const res = await data.updateWidget(w.id, { config: { repos: ["o/r"] } });
    expect(res.config).toEqual({ repos: ["o/r"], limit: 10 });
  });

  it("updateWidget clears the title back to null when set blank", async () => {
    const w = await data.createWidget(FIXTURE_TYPE, "default");
    await data.updateWidget(w.id, { title: "Renamed" });
    const res = await data.updateWidget(w.id, { title: "" });
    expect(res.title).toBeNull();
  });

  it("fetchWidgetData rejects for an unknown widget id", async () => {
    await expect(data.fetchWidgetData("nope", false)).rejects.toThrow("Widget not found");
  });

  it("fetchWidgetData returns cached data with status ok", async () => {
    const w = await data.createWidget(FIXTURE_TYPE, "default");
    const row = await data.fetchWidgetData(w.id, false);
    expect(row.status).toBe("ok");
    expect((row.payload as { platform: string }).platform).toBe("macos");
    expect(row.fetchedAt).toBeGreaterThan(0);
  });

  it("stores a preset accent and clears it with null", async () => {
    const w = await data.createWidget(FIXTURE_TYPE, "default");
    const res = await data.updateWidget(w.id, { accent: "violet" });
    expect(res.accent).toBe("violet");
    const cleared = await data.updateWidget(w.id, { accent: null });
    expect(cleared.accent).toBeNull();
  });

  it("silently normalizes a non-preset accent to null", async () => {
    const w = await data.createWidget(FIXTURE_TYPE, "default");
    await data.updateWidget(w.id, { accent: "violet" });
    const res = await data.updateWidget(w.id, { accent: "magenta" });
    expect(res.accent).toBeNull();
  });

  it("leaves accent untouched when the patch omits it", async () => {
    const w = await data.createWidget(FIXTURE_TYPE, "default");
    await data.updateWidget(w.id, { accent: "teal" });
    const res = await data.updateWidget(w.id, { title: "Renamed" });
    expect(res.accent).toBe("teal");
  });
});

describe("dashboard-data tabs", () => {
  it("fetchLayout returns tabs and defaults activeTabId to the first tab", async () => {
    const layout = await data.fetchLayout();
    expect(layout.tabs.map((t) => t.id)).toContain("default");
    expect(layout.activeTabId).toBe("default");
  });

  it("fetchLayout honors a persisted active tab, falling back when it is gone", async () => {
    const t = await tabsRepo.addTab("Work");
    await data.setActiveTab(t.id);
    expect((await data.fetchLayout()).activeTabId).toBe(t.id);
    await data.deleteTab(t.id);
    expect((await data.fetchLayout()).activeTabId).toBe("default");
  });

  it("createWidget assigns the given tab and moveWidgetToTab reassigns it", async () => {
    const t = await tabsRepo.addTab("Work");
    const w = await data.createWidget(FIXTURE_TYPE, t.id);
    expect(w.tabId).toBe(t.id);
    await data.moveWidgetToTab(w.id, "default");
    const layout = await data.fetchLayout();
    expect(layout.widgets.find((x) => x.id === w.id)!.tabId).toBe("default");
  });
});
