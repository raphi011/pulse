"use client";
import { useState } from "react";
import { listClientWidgets } from "@/modules/client-registry";

export function AddWidgetDrawer({ onAdd }: { onAdd: (type: string) => void }) {
  const [open, setOpen] = useState(false);
  const types = listClientWidgets();
  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-xl bg-primary-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-600">
        + Add widget
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setOpen(false)}>
          <div className="h-full w-80 bg-card p-4 dark:bg-card-dark" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-3 text-sm font-semibold">Add a widget</h2>
            <ul className="space-y-2">
              {types.map((t) => (
                <li key={t.type}>
                  <button
                    onClick={() => { onAdd(t.type); setOpen(false); }}
                    className="w-full rounded-lg px-3 py-2 text-left text-sm ring-1 ring-border hover:bg-black/5 dark:ring-border-dark dark:hover:bg-white/10"
                  >
                    {t.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
