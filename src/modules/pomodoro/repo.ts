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
