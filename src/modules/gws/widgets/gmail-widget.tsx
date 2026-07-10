"use client";
import type { WidgetBodyProps } from "@/modules/contracts";
import type { GmailData, GmailConfig } from "../manifest";

function shortDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function GmailWidget({ data }: WidgetBodyProps<GmailData, GmailConfig>) {
  if (data.emails.length === 0)
    return <p className="text-sm text-slate-500 dark:text-slate-400">No emails.</p>;
  return (
    <ul className="divide-y divide-border dark:divide-border-dark">
      {data.emails.map((m) => (
        <li key={m.id} className="flex items-center gap-2.5 py-2">
          <span
            aria-label={m.unread ? "unread" : "read"}
            className={`h-2 w-2 shrink-0 rounded-full ${m.unread ? "bg-primary-500" : "bg-transparent"}`}
          />
          <a href={m.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 hover:underline">
            <span className={`block truncate text-sm ${m.unread ? "font-semibold" : ""}`}>{m.subject}</span>
            <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{m.from}</span>
          </a>
          <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">{shortDate(m.date)}</span>
        </li>
      ))}
    </ul>
  );
}
