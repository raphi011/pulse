// Thin frontend data layer: every function delegates to a generated Wails
// binding. Function names/signatures match the pre-Wails API so callers are
// unchanged. All backend logic (validation, cache, fetch dispatch) lives in Go.
import { Dashboard, Integrations, type CacheRow, type Widget, type Tab, type WidgetPatch as GoWidgetPatch } from "./backend";
import type { WidgetManifest } from "@/modules/contracts";
import type { IntegrationStatus } from "@/modules/integration-contracts";

export type LayoutSnapshot = {
  widgets: Widget[];
  tabs: Tab[];
  activeTabId: string;
};

export async function fetchLayout(): Promise<LayoutSnapshot> {
  const snap = await Dashboard.Layout();
  return {
    widgets: snap.widgets ?? [],
    tabs: snap.tabs ?? [],
    activeTabId: snap.activeTabId,
  };
}

export async function fetchWidgetData(id: string, refresh: boolean): Promise<CacheRow> {
  return Dashboard.GetWidgetData(id, refresh);
}

export async function createWidget(type: string, tabId: string): Promise<Widget> {
  return Dashboard.CreateWidget(type, tabId);
}

/** Every registered widget manifest (server-owned). Cache via TanStack under ["manifests"]. */
export async function fetchManifests(): Promise<WidgetManifest[]> {
  const manifests = await Dashboard.Manifests();
  // Runtime shape is exactly the frontend WidgetManifest (Field-shaped configFields), except
  // the generated configFields is nullable — normalize it to [] at this choke point.
  return (manifests ?? []).map((m) => ({ ...m, configFields: m.configFields ?? [] })) as WidgetManifest[];
}

export type WidgetPatch = {
  hidden?: boolean;
  config?: Record<string, unknown>;
  title?: string | null;
  accent?: string | null;
};

/** Validates config against the manifest in Go; echoes stored config+title+accent. */
export async function updateWidget(
  id: string, patch: WidgetPatch,
): Promise<{ config?: unknown; title: string | null; accent: string | null }> {
  const go: GoWidgetPatch = {};
  if (typeof patch.hidden === "boolean") go.hidden = patch.hidden;
  if (patch.config !== undefined) go.config = patch.config;
  if (patch.title !== undefined) {
    go.title = patch.title;
    go.setTitle = true;
  }
  if (patch.accent !== undefined) {
    go.accent = patch.accent;
    go.setAccent = true;
  }
  const res = await Dashboard.UpdateWidget(id, go);
  return { config: res.config, title: res.title, accent: res.accent };
}

export async function deleteWidget(id: string): Promise<void> {
  await Dashboard.DeleteWidget(id);
}

export async function savePositions(
  positions: { id: string; order: number; colSpan: number; rowSpan: number }[],
): Promise<void> {
  await Dashboard.SavePositions(positions);
}

export async function getTabs(): Promise<Tab[]> {
  return (await Dashboard.Layout()).tabs ?? [];
}
export async function createTab(name: string): Promise<Tab> {
  return Dashboard.CreateTab(name);
}
export async function renameTab(id: string, name: string): Promise<void> {
  await Dashboard.RenameTab(id, name);
}
export async function deleteTab(id: string): Promise<void> {
  await Dashboard.DeleteTab(id);
}
export async function reorderTabs(orders: { id: string; order: number }[]): Promise<void> {
  await Dashboard.ReorderTabs(orders);
}
export async function setActiveTab(id: string): Promise<void> {
  await Dashboard.SetActiveTab(id);
}
export async function moveWidgetToTab(widgetId: string, tabId: string): Promise<void> {
  await Dashboard.UpdateWidget(widgetId, { moveToTab: tabId });
}

export async function fetchIntegrations(recheck = false): Promise<IntegrationStatus[]> {
  // The generated Status type matches IntegrationStatus structurally except
  // `authed: any` (Go serializes true | false | "n/a") — cast once here.
  return ((await Integrations.Statuses(recheck)) ?? []) as unknown as IntegrationStatus[];
}

/** Returns { statuses } on success, plus { confirmRequired } when disabling would delete widgets. */
export async function toggleIntegration(
  id: string, enabled: boolean, deleteWidgets = false,
): Promise<{ statuses: IntegrationStatus[]; confirmRequired?: number }> {
  if (enabled) {
    await Integrations.Enable(id);
  } else {
    const res = await Integrations.Disable(id, deleteWidgets);
    if (res.confirmRequired > 0) {
      return { statuses: await fetchIntegrations(true), confirmRequired: res.confirmRequired };
    }
  }
  return { statuses: await fetchIntegrations(true) };
}
