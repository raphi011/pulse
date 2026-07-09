import "server-only";
import { registerServerWidget } from "@/modules/server-registry";
import {
  MY_PRS_TYPE, TEAM_PRS_TYPE, FAILING_ACTIONS_TYPE, DEPENDABOT_TYPE,
  myPrsConfigSchema, myPrsDefaultConfig,
  teamPrsConfigSchema, teamPrsDefaultConfig,
  failingActionsConfigSchema, failingActionsDefaultConfig,
  dependabotConfigSchema, dependabotDefaultConfig,
} from "./manifest";
import { fetchMyPrs, fetchTeamPrs } from "./prs";
import { fetchFailingActions } from "./runs";
import { fetchDependabot } from "./dependabot";

registerServerWidget({
  type: MY_PRS_TYPE, configSchema: myPrsConfigSchema, defaultConfig: myPrsDefaultConfig, fetch: fetchMyPrs,
});
registerServerWidget({
  type: TEAM_PRS_TYPE, configSchema: teamPrsConfigSchema, defaultConfig: teamPrsDefaultConfig, fetch: fetchTeamPrs,
});
registerServerWidget({
  type: FAILING_ACTIONS_TYPE, configSchema: failingActionsConfigSchema, defaultConfig: failingActionsDefaultConfig, fetch: fetchFailingActions,
});
registerServerWidget({
  type: DEPENDABOT_TYPE, configSchema: dependabotConfigSchema, defaultConfig: dependabotDefaultConfig, fetch: fetchDependabot,
});
