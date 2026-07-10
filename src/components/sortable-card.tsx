"use client";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Widget } from "@/server/config-repo";
import { WidgetCard } from "./widget-card";

export function SortableCard({ widget, onRemove, onConfigure }: { widget: Widget; onRemove: (id: string) => void; onConfigure: (w: Widget) => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: widget.id,
    data: { column: widget.column },
  });
  // While dragging, the DragOverlay renders the moving copy; keep the original in
  // place as a dimmed ghost (no translate) so its slot is preserved across columns.
  const style = {
    transform: isDragging ? undefined : CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={style}>
      <WidgetCard
        widget={widget}
        onRemove={onRemove}
        onConfigure={onConfigure}
        dragHandle={{ setRef: setActivatorNodeRef, attributes, listeners }}
      />
    </div>
  );
}
