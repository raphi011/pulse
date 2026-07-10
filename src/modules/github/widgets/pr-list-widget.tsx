"use client";
import type { WidgetBodyProps } from "@/modules/contracts";
import type { PrsData, PrsConfig, CiStatus } from "../manifest";

const ciDot: Record<CiStatus, string> = {
  ok: "bg-ok", warn: "bg-warn", danger: "bg-danger", none: "bg-slate-300 dark:bg-white/20",
};
const reviewBadge: Record<string, { label: string; cls: string }> = {
  APPROVED: { label: "approved", cls: "text-ok" },
  CHANGES_REQUESTED: { label: "changes", cls: "text-danger" },
  REVIEW_REQUIRED: { label: "review", cls: "text-warn" },
};

export function PrListWidget({ data, config }: WidgetBodyProps<PrsData, PrsConfig>) {
  if (data.prs.length === 0)
    return <p className="text-sm text-slate-500 dark:text-slate-400">No open PRs.</p>;
  return (
    <ul className="divide-y divide-border dark:divide-border-dark">
      {data.prs.slice(0, config.limit).map((pr) => {
        const rev = reviewBadge[pr.review];
        return (
          <li key={pr.url} className="flex items-center gap-2.5 py-2">
            <span aria-label={`CI ${pr.ci}`} title={`CI ${pr.ci}`} className={`h-2 w-2 shrink-0 rounded-full ${ciDot[pr.ci]}`} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`https://github.com/${pr.author}.png?size=40`} alt={pr.author} title={pr.author} loading="lazy" className="h-4 w-4 shrink-0 rounded-full bg-slate-200 dark:bg-white/10" />
            <a href={pr.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-sm hover:underline">
              {pr.title}
            </a>
            {rev && <span className={`shrink-0 text-[0.6875rem] font-medium ${rev.cls}`}>{rev.label}</span>}
            <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">{pr.repo}#{pr.number}</span>
          </li>
        );
      })}
    </ul>
  );
}
