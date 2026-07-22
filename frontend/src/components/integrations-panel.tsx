"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AppLink as Link } from "@/components/app-link";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast-context";
import type { IntegrationStatus } from "@/modules/integration-contracts";
import { toggleIntegration, fetchIntegrations } from "@/lib/dashboard-data";
import { BrandIcon } from "./brand-icon";
import { integrationIcons } from "./integration-icons";

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span aria-hidden className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-500" : "bg-slate-300 dark:bg-white/20"}`} />
      {label}
    </span>
  );
}

export function IntegrationsPanel({ initial }: { initial: IntegrationStatus[] }) {
  const [statuses, setStatuses] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<IntegrationStatus | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  // Keep the add-widget drawer's cached ["integrations"] query in sync so a toggle
  // here is reflected there immediately (no waiting for its staleTime to elapse).
  function syncStatuses(fresh: IntegrationStatus[]) {
    setStatuses(fresh);
    qc.setQueryData(["integrations"], fresh);
  }

  useEffect(() => {
    if (!confirm) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setConfirm(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm]);

  async function post(id: string, enabled: boolean, deleteWidgets = false) {
    setBusy(true);
    try {
      const res = await toggleIntegration(id, enabled, deleteWidgets);
      syncStatuses(res.statuses);
      if (res.confirmRequired !== undefined) {
        setConfirm(res.statuses.find((s) => s.id === id) ?? null);
      }
    } catch { toast("Failed to update integration"); }
    finally { setBusy(false); }
  }

  async function recheck() {
    setBusy(true);
    try {
      syncStatuses(await fetchIntegrations(true));
    } catch { toast("Re-check failed"); }
    finally { setBusy(false); }
  }

  function onToggle(s: IntegrationStatus) {
    if (s.enabled && s.widgetCount > 0) { setConfirm(s); return; }
    void post(s.id, !s.enabled);
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link href="/" className="text-xs text-slate-500 hover:underline dark:text-slate-400">← Dashboard</Link>
          <h1 className="mt-1 text-lg font-semibold tracking-tight">Integrations</h1>
        </div>
        <button onClick={recheck} disabled={busy} className="btn btn-ghost">Re-check</button>
      </div>

      <ul className="space-y-3">
        {statuses.map((s) => {
          const authUnknown = s.health.authed === "n/a";
          const authed = s.health.authed === true;
          return (
            <li key={s.id} className="rounded-xl bg-card p-4 ring-1 ring-border dark:bg-card-dark dark:ring-border-dark">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <BrandIcon mark={integrationIcons[s.id]} />
                    <span className="font-medium">{s.name}</span>
                    {!authUnknown && s.health.installed && !authed && (
                      <span aria-label="Has an issue" title={s.health.detail ?? "Not authenticated"} className="text-warn">⚠</span>
                    )}
                  </div>
                  <div className="mt-1.5 flex gap-4">
                    {s.tool && <StatusDot ok={s.health.installed} label={s.health.installed ? "Installed" : "Not installed"} />}
                    {s.tool && !authUnknown && <StatusDot ok={authed} label={authed ? "Authenticated" : "Not authenticated"} />}
                  </div>
                </div>
                <button
                  onClick={() => onToggle(s)}
                  disabled={busy}
                  aria-label={`${s.enabled ? "Disable" : "Enable"} ${s.name}`}
                  aria-pressed={s.enabled}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 transition-colors ${
                    s.enabled ? "bg-primary-600 text-white ring-primary-600"
                      : "text-slate-600 ring-border hover:bg-slate-50 dark:text-slate-300 dark:ring-border-dark dark:hover:bg-white/5"
                  }`}
                >
                  {s.enabled ? "Enabled" : "Disabled"}
                </button>
              </div>

              {s.tool && !s.health.installed && (
                <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-white/5 dark:text-slate-300">{s.tool.installHint}</p>
              )}
              {s.tool && s.health.installed && !authed && !authUnknown && (
                <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-white/5 dark:text-slate-300">{s.tool.authHint}</p>
              )}
            </li>
          );
        })}
      </ul>

      {confirm && createPortal(
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 dark:bg-black/60" onClick={() => setConfirm(null)}>
          <div className="w-80 rounded-xl bg-panel p-5 shadow-xl dark:bg-panel-dark" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-sm font-semibold">Disable {confirm.name}?</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              This permanently removes {confirm.widgetCount} {confirm.name} widget{confirm.widgetCount === 1 ? "" : "s"} from your dashboard. Re-enabling won’t bring them back.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => setConfirm(null)}>Cancel</button>
              <button className="btn bg-danger text-white shadow-sm hover:bg-danger/90" onClick={() => { const c = confirm; setConfirm(null); void post(c.id, false, true); }}>Delete & disable</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </main>
  );
}
