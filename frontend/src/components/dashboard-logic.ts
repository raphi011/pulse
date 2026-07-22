import type { Widget, Tab } from "@/lib/backend";
import { savePositions } from "@/lib/dashboard-data";

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
  // Renumber visible first (0..k-1), then hidden after them, so `order` stays a
  // collision-free global sequence even though hidden widgets aren't in the grid.
  const hidden = widgets.filter((w) => w.hidden).sort((a, b) => a.order - b.order);
  const orderById = new Map<string, number>();
  reordered.forEach((w, i) => orderById.set(w.id, i));
  hidden.forEach((w, i) => orderById.set(w.id, reordered.length + i));
  return widgets.map((w) => (orderById.has(w.id) ? { ...w, order: orderById.get(w.id)! } : w));
}

/** Set one widget's spans. */
export function applyResize(widgets: Widget[], id: string, colSpan: number, rowSpan: number): Widget[] {
  return widgets.map((w) => (w.id === id ? { ...w, colSpan, rowSpan } : w));
}

export async function persistPositions(widgets: Widget[]): Promise<void> {
  const positions = widgets.map((w) => ({
    id: w.id, order: w.order, colSpan: w.colSpan, rowSpan: w.rowSpan,
  }));
  await savePositions(positions);
}

/** Visible widgets belonging to one tab, in global flow order. */
export function widgetsForTab(widgets: Widget[], tabId: string): Widget[] {
  return orderedWidgets(widgets).filter((w) => w.tabId === tabId);
}

/** Move `activeId` tab to `overId`'s slot; reassign a dense 0..n order. */
export function applyReorderTabs(tabs: Tab[], activeId: string, overId: string): Tab[] {
  const sorted = [...tabs].sort((a, b) => a.order - b.order);
  const from = sorted.findIndex((t) => t.id === activeId);
  const to = sorted.findIndex((t) => t.id === overId);
  if (from < 0 || to < 0) return tabs;
  const [moved] = sorted.splice(from, 1);
  sorted.splice(to, 0, moved);
  return sorted.map((t, i) => ({ ...t, order: i }));
}

/** Reassign one widget to a tab. */
export function assignWidgetToTab(widgets: Widget[], widgetId: string, tabId: string): Widget[] {
  return widgets.map((w) => (w.id === widgetId ? { ...w, tabId } : w));
}

export const TAB_DND_PREFIX = "tab:";
export function tabDndId(id: string): string {
  return TAB_DND_PREFIX + id;
}
export function parseTabDndId(id: string): string | null {
  return id.startsWith(TAB_DND_PREFIX) ? id.slice(TAB_DND_PREFIX.length) : null;
}

export type DragAction =
  | { kind: "reorder-widgets"; activeId: string; overId: string }
  | { kind: "reorder-tabs"; activeTabId: string; overTabId: string }
  | { kind: "move-widget-to-tab"; widgetId: string; tabId: string }
  | { kind: "none" };

/** Decide what a drag means from the dragged/over item ids and their `data.type`. */
export function classifyDrag(
  active: { id: string; type?: string },
  over: { id: string; type?: string } | null,
): DragAction {
  if (!over) return { kind: "none" };
  if (active.type === "widget" && over.type === "widget") {
    return active.id === over.id
      ? { kind: "none" }
      : { kind: "reorder-widgets", activeId: active.id, overId: over.id };
  }
  if (active.type === "tab" && over.type === "tab") {
    const at = parseTabDndId(active.id);
    const ot = parseTabDndId(over.id);
    if (!at || !ot || at === ot) return { kind: "none" };
    return { kind: "reorder-tabs", activeTabId: at, overTabId: ot };
  }
  if (active.type === "widget" && over.type === "tab") {
    const t = parseTabDndId(over.id);
    return t ? { kind: "move-widget-to-tab", widgetId: active.id, tabId: t } : { kind: "none" };
  }
  return { kind: "none" };
}
