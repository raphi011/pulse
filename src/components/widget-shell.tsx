"use client";
import type { ReactNode } from "react";
import type { DraggableAttributes, DraggableSyntheticListeners } from "@dnd-kit/core";

export type WidgetState = "loading" | "error" | "empty" | "ok";

export type DragHandle = {
  setRef: (el: HTMLElement | null) => void;
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
};

function ago(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function Skeleton() {
  return (
    <div className="space-y-2.5" aria-hidden>
      <div className="h-3 w-3/5 animate-pulse rounded bg-slate-200 dark:bg-white/10" />
      <div className="h-3 w-4/5 animate-pulse rounded bg-slate-200 dark:bg-white/10" />
      <div className="h-3 w-2/5 animate-pulse rounded bg-slate-200 dark:bg-white/10" />
    </div>
  );
}

export function WidgetShell({
  title, count, state, error, fetchedAt, onRefresh, refreshing, children, headerExtra, menu, dragHandle,
}: {
  title: string;
  count?: number | null;
  state: WidgetState;
  error?: string | null;
  fetchedAt: number | null;
  onRefresh: () => void;
  refreshing?: boolean;
  children?: ReactNode;
  headerExtra?: ReactNode;
  menu?: ReactNode;
  dragHandle?: DragHandle;
}) {
  const { setRef, attributes, listeners } = dragHandle ?? {};
  return (
    <section className="group/card flex h-full flex-col overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-border transition-shadow duration-150 hover:shadow-md dark:bg-card-dark dark:shadow-none dark:ring-border-dark dark:hover:ring-white/15">
      <header className="flex items-center justify-between gap-2 border-b border-border px-3.5 py-2.5 dark:border-border-dark">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {dragHandle ? (
            <h3
              ref={setRef}
              {...attributes}
              {...listeners}
              title="Drag to move"
              className="min-w-0 cursor-grab touch-none select-none truncate text-[0.8125rem] font-semibold tracking-tight text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-primary-500/50 active:cursor-grabbing dark:text-slate-100"
            >
              {title}
            </h3>
          ) : (
            <h3 className="min-w-0 truncate text-[0.8125rem] font-semibold tracking-tight">{title}</h3>
          )}
          {count != null && (
            <span className="shrink-0 text-[0.8125rem] font-semibold tabular-nums text-slate-400 dark:text-slate-500">
              ({count})
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          {fetchedAt && <span className="tabular-nums">{ago(fetchedAt)}</span>}
          {headerExtra}
          {menu}
          <button
            aria-label="Refresh"
            onClick={onRefresh}
            disabled={refreshing}
            className="icon-btn hover:[&>span]:rotate-90 disabled:cursor-default"
          >
            <span
              className={`inline-block text-[0.95rem] leading-none transition-transform duration-300 ease-out ${
                refreshing ? "animate-spin" : ""
              }`}
            >
              ↻
            </span>
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
        {state === "loading" && (
          <>
            <span className="sr-only">Loading…</span>
            <Skeleton />
          </>
        )}
        {state === "error" && (
          <div className="flex items-start gap-2 text-sm text-danger">
            <span aria-hidden className="mt-px select-none">⚠</span>
            <p className="min-w-0 break-words">{error ?? "Something went wrong"}</p>
          </div>
        )}
        {state === "empty" && (
          <p className="py-2 text-sm text-slate-500 dark:text-slate-400">Nothing here yet.</p>
        )}
        {state === "ok" && children}
      </div>
    </section>
  );
}
