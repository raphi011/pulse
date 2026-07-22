"use client";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { WidgetBodyProps } from "@/modules/contracts";
import type { StatsData, SummaryConfig, TrendPoint } from "../manifest";

type Props = WidgetBodyProps<StatsData, SummaryConfig>;

const TILES: { key: "commits" | "prs" | "reviews" | "issues"; label: string }[] = [
  { key: "commits", label: "Commits" },
  { key: "prs", label: "PRs" },
  { key: "reviews", label: "Reviews" },
  { key: "issues", label: "Issues" },
];

type TrendTooltipPayload = { value: number; payload: TrendPoint };
function TrendTooltip({ active, payload }: { active?: boolean; payload?: TrendTooltipPayload[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md bg-panel px-2 py-1 text-xs shadow-lg ring-1 ring-border dark:bg-panel-dark dark:ring-border-dark">
      <span className="font-medium tabular-nums text-slate-900 dark:text-slate-100">{p.count}</span>
      <span className="ml-1.5 text-muted">{new Date(p.date).toLocaleDateString()}</span>
    </div>
  );
}

export function SummaryWidget({ data }: Props) {
  if (data.total === 0)
    return <p className="py-2 text-sm text-slate-500 dark:text-slate-400">No activity in this timeframe.</p>;
  return (
    <div className="space-y-3 py-1">
      <div className="grid grid-cols-2 gap-3">
        {TILES.map((t) => (
          <div key={t.key} className="flex flex-col">
            <span className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {data[t.key]}
            </span>
            <span className="text-xs uppercase tracking-wide text-muted">{t.label}</span>
          </div>
        ))}
      </div>
      <div className="h-16">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.trend} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
            <XAxis dataKey="date" hide />
            <YAxis hide />
            <Tooltip
              content={<TrendTooltip />}
              cursor={{ fill: "currentColor", fillOpacity: 0.06 }}
              isAnimationActive={false}
            />
            <Bar dataKey="count" fill="var(--chart-contrib)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
