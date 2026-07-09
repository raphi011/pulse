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

  const state: WidgetState = isLoading ? "loading" : data?.status === "error" ? "error" : "ok";
  const Body = def.Component;

  return (
    <WidgetShell
      title={def.title}
      state={state}
      error={data?.error}
      fetchedAt={data?.fetchedAt ?? null}
      onRefresh={refresh}
    >
      {data && data.payload != null && (
        <Body data={data.payload} config={widget.config} runAction={async () => {}} />
      )}
    </WidgetShell>
  );
}
