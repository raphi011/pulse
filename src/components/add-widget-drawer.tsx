"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { listRenderWidgets } from "@/modules/render-registry";
import type { IntegrationStatus } from "@/modules/integration-contracts";
import { BrandIcon } from "./brand-icon";

export function AddWidgetDrawer({ onAdd }: { onAdd: (type: string) => void }) {
  const [open, setOpen] = useState(false);
  const { data: statuses } = useQuery({
    queryKey: ["integrations"],
    queryFn: async (): Promise<IntegrationStatus[]> => (await fetch("/api/integrations")).json(),
    enabled: open,
  });
  const enabledIds = new Set((statuses ?? []).filter((s) => s.enabled).map((s) => s.id));
  const types = listRenderWidgets().filter((t) => !t.integration || enabledIds.has(t.integration));

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn btn-primary">
        <span aria-hidden className="text-base leading-none">+</span>
        Add widget
      </button>
      {open && createPortal(
        <div
          className="fixed inset-0 z-50 flex justify-end bg-slate-950/40 [animation:wd-fade-in_.15s_ease-out] dark:bg-black/60"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-label="Add a widget"
            aria-modal="true"
            className="flex h-full w-80 flex-col border-l border-border bg-panel shadow-xl [animation:wd-slide-in_.28s_var(--ease-out-quart)] dark:border-border-dark dark:bg-panel-dark"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3 dark:border-border-dark">
              <h2 className="text-sm font-semibold">Add a widget</h2>
              <button aria-label="Close" onClick={() => setOpen(false)} className="icon-btn">
                <span className="text-base leading-none">✕</span>
              </button>
            </div>
            <ul className="flex-1 space-y-1.5 overflow-y-auto p-3">
              {types.map((t) => (
                <li key={t.type}>
                  <button
                    onClick={() => { onAdd(t.type); setOpen(false); }}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm ring-1 ring-border transition-colors duration-150 ease-out hover:bg-slate-100 hover:ring-primary-500/40 dark:ring-border-dark dark:hover:bg-white/5"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <BrandIcon mark={t.icon} />
                      <span className="truncate font-medium">{t.title}</span>
                    </span>
                    <span aria-hidden className="text-slate-400">+</span>
                  </button>
                </li>
              ))}
              {types.length === 0 && (
                <li className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">No widgets available.</li>
              )}
            </ul>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
