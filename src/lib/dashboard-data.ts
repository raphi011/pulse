import { getFetchWidget } from "@/modules/fetch-registry";
import {
  addWidget as repoAddWidget, getWidget, getWidgets, getPref,
  setHidden, setConfig, setTitle, removeWidget, setPositions,
  type Widget,
} from "@/server/config-repo";
import { getWidgetData } from "@/server/widget-service";
import {
  getIntegrationStatuses, enableIntegration, disableIntegration, ConfirmRequiredError,
} from "@/server/integration-service";
import type { CacheRow } from "@/server/cache-repo";
import type { IntegrationStatus } from "@/modules/integration-contracts";

export type LayoutSnapshot = { widgets: Widget[]; prefs: { theme: string } };

export async function fetchLayout(): Promise<LayoutSnapshot> {
  const [widgets, theme] = await Promise.all([getWidgets(), getPref("theme", "dark")]);
  return { widgets, prefs: { theme } };
}

export async function fetchWidgetData(id: string, refresh: boolean): Promise<CacheRow> {
  return getWidgetData(id, refresh);
}

export async function createWidget(type: string): Promise<Widget> {
  const def = getFetchWidget(type);
  if (!def) throw new Error(`Unknown widget type: ${type}`);
  return repoAddWidget(type, def.defaultConfig as Record<string, unknown>);
}

export type WidgetPatch = { hidden?: boolean; config?: Record<string, unknown>; title?: string | null };

/** Mirrors PATCH /api/widgets/:id — validates config against the schema, echoes stored config+title. */
export async function updateWidget(id: string, patch: WidgetPatch): Promise<{ config?: unknown; title: string | null }> {
  const widget = await getWidget(id);
  if (!widget) throw new Error("Not found");
  if (typeof patch.hidden === "boolean") await setHidden(id, patch.hidden);
  if (patch.title !== undefined) await setTitle(id, patch.title);
  if (patch.config !== undefined) {
    const def = getFetchWidget(widget.type);
    const parsed = def?.configSchema.safeParse(patch.config);
    if (def && parsed && !parsed.success) throw new Error("Invalid config");
    await setConfig(id, (parsed?.success ? parsed.data : patch.config) as Record<string, unknown>);
  }
  const fresh = await getWidget(id);
  return { config: fresh?.config, title: fresh?.title ?? null };
}

export async function deleteWidget(id: string): Promise<void> {
  await removeWidget(id);
}

export async function savePositions(
  positions: { id: string; order: number; colSpan: number; rowSpan: number }[],
): Promise<void> {
  await setPositions(positions);
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
