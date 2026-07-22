"use client";
import { useCallback, useState } from "react";
import type { WidgetBodyProps } from "@/modules/contracts";
import type { HeatmapData, HeatmapConfig, HeatmapDay, HeatmapWeek } from "../manifest";

const LEVEL_VAR = ["--heat-0", "--heat-1", "--heat-2", "--heat-3", "--heat-4"] as const;
const CELL = 11; // px — square size
const GAP = 3; // px — gap between cells and columns
const COL = CELL + GAP; // px — column pitch
const DOW_W = 26; // px — weekday-label gutter width
const GUTTER = 4; // px — gap between the gutter and the grid
const MONTH_H = 13; // px — reserved height for the month-label row
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["", "Mon", "", "Wed", "", "Fri", ""]; // rows Sun..Sat (GitHub labels Mon/Wed/Fri)
const LABEL = "text-[10px] text-slate-500 dark:text-slate-400";

function cellTitle(d: HeatmapDay): string {
  const n = d.count === 1 ? "1 contribution" : `${d.count} contributions`;
  const when = new Date(d.date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${n} on ${when}`;
}

/** Place a week's days into 7 weekday slots (Sun..Sat); missing days (partial weeks) stay null. */
function columnCells(week: HeatmapWeek): (HeatmapDay | null)[] {
  const col: (HeatmapDay | null)[] = Array(7).fill(null);
  for (const d of week.days) col[new Date(d.date).getUTCDay()] = d;
  return col;
}

/** Month name to show above each column, or null. Suppressed when it would crowd the previous label. */
function monthLabels(weeks: HeatmapWeek[]): (string | null)[] {
  let lastLabeled = -Infinity;
  let prevMonth: number | null = null;
  return weeks.map((w, i) => {
    const first = w.days[0];
    const month = first ? new Date(first.date).getUTCMonth() : prevMonth;
    let label: string | null = null;
    if (month !== null && month !== prevMonth && i - lastLabeled >= 3) {
      label = MONTHS[month];
      lastLabeled = i;
    }
    prevMonth = month;
    return label;
  });
}

/**
 * Measure the container width and derive how many week-columns fit. Returns `cols: null`
 * before the first measurement (or where ResizeObserver is unavailable — jsdom/SSR), meaning
 * "show every week"; once measured, only the most recent `cols` weeks are shown (no scrollbar,
 * widen the card to reveal more). Ref-callback pattern mirrors `useElementHeight`.
 */
function useFitColumns(): { ref: (node: HTMLElement | null) => void; cols: number | null } {
  const [width, setWidth] = useState(0);
  const ref = useCallback((node: HTMLElement | null) => {
    if (!node || typeof ResizeObserver === "undefined") return;
    setWidth(node.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setWidth(box.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const cols = width > 0 ? Math.max(1, Math.floor((width - DOW_W - GUTTER + GAP) / COL)) : null;
  return { ref, cols };
}

export function HeatmapWidget({ data }: WidgetBodyProps<HeatmapData, HeatmapConfig>) {
  const { ref, cols } = useFitColumns();
  if (data.total === 0)
    return <p className="py-2 text-sm text-slate-500 dark:text-slate-400">No activity this year.</p>;

  const weeks = cols == null ? data.weeks : data.weeks.slice(-cols);
  const months = monthLabels(weeks);

  return (
    // h-full + justify-center: fits the default height and vertically centers when the card is taller.
    <div ref={ref} className="flex h-full flex-col justify-center overflow-hidden">
      <div>
        {/* Month axis — columns mirror the grid's width/gap so labels sit above their week. */}
        <div className="flex" style={{ paddingLeft: DOW_W + GUTTER, height: MONTH_H }}>
          <div className="flex" style={{ gap: GAP }}>
            {months.map((m, i) => (
              <div key={i} className="relative" style={{ width: CELL }}>
                {m && <span className={`absolute left-0 top-0 whitespace-nowrap leading-none ${LABEL}`}>{m}</span>}
              </div>
            ))}
          </div>
        </div>
        {/* Weekday gutter + cells */}
        <div className="flex" style={{ gap: GUTTER }}>
          <div className="flex flex-col" style={{ width: DOW_W, gap: GAP }}>
            {DOW.map((l, r) => (
              <div key={r} className={LABEL} style={{ height: CELL, lineHeight: `${CELL}px` }}>
                {l}
              </div>
            ))}
          </div>
          <div className="flex" style={{ gap: GAP }}>
            {weeks.map((w, i) => (
              <div key={i} className="flex flex-col" style={{ gap: GAP }}>
                {columnCells(w).map((d, r) => (
                  <span
                    key={r}
                    title={d ? cellTitle(d) : undefined}
                    className="rounded-[2px]"
                    style={{
                      width: CELL,
                      height: CELL,
                      backgroundColor: d ? `var(${LEVEL_VAR[d.level]})` : "transparent",
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
