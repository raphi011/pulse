import { describe, it, expect } from "vitest";
import { buildColumns, reorderWidgets } from "@/components/dashboard-logic";
import type { Widget } from "@/server/config-repo";

const mk = (id: string, column: number, order: number): Widget => ({
  id, type: "core.status", title: null, column, order, hidden: false, config: {},
});

describe("dashboard-logic", () => {
  it("builds columns sorted by order, skipping hidden", () => {
    const ws = [mk("a", 0, 1), mk("b", 0, 0), { ...mk("c", 1, 0), hidden: true }];
    const cols = buildColumns(ws, 3);
    expect(cols[0].map((w) => w.id)).toEqual(["b", "a"]);
    expect(cols[1]).toHaveLength(0);
  });

  it("reorders a widget onto another and reassigns column/order", () => {
    const ws = [mk("a", 0, 0), mk("b", 0, 1), mk("c", 1, 0)];
    const next = reorderWidgets(ws, 3, "c", "a"); // move c above a in column 0
    const map = Object.fromEntries(next.map((w) => [w.id, w]));
    expect(map.c.column).toBe(0);
    expect(map.c.order).toBe(0);
    expect(map.a.order).toBe(1);
    expect(map.b.order).toBe(2);
  });

  it("moves a widget into an empty column via the col:N target", () => {
    const ws = [mk("a", 0, 0), mk("b", 0, 1)]; // columns 1 and 2 are empty
    const next = reorderWidgets(ws, 3, "b", "col:2"); // drop b into empty column 2
    const map = Object.fromEntries(next.map((w) => [w.id, w]));
    expect(map.b.column).toBe(2);
    expect(map.b.order).toBe(0);
    expect(map.a.column).toBe(0);
    expect(map.a.order).toBe(0);
  });
});
