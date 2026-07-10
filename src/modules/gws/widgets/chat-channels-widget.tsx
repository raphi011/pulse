"use client";
import type { WidgetBodyProps } from "@/modules/contracts";
import type { ChatChannelsData, ChatChannelsConfig } from "../manifest";

function shortDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function ChatChannelsWidget({ data }: WidgetBodyProps<ChatChannelsData, ChatChannelsConfig>) {
  if (data.channels.length === 0)
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        No channels configured — add space IDs (run <code>gws chat spaces list</code>).
      </p>
    );
  return (
    <ul className="divide-y divide-border dark:divide-border-dark">
      {data.channels.map((c) => (
        <li key={c.spaceId} className="flex items-center gap-2.5 py-2">
          <span
            aria-label={c.unread ? "unread" : "read"}
            className={`h-2 w-2 shrink-0 rounded-full ${c.unread ? "bg-primary-500" : "bg-transparent"}`}
          />
          <a href={c.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 hover:underline">
            <span className={`block truncate text-sm ${c.unread ? "font-medium" : ""}`}>{c.name}</span>
            <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{c.snippet}</span>
          </a>
          <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">{shortDate(c.time)}</span>
        </li>
      ))}
    </ul>
  );
}
