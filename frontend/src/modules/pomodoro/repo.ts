import { Pomodoro } from "@/lib/backend";

/** Record one completed work block. `finishedAt` is Date.now() ms. */
export function addSession(finishedAt: number): Promise<void> {
  return Pomodoro.AddSession(finishedAt);
}

/** Completed work blocks since local midnight (midnight computed in Go). */
export function countSessionsToday(): Promise<number> {
  return Pomodoro.CountToday();
}
