"use client";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Widget } from "@/server/config-repo";
import { clampSpan, ROW_UNIT_PX } from "@/lib/grid";
import { WidgetCard } from "./widget-card";
import { ResizeHandle } from "./resize-handle";

export function SortableCard({
  widget, cols, cellWidth, onRemove, onConfigure, onResize, onConfigChange,
}: {
  widget: Widget;
  cols: number;
  cellWidth: number;
  onRemove: (id: string) => void;
  onConfigure: (w: Widget) => void;
  onResize: (id: string, colSpan: number, rowSpan: number) => void;
  onConfigChange: (id: string, config: Record<string, unknown>) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: widget.id });
  const colSpan = clampSpan(widget.colSpan, cols);
  const style = {
    transform: isDragging ? undefined : CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    gridColumn: `span ${colSpan}`,
    gridRow: `span ${widget.rowSpan}`,
  };
  return (
    <div ref={setNodeRef} style={style} className="group/card relative min-h-0">
      <WidgetCard
        widget={widget}
        onRemove={onRemove}
        onConfigure={onConfigure}
        onConfigChange={onConfigChange}
        dragHandle={{ setRef: setActivatorNodeRef, attributes, listeners }}
      />
      <ResizeHandle
        colSpan={colSpan}
        rowSpan={widget.rowSpan}
        cellWidth={cellWidth}
        rowUnit={ROW_UNIT_PX}
        maxCols={cols}
        onCommit={(c, r) => onResize(widget.id, c, r)}
      />
    </div>
  );
}
