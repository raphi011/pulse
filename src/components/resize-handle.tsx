"use client";
import { useRef } from "react";
import { clampSpan, spanFromDelta } from "@/lib/grid";

export function ResizeHandle({
  colSpan, rowSpan, cellWidth, rowUnit, maxCols, onCommit,
}: {
  colSpan: number;
  rowSpan: number;
  cellWidth: number;
  rowUnit: number;
  maxCols: number;
  onCommit: (colSpan: number, rowSpan: number) => void;
}) {
  const state = useRef<{ x: number; y: number; c: number; r: number } | null>(null);

  function spansAt(e: React.PointerEvent<HTMLButtonElement>, s: { x: number; y: number; c: number; r: number }) {
    const c = clampSpan(spanFromDelta(s.c, e.clientX - s.x, cellWidth), maxCols);
    const r = spanFromDelta(s.r, e.clientY - s.y, rowUnit);
    return { c, r };
  }

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    state.current = { x: e.clientX, y: e.clientY, c: colSpan, r: rowSpan };
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const s = state.current;
    if (!s) return;
    const { c, r } = spansAt(e, s);
    // Live preview: write spans straight onto the grid-item wrapper (the button's parent).
    const item = e.currentTarget.parentElement;
    if (item) {
      item.style.gridColumn = `span ${c}`;
      item.style.gridRow = `span ${r}`;
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    const s = state.current;
    state.current = null;
    if (!s) return;
    const { c, r } = spansAt(e, s);
    onCommit(c, r);
  }

  return (
    <button
      type="button"
      aria-label="Resize"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="absolute bottom-1 right-1 z-10 hidden h-4 w-4 cursor-se-resize touch-none place-items-center rounded text-slate-400 opacity-0 transition-opacity group-hover/card:grid group-hover/card:opacity-100 hover:text-slate-600 dark:hover:text-slate-200"
    >
      <span aria-hidden className="text-[0.7rem] leading-none">⇲</span>
    </button>
  );
}
