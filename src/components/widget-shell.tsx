"use client";
import { useEffect, useState, type ReactNode } from "react";
import type { DraggableAttributes, DraggableSyntheticListeners } from "@dnd-kit/core";
import { accentBorderClass } from "@/lib/accents";

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

/** Re-render once a minute so a rendered `ago()` label stays current without a data refresh. */
function useMinuteTick(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, [active]);
}

function issueStyle(kind?: string | null): { colorClass: string; label: string } {
  switch (kind) {
    case "auth": return { colorClass: "text-warn", label: "Authentication issue" };
    case "not-found": return { colorClass: "text-warn", label: "Tool not installed" };
    case "timeout": return { colorClass: "text-warn", label: "Timed out" };
    default: return { colorClass: "text-danger", label: "Error" };
  }
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
  title, icon, count, state, error, fetchedAt, onRefresh, refreshing, refreshable = true, children, headerExtra, menu, dragHandle, issue, accent,
}: {
  title: string;
  icon?: ReactNode;
  count?: number | null;
  state: WidgetState;
  error?: string | null;
  fetchedAt: number | null;
  onRefresh: () => void;
  refreshing?: boolean;
  /** False = widget data only changes through its own controls: no refresh button, no timestamp. */
  refreshable?: boolean;
  children?: ReactNode;
  headerExtra?: ReactNode;
  menu?: ReactNode;
  dragHandle?: DragHandle;
  issue?: { message: string; kind?: string | null } | null;
  /** Preset accent name (src/lib/accents.ts); null/unknown = default border. */
  accent?: string | null;
}) {
  const { setRef, attributes, listeners } = dragHandle ?? {};
  const accentBorder = accentBorderClass(accent);
  useMinuteTick(refreshable && fetchedAt != null);
  return (
    <section
      data-accent={accentBorder ? accent : undefined}
      className={`group/card relative flex h-full flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition-[box-shadow,border-color] duration-150 hover:shadow-md dark:bg-card-dark dark:shadow-none ${
        accentBorder ?? "border-border dark:border-border-dark dark:hover:border-white/15"
      }`}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-3.5 py-2.5 dark:border-border-dark">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {icon}
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
          {issue && (() => {
            const { colorClass, label } = issueStyle(issue.kind);
            return (
            <span
              aria-label={label}
              title={issue.message}
              className={`grid h-5 w-5 place-items-center rounded ${colorClass}`}
            >
              <span aria-hidden className="text-[0.95rem] leading-none">⚠</span>
            </span>
            );
          })()}
          {refreshable && fetchedAt && <span className="tabular-nums">{ago(fetchedAt)}</span>}
          {headerExtra}
          {menu}
          {refreshable && (
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
          )}
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
