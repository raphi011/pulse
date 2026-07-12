import { SiGithub } from "react-icons/si";
import { registerRender } from "@/modules/render-registry";
import { summaryManifest, heatmapManifest } from "./manifest";
import { SummaryWidget } from "./widgets/summary-widget";
import { HeatmapWidget } from "./widgets/heatmap-widget";

registerRender(summaryManifest, {
  Component: SummaryWidget,
  count: (d) => d.total,
  icon: { Icon: SiGithub, className: "text-[#181717] dark:text-white" },
});
registerRender(heatmapManifest, {
  Component: HeatmapWidget,
  count: (d) => d.total,
  icon: { Icon: SiGithub, className: "text-[#181717] dark:text-white" },
});
