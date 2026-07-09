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
    <div className="mb-6 flex items-center justify-between">
      <h1 className="text-lg font-bold">Work Dashboard</h1>
      <div className="flex items-center gap-2">
        <button onClick={toggle} className="rounded-xl px-3 py-1.5 text-sm ring-1 ring-border dark:ring-border-dark">
          {editing ? "Done" : "Edit"}
        </button>
        <AddWidgetDrawer onAdd={onAdd} />
      </div>
    </div>
  );
}

export function Dashboard({ initialWidgets, columnCount }: { initialWidgets: Widget[]; columnCount: number }) {
  const [widgets, setWidgets] = useState(initialWidgets);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const columns = buildColumns(widgets, columnCount);

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
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <Toolbar onAdd={onAdd} />
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
          <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}>
            {columns.map((col, i) => (
              <SortableContext key={i} items={col.map((w) => w.id)} strategy={verticalListSortingStrategy}>
                <div className="flex flex-col gap-4">
                  {col.map((w) => <SortableCard key={w.id} widget={w} onRemove={onRemove} />)}
                </div>
              </SortableContext>
            ))}
          </div>
        </DndContext>
      </main>
    </EditModeProvider>
  );
}
