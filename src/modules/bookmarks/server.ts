import "server-only";
import { registerServerWidget } from "@/modules/server-registry";
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

registerServerWidget({
  type: BOOKMARKS_TYPE,
  configSchema: bookmarksConfigSchema,
  defaultConfig: bookmarksDefaultConfig,
  fetch: fetchBookmarks,
});
