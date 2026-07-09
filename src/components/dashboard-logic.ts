import type { Widget } from "@/server/config-repo";
import type { DragEndEvent } from "@dnd-kit/core";
import { findColumn, moveWidget, toPositions, type Columns } from "@/lib/layout";

export function buildColumns(widgets: Widget[], columnCount: number): Widget[][] {
  const n = Math.max(1, Number.isFinite(columnCount) ? Math.floor(columnCount) : 3);
  const cols: Widget[][] = Array.from({ length: n }, () => []);
  for (const w of widgets.filter((x) => !x.hidden)) {
    cols[Math.max(0, Math.min(w.column, n - 1))].push(w);
  }
  cols.forEach((c) => c.sort((a, b) => a.order - b.order));
  return cols;
}

function idColumns(widgets: Widget[], columnCount: number): Columns {
  return buildColumns(widgets, columnCount).map((c) => c.map((w) => w.id));
}

/** Move `activeId` to the position of `overId` (or empty column key `col:N`). */
export function reorderWidgets(widgets: Widget[], columnCount: number, activeId: string, overId: string): Widget[] {
  const cols = idColumns(widgets, columnCount);
  let toCol: number;
  let toIndex: number;
  if (overId.startsWith("col:")) {
    toCol = Number(overId.slice(4));
    toIndex = cols[toCol]?.length ?? 0;
  } else {
    toCol = findColumn(cols, overId);
    toIndex = cols[toCol].indexOf(overId);
  }
  if (toCol < 0) return widgets;
  const moved = moveWidget(cols, activeId, toCol, toIndex);
  const positions = toPositions(moved);
  const byId = Object.fromEntries(widgets.map((w) => [w.id, w]));
  const visible = positions.map((p) => ({ ...byId[p.id], column: p.column, order: p.order }));
  // buildColumns drops hidden widgets; re-append them unchanged so client state and
  // the persisted PATCH keep every widget.
  const hidden = widgets.filter((w) => w.hidden);
  return [...visible, ...hidden];
}

export function applyDragEnd(widgets: Widget[], columnCount: number, e: DragEndEvent): Widget[] | null {
  if (!e.over || e.active.id === e.over.id) return null;
  return reorderWidgets(widgets, columnCount, String(e.active.id), String(e.over.id));
}

export async function persistPositions(widgets: Widget[]): Promise<void> {
  const positions = widgets.map((w) => ({ id: w.id, column: w.column, order: w.order }));
  await fetch("/api/layout", { method: "PATCH", body: JSON.stringify({ positions }) });
}
