"use client";
import { useEffect, useState } from "react";
import type { WidgetBodyProps } from "@/modules/contracts";
import {
  deriveMeetingState,
  type NextMeetingData,
  type NextMeetingConfig,
  type MeetingItem,
} from "../manifest";

/** "in 23 min" / "in 1h 30m"; rounds up so it never reads "in 0 min". */
export function formatCountdown(msUntil: number): string {
  const mins = Math.max(1, Math.ceil(msUntil / 60_000));
  if (mins >= 60) return `in ${Math.floor(mins / 60)}h ${mins % 60}m`;
  return `in ${mins} min`;
}

export function urgencyClass(msUntil: number): string {
  if (msUntil < 2 * 60_000) return "text-red-600 dark:text-red-400";
  if (msUntil < 10 * 60_000) return "text-amber-600 dark:text-amber-400";
  return "text-slate-900 dark:text-slate-100";
}

function minutesLeft(m: MeetingItem, now: Date): number {
  return Math.max(1, Math.ceil((new Date(m.end).getTime() - now.getTime()) / 60_000));
}

export function NextMeetingWidget({ data }: WidgetBodyProps<NextMeetingData, NextMeetingConfig>) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(id);
  }, []);

  const { current, next } = deriveMeetingState(data.meetings ?? [], now);
  if (!current && !next)
    return <p className="text-sm text-slate-500 dark:text-slate-400">No more meetings today.</p>;

  const msUntilNext = next ? new Date(next.start).getTime() - now.getTime() : 0;
  return (
    <div className="space-y-1.5">
      {current && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          In: {current.title} — {minutesLeft(current, now)} min left
        </p>
      )}
      {next && (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <a
              href={next.url}
              target="_blank"
              rel="noreferrer"
              className="block truncate text-sm font-medium hover:underline"
            >
              {next.title}
            </a>
            <p className={`text-2xl font-semibold tabular-nums ${urgencyClass(msUntilNext)}`}>
              {formatCountdown(msUntilNext)}
            </p>
          </div>
          {next.meetUrl && (
            <a
              href={next.meetUrl}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 rounded-md bg-primary-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-primary-700"
            >
              Join
            </a>
          )}
        </div>
      )}
    </div>
  );
}
