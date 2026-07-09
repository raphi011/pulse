"use client";
import { getClientWidget } from "@/modules/client-registry";
import type { Widget } from "@/server/config-repo";
import { WidgetShell, type WidgetState } from "./widget-shell";
import { useWidgetData } from "./use-widget-data";

export function WidgetCard({ widget }: { widget: Widget }) {
  const def = getClientWidget(widget.type);
  const { data, isLoading, refresh } = useWidgetData(widget.id, widget.refreshInterval);

  if (!def) {
    return <WidgetShell title={widget.type} state="error" error={`No renderer for ${widget.type}`} fetchedAt={null} onRefresh={() => {}} />;
  }

  const hasData = data != null && data.payload != null;
  const errored = data?.status === "error";
  // Keep showing last-good data on error (per spec); only blank to an error state
  // when there's nothing cached to fall back to.
  const state: WidgetState = isLoading ? "loading" : hasData ? "ok" : errored ? "error" : "empty";
  const Body = def.Component;

  return (
    <WidgetShell
      title={def.title}
      state={state}
      error={data?.error}
      fetchedAt={data?.fetchedAt ?? null}
      onRefresh={refresh}
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
