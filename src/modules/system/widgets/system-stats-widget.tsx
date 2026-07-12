"use client";
import { useState } from "react";
import type { ReactNode } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { WidgetBodyProps } from "@/modules/contracts";
import type { SamplePoint, SystemStatsConfig, SystemStatsData } from "../manifest";
import { useSystemStats } from "../use-system-stats";
import { useElementHeight } from "../use-element-height";
import { nextLayout, type Layout } from "../layout";

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
function NetworkArea({ points, wrapperClass = "mt-1 h-16" }: { points: SamplePoint[]; wrapperClass?: string }) {
  const rxColor = "var(--chart-net-rx)";
  const txColor = "var(--chart-net-tx)";
  return (
    <div className={wrapperClass}>
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

/** Single-line bounded metric: label + track/fill bar + value. */
function MeterRow({
  label, ariaLabel, fraction, valueNow, valueMax, colorVar, value,
}: {
  label: string;
  ariaLabel: string;
  fraction: number;
  valueNow: number;
  valueMax: number;
  colorVar: "--chart-cpu" | "--chart-mem";
  value: string;
}) {
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  return (
    <div className="flex items-center gap-2">
      <h3 className="w-14 shrink-0 text-xs font-medium uppercase tracking-wide text-muted">{label}</h3>
      <div
        role="meter"
        aria-label={ariaLabel}
        aria-valuenow={valueNow}
        aria-valuemin={0}
        aria-valuemax={valueMax}
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200/70 dark:bg-slate-700/50"
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, backgroundColor: `var(${colorVar})` }}
        />
      </div>
      <span className="w-24 shrink-0 whitespace-nowrap text-right text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
        {value}
      </span>
    </div>
  );
}

function CompactLayout({ points, latest }: { points: SamplePoint[]; latest: SamplePoint }) {
  return (
    <div className="space-y-2 py-1">
      <MeterRow
        label="CPU" ariaLabel="CPU usage"
        fraction={latest.cpu / 100} valueNow={Math.round(latest.cpu)} valueMax={100}
        colorVar="--chart-cpu" value={`${latest.cpu.toFixed(0)}%`}
      />
      <MeterRow
        label="Memory" ariaLabel="Memory usage"
        fraction={latest.memTotal > 0 ? latest.memUsed / latest.memTotal : 0}
        valueNow={Math.round(latest.memUsed / GIB)} valueMax={Math.round(latest.memTotal / GIB)}
        colorVar="--chart-mem" value={`${gb(latest.memUsed)} / ${gb(latest.memTotal)} GB`}
      />
      <section aria-label="Network traffic" className="flex items-center gap-2">
        <h3 className="w-14 shrink-0 text-xs font-medium uppercase tracking-wide text-muted">Network</h3>
        <div className="flex-1">
          <NetworkArea points={points} wrapperClass="h-6" />
        </div>
        <span className="shrink-0 whitespace-nowrap text-right text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
          <span aria-hidden style={{ color: "var(--chart-net-rx)" }}>↓</span>
          {` ${rate(latest.rx)} `}
          <span aria-hidden style={{ color: "var(--chart-net-tx)" }}>↑</span>
          {` ${rate(latest.tx)}`}
        </span>
      </section>
    </div>
  );
}

function FullLayout({ points, latest }: { points: SamplePoint[]; latest: SamplePoint }) {
  return (
    <div className="space-y-4 py-1">
      <section aria-label="CPU usage" data-testid="system-chart-section">
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
      <section aria-label="Memory usage" data-testid="system-chart-section">
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
      <section aria-label="Network traffic" data-testid="system-chart-section">
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

const hintCls = "py-2 text-sm text-slate-500 dark:text-slate-400";

export function SystemStatsWidget({ config }: Props) {
  const { points, error } = useSystemStats(config);
  const { ref, height } = useElementHeight();
  const [layout, setLayout] = useState<Layout>("compact");

  // Storing-info-from-previous-render pattern: recompute on every render, persist
  // for the next height change (hysteresis), and render from the fresh value.
  const resolved = nextLayout(height, layout);
  if (resolved !== layout) setLayout(resolved);

  const latest = points[points.length - 1];
  let body: ReactNode;
  if (error) {
    body = <p className={hintCls}>System stats unavailable.</p>;
  } else if (points.length < 2 || !latest) {
    body = <p className={hintCls}>Measuring…</p>;
  } else if (resolved === "full") {
    body = <FullLayout points={points} latest={latest} />;
  } else {
    body = <CompactLayout points={points} latest={latest} />;
  }

  return <div ref={ref} className="h-full">{body}</div>;
}
