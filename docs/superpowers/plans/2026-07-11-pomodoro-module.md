# Pomodoro Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `pomodoro.timer` widget: classic work/short-break/long-break cycle, native macOS notification at phase end, completed pomodoros persisted per day.

**Architecture:** Timer logic lives in a webview singleton engine (`engine.ts`, same pattern as `src/modules/system/sampler.ts`) with wall-clock-deadline ticking, so remounts/throttling never skew elapsed time. Completed work blocks persist in a module-owned `pomodoro_sessions` table (same pattern as `src/modules/bookmarks/repo.ts`). Notifications go through a new `tauri-plugin-notification` wiring.

**Tech Stack:** Tauri v2, React 19, TypeScript, Zod 4, Drizzle ORM (sqlite-proxy), Vitest (fake timers), `@tauri-apps/plugin-notification`.

**Spec:** `docs/superpowers/specs/2026-07-11-pomodoro-module-design.md`

## Global Constraints

- Widget type id is exactly `pomodoro.timer`; module dir `src/modules/pomodoro/`.
- No `integration` field in the manifest (always available in the add-widget drawer); `refreshable: false`; `Data = Record<string, never>`.
- Config fields (all `z.number().int()`, schema-form-safe): `workMinutes` default 25, `shortBreakMinutes` default 5, `longBreakMinutes` default 15, `pomodorosPerLongBreak` default 4.
- Every phase starts manually — the engine never auto-starts the next phase.
- Config changes apply to the *next* phase; a running or paused phase keeps the duration it started with.
- The engine keeps ticking while the window is hidden (unlike the system sampler — the alert must fire in the background). No `visibilitychange` pause.
- Notification failures must never break the engine — catch, set a `notifyBlocked` flag, keep timing.
- Timer state is in-memory only; only completed sessions persist.
- Repo functions are async and go through `getDb()`; timestamps are `Date.now()` ms.
- Commit messages: plain conventional style, no Jira prefix.
- Working tree already has unrelated modified files (`widget-shell.tsx`, `accents.ts` + tests) — **stage only the files each task names**, never `git add -A`.

---

### Task 1: `pomodoro_sessions` table + repo

**Files:**
- Modify: `src/db/schema.ts` (append table)
- Modify: `src-tauri/src/lib.rs:8-13` (`migrations()` — add version 3)
- Create: `src/modules/pomodoro/repo.ts`
- Create: `tests/modules/pomodoro-repo.test.ts`
- Generated: `drizzle/0002_*.sql` (via `npm run db:generate`)

**Interfaces:**
- Consumes: `getDb()` from `@/db/client`, `useTempDb()` from `tests/helpers/db`.
- Produces: `addSession(finishedAt: number): Promise<void>` and `countSessionsToday(now?: number): Promise<number>` from `@/modules/pomodoro/repo` (Task 3's engine calls both).

- [ ] **Step 1: Write the failing repo test**

Create `tests/modules/pomodoro-repo.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useTempDb } from "../helpers/db";
import { addSession, countSessionsToday } from "@/modules/pomodoro/repo";

beforeEach(() => useTempDb());

describe("pomodoro repo", () => {
  it("starts with zero sessions today", async () => {
    expect(await countSessionsToday()).toBe(0);
  });

  it("counts sessions finished today", async () => {
    await addSession(Date.now());
    await addSession(Date.now());
    expect(await countSessionsToday()).toBe(2);
  });

  it("excludes sessions finished before local midnight", async () => {
    const todayStart = new Date().setHours(0, 0, 0, 0);
    await addSession(todayStart - 1); // 1ms before midnight = yesterday
    await addSession(todayStart);
    await addSession(Date.now());
    expect(await countSessionsToday()).toBe(2);
  });

  it("counts relative to the passed `now`", async () => {
    const now = Date.now();
    await addSession(now);
    const tomorrow = now + 24 * 60 * 60 * 1000;
    expect(await countSessionsToday(tomorrow)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/pomodoro-repo.test.ts`
Expected: FAIL — cannot resolve `@/modules/pomodoro/repo`.

- [ ] **Step 3: Add the table to the Drizzle schema**

Append to `src/db/schema.ts`:

```ts
export const pomodoroSessions = sqliteTable("pomodoro_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  finishedAt: integer("finished_at").notNull(), // Date.now() ms of work-block completion
});
```

- [ ] **Step 4: Generate the migration and register it in Rust**

Run: `npm run db:generate`
Expected: a new file `drizzle/0002_<generated-name>.sql` containing `CREATE TABLE pomodoro_sessions ...`. Note the exact filename (`ls drizzle/`).

In `src-tauri/src/lib.rs`, add to the `migrations()` vec (after version 2), using the actual generated filename:

```rust
Migration { version: 3, description: "pomodoro sessions", sql: include_str!("../../drizzle/0002_<generated-name>.sql"), kind: MigrationKind::Up },
```

- [ ] **Step 5: Write the repo**

Create `src/modules/pomodoro/repo.ts`:

```ts
import { gte } from "drizzle-orm";
import { getDb } from "@/db/client";
import { pomodoroSessions } from "@/db/schema";

/** Record one completed work block. `finishedAt` is Date.now() ms. */
export async function addSession(finishedAt: number): Promise<void> {
  await getDb().insert(pomodoroSessions).values({ finishedAt });
}

/** Completed work blocks since local midnight of the day containing `now`. */
export async function countSessionsToday(now: number = Date.now()): Promise<number> {
  const dayStart = new Date(now).setHours(0, 0, 0, 0);
  const rows = await getDb()
    .select({ id: pomodoroSessions.id })
    .from(pomodoroSessions)
    .where(gte(pomodoroSessions.finishedAt, dayStart));
  return rows.length;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/modules/pomodoro-repo.test.ts`
Expected: PASS (4 tests). Note: `useTempDb()` runs migrations from `drizzle/`, so the generated migration is exercised here too.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts src/modules/pomodoro/repo.ts tests/modules/pomodoro-repo.test.ts drizzle/ src-tauri/src/lib.rs
git commit -m "feat: pomodoro sessions table + repo"
```

---

### Task 2: Notification plugin wiring + `notify.ts`

**Files:**
- Modify: `src-tauri/Cargo.toml` (`[dependencies]`)
- Modify: `src-tauri/src/lib.rs` (plugin init)
- Modify: `src-tauri/capabilities/default.json` (permission)
- Modify: `package.json` (npm dep)
- Create: `src/modules/pomodoro/notify.ts`
- Create: `tests/modules/pomodoro-notify.test.ts`

**Interfaces:**
- Consumes: `@tauri-apps/plugin-notification` (`isPermissionGranted`, `requestPermission`, `sendNotification`).
- Produces: `notifyPhaseEnd(title: string, body: string): Promise<boolean>` from `@/modules/pomodoro/notify` — resolves `false` when permission is denied or the send throws, never rejects. (Task 3's engine consumes this.)

- [ ] **Step 1: Write the failing notify test**

Create `tests/modules/pomodoro-notify.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-notification", () => mocks);

import { notifyPhaseEnd } from "@/modules/pomodoro/notify";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("notifyPhaseEnd", () => {
  it("sends when permission is already granted", async () => {
    mocks.isPermissionGranted.mockResolvedValue(true);
    await expect(notifyPhaseEnd("T", "B")).resolves.toBe(true);
    expect(mocks.sendNotification).toHaveBeenCalledWith({ title: "T", body: "B" });
    expect(mocks.requestPermission).not.toHaveBeenCalled();
  });

  it("requests permission once when not yet granted, then sends", async () => {
    mocks.isPermissionGranted.mockResolvedValue(false);
    mocks.requestPermission.mockResolvedValue("granted");
    await expect(notifyPhaseEnd("T", "B")).resolves.toBe(true);
    expect(mocks.sendNotification).toHaveBeenCalledOnce();
  });

  it("returns false without sending when permission is denied", async () => {
    mocks.isPermissionGranted.mockResolvedValue(false);
    mocks.requestPermission.mockResolvedValue("denied");
    await expect(notifyPhaseEnd("T", "B")).resolves.toBe(false);
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it("returns false instead of throwing when the plugin throws", async () => {
    mocks.isPermissionGranted.mockRejectedValue(new Error("no tauri"));
    await expect(notifyPhaseEnd("T", "B")).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/pomodoro-notify.test.ts`
Expected: FAIL — cannot resolve `@/modules/pomodoro/notify` (and/or the plugin package is not installed yet).

- [ ] **Step 3: Install the plugin (npm + Cargo + init + capability)**

```bash
npm install @tauri-apps/plugin-notification
cd src-tauri && cargo add tauri-plugin-notification && cd ..
```

In `src-tauri/src/lib.rs`, add to the builder chain (next to the other `.plugin(...)` lines):

```rust
    .plugin(tauri_plugin_notification::init())
```

In `src-tauri/capabilities/default.json`, add to `"permissions"`:

```json
    "notification:default",
```

- [ ] **Step 4: Write `notify.ts`**

Create `src/modules/pomodoro/notify.ts`:

```ts
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

/**
 * Fire a native notification for a phase ending. Lazily requests permission on
 * first use. Resolves false (never rejects) when permission is denied or the
 * plugin throws — the engine shows an in-card hint but keeps timing.
 */
export async function notifyPhaseEnd(title: string, body: string): Promise<boolean> {
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (!granted) return false;
    sendNotification({ title, body });
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/modules/pomodoro-notify.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Verify the Rust side compiles**

Run: `cd src-tauri && cargo check && cd ..`
Expected: compiles with no errors (warnings ok).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/capabilities/default.json src/modules/pomodoro/notify.ts tests/modules/pomodoro-notify.test.ts
git commit -m "feat: wire tauri-plugin-notification + pomodoro notify wrapper"
```

---

### Task 3: Manifest + engine (state machine)

**Files:**
- Create: `src/modules/pomodoro/manifest.ts`
- Create: `src/modules/pomodoro/engine.ts`
- Create: `tests/modules/pomodoro-engine.test.ts`

**Interfaces:**
- Consumes: `notifyPhaseEnd(title, body): Promise<boolean>` (Task 2), `addSession(finishedAt): Promise<void>` / `countSessionsToday(): Promise<number>` (Task 1), `defineManifest` from `@/modules/contracts`.
- Produces (Task 4 consumes all of these):
  - From `manifest.ts`: `POMODORO_TYPE = "pomodoro.timer"`, `pomodoroConfigSchema`, `PomodoroConfig`, `pomodoroDefaultConfig`, `PomodoroData = Record<string, never>`, `pomodoroManifest`.
  - From `engine.ts`: `PomodoroPhase = "work" | "shortBreak" | "longBreak"`, `PomodoroStatus = "idle" | "running" | "paused" | "finished"`, `PomodoroSnapshot`, and `pomodoroEngine` with `subscribe(l): () => void`, `getSnapshot(): PomodoroSnapshot`, `configure(c: PomodoroConfig): void`, `start(): void`, `pause(): void`, `reset(): void`, `skip(): void`; plus `__resetEngineForTests()`.

- [ ] **Step 1: Write `manifest.ts`** (no test of its own — covered by Task 4's registration test; the engine test imports it)

Create `src/modules/pomodoro/manifest.ts`:

```ts
import { z } from "zod";
import { defineManifest } from "@/modules/contracts";

export const POMODORO_TYPE = "pomodoro.timer";

/** All fields render as number inputs in the auto-generated config form. */
export const pomodoroConfigSchema = z.object({
  workMinutes: z.number().int().min(1).max(180).default(25).describe("Work (minutes)"),
  shortBreakMinutes: z.number().int().min(1).max(60).default(5).describe("Short break (minutes)"),
  longBreakMinutes: z.number().int().min(1).max(60).default(15).describe("Long break (minutes)"),
  pomodorosPerLongBreak: z.number().int().min(1).max(12).default(4).describe("Pomodoros per long break"),
});
export type PomodoroConfig = z.infer<typeof pomodoroConfigSchema>;
export const pomodoroDefaultConfig: PomodoroConfig = {
  workMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  pomodorosPerLongBreak: 4,
};

/**
 * Live widget: the cache pipeline carries no data — the card renders from the
 * engine singleton (src/modules/pomodoro/engine.ts), so fetch returns {}.
 */
export type PomodoroData = Record<string, never>;

export const pomodoroManifest = defineManifest({
  type: POMODORO_TYPE, title: "Pomodoro",
  configSchema: pomodoroConfigSchema, defaultConfig: pomodoroDefaultConfig,
  refreshable: false,
});
```

- [ ] **Step 2: Write the failing engine tests**

Create `tests/modules/pomodoro-engine.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const notifyMock = vi.hoisted(() => ({ notifyPhaseEnd: vi.fn() }));
const repoMock = vi.hoisted(() => ({ addSession: vi.fn(), countSessionsToday: vi.fn() }));
vi.mock("@/modules/pomodoro/notify", () => notifyMock);
vi.mock("@/modules/pomodoro/repo", () => repoMock);

import { pomodoroEngine, __resetEngineForTests } from "@/modules/pomodoro/engine";
import { pomodoroDefaultConfig } from "@/modules/pomodoro/manifest";

const MIN = 60_000;

let unsubscribe: (() => void) | null = null;

/** Subscribe (starts nothing — just listener bookkeeping + count load). */
function attach() {
  unsubscribe = pomodoroEngine.subscribe(() => {});
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  notifyMock.notifyPhaseEnd.mockResolvedValue(true);
  repoMock.addSession.mockResolvedValue(undefined);
  // The engine reconciles its optimistic count from countSessionsToday after
  // each addSession — mirror that: today's count = sessions added so far.
  repoMock.countSessionsToday.mockImplementation(async () => repoMock.addSession.mock.calls.length);
  __resetEngineForTests();
});

afterEach(() => {
  unsubscribe?.();
  unsubscribe = null;
  vi.useRealTimers();
});

describe("pomodoro engine", () => {
  it("starts idle in the work phase with the configured duration", () => {
    attach();
    const s = pomodoroEngine.getSnapshot();
    expect(s).toMatchObject({ phase: "work", status: "idle" });
    expect(s.remainingMs).toBe(25 * MIN);
    expect(s.durationMs).toBe(25 * MIN);
  });

  it("counts down while running", async () => {
    attach();
    pomodoroEngine.start();
    await vi.advanceTimersByTimeAsync(5 * MIN);
    const s = pomodoroEngine.getSnapshot();
    expect(s.status).toBe("running");
    expect(s.remainingMs).toBe(20 * MIN);
  });

  it("work expiry: notifies, persists the session, queues a short break (manual start)", async () => {
    attach();
    pomodoroEngine.start();
    await vi.advanceTimersByTimeAsync(25 * MIN);
    const s = pomodoroEngine.getSnapshot();
    expect(s.status).toBe("finished"); // waits for the user — never auto-starts
    expect(s.phase).toBe("shortBreak");
    expect(s.remainingMs).toBe(5 * MIN);
    expect(notifyMock.notifyPhaseEnd).toHaveBeenCalledOnce();
    expect(repoMock.addSession).toHaveBeenCalledOnce();
    expect(s.completedToday).toBe(1);
  });

  it("break expiry: notifies, queues work, does NOT persist a session", async () => {
    attach();
    pomodoroEngine.start();
    await vi.advanceTimersByTimeAsync(25 * MIN); // work done
    pomodoroEngine.start(); // start short break
    await vi.advanceTimersByTimeAsync(5 * MIN);
    const s = pomodoroEngine.getSnapshot();
    expect(s).toMatchObject({ phase: "work", status: "finished" });
    expect(repoMock.addSession).toHaveBeenCalledOnce(); // still just the work block
    expect(notifyMock.notifyPhaseEnd).toHaveBeenCalledTimes(2);
  });

  it("every 4th completed work block queues a long break", async () => {
    attach();
    for (let i = 0; i < 3; i++) {
      pomodoroEngine.start(); // work
      await vi.advanceTimersByTimeAsync(25 * MIN);
      expect(pomodoroEngine.getSnapshot().phase).toBe("shortBreak");
      pomodoroEngine.start(); // break
      await vi.advanceTimersByTimeAsync(5 * MIN);
    }
    pomodoroEngine.start(); // 4th work block
    await vi.advanceTimersByTimeAsync(25 * MIN);
    const s = pomodoroEngine.getSnapshot();
    expect(s.phase).toBe("longBreak");
    expect(s.remainingMs).toBe(15 * MIN);
  });

  it("pause freezes remaining time; start resumes from it", async () => {
    attach();
    pomodoroEngine.start();
    await vi.advanceTimersByTimeAsync(10 * MIN);
    pomodoroEngine.pause();
    await vi.advanceTimersByTimeAsync(60 * MIN); // wall clock moves, timer doesn't
    expect(pomodoroEngine.getSnapshot()).toMatchObject({ status: "paused", remainingMs: 15 * MIN });
    pomodoroEngine.start();
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(pomodoroEngine.getSnapshot().remainingMs).toBe(10 * MIN);
  });

  it("reset returns the current phase to idle at full duration", async () => {
    attach();
    pomodoroEngine.start();
    await vi.advanceTimersByTimeAsync(10 * MIN);
    pomodoroEngine.reset();
    expect(pomodoroEngine.getSnapshot()).toMatchObject({ phase: "work", status: "idle", remainingMs: 25 * MIN });
  });

  it("skip jumps a queued break straight to work; skip during work is a no-op", async () => {
    attach();
    pomodoroEngine.skip(); // work phase — no-op
    expect(pomodoroEngine.getSnapshot().phase).toBe("work");
    pomodoroEngine.start();
    await vi.advanceTimersByTimeAsync(25 * MIN); // shortBreak queued
    pomodoroEngine.skip();
    expect(pomodoroEngine.getSnapshot()).toMatchObject({ phase: "work", status: "idle", remainingMs: 25 * MIN });
  });

  it("configure mid-phase keeps the running duration; applies to the next phase", async () => {
    attach();
    pomodoroEngine.start();
    await vi.advanceTimersByTimeAsync(5 * MIN);
    pomodoroEngine.configure({ ...pomodoroDefaultConfig, workMinutes: 50, shortBreakMinutes: 10 });
    let s = pomodoroEngine.getSnapshot();
    expect(s.durationMs).toBe(25 * MIN); // unchanged mid-flight
    expect(s.remainingMs).toBe(20 * MIN);
    await vi.advanceTimersByTimeAsync(20 * MIN); // finish at the ORIGINAL duration
    s = pomodoroEngine.getSnapshot();
    expect(s.phase).toBe("shortBreak");
    expect(s.remainingMs).toBe(10 * MIN); // new config applies to the queued phase
  });

  it("flags notifyBlocked when the notification is denied, and keeps working", async () => {
    notifyMock.notifyPhaseEnd.mockResolvedValue(false);
    attach();
    pomodoroEngine.start();
    await vi.advanceTimersByTimeAsync(25 * MIN);
    const s = pomodoroEngine.getSnapshot();
    expect(s.notifyBlocked).toBe(true);
    expect(s.phase).toBe("shortBreak"); // cycle unaffected
  });

  it("loads today's count from the repo on first subscribe", async () => {
    repoMock.countSessionsToday.mockResolvedValue(7);
    attach();
    await vi.advanceTimersByTimeAsync(0); // flush the async load
    expect(pomodoroEngine.getSnapshot().completedToday).toBe(7);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/modules/pomodoro-engine.test.ts`
Expected: FAIL — cannot resolve `@/modules/pomodoro/engine`.

- [ ] **Step 4: Write the engine**

Create `src/modules/pomodoro/engine.ts`:

```ts
import { pomodoroDefaultConfig, type PomodoroConfig } from "./manifest";
import { notifyPhaseEnd } from "./notify";
import { addSession, countSessionsToday } from "./repo";

export type PomodoroPhase = "work" | "shortBreak" | "longBreak";
/** finished = a phase just expired and the next one is queued (manual start, like idle). */
export type PomodoroStatus = "idle" | "running" | "paused" | "finished";

export type PomodoroSnapshot = {
  phase: PomodoroPhase;
  status: PomodoroStatus;
  remainingMs: number;
  /** Full duration of the current phase (frozen at start for running/paused). */
  durationMs: number;
  /** Work blocks completed since local midnight (repo-backed). */
  completedToday: number;
  /** True once a notification was denied/failed — widget shows a hint. */
  notifyBlocked: boolean;
};

/**
 * Module-level singleton state machine for the pomodoro.timer widget — the
 * system-module sampler pattern (lives outside React so card drag/remount
 * can't kill the timer). Deadline-based: elapsed time comes from Date.now()
 * against a stored deadline, so timer throttling can only delay the display
 * and the expiry check, never skew the math.
 *
 * Deliberately NO visibilitychange pause (unlike the system sampler): the
 * whole point is alerting while the window is hidden.
 *
 * Multiple pomodoro widgets share this one engine; last configure() wins.
 */
const TICK_MS = 500;

let config: PomodoroConfig = { ...pomodoroDefaultConfig };
let phase: PomodoroPhase = "work";
let status: PomodoroStatus = "idle";
let deadline: number | null = null; // wall-clock ms while running
let frozenRemainingMs = 0; // remaining while paused; duration of the queued phase otherwise
let frozenDurationMs = 0; // duration of the phase in flight (running/paused)
let workBlocksSinceLongBreak = 0;
let completedToday = 0;
let notifyBlocked = false;
let countLoaded = false;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function durationMsFor(p: PomodoroPhase): number {
  const minutes =
    p === "work" ? config.workMinutes : p === "shortBreak" ? config.shortBreakMinutes : config.longBreakMinutes;
  return minutes * 60_000;
}

function currentRemainingMs(): number {
  if (status === "running" && deadline !== null) return Math.max(0, deadline - Date.now());
  if (status === "paused") return frozenRemainingMs;
  return durationMsFor(phase); // idle | finished: queued phase at full duration
}

function currentDurationMs(): number {
  return status === "running" || status === "paused" ? frozenDurationMs : durationMsFor(phase);
}

let snapshot: PomodoroSnapshot = buildSnapshot();

function buildSnapshot(): PomodoroSnapshot {
  return {
    phase,
    status,
    remainingMs: currentRemainingMs(),
    durationMs: currentDurationMs(),
    completedToday,
    notifyBlocked,
  };
}

function publish() {
  snapshot = buildSnapshot();
  listeners.forEach((l) => l());
}

function stopTimer() {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function tick() {
  if (deadline === null) return;
  if (deadline - Date.now() <= 0) expire();
  else publish();
}

function expire() {
  stopTimer();
  deadline = null;
  const ended = phase;
  if (ended === "work") {
    workBlocksSinceLongBreak += 1;
    completedToday += 1; // optimistic; reconciled by persistSession
    phase = workBlocksSinceLongBreak % config.pomodorosPerLongBreak === 0 ? "longBreak" : "shortBreak";
    void persistSession();
  } else {
    phase = "work";
  }
  status = "finished";
  void sendPhaseEndNotification(ended);
  publish();
}

async function persistSession() {
  try {
    await addSession(Date.now());
    completedToday = await countSessionsToday();
    publish();
  } catch {
    // DB hiccup: keep the optimistic in-memory count; next load reconciles.
  }
}

async function sendPhaseEndNotification(ended: PomodoroPhase) {
  const [title, body] =
    ended === "work"
      ? ["Pomodoro done", `Pomodoro #${completedToday} done — take a ${phase === "longBreak" ? "long" : "short"} break.`]
      : ["Break over", "Ready for the next pomodoro."];
  const ok = await notifyPhaseEnd(title, body);
  if (!ok && !notifyBlocked) {
    notifyBlocked = true;
    publish();
  }
}

async function loadCount() {
  try {
    completedToday = await countSessionsToday();
    publish();
  } catch {
    // Card renders with 0 until a session completes; not worth an error state.
  }
}

export const pomodoroEngine = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    if (!countLoaded) {
      countLoaded = true;
      void loadCount();
    }
    return () => {
      listeners.delete(listener);
      // The timer intentionally keeps running with zero subscribers (e.g.
      // widget removed mid-pomodoro) — the alert must still fire.
    };
  },

  /** Stable reference between changes — safe as a useSyncExternalStore snapshot. */
  getSnapshot(): PomodoroSnapshot {
    return snapshot;
  },

  /** New durations apply to idle/finished (queued) phases; running/paused keep theirs. */
  configure(next: PomodoroConfig): void {
    const changed = JSON.stringify(next) !== JSON.stringify(config);
    config = { ...next };
    if (changed && (status === "idle" || status === "finished")) publish();
  },

  /** Start the queued phase, or resume a paused one. No-op while running. */
  start(): void {
    if (status === "running") return;
    const remaining = status === "paused" ? frozenRemainingMs : durationMsFor(phase);
    if (status !== "paused") frozenDurationMs = durationMsFor(phase);
    deadline = Date.now() + remaining;
    status = "running";
    stopTimer();
    timer = setInterval(tick, TICK_MS);
    publish();
  },

  pause(): void {
    if (status !== "running" || deadline === null) return;
    frozenRemainingMs = Math.max(0, deadline - Date.now());
    deadline = null;
    status = "paused";
    stopTimer();
    publish();
  },

  /** Current phase back to idle at full duration. */
  reset(): void {
    stopTimer();
    deadline = null;
    status = "idle";
    publish();
  },

  /** Breaks only: drop the queued/running break and line up the next work block. */
  skip(): void {
    if (phase === "work") return;
    stopTimer();
    deadline = null;
    phase = "work";
    status = "idle";
    publish();
  },
};

export function __resetEngineForTests(): void {
  stopTimer();
  listeners.clear();
  config = { ...pomodoroDefaultConfig };
  phase = "work";
  status = "idle";
  deadline = null;
  frozenRemainingMs = 0;
  frozenDurationMs = 0;
  workBlocksSinceLongBreak = 0;
  completedToday = 0;
  notifyBlocked = false;
  countLoaded = false;
  snapshot = buildSnapshot();
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/modules/pomodoro-engine.test.ts`
Expected: PASS (11 tests). If the countdown assertions are off by <= TICK_MS, the deadline math is fine but snapshot publishing lags a tick — check that `tick()` publishes on every interval fire.

- [ ] **Step 6: Commit**

```bash
git add src/modules/pomodoro/manifest.ts src/modules/pomodoro/engine.ts tests/modules/pomodoro-engine.test.ts
git commit -m "feat: pomodoro manifest + engine state machine"
```

---

### Task 4: Hook, widget, registration

**Files:**
- Create: `src/modules/pomodoro/use-pomodoro.ts`
- Create: `src/modules/pomodoro/widgets/pomodoro-widget.tsx`
- Create: `src/modules/pomodoro/fetch.ts`
- Create: `src/modules/pomodoro/render.ts`
- Modify: `src/modules/fetch.ts` (barrel)
- Modify: `src/modules/render.ts` (barrel)
- Create: `tests/modules/pomodoro-registration.test.ts`

**Interfaces:**
- Consumes: everything Task 3 produces; `registerFetch` (`@/modules/fetch-registry`), `registerRender` (`@/modules/render-registry`), `WidgetBodyProps` (`@/modules/contracts`).
- Produces: the registered `pomodoro.timer` widget type (drawer entry comes from render registration automatically).

- [ ] **Step 1: Write the failing registration test**

Create `tests/modules/pomodoro-registration.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import "@/modules/fetch";
import { getFetchWidget } from "@/modules/fetch-registry";
import { POMODORO_TYPE, pomodoroDefaultConfig } from "@/modules/pomodoro/manifest";

describe("pomodoro fetch registration", () => {
  it("registers pomodoro.timer on the fetch registry with defaults", () => {
    const def = getFetchWidget(POMODORO_TYPE);
    expect(def).toBeDefined();
    expect(def!.manifest.defaultConfig).toEqual(pomodoroDefaultConfig);
    expect(typeof def!.fetch).toBe("function");
  });

  it("fetch returns an empty payload (data comes from the live engine)", async () => {
    const def = getFetchWidget(POMODORO_TYPE);
    await expect(def!.fetch(pomodoroDefaultConfig)).resolves.toEqual({});
  });
});

import "@/modules/render";
import { getRenderWidget } from "@/modules/render-registry";

describe("pomodoro render registration", () => {
  it("registers pomodoro.timer on the render registry as a live, non-refreshable widget", () => {
    const def = getRenderWidget(POMODORO_TYPE);
    expect(def).toBeDefined();
    expect(def!.manifest.title).toBe("Pomodoro");
    expect(def!.manifest.refreshable).toBe(false);
    expect(def!.manifest.integration).toBeUndefined();
    expect(def!.Component).toBeDefined();
    expect(def!.icon).toBeDefined();
  });

  it("both sides share the same manifest object", () => {
    expect(getFetchWidget(POMODORO_TYPE)!.manifest).toBe(getRenderWidget(POMODORO_TYPE)!.manifest);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/pomodoro-registration.test.ts`
Expected: FAIL — `getFetchWidget(POMODORO_TYPE)` returns undefined (module not in the barrels yet).

- [ ] **Step 3: Write the hook**

Create `src/modules/pomodoro/use-pomodoro.ts`:

```ts
import { useEffect, useSyncExternalStore } from "react";
import { pomodoroEngine, type PomodoroSnapshot } from "./engine";
import { pomodoroConfigSchema, pomodoroDefaultConfig, type PomodoroConfig } from "./manifest";

/** Subscribe this component to the engine and keep it tuned to the widget config. */
export function usePomodoro(config: PomodoroConfig): PomodoroSnapshot {
  useEffect(() => {
    // Same guard as use-system-stats: after a breaking schema change the shell
    // can hand the body stale invalid config — it must never reach the engine
    // (NaN minutes would make durations NaN and the deadline math nonsense).
    const parsed = pomodoroConfigSchema.safeParse(config);
    pomodoroEngine.configure(parsed.success ? parsed.data : pomodoroDefaultConfig);
  }, [config]);
  return useSyncExternalStore(pomodoroEngine.subscribe, pomodoroEngine.getSnapshot);
}
```

- [ ] **Step 4: Write the widget body**

Create `src/modules/pomodoro/widgets/pomodoro-widget.tsx`:

```tsx
import type { WidgetBodyProps } from "@/modules/contracts";
import type { PomodoroConfig, PomodoroData } from "../manifest";
import { pomodoroEngine, type PomodoroPhase, type PomodoroSnapshot } from "../engine";
import { usePomodoro } from "../use-pomodoro";

type Props = WidgetBodyProps<PomodoroData, PomodoroConfig>;

const PHASE_LABEL: Record<PomodoroPhase, string> = {
  work: "Focus",
  shortBreak: "Short break",
  longBreak: "Long break",
};

function formatRemaining(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function CompletedDots({ count }: { count: number }) {
  if (count === 0) return null;
  const dots = Math.min(count, 8);
  return (
    <span className="flex items-center gap-1" title={`${count} pomodoros completed today`}>
      {Array.from({ length: dots }, (_, i) => (
        <span key={i} className="h-1.5 w-1.5 rounded-full bg-primary-500" />
      ))}
      {count > dots && <span className="text-xs text-slate-500 dark:text-slate-400">+{count - dots}</span>}
    </span>
  );
}

function controls(snap: PomodoroSnapshot): { label: string; action: () => void; primary?: boolean }[] {
  const buttons: { label: string; action: () => void; primary?: boolean }[] = [];
  if (snap.status === "running") {
    buttons.push({ label: "Pause", action: pomodoroEngine.pause, primary: true });
  } else {
    buttons.push({ label: snap.status === "paused" ? "Resume" : "Start", action: pomodoroEngine.start, primary: true });
  }
  if (snap.status === "running" || snap.status === "paused") {
    buttons.push({ label: "Reset", action: pomodoroEngine.reset });
  }
  if (snap.phase !== "work") {
    buttons.push({ label: "Skip break", action: pomodoroEngine.skip });
  }
  return buttons;
}

export function PomodoroWidget({ config }: Props) {
  const snap = usePomodoro(config);
  const progress = snap.durationMs > 0 ? 1 - snap.remainingMs / snap.durationMs : 0;

  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <span>{PHASE_LABEL[snap.phase]}</span>
        {snap.status === "finished" && <span className="text-warn">— time's up</span>}
      </div>

      <div className="font-mono text-4xl tabular-nums text-slate-800 dark:text-slate-100">
        {formatRemaining(snap.remainingMs)}
      </div>

      <div className="h-1 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
        <div
          className="h-full rounded-full bg-primary-500 transition-[width]"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>

      <div className="flex items-center gap-2">
        {controls(snap).map((b) => (
          <button
            key={b.label}
            onClick={b.action}
            className={
              b.primary
                ? "rounded-md bg-primary-600 px-3 py-1 text-sm font-medium text-white hover:bg-primary-500"
                : "rounded-md px-3 py-1 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"
            }
          >
            {b.label}
          </button>
        ))}
      </div>

      <CompletedDots count={snap.completedToday} />

      {snap.notifyBlocked && (
        <p className="text-center text-xs text-slate-500 dark:text-slate-400">
          Notifications blocked — enable them for this app in System Settings.
        </p>
      )}
    </div>
  );
}
```

(Visual polish happens during live verification in Task 5 with the impeccable/tailwind skills — but this is the complete functional baseline. Check `src/globals.css` for existing `primary-*`/`text-warn` tokens; reuse what's there rather than inventing new classes.)

- [ ] **Step 5: Write fetch.ts + render.ts and wire the barrels**

Create `src/modules/pomodoro/fetch.ts`:

```ts
import { registerFetch } from "@/modules/fetch-registry";
import { pomodoroManifest, type PomodoroData } from "./manifest";

/** Live widget: data flows through the engine, not the cache — fetch is a contract no-op. */
export async function fetchPomodoro(): Promise<PomodoroData> {
  return {};
}

registerFetch(pomodoroManifest, { fetch: fetchPomodoro });
```

Create `src/modules/pomodoro/render.ts`:

```ts
import { FiClock } from "react-icons/fi";
import { registerRender } from "@/modules/render-registry";
import { pomodoroManifest } from "./manifest";
import { PomodoroWidget } from "./widgets/pomodoro-widget";

registerRender(pomodoroManifest, {
  Component: PomodoroWidget,
  icon: { Icon: FiClock, className: "text-slate-500 dark:text-slate-400" },
});
```

In `src/modules/fetch.ts`, add before the trailing comment:

```ts
import "./pomodoro/fetch";
```

In `src/modules/render.ts`, add before the trailing comment:

```ts
import "./pomodoro/render";
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/modules/pomodoro-registration.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add src/modules/pomodoro/use-pomodoro.ts src/modules/pomodoro/widgets/pomodoro-widget.tsx src/modules/pomodoro/fetch.ts src/modules/pomodoro/render.ts src/modules/fetch.ts src/modules/render.ts tests/modules/pomodoro-registration.test.ts
git commit -m "feat: pomodoro widget + registration"
```

---

### Task 5: Full verification + live drive

**Files:**
- No new files (fixes only, if verification finds problems).

**Interfaces:**
- Consumes: the complete module from Tasks 1-4.
- Produces: verified, shippable state.

- [ ] **Step 1: Full test suite + static checks**

```bash
npm test
npm run lint
npx tsc --noEmit
```

Expected: all green — including the pre-existing suite (nothing outside the pomodoro files may regress).

- [ ] **Step 2: Release-shaped build**

Run: `npm run build:vite && cd src-tauri && cargo check && cd ..`
Expected: both succeed.

- [ ] **Step 3: Live drive (real app)**

Run: `npm run dev` and in the app:

1. **Edit → + Add widget → Pomodoro** — card renders: "Focus", `25:00`, Start button.
2. Open the widget's Configure dialog — the four number fields render with labels; set Work to 1 minute (for a fast test) and save.
3. Start → countdown runs; drag the card to another column mid-countdown → timer keeps running (engine survives remount).
4. Let the minute expire → macOS permission prompt appears on first notification; grant → notification "Pomodoro done …" arrives; card shows "Short break" queued with one completed dot; nothing auto-starts.
5. Minimize the window mid-work-phase → notification still arrives at expiry (a few seconds late is acceptable).
6. Pause/Resume/Reset and "Skip break" all behave; restart the app → timer is fresh but the completed dot is still there (repo persistence + migration ran).
7. Set Work back to 25 minutes; remove the test widget if unwanted.

- [ ] **Step 4: Commit any verification fixes**

```bash
git add <only-files-you-fixed>
git commit -m "fix: pomodoro verification fixes"
```

(Skip if nothing needed fixing.)
