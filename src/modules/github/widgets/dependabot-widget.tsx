"use client";
import type { WidgetBodyProps } from "@/modules/contracts";
import type { DependabotData, DependabotConfig, Severity } from "../manifest";
import { NotConfigured, PartialFailure } from "./notices";

const sevCls: Record<Severity, string> = {
  low: "text-slate-500 dark:text-slate-400", medium: "text-warn", high: "text-danger", critical: "text-danger font-semibold",
};

export function DependabotWidget({ data, config }: WidgetBodyProps<DependabotData, DependabotConfig>) {
  if (config.repos.length === 0) return <NotConfigured />;
  return (
    <>
      {data.alerts.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No open alerts.</p>
      ) : (
        <ul className="divide-y divide-border dark:divide-border-dark">
          {data.alerts.slice(0, config.limit).map((a) => (
            <li key={a.url} className="flex items-center gap-2.5 py-2">
              <span className={`shrink-0 text-[0.6875rem] font-medium uppercase ${sevCls[a.severity]}`}>{a.severity}</span>
              <a href={a.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-sm hover:underline">
                {a.package}: {a.summary}
              </a>
              <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">{a.repo}</span>
            </li>
          ))}
        </ul>
      )}
      {data.errors?.length ? <PartialFailure repos={data.errors} /> : null}
    </>
  );
}
