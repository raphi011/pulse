import { registerFetch } from "@/modules/fetch-registry";
import { pomodoroManifest, type PomodoroData } from "./manifest";

/** Live widget: data flows through the engine, not the cache — fetch is a contract no-op. */
export async function fetchPomodoro(): Promise<PomodoroData> {
  return {};
}

registerFetch(pomodoroManifest, { fetch: fetchPomodoro });
