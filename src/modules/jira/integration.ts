import { registerIntegration } from "@/modules/integration-registry";
import { probeHealth } from "@/modules/integration-health";
import { runJira } from "./jira";

registerIntegration({
  id: "jira",
  name: "Jira",
  tool: {
    bin: "jira",
    installHint: "Install jira-cli — https://github.com/ankitpokhrel/jira-cli (`brew install ankitpokhrel/jira-cli/jira-cli`).",
    authHint: "Run `jira init` and set the `JIRA_API_TOKEN` environment variable.",
  },
  checkHealth: () => probeHealth(() => runJira(["me"])),
});
