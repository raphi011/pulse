"use client";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Widget } from "@/server/config-repo";
import { WidgetCard } from "./widget-card";
import { useEditMode } from "./edit-mode";

export function SortableCard({ widget, onRemove }: { widget: Widget; onRemove: (id: string) => void }) {
  const { editing } = useEditMode();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: widget.id });
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 40 : undefined,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative ${isDragging ? "cursor-grabbing shadow-xl" : ""} ${editing ? "rounded-xl ring-1 ring-dashed ring-primary-500/30" : ""}`}
    >
      {editing && (
        <div className="absolute -top-2.5 right-2 z-10 flex gap-1">
          <button
            {...attributes}
            {...listeners}
            aria-label="Drag to reorder"
            className="icon-btn cursor-grab bg-panel text-slate-500 shadow-sm ring-1 ring-border active:cursor-grabbing dark:bg-panel-dark dark:ring-border-dark"
          >
            <span className="text-sm leading-none">⠿</span>
          </button>
          <button
            onClick={() => onRemove(widget.id)}
            aria-label="Remove widget"
            className="icon-btn bg-panel text-slate-500 shadow-sm ring-1 ring-border hover:bg-danger hover:text-white dark:bg-panel-dark dark:ring-border-dark"
          >
            <span className="text-xs leading-none">✕</span>
          </button>
        </div>
      )}
      <WidgetCard widget={widget} />
    </div>
  );
}
