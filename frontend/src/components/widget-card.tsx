"use client";
import { getRenderWidget } from "@/modules/render-registry";
import type { Widget } from "@/lib/backend";
import { WidgetShell, type WidgetState, type DragHandle } from "./widget-shell";
import { useWidgetData } from "./use-widget-data";
import { useManifest } from "./use-manifests";
import { CardMenu } from "./card-menu";
import { BrandIcon } from "./brand-icon";
import { WidgetErrorBoundary } from "./widget-error-boundary";

export function WidgetCard({
  widget, onConfigure, onRemove, moveTargets, onMoveToTab, dragHandle,
}: {
  widget: Widget;
  onConfigure?: (w: Widget) => void;
  onRemove?: (id: string) => void;
  moveTargets?: { id: string; name: string }[];
  onMoveToTab?: (widgetId: string, tabId: string) => void;
  dragHandle?: DragHandle;
}) {
  const def = getRenderWidget(widget.type);
  const manifest = useManifest(widget.type);
  const refreshable = manifest?.refreshable !== false;
  const { data, isLoading, isError, error: queryError, refresh, isRefreshing } = useWidgetData(widget.id);

  if (!def) {
    return <WidgetShell title={widget.title ?? widget.type} state="error" error={`No renderer for ${widget.type}`} fetchedAt={null} onRefresh={() => {}} dragHandle={dragHandle} accent={widget.accent} />;
  }

  const hasData = data != null && data.payload != null;
  const errored = data?.status === "error";
  // A rejected useQuery (e.g. DB read failed) leaves `data` undefined; without this it would
  // fall through to the "empty" state and read as "nothing here" rather than a failure.
  const loadFailed = isError && !hasData;
  const errorText =
    data?.error ?? (loadFailed ? (queryError instanceof Error ? queryError.message : "Failed to load") : undefined);
  // Keep showing last-good data on error (per spec); only blank to an error state
  // when there's nothing cached to fall back to.
  const state: WidgetState = isLoading ? "loading" : hasData ? "ok" : errored || loadFailed ? "error" : "empty";
  // count() runs outside the body's ErrorBoundary — a stale config/payload combo must not crash the card.
  let count: number | null = null;
  if (def.count && hasData) {
    try {
      count = def.count(data!.payload, widget.config);
    } catch {
      count = null;
    }
  }
  const Body = def.Component;
  const menu =
    onConfigure && onRemove ? (
      <CardMenu
        onConfigure={() => onConfigure(widget)}
        onRemove={() => onRemove(widget.id)}
        moveTargets={moveTargets}
        onMove={onMoveToTab ? (tabId) => onMoveToTab(widget.id, tabId) : undefined}
      />
    ) : undefined;
  const HeaderControls = def.HeaderControls;
  const headerExtra =
    HeaderControls && hasData ? (
      // HeaderControls render in the header, outside the Body boundary below — give them their own
      // so a throw there can't unmount the whole dashboard. Fail silently (no error block in the header).
      <WidgetErrorBoundary resetKey={data!.fetchedAt} fallback={null}>
        <HeaderControls data={data!.payload} config={widget.config} refresh={refresh} />
      </WidgetErrorBoundary>
    ) : undefined;

  return (
    <WidgetShell
      title={widget.title ?? manifest?.title ?? widget.type}
      icon={def.icon && <BrandIcon mark={def.icon} />}
      count={count}
      state={state}
      error={errorText}
      fetchedAt={data?.fetchedAt ?? null}
      onRefresh={refresh}
      refreshing={isRefreshing}
      refreshable={refreshable}
      menu={menu}
      headerExtra={headerExtra}
      dragHandle={dragHandle}
      issue={errored || loadFailed ? { message: errorText ?? "Refresh failed", kind: data?.errorKind } : null}
      accent={widget.accent}
    >
      {hasData && (
        <WidgetErrorBoundary resetKey={data!.fetchedAt}>
          <Body data={data!.payload} config={widget.config} refresh={refresh} />
        </WidgetErrorBoundary>
      )}
    </WidgetShell>
  );
}
