import { registerFetch } from "@/modules/fetch-registry";
import { bookmarksManifest, type BookmarksConfig, type BookmarksData } from "./manifest";

export async function fetchBookmarks(config: BookmarksConfig): Promise<BookmarksData> {
  return { bookmarks: config.bookmarks };
}

registerFetch(bookmarksManifest, { fetch: fetchBookmarks });
