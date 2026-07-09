"use client";
import type { WidgetBodyProps } from "@/modules/contracts";
import type { FailingActionsData } from "../manifest";

export function FailingActionsWidget({ data }: WidgetBodyProps<FailingActionsData, unknown>) {
  if (data.runs.length === 0)
    return <p className="text-sm text-slate-500 dark:text-slate-400">No failing runs.</p>;
  return (
    <ul className="divide-y divide-border dark:divide-border-dark">
      {data.runs.map((run) => (
        <li key={run.url} className="flex items-center gap-2.5 py-2">
          <span className="h-2 w-2 shrink-0 rounded-full bg-danger" />
          <a href={run.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-sm hover:underline">
            {run.name}
          </a>
          <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">{run.repo} · {run.branch}</span>
        </li>
      ))}
    </ul>
  );
}
