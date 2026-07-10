import "server-only";
import { registerServerWidget } from "@/modules/server-registry";
import {
  PRS_TYPE, FAILING_ACTIONS_TYPE, DEPENDABOT_TYPE,
  prsConfigSchema, prsDefaultConfig,
  failingActionsConfigSchema, failingActionsDefaultConfig,
  dependabotConfigSchema, dependabotDefaultConfig,
} from "./manifest";
import { fetchPrs } from "./prs";
import { fetchFailingActions } from "./runs";
import { fetchDependabot } from "./dependabot";

registerServerWidget({
  type: PRS_TYPE, configSchema: prsConfigSchema, defaultConfig: prsDefaultConfig, fetch: fetchPrs,
});
registerServerWidget({
  type: FAILING_ACTIONS_TYPE, configSchema: failingActionsConfigSchema, defaultConfig: failingActionsDefaultConfig, fetch: fetchFailingActions,
});
registerServerWidget({
  type: DEPENDABOT_TYPE, configSchema: dependabotConfigSchema, defaultConfig: dependabotDefaultConfig, fetch: fetchDependabot,
});
