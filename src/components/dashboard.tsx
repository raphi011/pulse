"use client";
import { useState } from "react";
import { DndContext, closestCorners, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Widget } from "@/server/config-repo";
import { buildColumns, applyDragEnd, persistPositions } from "@/components/dashboard-logic";
import { SortableCard } from "./sortable-card";
import { AddWidgetDrawer } from "./add-widget-drawer";
import { EditModeProvider, useEditMode } from "./edit-mode";

function Toolbar({ onAdd }: { onAdd: (type: string) => void }) {
  const { editing, toggle } = useEditMode();
  return (
    <div className="sticky top-0 z-30 border-b border-border/80 bg-surface/80 backdrop-blur dark:border-border-dark/80 dark:bg-surface-dark/70">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="grid h-7 w-7 place-items-center rounded-lg bg-primary-600 text-sm font-bold text-white shadow-sm"
          >
            W
          </span>
          <h1 className="text-[0.9375rem] font-semibold tracking-tight">Work Dashboard</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggle}
            aria-pressed={editing}
            className={`btn ${editing ? "btn-active" : "btn-ghost"}`}
          >
            {editing ? "Done" : "Edit"}
          </button>
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
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const columns = buildColumns(widgets, columnCount);
  const isEmpty = columns.every((col) => col.length === 0);

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
    const next = applyDragEnd(widgets, columnCount, e);
    if (next) { setWidgets(next); void persistPositions(next); }
  }

  return (
    <EditModeProvider>
      <Toolbar onAdd={onAdd} />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {isEmpty ? (
          <EmptyState />
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
            <div className="wd-grid" style={{ ["--wd-cols" as string]: columnCount }}>
              {columns.map((col, i) => (
                <SortableContext key={i} items={col.map((w) => w.id)} strategy={verticalListSortingStrategy}>
                  <div className="flex flex-col gap-4">
                    {col.map((w) => <SortableCard key={w.id} widget={w} onRemove={onRemove} />)}
                  </div>
                </SortableContext>
              ))}
            </div>
          </DndContext>
        )}
      </main>
    </EditModeProvider>
  );
}
