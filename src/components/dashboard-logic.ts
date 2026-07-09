import type { Widget } from "@/server/config-repo";
import type { DragEndEvent } from "@dnd-kit/core";
export function buildColumns(widgets: Widget[], columnCount: number): Widget[][] {
  const cols: Widget[][] = Array.from({ length: columnCount }, () => []);
  for (const w of widgets.filter((x) => !x.hidden)) cols[Math.min(w.column, columnCount - 1)].push(w);
  cols.forEach((c) => c.sort((a, b) => a.order - b.order));
  return cols;
}
export function applyDragEnd(_w: Widget[], _c: number, _e: DragEndEvent): Widget[] | null { return null; }
export async function persistPositions(_w: Widget[]): Promise<void> {}
