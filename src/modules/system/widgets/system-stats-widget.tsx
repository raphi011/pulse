"use client";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { WidgetBodyProps } from "@/modules/contracts";
import type { SamplePoint, SystemStatsConfig, SystemStatsData } from "../manifest";
import { useSystemStats } from "../use-system-stats";

type Props = WidgetBodyProps<SystemStatsData, SystemStatsConfig>;

const GIB = 1024 ** 3;
const gb = (bytes: number) => (bytes / GIB).toFixed(1);

const KIB = 1024;
const MIB = 1024 ** 2;
function rate(bytesPerSec: number): string {
  if (bytesPerSec >= MIB) return `${(bytesPerSec / MIB).toFixed(1)} MB/s`;
  if (bytesPerSec >= KIB) return `${(bytesPerSec / KIB).toFixed(1)} KB/s`;
  return `${bytesPerSec.toFixed(0)} B/s`;
}

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

function NetTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md bg-panel px-2 py-1 text-xs shadow-lg ring-1 ring-border dark:bg-panel-dark dark:ring-border-dark">
      <span className="font-medium tabular-nums text-slate-900 dark:text-slate-100">
        {`↓ ${rate(p.rx)} ↑ ${rate(p.tx)}`}
      </span>
      <span className="ml-1.5 text-muted">{new Date(p.t).toLocaleTimeString()}</span>
    </div>
  );
}

/** Both directions share one chart (and one auto y-domain) so relative volume reads at a glance. */
function NetworkArea({ points }: { points: SamplePoint[] }) {
  const rxColor = "var(--chart-net-rx)";
  const txColor = "var(--chart-net-tx)";
  return (
    <div className="mt-1 h-16">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="sys-net-rx-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={rxColor} stopOpacity={0.28} />
              <stop offset="100%" stopColor={rxColor} stopOpacity={0.03} />
            </linearGradient>
            <linearGradient id="sys-net-tx-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={txColor} stopOpacity={0.28} />
              <stop offset="100%" stopColor={txColor} stopOpacity={0.03} />
            </linearGradient>
          </defs>
          <XAxis dataKey="t" hide />
          <YAxis domain={[0, "auto"]} hide />
          <Tooltip
            content={<NetTooltip />}
            cursor={{ stroke: "currentColor", strokeOpacity: 0.25, strokeWidth: 1 }}
            isAnimationActive={false}
          />
          <Area
            type="monotone" dataKey="rx" stroke={rxColor} strokeWidth={2}
            fill="url(#sys-net-rx-fill)" isAnimationActive={false} dot={false}
            activeDot={{ r: 3, strokeWidth: 0 }}
          />
          <Area
            type="monotone" dataKey="tx" stroke={txColor} strokeWidth={2}
            fill="url(#sys-net-tx-fill)" isAnimationActive={false} dot={false}
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
      <section aria-label="Network traffic">
        <div className="flex items-baseline justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Network</h3>
          <span className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            <span aria-hidden style={{ color: "var(--chart-net-rx)" }}>↓</span>
            {` ${rate(latest.rx)} `}
            <span aria-hidden style={{ color: "var(--chart-net-tx)" }}>↑</span>
            {` ${rate(latest.tx)}`}
          </span>
        </div>
        <NetworkArea points={points} />
      </section>
    </div>
  );
}
