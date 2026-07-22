import { describe, it, expect } from "vitest";
import {
  orderedWidgets, applyReorder, applyResize,
  widgetsForTab, applyReorderTabs, assignWidgetToTab,
  tabDndId, parseTabDndId, classifyDrag,
} from "@/components/dashboard-logic";
import { FIXTURE_TYPE } from "../helpers/fixture-widget";
import type { Widget, Tab } from "@/lib/backend";

const mk = (id: string, order: number, extra: Partial<Widget> = {}): Widget => ({
  id, type: FIXTURE_TYPE, title: null, accent: null, order, colSpan: 1, rowSpan: 6,
  hidden: false, tabId: "default", config: {}, ...extra,
});

describe("dashboard-logic", () => {
  it("orders visible widgets by order, skipping hidden", () => {
    const ws = [mk("a", 1), mk("b", 0), mk("c", 2, { hidden: true })];
    expect(orderedWidgets(ws).map((w) => w.id)).toEqual(["b", "a"]);
  });

  it("reorders a widget before another and reassigns a 0..n order", () => {
    const ws = [mk("a", 0), mk("b", 1), mk("c", 2)];
    const next = applyReorder(ws, "c", "a"); // move c to a's slot
    const map = Object.fromEntries(next.map((w) => [w.id, w.order]));
    expect(map).toEqual({ c: 0, a: 1, b: 2 });
  });

  it("keeps hidden widgets in the returned set unchanged", () => {
    const ws = [mk("a", 0), mk("b", 1), mk("h", 2, { hidden: true })];
    const next = applyReorder(ws, "b", "a");
    expect(next.find((w) => w.id === "h")).toMatchObject({ hidden: true });
  });

  it("applies a resize to one widget's spans", () => {
    const ws = [mk("a", 0), mk("b", 1)];
    const next = applyResize(ws, "a", 3, 8);
    expect(next.find((w) => w.id === "a")).toMatchObject({ colSpan: 3, rowSpan: 8 });
    expect(next.find((w) => w.id === "b")).toMatchObject({ colSpan: 1, rowSpan: 6 });
  });
});

describe("dashboard-logic tabs", () => {
  const mkTab = (id: string, order: number, name = id): Tab => ({ id, name, order });

  it("filters visible widgets to a tab, in order", () => {
    const ws = [
      mk("a", 1, { tabId: "t1" }),
      mk("b", 0, { tabId: "t1" }),
      mk("c", 2, { tabId: "t2" }),
      mk("h", 3, { tabId: "t1", hidden: true }),
    ];
    expect(widgetsForTab(ws, "t1").map((w) => w.id)).toEqual(["b", "a"]);
    expect(widgetsForTab(ws, "t2").map((w) => w.id)).toEqual(["c"]);
  });

  it("reorders tabs and reassigns a dense 0..n order", () => {
    const ts = [mkTab("a", 0), mkTab("b", 1), mkTab("c", 2)];
    const next = applyReorderTabs(ts, "c", "a");
    expect(next.map((t) => [t.id, t.order])).toEqual([["c", 0], ["a", 1], ["b", 2]]);
  });

  it("assigns a widget to a different tab", () => {
    const ws = [mk("a", 0, { tabId: "t1" }), mk("b", 1, { tabId: "t1" })];
    const next = assignWidgetToTab(ws, "a", "t2");
    expect(next.find((w) => w.id === "a")!.tabId).toBe("t2");
    expect(next.find((w) => w.id === "b")!.tabId).toBe("t1");
  });

  it("round-trips tab dnd ids", () => {
    expect(tabDndId("x")).toBe("tab:x");
    expect(parseTabDndId("tab:x")).toBe("x");
    expect(parseTabDndId("plain-uuid")).toBeNull();
  });

  it("classifies drag actions by type", () => {
    expect(classifyDrag({ id: "w1", type: "widget" }, { id: "w2", type: "widget" }))
      .toEqual({ kind: "reorder-widgets", activeId: "w1", overId: "w2" });
    expect(classifyDrag({ id: "tab:a", type: "tab" }, { id: "tab:b", type: "tab" }))
      .toEqual({ kind: "reorder-tabs", activeTabId: "a", overTabId: "b" });
    expect(classifyDrag({ id: "w1", type: "widget" }, { id: "tab:b", type: "tab" }))
      .toEqual({ kind: "move-widget-to-tab", widgetId: "w1", tabId: "b" });
    expect(classifyDrag({ id: "w1", type: "widget" }, null)).toEqual({ kind: "none" });
    expect(classifyDrag({ id: "w1", type: "widget" }, { id: "w1", type: "widget" }))
      .toEqual({ kind: "none" });
  });
});
