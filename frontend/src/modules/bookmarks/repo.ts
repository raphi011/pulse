import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { bookmarks } from "@/db/schema";

export type BookmarkRow = typeof bookmarks.$inferSelect;

export async function listBookmarks(): Promise<BookmarkRow[]> {
  return getDb().select().from(bookmarks).orderBy(asc(bookmarks.order));
}

export async function addBookmark(title: string, url: string): Promise<BookmarkRow> {
  const existing = await listBookmarks();
  const order = existing.reduce((max, b) => Math.max(max, b.order + 1), 0);
  const row: BookmarkRow = { id: crypto.randomUUID(), title, url, icon: null, order };
  await getDb().insert(bookmarks).values(row);
  return row;
}

export async function removeBookmark(id: string): Promise<void> {
  await getDb().delete(bookmarks).where(eq(bookmarks.id, id));
}
