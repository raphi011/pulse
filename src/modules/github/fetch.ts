import "server-only";
import { registerFetchWidget } from "@/modules/fetch-registry";
import {
  PRS_TYPE, FAILING_ACTIONS_TYPE, DEPENDABOT_TYPE,
  prsConfigSchema, prsDefaultConfig,
  failingActionsConfigSchema, failingActionsDefaultConfig,
  dependabotConfigSchema, dependabotDefaultConfig,
} from "./manifest";
import { fetchPrs } from "./prs";
import { fetchFailingActions } from "./runs";
import { fetchDependabot } from "./dependabot";

registerFetchWidget({
  type: PRS_TYPE, configSchema: prsConfigSchema, defaultConfig: prsDefaultConfig, fetch: fetchPrs,
});
registerFetchWidget({
  type: FAILING_ACTIONS_TYPE, configSchema: failingActionsConfigSchema, defaultConfig: failingActionsDefaultConfig, fetch: fetchFailingActions,
});
registerFetchWidget({
  type: DEPENDABOT_TYPE, configSchema: dependabotConfigSchema, defaultConfig: dependabotDefaultConfig, fetch: fetchDependabot,
});
