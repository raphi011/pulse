"use client";
import type { WidgetBodyProps } from "@/modules/contracts";
import type { CcusageSpendData, CcusageSpendConfig } from "../manifest";
import { Ring } from "@/components/ring";

/** green (empty) → red (at/over limit). hue 140→0 linearly across pct 0→1, clamped. */
export function costColor(pct: number): string {
  const hue = 140 * (1 - Math.min(Math.max(pct, 0), 1));
  return `hsl(${hue} 70% 45%)`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-07-13" → "Jul 13". Pure + timezone-safe (no Date parsing). */
export function formatDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${MONTHS[Number(m) - 1] ?? m} ${Number(d)}`;
}

/** Shrink the hero amount as it grows so it never touches the ring stroke. */
function heroFitClass(text: string): string {
  if (text.length >= 8) return "text-xl"; // $1234.56
  if (text.length === 7) return "text-2xl"; // $123.45
  return "text-[1.75rem]"; // ≤ $99.99
}

export function CcusageWidget({ data, config }: WidgetBodyProps<CcusageSpendData, CcusageSpendConfig>) {
  const limit = config.dailyLimitUsd;
  const pct = limit > 0 ? data.costUsd / limit : 0;
  const over = limit > 0 && pct >= 1;
  const amount = `$${data.costUsd.toFixed(2)}`;

  return (
    <div className="flex h-full flex-col items-center gap-3">
      <div className="flex min-h-0 w-full flex-1 items-center justify-center">
        <Ring progress={limit > 0 ? Math.min(pct, 1) : undefined} color={costColor(pct)} arcTestId="ccusage-arc">
          <span className="text-[0.625rem] font-semibold uppercase tracking-[0.09em] text-slate-500 dark:text-slate-400">
            Today · {formatDate(data.date)}
          </span>
          <span
            className={`${heroFitClass(amount)} font-semibold leading-none tracking-tight tabular-nums ${
              over ? "text-danger" : "text-slate-900 dark:text-slate-100"
            }`}
          >
            {amount}
          </span>
        </Ring>
      </div>

      {limit > 0 ? (
        <div className="shrink-0 tabular-nums text-xs text-slate-500 dark:text-slate-400">
          of ${limit.toFixed(2)} · {Math.round(pct * 100)}%
        </div>
      ) : (
        <div className="shrink-0 text-xs text-slate-500 dark:text-slate-400">No limit set</div>
      )}
    </div>
  );
}
