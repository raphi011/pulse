export const POMODORO_TYPE = "pomodoro.timer";

/** All fields render as number inputs in the server-generated config form. */
export interface PomodoroConfig {
  workMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  pomodorosPerLongBreak: number;
}
export const pomodoroDefaultConfig: PomodoroConfig = {
  workMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  pomodorosPerLongBreak: 4,
};

/**
 * Guard against a stale/invalid config reaching the engine (mirrors the
 * bounds the Go manifest enforces) — same pattern as
 * system/manifest.ts#isValidSystemStatsConfig.
 */
export function isValidPomodoroConfig(config: unknown): config is PomodoroConfig {
  if (typeof config !== "object" || config === null) return false;
  const c = config as Record<string, unknown>;
  const inRange = (v: unknown, min: number, max: number) =>
    typeof v === "number" && v >= min && v <= max;
  return (
    inRange(c.workMinutes, 1, 180) &&
    inRange(c.shortBreakMinutes, 1, 60) &&
    inRange(c.longBreakMinutes, 1, 60) &&
    inRange(c.pomodorosPerLongBreak, 1, 12)
  );
}

/**
 * Live widget: the cache pipeline carries no data — the card renders from the
 * engine singleton (src/modules/pomodoro/engine.ts).
 */
export type PomodoroData = Record<string, never>;
