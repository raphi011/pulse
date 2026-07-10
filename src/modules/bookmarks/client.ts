import { FaRegBookmark } from "react-icons/fa6";
import { registerClientWidget } from "@/modules/client-registry";
import {
  BOOKMARKS_TYPE,
  bookmarksConfigSchema,
  bookmarksDefaultConfig,
} from "./manifest";
import { BookmarksWidget, BookmarksHeaderControls } from "./widgets/bookmarks-widget";

registerClientWidget({
  type: BOOKMARKS_TYPE,
  title: "Bookmarks",
  Component: BookmarksWidget,
  configSchema: bookmarksConfigSchema,
  defaultConfig: bookmarksDefaultConfig,
  count: (d) => d.bookmarks.length,
  formEditable: false,
  HeaderControls: BookmarksHeaderControls,
  icon: { Icon: FaRegBookmark, className: "text-slate-500 dark:text-slate-400" },
});
