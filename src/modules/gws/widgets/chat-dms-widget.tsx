"use client";
import type { WidgetBodyProps } from "@/modules/contracts";
import { Avatar } from "@/components/avatar";
import type { ChatDmsData, ChatDmsConfig } from "../manifest";

function shortDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function ChatDmsWidget({ data }: WidgetBodyProps<ChatDmsData, ChatDmsConfig>) {
  if (data.dms.length === 0)
    return <p className="text-sm text-slate-500 dark:text-slate-400">No unread DMs.</p>;
  return (
    <ul className="divide-y divide-border dark:divide-border-dark">
      {data.dms.map((dm) => (
        <li key={dm.spaceId} className="flex items-center gap-2.5 py-2">
          <span aria-label="unread" className="h-2 w-2 shrink-0 rounded-full bg-primary-500" />
          <Avatar src={dm.avatarUrl} name={dm.partner} />
          <a href={dm.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 hover:underline">
            <span className="block truncate text-sm">{dm.partner}</span>
            <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{dm.snippet}</span>
          </a>
          <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">{shortDate(dm.time)}</span>
        </li>
      ))}
    </ul>
  );
}
