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
let countDayStart: number | null = null; // local day-start ms completedToday was computed for
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

function localDayStart(now: number = Date.now()): number {
  return new Date(now).setHours(0, 0, 0, 0);
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
    // A work block that spanned local midnight belongs to the new day — drop yesterday's optimistic
    // base so the notification numbers this as today's block, not a continuation of yesterday's count.
    if (countDayStart !== null && localDayStart() !== countDayStart) {
      completedToday = 0;
      countDayStart = localDayStart();
    }
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
    countDayStart = localDayStart();
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
  if (ok && notifyBlocked) {
    notifyBlocked = false;
    publish();
  }
}

async function loadCount() {
  // Record the day we (attempted to) count for even on failure — otherwise countDayStart stays null
  // and the start()/expire() rollover reconciliation never fires for the rest of the session.
  const dayStart = localDayStart();
  try {
    completedToday = await countSessionsToday();
  } catch {
    // Card renders with the last-known count until a session completes; not worth an error state.
  } finally {
    countDayStart = dayStart;
    publish();
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
    // Local day rolled over since completedToday was last computed (e.g. an
    // overnight tray app) — reconcile before the next notification fires.
    if (countDayStart !== null && localDayStart() !== countDayStart) void loadCount();
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
  countDayStart = null;
  notifyBlocked = false;
  countLoaded = false;
  snapshot = buildSnapshot();
}
