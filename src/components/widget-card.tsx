"use client";
import { getClientWidget } from "@/modules/client-registry";
import type { Widget } from "@/server/config-repo";
import { WidgetShell, type WidgetState, type DragHandle } from "./widget-shell";
import { useWidgetData } from "./use-widget-data";
import { CardMenu } from "./card-menu";

export function WidgetCard({
  widget, onConfigure, onRemove, dragHandle,
}: {
  widget: Widget;
  onConfigure?: (w: Widget) => void;
  onRemove?: (id: string) => void;
  dragHandle?: DragHandle;
}) {
  const def = getClientWidget(widget.type);
  const { data, isLoading, refresh } = useWidgetData(widget.id, widget.refreshInterval);

  if (!def) {
    return <WidgetShell title={widget.title ?? widget.type} state="error" error={`No renderer for ${widget.type}`} fetchedAt={null} onRefresh={() => {}} dragHandle={dragHandle} />;
  }

  const hasData = data != null && data.payload != null;
  const errored = data?.status === "error";
  // Keep showing last-good data on error (per spec); only blank to an error state
  // when there's nothing cached to fall back to.
  const state: WidgetState = isLoading ? "loading" : hasData ? "ok" : errored ? "error" : "empty";
  const Body = def.Component;
  const menu =
    onConfigure && onRemove ? (
      <CardMenu onConfigure={() => onConfigure(widget)} onRemove={() => onRemove(widget.id)} />
    ) : undefined;

  return (
    <WidgetShell
      title={widget.title ?? def.title}
      state={state}
      error={data?.error}
      fetchedAt={data?.fetchedAt ?? null}
      onRefresh={refresh}
      menu={menu}
      dragHandle={dragHandle}
      headerExtra={
        errored && hasData ? (
          <span
            title={data?.error ?? "Refresh failed"}
            className="rounded-full bg-warn/15 px-1.5 py-0.5 text-[0.6875rem] font-medium text-warn"
          >
            stale
          </span>
        ) : undefined
      }
    >
      {hasData && (
        <Body data={data!.payload} config={widget.config} runAction={async () => {}} />
      )}
    </WidgetShell>
  );
}
