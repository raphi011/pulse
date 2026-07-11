import { registerFetchWidget } from "@/modules/fetch-registry";
import {
  BOOKMARKS_TYPE,
  bookmarksConfigSchema,
  bookmarksDefaultConfig,
  type BookmarksConfig,
  type BookmarksData,
} from "./manifest";

export async function fetchBookmarks(config: BookmarksConfig): Promise<BookmarksData> {
  return { bookmarks: config.bookmarks };
}

registerFetchWidget({
  type: BOOKMARKS_TYPE,
  configSchema: bookmarksConfigSchema,
  defaultConfig: bookmarksDefaultConfig,
  fetch: fetchBookmarks,
});
