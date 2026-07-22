import { FaRegBookmark } from "react-icons/fa6";
import { registerRender } from "@/modules/render-registry";
import { BOOKMARKS_TYPE } from "./manifest";
import { BookmarksWidget, BookmarksHeaderControls } from "./widgets/bookmarks-widget";

registerRender(BOOKMARKS_TYPE, {
  Component: BookmarksWidget,
  count: (d) => d.bookmarks.length,
  formEditable: false,
  HeaderControls: BookmarksHeaderControls,
  icon: { Icon: FaRegBookmark, className: "text-slate-500 dark:text-slate-400" },
});
