import { registerFetch } from "@/modules/fetch-registry";
import { bookmarksManifest, type BookmarksData } from "./manifest";
import { listBookmarks } from "./repo";

export async function fetchBookmarks(): Promise<BookmarksData> {
  const rows = await listBookmarks();
  return { bookmarks: rows.map(({ id, title, url }) => ({ id, title, url })) };
}

registerFetch(bookmarksManifest, { fetch: fetchBookmarks });
