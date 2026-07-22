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

  // Validate stored config before fetching: Zod defaults backfill additive schema
  // changes for free; a breaking change surfaces as a fixable error instead of a
  // crash — the stored config is NOT overwritten.
  const parsed = def.manifest.configSchema.safeParse(widget.config);
  if (!parsed.success) {
    return cache.set(widgetId, {
      status: "error",
      payload: prev?.payload ?? null,
      error: "Invalid config — open Configure and re-save this widget.",
      errorKind: "failed",
    });
  }

  try {
    const payload = await def.fetch(parsed.data);
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
