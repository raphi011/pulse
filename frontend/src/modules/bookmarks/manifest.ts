export const BOOKMARKS_TYPE = "bookmarks.links";

export type Bookmark = { id: string; title: string; url: string };

/** Bookmark data lives in the module-owned `bookmarks` table, not in config. */
export type BookmarksConfig = Record<string, never>;

export type BookmarksData = { bookmarks: Bookmark[] };
