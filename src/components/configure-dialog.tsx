"use client";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Widget } from "@/server/config-repo";
import { getClientWidget } from "@/modules/client-registry";
import { SchemaForm } from "./schema-form";

export function ConfigureDialog({
  widget, onClose, onSaved,
}: {
  widget: Widget;
  onClose: () => void;
  onSaved: (id: string, config: Record<string, unknown>) => void;
}) {
  const def = getClientWidget(widget.type);
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, unknown>>(widget.config);
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
    const res = await fetch(`/api/widgets/${widget.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config: values }),
    });
    if (!res.ok) {
      setError("Invalid configuration");
      setSaving(false);
      return;
    }
    const fresh = await fetch(`/api/widgets/${widget.id}/data?refresh=1`).then((r) => r.json());
    qc.setQueryData(["widget", widget.id], fresh);
    onSaved(widget.id, values);
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
        <SchemaForm schema={def.configSchema} values={values} onChange={setValues} />
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
