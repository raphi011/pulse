import { FiCpu } from "react-icons/fi";
import { registerRender } from "@/modules/render-registry";
import { SYSTEM_STATS_TYPE } from "./manifest";
import { SystemStatsWidget } from "./widgets/system-stats-widget";

registerRender(SYSTEM_STATS_TYPE, {
  Component: SystemStatsWidget,
  icon: { Icon: FiCpu, className: "text-slate-500 dark:text-slate-400" },
});
