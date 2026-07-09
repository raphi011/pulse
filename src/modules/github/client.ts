import { registerClientWidget } from "@/modules/client-registry";
import {
  MY_PRS_TYPE, TEAM_PRS_TYPE, FAILING_ACTIONS_TYPE, DEPENDABOT_TYPE,
  myPrsConfigSchema, myPrsDefaultConfig,
  teamPrsConfigSchema, teamPrsDefaultConfig,
  failingActionsConfigSchema, failingActionsDefaultConfig,
  dependabotConfigSchema, dependabotDefaultConfig,
} from "./manifest";
import { PrListWidget } from "./widgets/pr-list-widget";
import { FailingActionsWidget } from "./widgets/failing-actions-widget";
import { DependabotWidget } from "./widgets/dependabot-widget";

registerClientWidget({
  type: MY_PRS_TYPE, title: "My PRs", Component: PrListWidget,
  configSchema: myPrsConfigSchema, defaultConfig: myPrsDefaultConfig,
});
registerClientWidget({
  type: TEAM_PRS_TYPE, title: "Team PRs", Component: PrListWidget,
  configSchema: teamPrsConfigSchema, defaultConfig: teamPrsDefaultConfig,
});
registerClientWidget({
  type: FAILING_ACTIONS_TYPE, title: "Failing Actions", Component: FailingActionsWidget,
  configSchema: failingActionsConfigSchema, defaultConfig: failingActionsDefaultConfig,
});
registerClientWidget({
  type: DEPENDABOT_TYPE, title: "Dependabot Alerts", Component: DependabotWidget,
  configSchema: dependabotConfigSchema, defaultConfig: dependabotDefaultConfig,
});
