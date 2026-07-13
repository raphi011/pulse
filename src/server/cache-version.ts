import type { BatchItem } from "drizzle-orm/batch";
import { getDb } from "@/db/client";
import { widgetCache, prefs } from "@/db/schema";
import { getPref } from "./config-repo";

/**
 * Bump whenever any widget's Data payload shape changes. The cache is
 * disposable by design (everything is re-fetchable), so a mismatch wipes it —
 * no per-widget payload migrations.
 */
export const CACHE_VERSION = 4;

export async function ensureCacheVersion(): Promise<void> {
  const stored = await getPref("cacheVersion", "");
  if (stored === String(CACHE_VERSION)) return;
  // Wipe and version-stamp atomically: a crash between the two would otherwise leave a
  // wiped cache still tagged with the old version (harmless — re-wiped next boot).
  const db = getDb();
  const value = String(CACHE_VERSION);
  await db.batch([
    db.delete(widgetCache),
    db.insert(prefs).values({ key: "cacheVersion", value })
      .onConflictDoUpdate({ target: prefs.key, set: { value } }),
  ] as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
}
