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

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

const LABEL = "text-[0.625rem] font-semibold uppercase tracking-[0.09em] text-slate-500 dark:text-slate-400";
const HERO = "text-3xl font-semibold leading-none tracking-tight tabular-nums";

export function NextMeetingWidget({ data }: WidgetBodyProps<NextMeetingData, NextMeetingConfig>) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(id);
  }, []);

  const { current, next } = deriveMeetingState(data.meetings ?? [], now);

  if (!current && !next)
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-slate-500 dark:text-slate-400">No more meetings today.</p>
      </div>
    );

  // The upcoming meeting is the hero; with nothing upcoming, the one in progress takes the spotlight.
  const hero = next ?? current!;
  const isCurrentHero = !next;
  const msUntil = new Date(hero.start).getTime() - now.getTime();

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 text-center">
        <span className={LABEL}>
          {isCurrentHero ? "Now" : "Next"} · {hhmm(hero.start)}–{hhmm(hero.end)}
        </span>
        <span
          className={`${HERO} ${isCurrentHero ? "text-slate-900 dark:text-slate-100" : urgencyClass(msUntil)}`}
        >
          {isCurrentHero ? `${minutesLeft(hero, now)} min left` : formatCountdown(msUntil)}
        </span>
        <a
          href={hero.url}
          target="_blank"
          rel="noreferrer"
          className="block max-w-full truncate text-sm font-medium hover:underline"
        >
          {hero.title}
        </a>
        {hero.meetUrl && (
          <a
            href={hero.meetUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-500"
          >
            Join
          </a>
        )}
      </div>

      {/* A meeting already running, kept as a quiet footer while the hero counts down to the next one. */}
      {current && next && (
        <div className="flex shrink-0 items-center gap-1.5 border-t border-border pt-2 dark:border-border-dark">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
          <span className="min-w-0 truncate text-xs text-slate-500 dark:text-slate-400">
            {current.title} · {minutesLeft(current, now)} min left
          </span>
        </div>
      )}
    </div>
  );
}
