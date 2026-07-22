import { useEffect, useSyncExternalStore } from "react";
import { pomodoroEngine, type PomodoroSnapshot } from "./engine";
import { isValidPomodoroConfig, pomodoroDefaultConfig, type PomodoroConfig } from "./manifest";

/** Subscribe this component to the engine and keep it tuned to the widget config. */
export function usePomodoro(config: PomodoroConfig): PomodoroSnapshot {
  useEffect(() => {
    // Same guard as use-system-stats: after a breaking schema change the shell
    // can hand the body stale invalid config — it must never reach the engine
    // (NaN minutes would make durations NaN and the deadline math nonsense).
    pomodoroEngine.configure(isValidPomodoroConfig(config) ? config : pomodoroDefaultConfig);
  }, [config]);
  return useSyncExternalStore(pomodoroEngine.subscribe, pomodoroEngine.getSnapshot);
}
