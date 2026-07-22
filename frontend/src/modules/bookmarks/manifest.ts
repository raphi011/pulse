import { z } from "zod";
import { defineManifest } from "@/modules/contracts";

export const BOOKMARKS_TYPE = "bookmarks.links";

export type Bookmark = { id: string; title: string; url: string };

/** Bookmark data lives in the module-owned `bookmarks` table, not in config. */
export const bookmarksConfigSchema = z.object({});
export type BookmarksConfig = z.infer<typeof bookmarksConfigSchema>;
export const bookmarksDefaultConfig: BookmarksConfig = {};

export type BookmarksData = { bookmarks: Bookmark[] };

export const bookmarksManifest = defineManifest({
  type: BOOKMARKS_TYPE, title: "Bookmarks",
  configSchema: bookmarksConfigSchema, defaultConfig: bookmarksDefaultConfig,
  refreshable: false,
});

/**
 * Normalize a user-typed URL: prepend `https://` when no scheme is present,
 * then validate with the URL constructor. Returns the canonical href, or
 * `null` when the input can't form a valid URL.
 */
export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme).href;
  } catch {
    return null;
  }
}
