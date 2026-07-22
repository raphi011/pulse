import { SiGithub } from "react-icons/si";
import { registerRender } from "@/modules/render-registry";
import { SUMMARY_TYPE, HEATMAP_TYPE } from "./manifest";
import { SummaryWidget } from "./widgets/summary-widget";
import { HeatmapWidget } from "./widgets/heatmap-widget";

registerRender(SUMMARY_TYPE, {
  Component: SummaryWidget,
  count: (d) => d.total,
  icon: { Icon: SiGithub, className: "text-[#181717] dark:text-white" },
});
registerRender(HEATMAP_TYPE, {
  Component: HeatmapWidget,
  count: (d) => d.total,
  icon: { Icon: SiGithub, className: "text-[#181717] dark:text-white" },
});
