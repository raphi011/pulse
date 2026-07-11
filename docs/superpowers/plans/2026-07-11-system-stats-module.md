# System Stats Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `system` module with one live widget (`system.stats`) showing CPU % and memory usage with scrolling Recharts area graphs, sampled every 1–2s via a Rust `sysinfo` Tauri command.

**Architecture:** A new Tauri command (`system_stats`, persistent `sysinfo::System` in managed state) is polled by a module-level singleton sampler (TS) that keeps a rolling ring buffer; a `useSyncExternalStore` hook feeds the widget. The widget bypasses the cache pipeline (`refreshable: false`, no-op fetch). Spec: `docs/superpowers/specs/2026-07-11-system-stats-module-design.md`.

**Tech Stack:** Tauri v2 (Rust: `sysinfo` crate), React 19 + TypeScript, Recharts (new dep), Zod v4, Vitest + Testing Library, Tailwind v4.

## Global Constraints

- Personal project: NO Jira prefix on commits/branches. Conventional messages, e.g. `feat: add system stats command`.
- Imports use the `@/` alias (`@` → `src/`), e.g. `@/modules/contracts`.
- Tests live under `tests/` and run with `npm test` (vitest, jsdom, globals on).
- Match existing module shape: `manifest.ts` (no runtime deps) / `fetch.ts` / `render.ts` / `widgets/*.tsx`. Closest analog: `src/modules/bookmarks/` (local, `refreshable: false`).
- Chart colors are ALREADY validated with the dataviz six-checks script against the real card surfaces (`#ffffff` light / `#121826` dark). Use exactly: light `--chart-cpu: #4f46e5`, `--chart-mem: #0d9488`; dark `--chart-cpu: #6366f1`, `--chart-mem: #0d9488`. Do not substitute other hues.
- Rust work happens in `src-tauri/`; verify with `cargo test` / `cargo check` run from `src-tauri/`.
- Do not touch `CACHE_VERSION` — this widget stores nothing in `widget_cache` worth versioning (fetch returns `{}`).

---

### Task 1: Rust `system_stats` command

**Files:**
- Modify: `src-tauri/Cargo.toml` (add `sysinfo`)
- Create: `src-tauri/src/system_stats.rs`
- Modify: `src-tauri/src/lib.rs` (mod + manage + invoke_handler)

**Interfaces:**
- Consumes: nothing.
- Produces: Tauri command `system_stats` (no args) returning JSON `{ cpuPercent: number, memUsedBytes: number, memTotalBytes: number }`. Later tasks call it as `invoke("system_stats")`.

- [ ] **Step 1: Add the sysinfo dependency**

Append to `[dependencies]` in `src-tauri/Cargo.toml`:

```toml
# CPU/memory sampling for the system module's `system_stats` command.
sysinfo = { version = "0.35", default-features = false, features = ["system"] }
```

If `cargo check` later reports the version or an API name doesn't exist, run `cargo add sysinfo --no-default-features --features system` from `src-tauri/` to get the current release and adapt names (`global_cpu_usage`, `used_memory`, `total_memory` are stable since 0.30; memory values are bytes).

- [ ] **Step 2: Create `src-tauri/src/system_stats.rs` (implementation + test in one file, Rust-style)**

```rust
//! Live CPU/memory sampling for the `system` module.
//!
//! A persistent `sysinfo::System` lives in Tauri managed state: sysinfo
//! computes CPU % as a delta since the previous refresh, so the instance must
//! survive across invokes — a fresh `System` per call would always report 0%.
//! The webview polls this command every 1–2s (see src/modules/system/sampler.ts).

use std::sync::Mutex;
use sysinfo::System;
use tauri::State;

pub struct SystemMonitor(Mutex<System>);

impl SystemMonitor {
    pub fn new() -> Self {
        SystemMonitor(Mutex::new(System::new()))
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStatsPayload {
    cpu_percent: f32,
    mem_used_bytes: u64,
    mem_total_bytes: u64,
}

fn sample(sys: &mut System) -> SystemStatsPayload {
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    SystemStatsPayload {
        cpu_percent: sys.global_cpu_usage(),
        mem_used_bytes: sys.used_memory(),
        mem_total_bytes: sys.total_memory(),
    }
}

#[tauri::command]
pub fn system_stats(monitor: State<'_, SystemMonitor>) -> Result<SystemStatsPayload, String> {
    let mut sys = monitor.0.lock().map_err(|e| e.to_string())?;
    Ok(sample(&mut sys))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sample_reports_plausible_memory_and_cpu() {
        let mut sys = System::new();
        let first = sample(&mut sys);
        assert!(first.mem_total_bytes > 0, "total memory should be > 0");
        assert!(first.mem_used_bytes <= first.mem_total_bytes);

        // CPU % is a delta between refreshes; wait sysinfo's minimum interval
        // so the second sample is meaningful.
        std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL + std::time::Duration::from_millis(50));
        let second = sample(&mut sys);
        assert!((0.0..=100.0).contains(&second.cpu_percent), "cpu% out of range: {}", second.cpu_percent);
    }
}
```

- [ ] **Step 3: Run the Rust test**

Run: `cd src-tauri && cargo test system_stats`
Expected: FAIL to compile first if the dep isn't fetched yet (cargo fetches automatically), then `test system_stats::tests::sample_reports_plausible_memory_and_cpu ... ok`. If `MINIMUM_CPU_UPDATE_INTERVAL` doesn't exist in the resolved sysinfo version, replace it with `std::time::Duration::from_millis(300)`.

- [ ] **Step 4: Wire the command into `src-tauri/src/lib.rs`**

Three edits:

Top of file (line 1 area, next to `mod db_batch;`):

```rust
mod db_batch;
mod system_stats;
```

In the builder chain, add `.manage(...)` before `.invoke_handler(...)`, and extend the handler list:

```rust
    .manage(system_stats::SystemMonitor::new())
    .invoke_handler(tauri::generate_handler![db_batch::db_batch, system_stats::system_stats])
```

(Replacing the existing `.invoke_handler(tauri::generate_handler![db_batch::db_batch])` line.)

- [ ] **Step 5: Verify the app side compiles**

Run: `cd src-tauri && cargo check`
Expected: `Finished` with no errors.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/system_stats.rs src-tauri/src/lib.rs
git commit -m "feat: add system_stats Tauri command (sysinfo CPU/memory sampling)"
```

---

### Task 2: Module manifest + config schema

**Files:**
- Create: `src/modules/system/manifest.ts`
- Test: `tests/modules/system-config.test.ts`

**Interfaces:**
- Consumes: `defineManifest` from `@/modules/contracts`.
- Produces (used by Tasks 3–5):
  - `SYSTEM_STATS_TYPE = "system.stats"`
  - `systemStatsConfigSchema`, `type SystemStatsConfig = { sampleIntervalSeconds: number; historySeconds: number }`, `systemStatsDefaultConfig`
  - `type SystemStatsPayload = { cpuPercent: number; memUsedBytes: number; memTotalBytes: number }`
  - `type SamplePoint = { t: number; cpu: number; memUsed: number; memTotal: number }`
  - `type SystemStatsData = Record<string, never>`
  - `systemStatsManifest` (with `refreshable: false`)

- [ ] **Step 1: Write the failing test**

Create `tests/modules/system-config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  systemStatsConfigSchema,
  systemStatsDefaultConfig,
  systemStatsManifest,
  SYSTEM_STATS_TYPE,
} from "@/modules/system/manifest";

describe("system stats config schema", () => {
  it("fills defaults from an empty object", () => {
    expect(systemStatsConfigSchema.parse({})).toEqual({ sampleIntervalSeconds: 2, historySeconds: 120 });
    expect(systemStatsDefaultConfig).toEqual({ sampleIntervalSeconds: 2, historySeconds: 120 });
  });

  it("enforces bounds", () => {
    expect(() => systemStatsConfigSchema.parse({ sampleIntervalSeconds: 0 })).toThrow();
    expect(() => systemStatsConfigSchema.parse({ sampleIntervalSeconds: 11 })).toThrow();
    expect(() => systemStatsConfigSchema.parse({ historySeconds: 10 })).toThrow();
    expect(() => systemStatsConfigSchema.parse({ historySeconds: 601 })).toThrow();
  });

  it("manifest is live (non-refreshable) with the right identity", () => {
    expect(systemStatsManifest.type).toBe(SYSTEM_STATS_TYPE);
    expect(SYSTEM_STATS_TYPE).toBe("system.stats");
    expect(systemStatsManifest.title).toBe("System");
    expect(systemStatsManifest.refreshable).toBe(false);
    expect(systemStatsManifest.integration).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/system-config.test.ts`
Expected: FAIL — cannot resolve `@/modules/system/manifest`.

- [ ] **Step 3: Create `src/modules/system/manifest.ts`**

```ts
import { z } from "zod";
import { defineManifest } from "@/modules/contracts";

export const SYSTEM_STATS_TYPE = "system.stats";

/** Both fields render as number inputs in the auto-generated config form. */
export const systemStatsConfigSchema = z.object({
  sampleIntervalSeconds: z.number().min(1).max(10).default(2).describe("Sample interval (seconds)"),
  historySeconds: z.number().min(30).max(600).default(120).describe("History window (seconds)"),
});
export type SystemStatsConfig = z.infer<typeof systemStatsConfigSchema>;
export const systemStatsDefaultConfig: SystemStatsConfig = { sampleIntervalSeconds: 2, historySeconds: 120 };

/** Raw payload of the `system_stats` Tauri command (serde camelCase). */
export type SystemStatsPayload = { cpuPercent: number; memUsedBytes: number; memTotalBytes: number };

/** One sampler tick in the rolling history. `t` is Date.now() ms. */
export type SamplePoint = { t: number; cpu: number; memUsed: number; memTotal: number };

/**
 * The cache pipeline carries no data for this widget — it renders from the
 * live sampler (src/modules/system/sampler.ts), so fetch returns an empty object.
 */
export type SystemStatsData = Record<string, never>;

export const systemStatsManifest = defineManifest({
  type: SYSTEM_STATS_TYPE, title: "System",
  configSchema: systemStatsConfigSchema, defaultConfig: systemStatsDefaultConfig,
  refreshable: false,
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/modules/system-config.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/system/manifest.ts tests/modules/system-config.test.ts
git commit -m "feat: system module manifest and config schema"
```

---

### Task 3: Singleton sampler with ring buffer

**Files:**
- Create: `src/modules/system/sampler.ts`
- Test: `tests/modules/system-sampler.test.ts`

**Interfaces:**
- Consumes: `invoke` from `@tauri-apps/api/core`; `SamplePoint`, `SystemStatsPayload`, `SystemStatsConfig` from `./manifest`.
- Produces (used by Task 4's hook and widget test mocks):
  - `type SamplerSnapshot = { points: SamplePoint[]; error: boolean }`
  - `systemSampler.subscribe(listener: () => void): () => void` — starts ticking on first subscriber (immediate first sample), stops at zero.
  - `systemSampler.getSnapshot(): SamplerSnapshot` — stable reference between changes (safe for `useSyncExternalStore`).
  - `systemSampler.configure(config: SystemStatsConfig): void` — retunes interval/history; restarts a running timer on interval change; trims the buffer on history shrink.
  - `__resetSamplerForTests(): void`

- [ ] **Step 1: Write the failing test**

Create `tests/modules/system-sampler.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { systemSampler, __resetSamplerForTests } from "@/modules/system/sampler";

const GIB = 1024 ** 3;
const payload = { cpuPercent: 12.5, memUsedBytes: 8 * GIB, memTotalBytes: 32 * GIB };
const config = (over: Partial<{ sampleIntervalSeconds: number; historySeconds: number }> = {}) => ({
  sampleIntervalSeconds: 2, historySeconds: 120, ...over,
});

/** jsdom's document.hidden is read-only; make it controllable per test. */
function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("system sampler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(payload);
    __resetSamplerForTests();
    setHidden(false);
  });
  afterEach(() => {
    __resetSamplerForTests();
    vi.useRealTimers();
  });

  it("takes an immediate sample on first subscribe, then one per interval", async () => {
    const unsub = systemSampler.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0); // flush the immediate tick's promise
    expect(systemSampler.getSnapshot().points).toHaveLength(1);
    expect(systemSampler.getSnapshot().points[0]).toMatchObject({ cpu: 12.5, memUsed: 8 * GIB, memTotal: 32 * GIB });

    await vi.advanceTimersByTimeAsync(4000); // two more 2s ticks
    expect(systemSampler.getSnapshot().points).toHaveLength(3);
    unsub();
  });

  it("stops ticking when the last subscriber leaves", async () => {
    const unsub = systemSampler.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    unsub();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(systemSampler.getSnapshot().points).toHaveLength(1);
  });

  it("caps the buffer at historySeconds / sampleIntervalSeconds and drops oldest", async () => {
    systemSampler.configure(config({ sampleIntervalSeconds: 1, historySeconds: 5 })); // capacity 5
    const unsub = systemSampler.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(9000); // 1 immediate + 9 ticks = 10 samples
    const points = systemSampler.getSnapshot().points;
    expect(points).toHaveLength(5);
    expect(points[0].t).toBeLessThan(points[4].t); // oldest-first, oldest dropped
    unsub();
  });

  it("pauses while the document is hidden and resumes on visible", async () => {
    const unsub = systemSampler.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    setHidden(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(systemSampler.getSnapshot().points).toHaveLength(1);
    setHidden(false);
    await vi.advanceTimersByTimeAsync(0); // resume takes an immediate sample
    expect(systemSampler.getSnapshot().points).toHaveLength(2);
    unsub();
  });

  it("flags error only after 3 consecutive failures, and recovers on success", async () => {
    invokeMock.mockRejectedValue(new Error("ipc down"));
    const unsub = systemSampler.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(systemSampler.getSnapshot().error).toBe(false); // 2 failures: not yet
    await vi.advanceTimersByTimeAsync(2000);
    expect(systemSampler.getSnapshot().error).toBe(true); // 3rd failure
    invokeMock.mockResolvedValue(payload);
    await vi.advanceTimersByTimeAsync(2000);
    expect(systemSampler.getSnapshot().error).toBe(false);
    expect(systemSampler.getSnapshot().points.length).toBeGreaterThan(0);
    unsub();
  });

  it("notifies subscribers on each new sample", async () => {
    const listener = vi.fn();
    const unsub = systemSampler.subscribe(listener);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(listener).toHaveBeenCalledTimes(2);
    unsub();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/system-sampler.test.ts`
Expected: FAIL — cannot resolve `@/modules/system/sampler`.

- [ ] **Step 3: Create `src/modules/system/sampler.ts`**

```ts
import { invoke } from "@tauri-apps/api/core";
import type { SamplePoint, SystemStatsConfig, SystemStatsPayload } from "./manifest";
import { systemStatsDefaultConfig } from "./manifest";

export type SamplerSnapshot = { points: SamplePoint[]; error: boolean };

/**
 * Module-level singleton ticker + ring buffer for the system.stats widget.
 *
 * Lives outside React so the rolling history survives card drag/remount (the
 * dashboard remounts widget bodies on reorder). Starts on the first subscriber,
 * stops at zero, and pauses while the app window is hidden — no sampling when
 * nobody can see the graph. History is in-memory only; lost on app restart by design.
 */
const MAX_CONSECUTIVE_FAILURES = 3;

let points: SamplePoint[] = [];
let snapshot: SamplerSnapshot = { points, error: false };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let config: SystemStatsConfig = { ...systemStatsDefaultConfig };
let failures = 0;
let visibilityHooked = false;

function capacity(): number {
  return Math.max(2, Math.floor(config.historySeconds / config.sampleIntervalSeconds));
}

function emit() {
  listeners.forEach((l) => l());
}

async function tick() {
  try {
    const p = await invoke<SystemStatsPayload>("system_stats");
    failures = 0;
    points = [...points, { t: Date.now(), cpu: p.cpuPercent, memUsed: p.memUsedBytes, memTotal: p.memTotalBytes }].slice(-capacity());
    snapshot = { points, error: false };
  } catch {
    // Single hiccups shouldn't flicker the card into an error state.
    failures += 1;
    if (failures >= MAX_CONSECUTIVE_FAILURES && !snapshot.error) snapshot = { points, error: true };
  }
  emit();
}

function start() {
  if (timer !== null || document.hidden) return;
  void tick(); // immediate first sample so the card isn't blank for a full interval
  timer = setInterval(() => void tick(), config.sampleIntervalSeconds * 1000);
}

function stop() {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function onVisibilityChange() {
  if (document.hidden) stop();
  else if (listeners.size > 0) start();
}

export const systemSampler = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    if (!visibilityHooked) {
      document.addEventListener("visibilitychange", onVisibilityChange);
      visibilityHooked = true;
    }
    if (listeners.size === 1) start();
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) stop();
    };
  },

  /** Stable reference between changes — safe as a useSyncExternalStore snapshot. */
  getSnapshot(): SamplerSnapshot {
    return snapshot;
  },

  /** Retune from widget config: restart a running timer on interval change, trim history on shrink. */
  configure(next: SystemStatsConfig): void {
    const intervalChanged = next.sampleIntervalSeconds !== config.sampleIntervalSeconds;
    const historyChanged = next.historySeconds !== config.historySeconds;
    if (!intervalChanged && !historyChanged) return;
    config = { ...next };
    const trimmed = points.slice(-capacity());
    if (trimmed.length !== points.length) {
      points = trimmed;
      snapshot = { points, error: snapshot.error };
    }
    if (intervalChanged && timer !== null) {
      stop();
      start();
    }
    emit();
  },
};

export function __resetSamplerForTests(): void {
  stop();
  listeners.clear();
  points = [];
  snapshot = { points, error: false };
  config = { ...systemStatsDefaultConfig };
  failures = 0;
  if (visibilityHooked) {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    visibilityHooked = false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/modules/system-sampler.test.ts`
Expected: PASS (6 tests). If the visibility test is flaky on the resume assertion, the cause is the immediate `void tick()` needing a microtask flush — the `await vi.advanceTimersByTimeAsync(0)` handles it; do not add real sleeps.

- [ ] **Step 5: Commit**

```bash
git add src/modules/system/sampler.ts tests/modules/system-sampler.test.ts
git commit -m "feat: system sampler singleton with ring buffer and visibility pause"
```

---

### Task 4: Widget UI (Recharts area graphs + stats)

**Files:**
- Modify: `package.json` (add `recharts` via npm install)
- Modify: `src/globals.css` (chart color tokens)
- Create: `src/modules/system/use-system-stats.ts`
- Create: `src/modules/system/widgets/system-stats-widget.tsx`
- Test: `tests/modules/system-widget.test.tsx`

**Interfaces:**
- Consumes: `systemSampler`, `SamplerSnapshot` from `../sampler`; types from `../manifest`; `WidgetBodyProps` from `@/modules/contracts`.
- Produces (used by Task 5): `SystemStatsWidget: FC<WidgetBodyProps<SystemStatsData, SystemStatsConfig>>` exported from `src/modules/system/widgets/system-stats-widget.tsx`.

- [ ] **Step 1: Install Recharts**

Run: `npm install recharts`
Expected: adds `recharts` to dependencies, no peer-dep errors (Recharts 3.x supports React 19).

- [ ] **Step 2: Add chart color tokens to `src/globals.css`**

Inside the existing `@layer base { ... }` block (after the `:focus-visible` rule), add:

```css
  /* Chart series colors — dataviz six-checks validated against the card surfaces
     (#ffffff light / #121826 dark): lightness band, chroma, CVD ΔE, ≥3:1 contrast. */
  :root {
    --chart-cpu: #4f46e5;
    --chart-mem: #0d9488;
  }
  .dark {
    --chart-cpu: #6366f1;
    --chart-mem: #0d9488;
  }
```

- [ ] **Step 3: Write the failing widget test**

Create `tests/modules/system-widget.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SamplePoint } from "@/modules/system/manifest";

const state = vi.hoisted(() => ({
  snapshot: { points: [] as SamplePoint[], error: false },
}));

vi.mock("@/modules/system/sampler", () => ({
  systemSampler: {
    subscribe: () => () => {},
    getSnapshot: () => state.snapshot,
    configure: () => {},
  },
}));

import { SystemStatsWidget } from "@/modules/system/widgets/system-stats-widget";
import { systemStatsDefaultConfig } from "@/modules/system/manifest";

const GIB = 1024 ** 3;
const point = (t: number, cpu: number): SamplePoint => ({ t, cpu, memUsed: 8.2 * GIB, memTotal: 32 * GIB });

function renderWidget() {
  return render(
    <SystemStatsWidget data={{}} config={systemStatsDefaultConfig} refresh={async () => {}} />,
  );
}

describe("SystemStatsWidget", () => {
  beforeEach(() => {
    state.snapshot = { points: [], error: false };
  });

  it("shows a measuring state until two samples exist", () => {
    state.snapshot = { points: [point(1000, 10)], error: false };
    renderWidget();
    expect(screen.getByText(/measuring/i)).toBeInTheDocument();
  });

  it("renders current CPU %, memory used/total, and both section labels", () => {
    state.snapshot = { points: [point(1000, 10), point(3000, 37.4)], error: false };
    renderWidget();
    expect(screen.getByText("CPU")).toBeInTheDocument();
    expect(screen.getByText("37%")).toBeInTheDocument();
    expect(screen.getByText("Memory")).toBeInTheDocument();
    expect(screen.getByText("8.2 / 32.0 GB")).toBeInTheDocument();
  });

  it("shows the error state when the sampler reports failure", () => {
    state.snapshot = { points: [], error: true };
    renderWidget();
    expect(screen.getByText(/unavailable/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/modules/system-widget.test.tsx`
Expected: FAIL — cannot resolve `@/modules/system/widgets/system-stats-widget`.

- [ ] **Step 5: Create `src/modules/system/use-system-stats.ts`**

```ts
import { useEffect, useSyncExternalStore } from "react";
import { systemSampler, type SamplerSnapshot } from "./sampler";
import type { SystemStatsConfig } from "./manifest";

/** Subscribe this component to the live sampler and keep it tuned to the widget config. */
export function useSystemStats(config: SystemStatsConfig): SamplerSnapshot {
  // configure() no-ops when values are unchanged, so a fresh config object
  // identity per render costs nothing.
  useEffect(() => {
    systemSampler.configure(config);
  }, [config]);
  return useSyncExternalStore(systemSampler.subscribe, systemSampler.getSnapshot);
}
```

- [ ] **Step 6: Create `src/modules/system/widgets/system-stats-widget.tsx`**

Chart mark specs follow the dataviz skill: 2px line, gradient area fill, no axis clutter (fixed domains, hidden axes), no per-point animation (data shifts every tick), hover tooltip, values in ink colors — series color only on the marks.

```tsx
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
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/modules/system-widget.test.tsx`
Expected: PASS (3 tests). Note: `ResponsiveContainer` measures 0×0 in jsdom, so the SVG plot itself doesn't render in tests — the assertions deliberately target the stat text, not chart internals.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/globals.css src/modules/system/use-system-stats.ts src/modules/system/widgets/system-stats-widget.tsx tests/modules/system-widget.test.tsx
git commit -m "feat: system stats widget with live CPU/memory area charts"
```

---

### Task 5: Register the module (fetch + render + wiring)

**Files:**
- Create: `src/modules/system/fetch.ts`
- Create: `src/modules/system/render.ts`
- Modify: `src/modules/fetch.ts`
- Modify: `src/modules/render.ts`
- Test: `tests/modules/system-registration.test.ts`

**Interfaces:**
- Consumes: `systemStatsManifest`, `SystemStatsData` (Task 2); `SystemStatsWidget` (Task 4); `registerFetch` from `@/modules/fetch-registry`; `registerRender` from `@/modules/render-registry`.
- Produces: `system.stats` resolvable in both registries (the shell picks it up automatically).

- [ ] **Step 1: Write the failing registration test**

Create `tests/modules/system-registration.test.ts` (mirrors `bookmarks-registration.test.ts`):

```ts
import { describe, it, expect } from "vitest";
import "@/modules/fetch";
import { getFetchWidget } from "@/modules/fetch-registry";
import { SYSTEM_STATS_TYPE, systemStatsDefaultConfig } from "@/modules/system/manifest";

describe("system fetch registration", () => {
  it("registers system.stats on the fetch registry with defaults", () => {
    const def = getFetchWidget(SYSTEM_STATS_TYPE);
    expect(def).toBeDefined();
    expect(def!.manifest.defaultConfig).toEqual(systemStatsDefaultConfig);
    expect(typeof def!.fetch).toBe("function");
  });

  it("fetch returns an empty payload (data comes from the live sampler)", async () => {
    const def = getFetchWidget(SYSTEM_STATS_TYPE);
    await expect(def!.fetch(systemStatsDefaultConfig)).resolves.toEqual({});
  });
});

import "@/modules/render";
import { getRenderWidget } from "@/modules/render-registry";

describe("system render registration", () => {
  it("registers system.stats on the render registry as a live, non-refreshable widget", () => {
    const def = getRenderWidget(SYSTEM_STATS_TYPE);
    expect(def).toBeDefined();
    expect(def!.manifest.title).toBe("System");
    expect(def!.manifest.refreshable).toBe(false);
    expect(def!.Component).toBeDefined();
    expect(def!.icon).toBeDefined();
  });

  it("both sides share the same manifest object", () => {
    expect(getFetchWidget(SYSTEM_STATS_TYPE)!.manifest).toBe(getRenderWidget(SYSTEM_STATS_TYPE)!.manifest);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/system-registration.test.ts`
Expected: FAIL — `getFetchWidget(SYSTEM_STATS_TYPE)` returns undefined.

- [ ] **Step 3: Create `src/modules/system/fetch.ts`**

```ts
import { registerFetch } from "@/modules/fetch-registry";
import { systemStatsManifest, type SystemStatsData } from "./manifest";

/** Live widget: data flows through the sampler, not the cache — fetch is a contract no-op. */
export async function fetchSystemStats(): Promise<SystemStatsData> {
  return {};
}

registerFetch(systemStatsManifest, { fetch: fetchSystemStats });
```

- [ ] **Step 4: Create `src/modules/system/render.ts`**

```ts
import { FiCpu } from "react-icons/fi";
import { registerRender } from "@/modules/render-registry";
import { systemStatsManifest } from "./manifest";
import { SystemStatsWidget } from "./widgets/system-stats-widget";

registerRender(systemStatsManifest, {
  Component: SystemStatsWidget,
  icon: { Icon: FiCpu, className: "text-slate-500 dark:text-slate-400" },
});
```

- [ ] **Step 5: Wire the module imports**

`src/modules/fetch.ts` — add before the trailing comment:

```ts
import "./system/fetch";
```

`src/modules/render.ts` — add before the trailing comment:

```ts
import "./system/render";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/modules/system-registration.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add src/modules/system/fetch.ts src/modules/system/render.ts src/modules/fetch.ts src/modules/render.ts tests/modules/system-registration.test.ts
git commit -m "feat: register system module on fetch and render registries"
```

---

### Task 6: Full verification + live smoke test

**Files:** none new.

**Interfaces:** n/a — this task gates completion.

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all suites pass, including the four new `system-*` test files and every pre-existing test (especially `registry.test.ts` and other modules' registration tests — a bad registry interaction would surface there).

- [ ] **Step 2: Lint + Rust**

Run: `npm run lint && cd src-tauri && cargo test && cd ..`
Expected: eslint clean; cargo tests pass.

- [ ] **Step 3: Live smoke test (real app, real data)**

Run: `npm run dev` (Rust + webview) and verify by eye:
1. Add a "System" widget from the add-widget UI — the card appears with no refresh button and no fetchedAt line (refreshable: false).
2. "Measuring…" appears briefly, then both graphs scroll left as new samples land every 2s; CPU % moves, memory reads plausibly (compare against Activity Monitor).
3. Drag the card to another column — the graph history survives the remount.
4. Open Configure — the form shows the two number fields ("Sample interval (seconds)", "History window (seconds)"); set interval to 1 and confirm faster ticks.
5. Toggle dark mode — chart colors swap (indigo `#6366f1`, teal stays `#0d9488`), tooltip and text remain readable.
6. Hide the window (tray) for ~30s, show it again — the graph has a gap-free restart rather than a frozen UI (sampling paused while hidden, immediate sample on show).

Expected: all six observations hold. If anything is off, fix before claiming done (superpowers:verification-before-completion).

- [ ] **Step 4: Final commit (if the smoke test required tweaks)**

```bash
git add -A && git commit -m "fix: system stats polish from live smoke test"
```

Only commit if there are changes; otherwise done.
