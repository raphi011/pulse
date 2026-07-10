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
      className="absolute bottom-1 right-1 z-10 grid h-5 w-5 cursor-se-resize touch-none place-items-center rounded-md bg-card/70 text-slate-400 opacity-60 backdrop-blur-sm transition-all group-hover/card:opacity-100 hover:bg-card hover:text-slate-600 focus-visible:opacity-100 dark:bg-card-dark/70 dark:text-slate-500 dark:hover:bg-card-dark dark:hover:text-slate-300"
    >
      <svg aria-hidden width="11" height="11" viewBox="0 0 11 11" fill="none" className="pointer-events-none">
        <path d="M10 2 L2 10 M10 6 L6 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}
