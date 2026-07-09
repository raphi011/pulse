"use client";
import type { WidgetBodyProps } from "@/modules/contracts";
import type { DependabotData, Severity } from "../manifest";

const sevCls: Record<Severity, string> = {
  low: "text-slate-500 dark:text-slate-400", medium: "text-warn", high: "text-danger", critical: "text-danger font-semibold",
};

export function DependabotWidget({ data }: WidgetBodyProps<DependabotData, unknown>) {
  if (data.alerts.length === 0)
    return <p className="text-sm text-slate-500 dark:text-slate-400">No open alerts.</p>;
  return (
    <ul className="divide-y divide-border dark:divide-border-dark">
      {data.alerts.map((a) => (
        <li key={a.url} className="flex items-center gap-2.5 py-2">
          <span className={`shrink-0 text-[0.6875rem] font-medium uppercase ${sevCls[a.severity]}`}>{a.severity}</span>
          <a href={a.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-sm hover:underline">
            {a.package}: {a.summary}
          </a>
          <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">{a.repo}</span>
        </li>
      ))}
    </ul>
  );
}
