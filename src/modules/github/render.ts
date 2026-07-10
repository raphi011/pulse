import { SiGithub, SiGithubactions, SiDependabot } from "react-icons/si";
import { registerRenderWidget } from "@/modules/render-registry";
import {
  PRS_TYPE, FAILING_ACTIONS_TYPE, DEPENDABOT_TYPE,
  prsConfigSchema, prsDefaultConfig,
  failingActionsConfigSchema, failingActionsDefaultConfig,
  dependabotConfigSchema, dependabotDefaultConfig,
} from "./manifest";
import { PrListWidget } from "./widgets/pr-list-widget";
import { FailingActionsWidget } from "./widgets/failing-actions-widget";
import { DependabotWidget } from "./widgets/dependabot-widget";

registerRenderWidget({
  type: PRS_TYPE, title: "Pull Requests", Component: PrListWidget,
  configSchema: prsConfigSchema, defaultConfig: prsDefaultConfig,
  count: (d) => d.prs.length,
  integration: "github",
  icon: { Icon: SiGithub, className: "text-[#181717] dark:text-white" },
});
registerRenderWidget({
  type: FAILING_ACTIONS_TYPE, title: "Failing Actions", Component: FailingActionsWidget,
  configSchema: failingActionsConfigSchema, defaultConfig: failingActionsDefaultConfig,
  count: (d) => d.runs.length,
  integration: "github",
  icon: { Icon: SiGithubactions, className: "text-[#2088FF]" },
});
registerRenderWidget({
  type: DEPENDABOT_TYPE, title: "Dependabot Alerts", Component: DependabotWidget,
  configSchema: dependabotConfigSchema, defaultConfig: dependabotDefaultConfig,
  count: (d) => d.alerts.length,
  integration: "github",
  icon: { Icon: SiDependabot, className: "text-[#025E8C]" },
});
