"use client";
import type { WidgetBodyProps } from "@/modules/contracts";
import type { JqlData, JqlConfig, StatusCategory } from "../manifest";

const PILL: Record<StatusCategory, string> = {
  done: "bg-ok/15 text-ok",
  inprogress: "bg-warn/15 text-warn",
  todo: "bg-slate-500/15 text-slate-500 dark:text-slate-400",
};

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

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
          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[0.6875rem] font-medium ${PILL[issue.statusCategory]}`}>
            {issue.status}
          </span>
          <span
            className="shrink-0 text-xs text-slate-500 dark:text-slate-400"
            title={issue.assignee ?? "Unassigned"}
          >
            {issue.assignee ? initials(issue.assignee) : "—"}
          </span>
        </li>
      ))}
    </ul>
  );
}
