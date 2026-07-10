"use client";
import { useState, type ReactNode } from "react";
import {
  DndContext, DragOverlay, pointerWithin, closestCorners, useDroppable,
  PointerSensor, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent, type CollisionDetection,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Widget } from "@/server/config-repo";
import { buildColumns, applyDragEnd, persistPositions } from "@/components/dashboard-logic";
import { SortableCard } from "./sortable-card";
import { WidgetCard } from "./widget-card";
import { AddWidgetDrawer } from "./add-widget-drawer";
import { ConfigureDialog } from "./configure-dialog";
import { useAutoRefresh } from "./auto-refresh-context";

const isColId = (id: string | number) => String(id).startsWith("col:");

/**
 * Prefer a card under the pointer (precise reorder); otherwise the closest card
 * within the hovered column, falling back to the column itself (`col:N`) when it
 * is empty; otherwise the globally closest card. Column droppables are what make
 * dropping into an empty column — and thus moving widgets back — possible.
 */
const collisionDetection: CollisionDetection = (args) => {
  const pointer = pointerWithin(args);
  const pointerCard = pointer.find((c) => !isColId(c.id));
  if (pointerCard) return [pointerCard];

  const pointerCol = pointer.find((c) => isColId(c.id));
  if (pointerCol) {
    const colIndex = Number(String(pointerCol.id).slice(4));
    const inColumn = closestCorners({
      ...args,
      droppableContainers: args.droppableContainers.filter(
        (d) => !isColId(d.id) && d.data.current?.column === colIndex,
      ),
    });
    return inColumn.length ? [inColumn[0]] : [pointerCol];
  }

  const corners = closestCorners(args).filter((c) => !isColId(c.id));
  return corners.length ? [corners[0]] : [];
};

function DroppableColumn({ index, isEmpty, children }: { index: number; isEmpty: boolean; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${index}` });
  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col gap-4 ${
        isEmpty
          ? `min-h-28 rounded-xl ring-1 ring-dashed transition-colors ${
              isOver ? "ring-2 ring-primary-500/50 bg-primary-500/5" : "ring-border dark:ring-border-dark"
            }`
          : ""
      }`}
    >
      {children}
      {isEmpty && (
        <div className="grid flex-1 place-items-center text-xs text-slate-400 dark:text-slate-500">Drop here</div>
      )}
    </div>
  );
}

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
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="grid h-7 w-7 place-items-center rounded-lg bg-primary-600 text-sm font-bold text-white shadow-sm"
          >
            P
          </span>
          <h1 className="text-[0.9375rem] font-semibold tracking-tight">Pulse</h1>
        </div>
        <div className="flex items-center gap-3">
          <AutoRefreshControls />
          <AddWidgetDrawer onAdd={onAdd} />
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mt-16 flex flex-col items-center justify-center text-center">
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

export function Dashboard({ initialWidgets, columnCount }: { initialWidgets: Widget[]; columnCount: number }) {
  const [widgets, setWidgets] = useState(initialWidgets);
  const [configuring, setConfiguring] = useState<Widget | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const columns = buildColumns(widgets, columnCount);
  const isEmpty = columns.every((col) => col.length === 0);
  const activeWidget = activeId ? widgets.find((w) => w.id === activeId) ?? null : null;

  async function onAdd(type: string) {
    const res = await fetch("/api/widgets", { method: "POST", body: JSON.stringify({ type }) });
    if (res.ok) {
      const added = await res.json();
      setWidgets((w) => [...w, added]);
    }
  }
  async function onRemove(id: string) {
    await fetch(`/api/widgets/${id}`, { method: "DELETE" });
    setWidgets((w) => w.filter((x) => x.id !== id));
  }
  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const next = applyDragEnd(widgets, columnCount, e);
    if (next) { setWidgets(next); void persistPositions(next); }
  }
  function onConfigSaved(id: string, config: Record<string, unknown>, title: string | null) {
    setWidgets((ws) => ws.map((w) => (w.id === id ? { ...w, config, title } : w)));
  }

  return (
    <>
      <Toolbar onAdd={onAdd} />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {isEmpty ? (
          <EmptyState />
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
            onDragEnd={onDragEnd}
            onDragCancel={() => setActiveId(null)}
          >
            <div className="wd-grid" style={{ ["--wd-cols" as string]: columnCount }}>
              {columns.map((col, i) => (
                <SortableContext key={i} items={col.map((w) => w.id)} strategy={verticalListSortingStrategy}>
                  <DroppableColumn index={i} isEmpty={col.length === 0}>
                    {col.map((w) => <SortableCard key={w.id} widget={w} onRemove={onRemove} onConfigure={setConfiguring} />)}
                  </DroppableColumn>
                </SortableContext>
              ))}
            </div>
            <DragOverlay>
              {activeWidget ? (
                <div className="cursor-grabbing rounded-xl shadow-2xl ring-1 ring-black/5 dark:ring-white/10">
                  <WidgetCard widget={activeWidget} />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
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
