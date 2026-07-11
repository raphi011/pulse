import { FiCpu } from "react-icons/fi";
import { registerRender } from "@/modules/render-registry";
import { systemStatsManifest } from "./manifest";
import { SystemStatsWidget } from "./widgets/system-stats-widget";

registerRender(systemStatsManifest, {
  Component: SystemStatsWidget,
  icon: { Icon: FiCpu, className: "text-slate-500 dark:text-slate-400" },
});
