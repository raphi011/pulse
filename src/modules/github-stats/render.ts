import { SiGithub } from "react-icons/si";
import { registerRender } from "@/modules/render-registry";
import { summaryManifest } from "./manifest";
import { SummaryWidget } from "./widgets/summary-widget";

registerRender(summaryManifest, {
  Component: SummaryWidget,
  count: (d) => d.total,
  icon: { Icon: SiGithub, className: "text-[#181717] dark:text-white" },
});
