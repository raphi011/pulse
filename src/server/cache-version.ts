import { getDb } from "@/db/client";
import { widgetCache } from "@/db/schema";
import { getPref, setPref } from "./config-repo";

/**
 * Bump whenever any widget's Data payload shape changes. The cache is
 * disposable by design (everything is re-fetchable), so a mismatch wipes it —
 * no per-widget payload migrations.
 */
export const CACHE_VERSION = 4;

export async function ensureCacheVersion(): Promise<void> {
  const stored = await getPref("cacheVersion", "");
  if (stored === String(CACHE_VERSION)) return;
  await getDb().delete(widgetCache);
  await setPref("cacheVersion", String(CACHE_VERSION));
}
