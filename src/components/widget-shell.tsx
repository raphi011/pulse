"use client";
import type { ReactNode } from "react";

export type WidgetState = "loading" | "error" | "empty" | "ok";

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
  title, state, error, fetchedAt, onRefresh, children, headerExtra,
}: {
  title: string;
  state: WidgetState;
  error?: string | null;
  fetchedAt: number | null;
  onRefresh: () => void;
  children?: ReactNode;
  headerExtra?: ReactNode;
}) {
  return (
    <section className="group/card overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-border transition-shadow duration-150 hover:shadow-md dark:bg-card-dark dark:shadow-none dark:ring-border-dark dark:hover:ring-white/15">
      <header className="flex items-center justify-between gap-2 border-b border-border px-3.5 py-2.5 dark:border-border-dark">
        <h3 className="truncate text-[0.8125rem] font-semibold tracking-tight">{title}</h3>
        <div className="flex shrink-0 items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          {fetchedAt && <span className="tabular-nums">{ago(fetchedAt)}</span>}
          {headerExtra}
          <button
            aria-label="Refresh"
            onClick={onRefresh}
            className="icon-btn hover:[&>span]:rotate-90"
          >
            <span className="inline-block text-[0.95rem] leading-none transition-transform duration-300 ease-out">↻</span>
          </button>
        </div>
      </header>
      <div className="px-3.5 py-3">
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
