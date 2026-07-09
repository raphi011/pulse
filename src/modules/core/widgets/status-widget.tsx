"use client";
import type { WidgetBodyProps } from "@/modules/contracts";
import type { StatusData, StatusConfig } from "../manifest";

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 text-sm">
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className={`truncate text-right font-medium ${mono ? "tabular-nums" : ""}`}>{value}</dd>
    </div>
  );
}

export function StatusWidget({ data, config }: WidgetBodyProps<StatusData, StatusConfig>) {
  return (
    <dl className="divide-y divide-border dark:divide-border-dark">
      <Row label="Label" value={config.label} />
      <Row label="Time" value={new Date(data.now).toLocaleTimeString()} mono />
      <Row label="Node" value={data.node} mono />
      <Row label="Platform" value={data.platform} />
    </dl>
  );
}
