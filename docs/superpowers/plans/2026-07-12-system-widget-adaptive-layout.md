# System Widget Adaptive Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the System widget switch between compact meter rows (short card) and full trend charts (tall card) based on its measured available height, so all three metrics are readable without dragging the card taller.

**Architecture:** A `ResizeObserver` hook measures the widget root's available height (the card body is `flex-1 min-h-0`, so an `h-full` root reports available — not content — height). A pure `nextLayout(height, current)` function picks `"compact"` or `"full"` with a hysteresis deadband to stop the layout oscillating while dragging. The widget renders meter rows (CPU/Memory) + an inline network sparkline in compact, or today's three area charts in full. Purely presentational — no sampler/manifest/data changes.

**Tech Stack:** React 19, TypeScript, Tailwind v4, recharts, Vitest + Testing Library.

## Global Constraints

- Personal project: plain conventional commit messages, **no Jira prefix** (e.g. `feat: ...`).
- Feature work stays surgical; match existing patterns in `src/modules/system/`.
- All new UI colors reuse existing CSS vars (`--chart-cpu`, `--chart-mem`, `--chart-net-rx`, `--chart-net-tx`); no new color vars.
- No shared meter/sparkline component — inline markup local to the module (YAGNI).
- Only two layout modes; no mid-height intermediate state.
- Tests run with `npx vitest run <path>` (jsdom env, `vitest.setup.ts` loads jest-dom). jsdom does not drive real layout, so height is injected in tests, never measured.

---

### Task 1: Layout selection (pure function + hysteresis)

**Files:**
- Create: `src/modules/system/layout.ts`
- Test: `tests/modules/system-layout.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Layout = "compact" | "full"`
  - `const FULL_MIN_PX: number` and `const COMPACT_MAX_PX: number`
  - `function nextLayout(height: number, current: Layout): Layout`

- [ ] **Step 1: Write the failing test**

`tests/modules/system-layout.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { nextLayout, FULL_MIN_PX, COMPACT_MAX_PX } from "@/modules/system/layout";

describe("nextLayout", () => {
  it("is full at or above the upper threshold", () => {
    expect(nextLayout(FULL_MIN_PX, "compact")).toBe("full");
    expect(nextLayout(FULL_MIN_PX + 100, "compact")).toBe("full");
  });

  it("is compact at or below the lower threshold", () => {
    expect(nextLayout(COMPACT_MAX_PX, "full")).toBe("compact");
    expect(nextLayout(0, "full")).toBe("compact");
  });

  it("keeps the current mode inside the deadband (hysteresis)", () => {
    const mid = Math.floor((FULL_MIN_PX + COMPACT_MAX_PX) / 2);
    expect(nextLayout(mid, "compact")).toBe("compact");
    expect(nextLayout(mid, "full")).toBe("full");
  });

  it("has a real deadband (upper strictly above lower)", () => {
    expect(FULL_MIN_PX).toBeGreaterThan(COMPACT_MAX_PX + 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/system-layout.test.ts`
Expected: FAIL — cannot resolve `@/modules/system/layout`.

- [ ] **Step 3: Write minimal implementation**

`src/modules/system/layout.ts`:

```ts
export type Layout = "compact" | "full";

/**
 * Provisional pixel thresholds — tune in Task 3's verify step against the real
 * running card. Full needs ~290px of body height to show three 64px charts
 * without scrolling; compact fits in ~90px.
 */
export const FULL_MIN_PX = 290;
export const COMPACT_MAX_PX = 260;

/**
 * Pick the layout for a measured available height. Inside the
 * [COMPACT_MAX_PX, FULL_MIN_PX] deadband the current mode is kept, so dragging
 * the card border across the boundary doesn't flip the layout back and forth.
 */
export function nextLayout(height: number, current: Layout): Layout {
  if (height >= FULL_MIN_PX) return "full";
  if (height <= COMPACT_MAX_PX) return "compact";
  return current;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/modules/system-layout.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/system/layout.ts tests/modules/system-layout.test.ts
git commit -m "feat: system widget layout selection with hysteresis"
```

---

### Task 2: `useElementHeight` hook (ResizeObserver)

**Files:**
- Create: `src/modules/system/use-element-height.ts`
- Test: `tests/modules/system-use-element-height.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `function useElementHeight(): { ref: (node: HTMLElement | null) => void; height: number }`
  - `ref` is a stable ref callback to attach to the element to measure.
  - `height` is the latest measured content height; `0` before first measurement or where `ResizeObserver` is unavailable (jsdom/SSR).

- [ ] **Step 1: Write the failing test**

`tests/modules/system-use-element-height.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useElementHeight } from "@/modules/system/use-element-height";

let lastCb: ResizeObserverCallback | null = null;

class FakeResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  constructor(cb: ResizeObserverCallback) {
    lastCb = cb;
  }
}

beforeEach(() => {
  lastCb = null;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => vi.unstubAllGlobals());

describe("useElementHeight", () => {
  it("reports the initial and observed content height", () => {
    const { result } = renderHook(() => useElementHeight());

    const node = document.createElement("div");
    node.getBoundingClientRect = () => ({ height: 120 }) as DOMRect;

    act(() => result.current.ref(node));
    expect(result.current.height).toBe(120);

    act(() => {
      lastCb?.(
        [{ contentRect: { height: 300 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });
    expect(result.current.height).toBe(300);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/system-use-element-height.test.ts`
Expected: FAIL — cannot resolve `@/modules/system/use-element-height`.

- [ ] **Step 3: Write minimal implementation**

`src/modules/system/use-element-height.ts`:

```ts
import { useCallback, useState } from "react";

/**
 * Measure an element's live content height via ResizeObserver.
 * Returns a stable ref callback and the latest height (0 before the first
 * measurement, or where ResizeObserver is unavailable — e.g. jsdom/SSR).
 */
export function useElementHeight(): {
  ref: (node: HTMLElement | null) => void;
  height: number;
} {
  const [height, setHeight] = useState(0);

  const ref = useCallback((node: HTMLElement | null) => {
    if (!node || typeof ResizeObserver === "undefined") return;
    setHeight(node.getBoundingClientRect().height);
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setHeight(box.height);
    });
    observer.observe(node);
    // React 19 runs a ref callback's returned cleanup when the node detaches.
    return () => observer.disconnect();
  }, []);

  return { ref, height };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/modules/system-use-element-height.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/modules/system/use-element-height.ts tests/modules/system-use-element-height.test.ts
git commit -m "feat: useElementHeight resize-observer hook for system widget"
```

---

### Task 3: Adaptive widget (compact meters + full charts)

**Files:**
- Modify (full rewrite): `src/modules/system/widgets/system-stats-widget.tsx`
- Modify (add tests, keep existing): `tests/modules/system-widget.test.tsx`

**Interfaces:**
- Consumes: `nextLayout`, `Layout` from `../layout`; `useElementHeight` from `../use-element-height`.
- Produces: `SystemStatsWidget` (unchanged export signature `({ data, config, refresh }) => JSX`).
- Compact mode exposes two `role="meter"` elements (CPU, Memory) with `aria-label`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax`; the network row is a `<section aria-label="Network traffic">` with an inline sparkline + `↓/↑` rate text.
- Full mode renders three `<section data-testid="system-chart-section">` blocks (CPU/Memory/Network) with area charts; no meters.

- [ ] **Step 1: Write the failing tests**

Append to `tests/modules/system-widget.test.tsx` a mock for the height hook and two new cases. First, add this mock alongside the existing `vi.mock("@/modules/system/sampler", …)` block near the top (after the sampler mock):

```ts
const layoutState = vi.hoisted(() => ({ height: 0 }));

vi.mock("@/modules/system/use-element-height", () => ({
  useElementHeight: () => ({ ref: () => {}, height: layoutState.height }),
}));
```

Add this import beside the existing ones:

```ts
import { FULL_MIN_PX, COMPACT_MAX_PX } from "@/modules/system/layout";
```

In the existing `beforeEach`, reset the height so unrelated tests keep running in compact (their default today):

```ts
  beforeEach(() => {
    state.snapshot = { points: [], error: false };
    state.configure.mockReset();
    layoutState.height = COMPACT_MAX_PX; // compact
  });
```

Add two new `it` cases inside the `describe`:

```ts
  it("compact layout (short card) shows CPU and Memory meters and the network rates", () => {
    layoutState.height = COMPACT_MAX_PX - 50;
    state.snapshot = { points: [point(1000, 10), point(3000, 37.4)], error: false };
    renderWidget();

    const meters = screen.getAllByRole("meter");
    expect(meters).toHaveLength(2);
    expect(screen.getByRole("meter", { name: /cpu/i })).toHaveAttribute("aria-valuenow", "37");
    expect(screen.getByText("37%")).toBeInTheDocument();
    expect(screen.getByText("8.2 / 32.0 GB")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Network traffic" })).toHaveTextContent(
      "↓ 1.5 MB/s ↑ 42.0 KB/s",
    );
    expect(screen.queryAllByTestId("system-chart-section")).toHaveLength(0);
  });

  it("full layout (tall card) shows three trend charts and no meters", () => {
    layoutState.height = FULL_MIN_PX + 50;
    state.snapshot = { points: [point(1000, 10), point(3000, 37.4)], error: false };
    renderWidget();

    expect(screen.getAllByTestId("system-chart-section")).toHaveLength(3);
    expect(screen.queryAllByRole("meter")).toHaveLength(0);
    expect(screen.getByText("CPU")).toBeInTheDocument();
    expect(screen.getByText("37%")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/modules/system-widget.test.tsx`
Expected: FAIL — no elements with `role="meter"` / `data-testid="system-chart-section"` yet (widget still renders the old single layout).

- [ ] **Step 3: Rewrite the widget**

Replace the entire contents of `src/modules/system/widgets/system-stats-widget.tsx` with:

```tsx
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
```

- [ ] **Step 4: Run the widget tests to verify they pass**

Run: `npx vitest run tests/modules/system-widget.test.tsx`
Expected: PASS — the two new cases plus all six existing cases (existing cases run in compact via the `beforeEach` height and still find their label/value texts and the network region).

- [ ] **Step 5: Run the full suite + lint**

Run: `npx vitest run && npm run lint`
Expected: all tests PASS, lint clean. (If lint flags the unused `data` prop, note the export signature is unchanged; `data` is intentionally destructured away — leave `{ config }` as the only used field, matching the current file.)

- [ ] **Step 6: Verify in the running app**

Run `npm run dev`, add/locate the System widget, and drag its card height:
- Short card → three compact rows (CPU/Memory meter bars, Network sparkline + rates), no clipping.
- Tall card → three full trend charts.
- Drag slowly across the boundary → no rapid flip-flop (hysteresis holds).

If the switch happens at an awkward height or full mode scrolls, tune `FULL_MIN_PX` / `COMPACT_MAX_PX` in `src/modules/system/layout.ts` (Task 1 test uses the constants, so it stays green). Re-run `npx vitest run tests/modules/system-layout.test.ts` after tuning.

- [ ] **Step 7: Commit**

```bash
git add src/modules/system/widgets/system-stats-widget.tsx tests/modules/system-widget.test.tsx
git commit -m "feat: size-adaptive system widget (compact meters / full charts)"
```

---

## Self-Review

**Spec coverage:**
- Two modes, height-chosen → Task 1 (`nextLayout`) + Task 3 (wiring). ✓
- ResizeObserver measurement → Task 2 (`useElementHeight`). ✓
- Compact: CPU/Memory meters + network inline sparkline → Task 3 `CompactLayout`. ✓
- Full: unchanged three area charts → Task 3 `FullLayout`. ✓
- Hysteresis / no flicker → Task 1 deadband + Task 3 persisted `layout` state. ✓
- Reuse `--chart-*` vars, no new component, no data changes → Task 3. ✓
- Tests for compact + full rendering, existing tests still pass → Task 3 Step 1/4. ✓

**Placeholder scan:** No TBD/TODO. `FULL_MIN_PX`/`COMPACT_MAX_PX` values are provisional-by-design (Task 3 Step 6 tunes them; the pure-function test imports the constants so tuning stays green).

**Type consistency:** `Layout`, `nextLayout`, `FULL_MIN_PX`, `COMPACT_MAX_PX` used identically across Tasks 1/3. `useElementHeight` return shape `{ ref, height }` matches its mock in Task 3. `NetworkArea` gains `wrapperClass?: string` (default preserves current `mt-1 h-16`), consumed by both layouts.
