"use client";
import { useEffect, useState } from "react";
import type { WidgetBodyProps } from "@/modules/contracts";
import {
  deriveEventEmphasis,
  type CalendarData,
  type CalendarConfig,
  type CalendarEventItem,
} from "../manifest";

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function timeLabel(e: CalendarEventItem): string {
  if (e.allDay) return "all day";
  return e.end ? `${hhmm(e.start)}–${hhmm(e.end)}` : hhmm(e.start);
}

export function CalendarWidget({ data }: WidgetBodyProps<CalendarData, CalendarConfig>) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (data.events.length === 0)
    return <p className="text-sm text-slate-500 dark:text-slate-400">Nothing today.</p>;

  const { pastIds, highlightId } = deriveEventEmphasis(data.events, now);

  return (
    <ul className="divide-y divide-border dark:divide-border-dark">
      {data.events.map((e) => (
        <li
          key={e.id}
          className={`relative flex items-center gap-2.5 py-2 ${pastIds.has(e.id) ? "opacity-45" : ""}`}
        >
          {e.id === highlightId && (
            <span
              aria-hidden
              className="absolute inset-y-1.5 -left-2 w-0.5 rounded-full bg-primary-500 dark:bg-primary-400"
            />
          )}
          <span className="w-24 shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">{timeLabel(e)}</span>
          <a href={e.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-sm hover:underline">
            {e.title}
          </a>
          {e.meetUrl ? (
            <a
              href={e.meetUrl}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 text-[0.6875rem] font-medium text-primary-600 hover:underline dark:text-primary-400"
            >
              Meet
            </a>
          ) : (
            e.location && (
              <span className="max-w-[8rem] shrink-0 truncate text-[0.6875rem] text-slate-500 dark:text-slate-400">
                {e.location}
              </span>
            )
          )}
        </li>
      ))}
    </ul>
  );
}
