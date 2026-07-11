"use client";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { WidgetBodyProps } from "@/modules/contracts";
import type { SamplePoint, SystemStatsConfig, SystemStatsData } from "../manifest";
import { useSystemStats } from "../use-system-stats";

type Props = WidgetBodyProps<SystemStatsData, SystemStatsConfig>;

const GIB = 1024 ** 3;
const gb = (bytes: number) => (bytes / GIB).toFixed(1);

type TooltipPayload = { value: number; payload: SamplePoint };

function ChartTooltip({ active, payload, format }: { active?: boolean; payload?: TooltipPayload[]; format: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md bg-panel px-2 py-1 text-xs shadow-lg ring-1 ring-border dark:bg-panel-dark dark:ring-border-dark">
      <span className="font-medium tabular-nums text-slate-900 dark:text-slate-100">{format(payload[0].value)}</span>
      <span className="ml-1.5 text-muted">{new Date(payload[0].payload.t).toLocaleTimeString()}</span>
    </div>
  );
}

function StatArea({
  points, dataKey, domain, colorVar, gradientId, format,
}: {
  points: SamplePoint[];
  dataKey: "cpu" | "memUsed";
  domain: [number, number];
  colorVar: "--chart-cpu" | "--chart-mem";
  gradientId: string;
  format: (v: number) => string;
}) {
  const color = `var(${colorVar})`;
  return (
    <div className="mt-1 h-16">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0.03} />
            </linearGradient>
          </defs>
          <XAxis dataKey="t" hide />
          <YAxis domain={domain} hide />
          <Tooltip
            content={<ChartTooltip format={format} />}
            cursor={{ stroke: "currentColor", strokeOpacity: 0.25, strokeWidth: 1 }}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

const hintCls = "py-2 text-sm text-slate-500 dark:text-slate-400";

export function SystemStatsWidget({ config }: Props) {
  const { points, error } = useSystemStats(config);

  if (error) return <p className={hintCls}>System stats unavailable.</p>;
  const latest = points[points.length - 1];
  if (points.length < 2 || !latest) return <p className={hintCls}>Measuring…</p>;

  return (
    <div className="space-y-4 py-1">
      <section aria-label="CPU usage">
        <div className="flex items-baseline justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted">CPU</h3>
          <span className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {`${latest.cpu.toFixed(0)}%`}
          </span>
        </div>
        <StatArea
          points={points} dataKey="cpu" domain={[0, 100]}
          colorVar="--chart-cpu" gradientId="sys-cpu-fill" format={(v) => `${v.toFixed(0)}%`}
        />
      </section>
      <section aria-label="Memory usage">
        <div className="flex items-baseline justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Memory</h3>
          <span className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {`${gb(latest.memUsed)} / ${gb(latest.memTotal)} GB`}
          </span>
        </div>
        <StatArea
          points={points} dataKey="memUsed" domain={[0, latest.memTotal]}
          colorVar="--chart-mem" gradientId="sys-mem-fill" format={(v) => `${gb(v)} GB`}
        />
      </section>
    </div>
  );
}
