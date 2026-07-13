"use client";
import type { WidgetBodyProps } from "@/modules/contracts";
import type { CcusageSpendData, CcusageSpendConfig } from "../manifest";

/** green (empty) → red (at/over limit). hue 140→0 linearly across pct 0→1, clamped. */
export function costColor(pct: number): string {
  const hue = 140 * (1 - Math.min(Math.max(pct, 0), 1));
  return `hsl(${hue} 70% 45%)`;
}

export function CcusageWidget({ data, config }: WidgetBodyProps<CcusageSpendData, CcusageSpendConfig>) {
  const limit = config.dailyLimitUsd;
  const pct = limit > 0 ? data.costUsd / limit : 0;
  const over = limit > 0 && pct >= 1;

  return (
    <div className="flex flex-col gap-2">
      <div
        className={`text-3xl font-semibold tabular-nums ${
          over ? "text-danger" : "text-slate-900 dark:text-slate-100"
        }`}
      >
        ${data.costUsd.toFixed(2)}
      </div>

      {limit > 0 ? (
        <div className="flex flex-col gap-1">
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
            <div
              data-testid="ccusage-bar"
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.min(pct, 1) * 100}%`, backgroundColor: costColor(pct) }}
            />
          </div>
          <div className="tabular-nums text-xs text-slate-500 dark:text-slate-400">
            of ${limit.toFixed(2)} · {Math.round(pct * 100)}%
          </div>
        </div>
      ) : (
        <div className="text-xs text-slate-500 dark:text-slate-400">No limit set</div>
      )}
    </div>
  );
}
