import { z } from "zod";

export const BOOKMARKS_TYPE = "bookmarks.links";

export type Bookmark = { title: string; url: string };

export const bookmarksConfigSchema = z.object({
  bookmarks: z
    .array(z.object({ title: z.string(), url: z.string() }))
    .default([]),
});
export type BookmarksConfig = z.infer<typeof bookmarksConfigSchema>;

export const bookmarksDefaultConfig: BookmarksConfig = { bookmarks: [] };

export type BookmarksData = { bookmarks: Bookmark[] };

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
