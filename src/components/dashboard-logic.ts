import type { Widget } from "@/server/config-repo";
import type { DragEndEvent } from "@dnd-kit/core";

/** Visible widgets in global flow order. */
export function orderedWidgets(widgets: Widget[]): Widget[] {
  return widgets.filter((w) => !w.hidden).sort((a, b) => a.order - b.order);
}

/** Move `activeId` to `overId`'s slot; reassign a dense 0..n order over visible widgets. */
export function applyReorder(widgets: Widget[], activeId: string, overId: string): Widget[] {
  const visible = orderedWidgets(widgets);
  const from = visible.findIndex((w) => w.id === activeId);
  const to = visible.findIndex((w) => w.id === overId);
  if (from < 0 || to < 0) return widgets;
  const reordered = [...visible];
  const [moved] = reordered.splice(from, 1);
  reordered.splice(to, 0, moved);
  const orderById = new Map(reordered.map((w, i) => [w.id, i]));
  return widgets.map((w) => (orderById.has(w.id) ? { ...w, order: orderById.get(w.id)! } : w));
}

/** Set one widget's spans. */
export function applyResize(widgets: Widget[], id: string, colSpan: number, rowSpan: number): Widget[] {
  return widgets.map((w) => (w.id === id ? { ...w, colSpan, rowSpan } : w));
}

export function applyDragEnd(widgets: Widget[], e: DragEndEvent): Widget[] | null {
  if (!e.over || e.active.id === e.over.id) return null;
  return applyReorder(widgets, String(e.active.id), String(e.over.id));
}

export async function persistPositions(widgets: Widget[]): Promise<void> {
  const positions = widgets.map((w) => ({
    id: w.id, order: w.order, colSpan: w.colSpan, rowSpan: w.rowSpan,
  }));
  await fetch("/api/layout", { method: "PATCH", body: JSON.stringify({ positions }) });
}
