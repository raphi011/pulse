"use client";
import type { WidgetBodyProps } from "@/modules/contracts";
import type { StatusData, StatusConfig } from "../manifest";

export function StatusWidget({ data, config }: WidgetBodyProps<StatusData, StatusConfig>) {
  return (
    <dl className="grid grid-cols-2 gap-y-1 text-sm">
      <dt className="text-muted">Label</dt>
      <dd className="text-right">{config.label}</dd>
      <dt className="text-muted">Time</dt>
      <dd className="text-right tabular-nums">{new Date(data.now).toLocaleTimeString()}</dd>
      <dt className="text-muted">Node</dt>
      <dd className="text-right">{data.node}</dd>
      <dt className="text-muted">Platform</dt>
      <dd className="text-right">{data.platform}</dd>
    </dl>
  );
}
