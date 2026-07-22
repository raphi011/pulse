export const BOOKMARKS_TYPE = "bookmarks.links";

export type Bookmark = { id: string; title: string; url: string };

/** Bookmark data lives in the module-owned `bookmarks` table, not in config. */
export type BookmarksConfig = Record<string, never>;

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
