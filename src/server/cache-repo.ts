import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { widgetCache } from "@/db/schema";

export type CacheRow = typeof widgetCache.$inferSelect;
export type CacheInput = { status: "ok" | "error"; payload: unknown; error: string | null };

export function get(widgetId: string): CacheRow | undefined {
  return getDb().select().from(widgetCache).where(eq(widgetCache.widgetId, widgetId)).get();
}

export function set(widgetId: string, input: CacheInput): CacheRow {
  const row: CacheRow = {
    widgetId, payload: input.payload, fetchedAt: Date.now(), status: input.status, error: input.error,
  };
  getDb().insert(widgetCache).values(row)
    .onConflictDoUpdate({
      target: widgetCache.widgetId,
      set: { payload: row.payload, fetchedAt: row.fetchedAt, status: row.status, error: row.error },
    }).run();
  return row;
}
