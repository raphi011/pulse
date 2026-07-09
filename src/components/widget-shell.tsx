"use client";
import type { ReactNode } from "react";

export type WidgetState = "loading" | "error" | "empty" | "ok";

function ago(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
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
    <section className="rounded-2xl bg-card ring-1 ring-border dark:bg-card-dark dark:ring-border-dark">
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5 dark:border-border-dark">
        <h3 className="text-sm font-semibold">{title}</h3>
        <div className="flex items-center gap-2 text-xs text-muted">
          {fetchedAt && <span>{ago(fetchedAt)}</span>}
          {headerExtra}
          <button aria-label="Refresh" onClick={onRefresh} className="rounded-md px-1.5 py-1 hover:bg-black/5 dark:hover:bg-white/10">↻</button>
        </div>
      </header>
      <div className="p-4">
        {state === "loading" && <p className="text-sm text-muted">Loading…</p>}
        {state === "error" && <p className="text-sm text-danger">{error ?? "Something went wrong"}</p>}
        {state === "empty" && <p className="text-sm text-muted">Nothing here yet.</p>}
        {state === "ok" && children}
      </div>
    </section>
  );
}
