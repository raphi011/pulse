"use client";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Widget } from "@/server/config-repo";
import { WidgetCard } from "./widget-card";
import { useEditMode } from "./edit-mode";

export function SortableCard({ widget, onRemove }: { widget: Widget; onRemove: (id: string) => void }) {
  const { editing } = useEditMode();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: widget.id });
  const style = { transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <div ref={setNodeRef} style={style} className="relative">
      {editing && (
        <div className="absolute -top-2 right-2 z-10 flex gap-1">
          <button {...attributes} {...listeners} aria-label="Drag" className="cursor-grab rounded-md bg-primary-500 px-2 text-xs text-white">⠿</button>
          <button onClick={() => onRemove(widget.id)} aria-label="Remove" className="rounded-md bg-danger px-2 text-xs text-white">✕</button>
        </div>
      )}
      <WidgetCard widget={widget} />
    </div>
  );
}
