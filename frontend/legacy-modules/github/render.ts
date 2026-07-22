import { SiGithub, SiGithubactions, SiDependabot } from "react-icons/si";
import { registerRender } from "@/modules/render-registry";
import { prsManifest, failingActionsManifest, dependabotManifest } from "./manifest";
import { PrListWidget } from "./widgets/pr-list-widget";
import { FailingActionsWidget } from "./widgets/failing-actions-widget";
import { DependabotWidget } from "./widgets/dependabot-widget";

registerRender(prsManifest, {
  Component: PrListWidget,
  count: (d) => d.prs.length,
  icon: { Icon: SiGithub, className: "text-[#181717] dark:text-white" },
});
registerRender(failingActionsManifest, {
  Component: FailingActionsWidget,
  count: (d) => d.runs.length,
  icon: { Icon: SiGithubactions, className: "text-[#2088FF]" },
});
registerRender(dependabotManifest, {
  Component: DependabotWidget,
  count: (d) => d.alerts.length,
  icon: { Icon: SiDependabot, className: "text-[#025E8C]" },
});
