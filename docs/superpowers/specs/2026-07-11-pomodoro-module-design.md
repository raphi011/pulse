# Pomodoro Module — Design

Date: 2026-07-11
Status: approved

## Summary

A `pomodoro` module for the dashboard: a classic pomodoro-cycle timer widget
(work → short break → …, long break every Nth pomodoro) that fires a native
macOS notification when a phase ends. Timer logic lives in a webview singleton
engine (the `system`-module sampler pattern); completed pomodoros persist in a
module-owned table (the `bookmarks`-module repo pattern).

## Decisions

- **Semantics:** classic cycle — work / short break / long break every Nth
  pomodoro, with a daily completed count.
- **Alert:** native macOS notification via `tauri-plugin-notification` (the
  default notification sound provides audibility). No separate in-app chime.
- **Phase transitions:** every phase starts manually. On expiry the timer
  notifies and stops in a `finished` state with the next phase queued.
- **Persistence:** completed-pomodoro history persists in the DB; running
  timer state is in-memory only (lost on app quit — acceptable).
- **Engine location:** webview TS singleton (approach A). A Rust-side timer
  (approach B) was rejected as overkill; worst case the notification lands a
  few seconds late while the window is hidden, and the deadline-based math
  self-corrects. Migration to Rust remains possible later without changing
  the widget.

## Module shape

```
src/modules/pomodoro/
  manifest.ts            # type "pomodoro.timer", config schema, Data = {} (live widget)
  engine.ts              # singleton state machine outside React (sampler pattern)
  notify.ts              # wrapper over @tauri-apps/plugin-notification (permission + send)
  repo.ts                # pomodoro_sessions table + CRUD
  use-pomodoro.ts        # useSyncExternalStore(engine) + configure-from-config effect
  fetch.ts               # contract no-op returning {}
  render.ts              # Component, icon, formEditable: true
  widgets/pomodoro-widget.tsx
```

- No `integration` field — always available in the add-widget drawer.
- `refreshable: false`; `Data = Record<string, never>`; fetch is a no-op
  returning `{}` (the cache pipeline carries no data for live widgets).
- Barrels: import `./pomodoro/fetch` in `src/modules/fetch.ts` and
  `./pomodoro/render` in `src/modules/render.ts`.

## Engine (state machine)

- Phase: `work | shortBreak | longBreak`. Status: `idle | running | paused |
  finished`. Cycle position counts completed work blocks since the last long
  break; after every `pomodorosPerLongBreak`-th work block the queued break is
  a long break, otherwise short.
- **Deadline-based ticking:** on start, store `deadline = Date.now() +
  duration`. A ~500 ms interval recomputes remaining time from `Date.now()`.
  Webview timer throttling or card remounts can only delay the *display* and
  the expiry *check*, never skew elapsed time.
- On expiry: fire the notification; if the finished phase was `work`, persist
  a completed session via the repo; transition to `finished` with the next
  phase queued. The user starts the next phase manually.
- Controls: `start`, `pause`/`resume`, `reset` (current phase back to idle at
  full duration), `skip` (breaks only — jump straight to the queued work
  phase).
- Singleton lifecycle mirrors `system/sampler.ts`: module-level state outside
  React, `subscribe`/`getSnapshot`/`configure`, interval runs only while a
  timer is running.
- Config changes apply to the next phase; a running or paused phase keeps the
  duration it started with.
- If multiple pomodoro widgets are added, they share the one engine (same
  singleton) — the last-configured widget's config wins, same trade-off as the
  `system` module.

## Config schema

All fields `z.number().int().min(1)` with `.describe()` labels and defaults —
renders in the auto-generated schema form:

| Field | Default |
|---|---|
| `workMinutes` | 25 |
| `shortBreakMinutes` | 5 |
| `longBreakMinutes` | 15 |
| `pomodorosPerLongBreak` | 4 |

Per the `system`-module lesson: `safeParse` the config in `use-pomodoro.ts`
before it reaches the engine; fall back to schema defaults on parse failure.

## Notification

- Add `tauri-plugin-notification`: Cargo dependency + `.plugin(...)` init in
  `lib.rs`, `notification:default` permission in the capability file, npm
  `@tauri-apps/plugin-notification`.
- `notify.ts`: check/request permission lazily on first send; expose one
  `notifyPhaseEnd(...)` used by the engine. Messages like
  "Pomodoro #3 done — take a short break" / "Break over — ready for the next
  pomodoro".
- Permission denied: show a small in-card hint; the timer keeps working.
- Notification failures never break the engine (catch and surface as the
  hint, don't throw into the tick).

## Persistence

- New table `pomodoro_sessions` (`id` integer pk, `finished_at` integer
  timestamp) in `src/db/schema.ts`, owned by `repo.ts`; migration generated
  via `npm run db:generate` and registered in `src-tauri` (`include_str!` of
  the new `drizzle/*.sql` file in the SQL plugin's migration list).
- One row per completed **work** block. Today's count = rows with
  `finished_at` in the local calendar day.
- `repo.ts`: `addSession()`, `countSessionsToday()` (async, via `getDb()`).
- Rows-not-a-counter keeps future stats (weekly charts etc.) possible without
  a schema change. No pruning for now — rows are tiny.

## Widget UI

- Large `mm:ss` countdown, phase label ("Focus" / "Short break" / "Long
  break"), thin progress bar for the current phase.
- Controls in the body: start / pause / resume / reset; skip shown during
  breaks only.
- Today's completed pomodoros as a dot row.
- Tomato/timer icon in the card header. Empty/idle state shows the configured
  work duration ready to start.
- Styling follows existing widgets (impeccable + tailwind skills at
  implementation time).

## Error handling

- Invalid stored config → schema-form/widget-service behavior as usual
  (in-card "Invalid config"), engine guarded by `safeParse` fallback.
- Notification permission denied or send failure → in-card hint, timer
  unaffected.
- Widget body already wrapped in the per-card ErrorBoundary by the shell.

## Testing

- `tests/modules/pomodoro-registration.test.ts` — both registries resolve
  `pomodoro.timer`, expected title/schema/defaults, and fetch/render share the
  same manifest object.
- Engine unit tests (vitest fake timers, notify + repo mocked): phase
  sequencing, long-break-every-Nth, pause/resume deadline math, expiry fires
  notify + persists work sessions only, reset/skip, config change mid-phase
  applies next phase.
- Repo test against the better-sqlite3 test DB (`addSession`,
  `countSessionsToday` day-boundary behavior).
