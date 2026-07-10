"use client";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Widget } from "@/server/config-repo";
import { getRenderWidget } from "@/modules/render-registry";
import { updateWidget, fetchWidgetData } from "@/lib/dashboard-data";
import { SchemaForm } from "./schema-form";

export function ConfigureDialog({
  widget, onClose, onSaved,
}: {
  widget: Widget;
  onClose: () => void;
  onSaved: (id: string, config: Record<string, unknown>, title: string | null) => void;
}) {
  const def = getRenderWidget(widget.type);
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, unknown>>(widget.config);
  const [title, setTitle] = useState(widget.title ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!def) return null;

  async function save() {
    setSaving(true);
    setError(null);
    const nextTitle = title.trim() || null;
    let stored: unknown;
    let storedTitle: string | null | undefined;
    try {
      ({ config: stored, title: storedTitle } = await updateWidget(widget.id, { config: values, title: nextTitle }));
    } catch {
      setError("Invalid configuration");
      setSaving(false);
      return;
    }
    const fresh = await fetchWidgetData(widget.id, true);
    qc.setQueryData(["widget", widget.id], fresh);
    onSaved(widget.id, (stored ?? values) as Record<string, unknown>, storedTitle ?? nextTitle);
    setSaving(false);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4 [animation:wd-fade-in_.15s_ease-out] dark:bg-black/60"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Configure ${def.title}`}
        className="w-full max-w-sm rounded-xl bg-panel p-5 shadow-xl ring-1 ring-border dark:bg-panel-dark dark:ring-border-dark"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-sm font-semibold">Configure {def.title}</h2>
        <div className="mb-4 space-y-1.5">
          <label htmlFor="cfg-title" className="block text-xs font-medium text-slate-600 dark:text-slate-300">Title</label>
          <input
            id="cfg-title"
            className="w-full rounded-lg bg-surface px-2.5 py-1.5 text-sm ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-primary-500/50 dark:bg-surface-dark dark:ring-border-dark"
            value={title}
            placeholder={def.title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <p className="text-xs text-slate-500 dark:text-slate-400">Blank uses the default ({def.title}).</p>
        </div>
        {def.formEditable !== false && (
          <SchemaForm schema={def.configSchema} values={values} onChange={setValues} />
        )}
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button onClick={save} disabled={saving} className="btn btn-primary disabled:opacity-60">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
