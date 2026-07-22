// The only file that knows Wails exists: it re-exports the generated service
// bindings (so app code never imports binding paths directly) plus the typed
// model shapes and the cache-updated event subscription helper.
import * as Dashboard from "../../bindings/pulse/internal/dashboard/service";
import * as Bookmarks from "../../bindings/pulse/internal/modules/bookmarks/service";
import * as Gws from "../../bindings/pulse/internal/modules/gws/service";
import * as System from "../../bindings/pulse/internal/modules/system/service";
import { Events } from "@wailsio/runtime";

export { Dashboard, Bookmarks, System, Gws };

// Generated model types — one source of truth mirroring the Go structs.
export type { CacheRow, Widget, Tab, Position, TabOrder } from "../../bindings/pulse/internal/db/models";
export type { LayoutSnapshot, UpdateResult, WidgetPatch } from "../../bindings/pulse/internal/dashboard/models";
export type { Manifest, ConfigField, FieldOption } from "../../bindings/pulse/internal/module/models";
export type { Bookmark } from "../../bindings/pulse/internal/modules/bookmarks/models";

export const CACHE_UPDATED = "widget:cache-updated" as const;

/**
 * Subscribe to the backend's per-widget cache-updated event. Go emits the
 * widget id as the event data; we accept both a bare string and an
 * array-wrapped payload (the runtime has been observed to deliver either).
 * Returns an unsubscribe function.
 */
export function onCacheUpdated(cb: (widgetId: string) => void): () => void {
  return Events.On(CACHE_UPDATED, (ev) => {
    const data = ev.data as unknown;
    const id = Array.isArray(data) ? data[0] : data;
    if (typeof id === "string") cb(id);
  });
}
