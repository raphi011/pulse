"use client";
import type { WidgetBodyProps } from "@/modules/contracts";
import { Avatar } from "@/components/avatar";
import type { JqlData, JqlConfig } from "../manifest";

export function JqlWidget({ data }: WidgetBodyProps<JqlData, JqlConfig>) {
  if (data.issues.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">No matching issues.</p>;
  }
  return (
    <ul className="divide-y divide-border dark:divide-border-dark">
      {data.issues.map((issue) => (
        <li key={issue.key} className="flex items-center gap-2.5 py-2">
          <a
            href={issue.url}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 flex-1 truncate text-sm hover:underline"
          >
            <span className="font-medium tabular-nums text-slate-500 dark:text-slate-400">{issue.key}</span>{" "}
            {issue.summary}
          </a>
          <span className="shrink-0 rounded-full bg-slate-500/15 px-1.5 py-0.5 text-[0.6875rem] font-medium text-slate-500 dark:text-slate-400">
            {issue.status}
          </span>
          {issue.assignee ? (
            <Avatar src={issue.avatarUrl} name={issue.assignee} />
          ) : (
            <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400" title="Unassigned">—</span>
          )}
        </li>
      ))}
    </ul>
  );
}
