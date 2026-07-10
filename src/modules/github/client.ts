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
  count: (d) => d.prs.length,
  integration: "github",
});
registerClientWidget({
  type: FAILING_ACTIONS_TYPE, title: "Failing Actions", Component: FailingActionsWidget,
  configSchema: failingActionsConfigSchema, defaultConfig: failingActionsDefaultConfig,
  count: (d) => d.runs.length,
  integration: "github",
});
registerClientWidget({
  type: DEPENDABOT_TYPE, title: "Dependabot Alerts", Component: DependabotWidget,
  configSchema: dependabotConfigSchema, defaultConfig: dependabotDefaultConfig,
  count: (d) => d.alerts.length,
  integration: "github",
});
