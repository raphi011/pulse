import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { widgetCache } from "@/db/schema";
import type { CliErrorKind } from "@/server/cli";

export type CacheRow = typeof widgetCache.$inferSelect;
export type CacheInput = {
  status: "ok" | "error";
  payload: unknown;
  error: string | null;
  errorKind?: CliErrorKind | null;
};

export async function get(widgetId: string): Promise<CacheRow | undefined> {
  return getDb().select().from(widgetCache).where(eq(widgetCache.widgetId, widgetId)).get();
}

export async function set(widgetId: string, input: CacheInput): Promise<CacheRow> {
  const row: CacheRow = {
    widgetId,
    payload: input.payload,
    fetchedAt: Date.now(),
    status: input.status,
    error: input.error,
    errorKind: input.errorKind ?? null,
  };
  await getDb().insert(widgetCache).values(row)
    .onConflictDoUpdate({
      target: widgetCache.widgetId,
      set: { payload: row.payload, fetchedAt: row.fetchedAt, status: row.status, error: row.error, errorKind: row.errorKind },
    });
  return row;
}
