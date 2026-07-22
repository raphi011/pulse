import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/backend", () => ({ System: { Stats: invokeMock } }));

import { systemSampler, __resetSamplerForTests } from "@/modules/system/sampler";

const GIB = 1024 ** 3;
const payload = {
  cpuPercent: 12.5, memUsedBytes: 8 * GIB, memTotalBytes: 32 * GIB,
  netRxBytesPerSec: 125_000, netTxBytesPerSec: 40_000,
};
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
    expect(systemSampler.getSnapshot().points[0]).toMatchObject({
      cpu: 12.5, memUsed: 8 * GIB, memTotal: 32 * GIB, rx: 125_000, tx: 40_000,
    });

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

  it("restarts the timer when sampleIntervalSeconds changes while running", async () => {
    const unsub = systemSampler.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0); // flush immediate tick
    expect(systemSampler.getSnapshot().points).toHaveLength(1);
    const initialCallCount = invokeMock.mock.calls.length;

    systemSampler.configure(config({ sampleIntervalSeconds: 1 }));
    await vi.advanceTimersByTimeAsync(0); // flush restart's immediate tick
    expect(systemSampler.getSnapshot().points).toHaveLength(2); // immediate + previous

    await vi.advanceTimersByTimeAsync(1000); // one 1s tick
    expect(systemSampler.getSnapshot().points).toHaveLength(3);
    expect(invokeMock.mock.calls.length).toBeGreaterThan(initialCallCount);
    unsub();
  });

  it("trims the buffer when historySeconds shrinks below current point count", async () => {
    systemSampler.configure(config({ sampleIntervalSeconds: 1, historySeconds: 600 })); // capacity 600
    const unsub = systemSampler.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);

    // accumulate ~10 points
    await vi.advanceTimersByTimeAsync(9000);
    expect(systemSampler.getSnapshot().points.length).toBeGreaterThanOrEqual(10);

    // shrink history to 5s capacity
    systemSampler.configure(config({ sampleIntervalSeconds: 1, historySeconds: 5 }));
    expect(systemSampler.getSnapshot().points).toHaveLength(5);
    unsub();
  });

  it("no-ops when called with unchanged values", async () => {
    const unsub = systemSampler.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    const snapshotBefore = systemSampler.getSnapshot();
    const callCountBefore = invokeMock.mock.calls.length;

    systemSampler.configure(config());
    const snapshotAfter = systemSampler.getSnapshot();

    expect(snapshotAfter).toBe(snapshotBefore); // same reference
    expect(invokeMock.mock.calls.length).toBe(callCountBefore); // no extra invoke
    unsub();
  });
});
