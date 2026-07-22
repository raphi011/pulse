import { getFetchWidget } from "@/modules/fetch-registry";
import {
  addWidget as repoAddWidget, getWidget, getWidgets, getPref, setPref,
  setHidden, setConfig, setTitle, removeWidget, setPositions, setAccent, setWidgetTab,
  type Widget,
} from "@/server/config-repo";
import {
  getTabs as repoGetTabs, addTab, renameTab as repoRenameTab,
  deleteTab as repoDeleteTab, setTabOrder, type Tab,
} from "@/server/tabs-repo";
import { getWidgetData } from "@/server/widget-service";
import {
  getIntegrationStatuses, enableIntegration, disableIntegration, ConfirmRequiredError,
} from "@/server/integration-service";
import type { CacheRow } from "@/server/cache-repo";
import type { IntegrationStatus } from "@/modules/integration-contracts";
import { isAccentName } from "@/lib/accents";

export type LayoutSnapshot = {
  widgets: Widget[];
  tabs: Tab[];
  activeTabId: string;
  prefs: { theme: string };
};

export async function fetchLayout(): Promise<LayoutSnapshot> {
  const [widgets, tabs, theme, savedActive] = await Promise.all([
    getWidgets(), repoGetTabs(), getPref("theme", "dark"), getPref("ui.activeTab", ""),
  ]);
  const activeTabId = tabs.some((t) => t.id === savedActive)
    ? savedActive
    : tabs[0]?.id ?? "default";
  return { widgets, tabs, activeTabId, prefs: { theme } };
}

export async function fetchWidgetData(id: string, refresh: boolean): Promise<CacheRow> {
  return getWidgetData(id, refresh);
}

export async function createWidget(type: string, tabId: string): Promise<Widget> {
  const def = getFetchWidget(type);
  if (!def) throw new Error(`Unknown widget type: ${type}`);
  return repoAddWidget(type, def.manifest.defaultConfig as Record<string, unknown>, tabId);
}

export type WidgetPatch = {
  hidden?: boolean;
  config?: Record<string, unknown>;
  title?: string | null;
  accent?: string | null;
};

/** Mirrors PATCH /api/widgets/:id — validates config against the schema, echoes stored config+title+accent. */
export async function updateWidget(
  id: string, patch: WidgetPatch,
): Promise<{ config?: unknown; title: string | null; accent: string | null }> {
  const widget = await getWidget(id);
  if (!widget) throw new Error("Not found");
  if (typeof patch.hidden === "boolean") await setHidden(id, patch.hidden);
  if (patch.title !== undefined) await setTitle(id, patch.title);
  if (patch.accent !== undefined) {
    // Non-preset values degrade to "no accent" silently (spec: never an error).
    await setAccent(id, isAccentName(patch.accent) ? patch.accent : null);
  }
  if (patch.config !== undefined) {
    const def = getFetchWidget(widget.type);
    const parsed = def?.manifest.configSchema.safeParse(patch.config);
    if (def && parsed && !parsed.success) throw new Error("Invalid config");
    await setConfig(id, (parsed?.success ? parsed.data : patch.config) as Record<string, unknown>);
  }
  const fresh = await getWidget(id);
  return { config: fresh?.config, title: fresh?.title ?? null, accent: fresh?.accent ?? null };
}

export async function deleteWidget(id: string): Promise<void> {
  await removeWidget(id);
}

export async function savePositions(
  positions: { id: string; order: number; colSpan: number; rowSpan: number }[],
): Promise<void> {
  await setPositions(positions);
}

export async function getTabs(): Promise<Tab[]> {
  return repoGetTabs();
}
export async function createTab(name: string): Promise<Tab> {
  return addTab(name);
}
export async function renameTab(id: string, name: string): Promise<void> {
  await repoRenameTab(id, name);
}
export async function deleteTab(id: string): Promise<void> {
  await repoDeleteTab(id);
}
export async function reorderTabs(orders: { id: string; order: number }[]): Promise<void> {
  await setTabOrder(orders);
}
export async function setActiveTab(id: string): Promise<void> {
  await setPref("ui.activeTab", id);
}
export async function moveWidgetToTab(widgetId: string, tabId: string): Promise<void> {
  await setWidgetTab(widgetId, tabId);
}

export async function fetchIntegrations(recheck = false): Promise<IntegrationStatus[]> {
  return getIntegrationStatuses(recheck);
}

/** Returns { deleted } on success, or { confirmRequired, widgetCount } when disabling would delete widgets. */
export async function toggleIntegration(
  id: string, enabled: boolean, deleteWidgets = false,
): Promise<{ statuses: IntegrationStatus[]; confirmRequired?: number }> {
  if (enabled) {
    await enableIntegration(id);
  } else {
    try {
      await disableIntegration(id, deleteWidgets);
    } catch (err) {
      if (err instanceof ConfirmRequiredError) {
        return { statuses: await getIntegrationStatuses(true), confirmRequired: err.widgetCount };
      }
      throw err;
    }
  }
  return { statuses: await getIntegrationStatuses(true) };
}
