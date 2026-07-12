"use client";
import type { WidgetBodyProps } from "@/modules/contracts";
import type { HeatmapData, HeatmapConfig, HeatmapDay } from "../manifest";

const LEVEL_VAR = ["--heat-0", "--heat-1", "--heat-2", "--heat-3", "--heat-4"] as const;

function cellTitle(d: HeatmapDay): string {
  const n = d.count === 1 ? "1 contribution" : `${d.count} contributions`;
  const when = new Date(d.date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${n} on ${when}`;
}

export function HeatmapWidget({ data }: WidgetBodyProps<HeatmapData, HeatmapConfig>) {
  if (data.total === 0)
    return <p className="py-2 text-sm text-slate-500 dark:text-slate-400">No activity this year.</p>;
  return (
    <div className="overflow-x-auto py-1">
      <div className="flex gap-[3px]">
        {data.weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-[3px]">
            {week.days.map((d) => (
              <span
                key={d.date}
                title={cellTitle(d)}
                className="h-[11px] w-[11px] rounded-[2px]"
                style={{ backgroundColor: `var(${LEVEL_VAR[d.level]})` }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
