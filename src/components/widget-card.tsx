"use client";
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getRenderWidget } from "@/modules/render-registry";
import type { Widget } from "@/server/config-repo";
import { updateWidget, fetchWidgetData } from "@/lib/dashboard-data";
import { WidgetShell, type WidgetState, type DragHandle } from "./widget-shell";
import { useWidgetData } from "./use-widget-data";
import { CardMenu } from "./card-menu";
import { BrandIcon } from "./brand-icon";

export function WidgetCard({
  widget, onConfigure, onRemove, dragHandle, onConfigChange,
}: {
  widget: Widget;
  onConfigure?: (w: Widget) => void;
  onRemove?: (id: string) => void;
  dragHandle?: DragHandle;
  onConfigChange?: (id: string, config: Record<string, unknown>) => void;
}) {
  const def = getRenderWidget(widget.type);
  const { data, isLoading, refresh, isRefreshing } = useWidgetData(widget.id);
  const qc = useQueryClient();
  const saveConfig = useCallback(
    async (next: unknown) => {
      const { config: stored } = await updateWidget(widget.id, { config: next as Record<string, unknown> });
      const fresh = await fetchWidgetData(widget.id, true);
      qc.setQueryData(["widget", widget.id], fresh);
      onConfigChange?.(widget.id, (stored ?? next) as Record<string, unknown>);
    },
    [widget.id, qc, onConfigChange],
  );

  if (!def) {
    return <WidgetShell title={widget.title ?? widget.type} state="error" error={`No renderer for ${widget.type}`} fetchedAt={null} onRefresh={() => {}} dragHandle={dragHandle} />;
  }

  const hasData = data != null && data.payload != null;
  const errored = data?.status === "error";
  // Keep showing last-good data on error (per spec); only blank to an error state
  // when there's nothing cached to fall back to.
  const state: WidgetState = isLoading ? "loading" : hasData ? "ok" : errored ? "error" : "empty";
  const count = def.count && hasData ? def.count(data!.payload, widget.config) : null;
  const Body = def.Component;
  const menu =
    onConfigure && onRemove ? (
      <CardMenu onConfigure={() => onConfigure(widget)} onRemove={() => onRemove(widget.id)} />
    ) : undefined;
  const HeaderControls = def.HeaderControls;
  const headerAction =
    HeaderControls && hasData ? (
      <HeaderControls
        data={data!.payload}
        config={widget.config}
        runAction={async () => {}}
        saveConfig={saveConfig}
      />
    ) : undefined;

  return (
    <WidgetShell
      title={widget.title ?? def.title}
      icon={def.icon && <BrandIcon mark={def.icon} />}
      count={count}
      state={state}
      error={data?.error}
      fetchedAt={data?.fetchedAt ?? null}
      onRefresh={refresh}
      refreshing={isRefreshing}
      menu={menu}
      headerAction={headerAction}
      dragHandle={dragHandle}
      issue={errored ? { message: data?.error ?? "Refresh failed", kind: data?.errorKind } : null}
    >
      {hasData && (
        <Body
          data={data!.payload}
          config={widget.config}
          runAction={async () => {}}
          saveConfig={saveConfig}
        />
      )}
    </WidgetShell>
  );
}
