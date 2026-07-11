import { describe, it, expect } from "vitest";
import { orderedWidgets, applyReorder, applyResize } from "@/components/dashboard-logic";
import type { Widget } from "@/server/config-repo";

const mk = (id: string, order: number, extra: Partial<Widget> = {}): Widget => ({
  id, type: "core.status", title: null, accent: null, order, colSpan: 1, rowSpan: 6,
  hidden: false, config: {}, ...extra,
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
