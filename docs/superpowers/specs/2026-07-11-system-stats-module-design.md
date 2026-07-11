# System Stats Module — Design

**Date:** 2026-07-11
**Status:** Approved for planning

## Summary

A new `system` module for the dashboard: one widget (`system-stats`) showing live CPU % and memory usage of the local machine, each with a scrolling area graph. First "live" module in the app — data comes from a 1–2s ticker, not the cache-first fetch pipeline.

## Decisions (with rationale)

| Decision | Choice | Why |
|---|---|---|
| Update model | Live ticker, in-memory rolling history | A CPU graph in coarse 5–10s cache steps feels dead; live sampling reads like a real system monitor |
| Data source | Custom Tauri command using Rust `sysinfo` crate | One IPC call per tick, microseconds of work; spawning `top`/`vm_stat` every tick is heavy and parse-fragile |
| Stats scope | Overall CPU % + memory used/total only | YAGNI; per-core, load/swap, top-processes are follow-ups |
| Chart rendering | Recharts | Batteries included (tooltips, animation); reusable by future modules. New dependency, accepted |
| Widget granularity | One combined "System" card | One ticker, one card; CPU + memory are closely related |
| Ticker/history home | Module-level singleton sampler | Card drag/reorder remounts widget components; React-local state would wipe the graph |

## Architecture

New module `src/modules/system/` following the standard split:

- `manifest.ts` — `defineManifest` for widget type `system-stats`, title "System". `refreshable: false` (no refresh button, no fetchedAt — the card is always current by definition). No `integration` (no CLI, no auth).
- `fetch.ts` — registers a minimal fetch to satisfy the module contract; the widget renders from the sampler, not cached data.
- `widgets/system-stats.tsx` + `render.ts` — the card component.
- `sampler.ts` — the singleton ticker + ring buffer (see below).
- Imports added to `src/modules/fetch.ts` and `src/modules/render.ts`.

### Rust command

`src-tauri/src/system_stats.rs`, using the `sysinfo` crate (new Cargo dependency):

- A persistent `sysinfo::System` instance in Tauri managed state behind a `Mutex`. Persistence matters: sysinfo computes CPU % as a delta since the previous refresh, which maps exactly onto a ticker cadence.
- Command `system_stats()` refreshes CPU + memory and returns `{ cpuPercent: f32, memUsedBytes: u64, memTotalBytes: u64 }`.
- Registered in the existing `invoke_handler` alongside `db_batch`.

### Sampler (module-level singleton)

`src/modules/system/sampler.ts`:

- Starts a `setInterval` when the first subscriber appears; stops at zero subscribers.
- Pauses on `visibilitychange` (no sampling while the app window is hidden); resumes on visible.
- Each tick: `invoke('system_stats')` → push `{ t, cpu, memUsed, memTotal }` into a ring buffer sized `historySeconds / sampleIntervalSeconds`.
- `useSystemStats(config)` React hook subscribes components to the buffer.
- History survives card remount (drag, hide/show, config edit); lost on app restart by design.
- If the widget config changes the interval, the sampler restarts its timer with the new value.

### Widget UI

One card, CPU section stacked above memory:

- Each section: current value as a stat (CPU %; memory as used/total in GB) plus a Recharts `AreaChart` over the rolling window.
- Sparkline styling: no axis clutter, fixed y-domain (0–100 for CPU, 0–total for memory), gradient fill, hover tooltip.
- Theme-aware colors (light/dark); `dataviz` and `impeccable` skills applied at implementation time.
- Until 2 samples exist, a brief "measuring…" skeleton.

### Config

Auto-generated form; both fields are `number`, which `schema-form.tsx` supports:

- `sampleIntervalSeconds` — `z.number().min(1).max(10).default(2)`
- `historySeconds` — `z.number().min(30).max(600).default(120)`

### Error handling

- A failed `invoke` increments a consecutive-failure counter on the sampler; the widget shows the standard in-card error state only after 3 consecutive failures (no flicker on a single hiccup). Counter resets on success.
- In practice `sysinfo` does not fail on macOS; this is a guard, not an expected path.

## Dependencies

- npm: `recharts` (new)
- Cargo: `sysinfo` (new)

## Testing

- `tests/modules/system-registration.test.ts` — both registries resolve `system-stats` (standard per-module test).
- Sampler unit test with fake timers + mocked `invoke`: ring-buffer capacity, start/stop tied to subscriber count, pause on document hidden, failure counter behavior.
- Widget render test with injected sample points (stat values + skeleton state).
- Config schema test: defaults and min/max bounds.

## Out of scope (deliberate)

Per-core CPU breakdown, load average, swap, top-processes list, persisted history across restarts, network/disk stats. All are natural follow-ups; none block this design.
