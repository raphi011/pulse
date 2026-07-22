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
 *
 * Multiple widget instances of this type share this one buffer and ticker;
 * the last configure() call wins.
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
    points = [
      ...points,
      { t: Date.now(), cpu: p.cpuPercent, memUsed: p.memUsedBytes, memTotal: p.memTotalBytes, rx: p.netRxBytesPerSec, tx: p.netTxBytesPerSec },
    ].slice(-capacity());
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
