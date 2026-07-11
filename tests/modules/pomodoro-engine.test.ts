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
