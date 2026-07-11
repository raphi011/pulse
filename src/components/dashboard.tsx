"use client";
import { AppLink as Link } from "@/components/app-link";
import { useEffect, useRef, useState } from "react";
import {
  DndContext, DragOverlay, closestCenter,
  PointerSensor, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import type { Widget } from "@/server/config-repo";
import { orderedWidgets, applyDragEnd, applyResize, persistPositions } from "@/components/dashboard-logic";
import { createWidget, deleteWidget } from "@/lib/dashboard-data";
import { columnCountForWidth, ROW_UNIT_PX } from "@/lib/grid";
import { SortableCard } from "./sortable-card";
import { WidgetCard } from "./widget-card";
import { AddWidgetDrawer } from "./add-widget-drawer";
import { ConfigureDialog } from "./configure-dialog";
import { useAutoRefresh } from "./auto-refresh-context";

function AutoRefreshControls() {
  const { enabled, toggle, refreshAll } = useAutoRefresh();
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={enabled}
        className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 transition-colors ${
          enabled
            ? "bg-primary-600 text-white ring-primary-600"
            : "text-slate-600 ring-border hover:bg-slate-50 dark:text-slate-300 dark:ring-border-dark dark:hover:bg-white/5"
        }`}
      >
        Auto-refresh {enabled ? "on" : "off"}
      </button>
      <button
        type="button"
        onClick={refreshAll}
        aria-label="Refresh all widgets"
        title="Refresh all widgets"
        className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 ring-1 ring-border transition-colors hover:bg-slate-50 hover:text-slate-700 dark:text-slate-400 dark:ring-border-dark dark:hover:bg-white/5"
      >
        ↻
      </button>
    </div>
  );
}

function Toolbar({ onAdd }: { onAdd: (type: string) => void }) {
  return (
    <div className="sticky top-0 z-30 border-b border-border/80 bg-surface/80 backdrop-blur dark:border-border-dark/80 dark:bg-surface-dark/70">
      <div className="flex items-center justify-end gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <AutoRefreshControls />
          <Link
            href="/integrations"
            aria-label="Integrations"
            title="Integrations"
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 ring-1 ring-border transition-colors hover:bg-slate-50 hover:text-slate-700 dark:text-slate-400 dark:ring-border-dark dark:hover:bg-white/5"
          >
            🔌
          </Link>
          <AddWidgetDrawer onAdd={onAdd} />
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mt-16 flex flex-col items-center justify-center text-center" style={{ gridColumn: "1 / -1" }}>
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-xl text-slate-400 ring-1 ring-border dark:bg-white/5 dark:ring-border-dark">
        ▦
      </div>
      <p className="mt-4 text-sm font-medium">Your dashboard is empty</p>
      <p className="mt-1 max-w-xs text-sm text-slate-500 dark:text-slate-400">
        Use <span className="font-medium text-slate-700 dark:text-slate-300">Add widget</span> to start
        assembling your workspace.
      </p>
    </div>
  );
}

export function Dashboard({ initialWidgets }: { initialWidgets: Widget[] }) {
  const [widgets, setWidgets] = useState(initialWidgets);
  const [configuring, setConfiguring] = useState<Widget | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cols = width > 0 ? columnCountForWidth(width) : 1;
  // Track width minus the inter-column gaps (1rem) so resize snapping matches real cells.
  const cellWidth = width > 0 ? (width - (cols - 1) * 16) / cols : ROW_UNIT_PX;
  const visible = orderedWidgets(widgets);
  const isEmpty = visible.length === 0;
  const activeWidget = activeId ? widgets.find((w) => w.id === activeId) ?? null : null;

  async function onAdd(type: string) {
    try {
      const added = await createWidget(type);
      setWidgets((w) => [...w, added]);
    } catch (err) {
      console.error("Failed to add widget", err);
    }
  }
  async function onRemove(id: string) {
    await deleteWidget(id);
    setWidgets((w) => w.filter((x) => x.id !== id));
  }
  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const next = applyDragEnd(widgets, e);
    if (next) { setWidgets(next); void persistPositions(next); }
  }
  function onResize(id: string, colSpan: number, rowSpan: number) {
    const next = applyResize(widgets, id, colSpan, rowSpan);
    setWidgets(next);
    void persistPositions(next);
  }
  function onConfigSaved(id: string, config: Record<string, unknown>, title: string | null, accent: string | null) {
    setWidgets((ws) => ws.map((w) => (w.id === id ? { ...w, config, title, accent } : w)));
  }

  return (
    <>
      <Toolbar onAdd={onAdd} />
      <main className="px-4 py-6 sm:px-6 lg:px-8">
        <div ref={gridRef} className="wd-grid" style={{ ["--wd-cols" as string]: cols, ["--wd-row-unit" as string]: `${ROW_UNIT_PX}px` }}>
          {isEmpty ? (
            <EmptyState />
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
              onDragEnd={onDragEnd}
              onDragCancel={() => setActiveId(null)}
            >
              <SortableContext items={visible.map((w) => w.id)} strategy={rectSortingStrategy}>
                {visible.map((w) => (
                  <SortableCard
                    key={w.id}
                    widget={w}
                    cols={cols}
                    cellWidth={cellWidth}
                    onRemove={onRemove}
                    onConfigure={setConfiguring}
                    onResize={onResize}
                  />
                ))}
              </SortableContext>
              <DragOverlay>
                {activeWidget ? (
                  <div className="cursor-grabbing rounded-xl shadow-2xl ring-1 ring-black/5 dark:ring-white/10">
                    <WidgetCard widget={activeWidget} />
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          )}
        </div>
      </main>
      {configuring && (
        <ConfigureDialog
          widget={configuring}
          onClose={() => setConfiguring(null)}
          onSaved={onConfigSaved}
        />
      )}
    </>
  );
}
