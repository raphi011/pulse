import { registerClientWidget } from "@/modules/client-registry";
import {
  PRS_TYPE, FAILING_ACTIONS_TYPE, DEPENDABOT_TYPE,
  prsConfigSchema, prsDefaultConfig,
  failingActionsConfigSchema, failingActionsDefaultConfig,
  dependabotConfigSchema, dependabotDefaultConfig,
} from "./manifest";
import { PrListWidget } from "./widgets/pr-list-widget";
import { FailingActionsWidget } from "./widgets/failing-actions-widget";
import { DependabotWidget } from "./widgets/dependabot-widget";

registerClientWidget({
  type: PRS_TYPE, title: "Pull Requests", Component: PrListWidget,
  configSchema: prsConfigSchema, defaultConfig: prsDefaultConfig,
});
registerClientWidget({
  type: FAILING_ACTIONS_TYPE, title: "Failing Actions", Component: FailingActionsWidget,
  configSchema: failingActionsConfigSchema, defaultConfig: failingActionsDefaultConfig,
});
registerClientWidget({
  type: DEPENDABOT_TYPE, title: "Dependabot Alerts", Component: DependabotWidget,
  configSchema: dependabotConfigSchema, defaultConfig: dependabotDefaultConfig,
});
