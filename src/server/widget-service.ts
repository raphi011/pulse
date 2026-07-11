import { getWidget } from "./config-repo";
import * as cache from "./cache-repo";
import { getFetchWidget } from "@/modules/fetch-registry";
import { NotFoundError } from "./errors";
import { CliError } from "./cli";

export async function getWidgetData(widgetId: string, refresh: boolean): Promise<cache.CacheRow> {
  const widget = await getWidget(widgetId);
  if (!widget) throw new NotFoundError(`Widget not found: ${widgetId}`);

  if (!refresh) {
    const cached = await cache.get(widgetId);
    if (cached) return cached;
  }

  const def = getFetchWidget(widget.type);
  const prev = await cache.get(widgetId);

  if (!def) {
    return cache.set(widgetId, {
      status: "error", payload: prev?.payload ?? null, error: `Unknown widget type: ${widget.type}`, errorKind: "failed",
    });
  }

  try {
    const payload = await def.fetch(widget.config);
    return cache.set(widgetId, { status: "ok", payload, error: null, errorKind: null });
  } catch (err) {
    return cache.set(widgetId, {
      status: "error",
      payload: prev?.payload ?? null,
      error: err instanceof Error ? err.message : String(err),
      errorKind: err instanceof CliError ? err.kind : "failed",
    });
  }
}
