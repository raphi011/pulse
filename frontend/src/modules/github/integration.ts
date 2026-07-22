import { registerIntegration } from "@/modules/integration-registry";
import { probeHealth } from "@/modules/integration-health";
import { runGh } from "./gh";

registerIntegration({
  id: "github",
  name: "GitHub",
  tool: {
    bin: "gh",
    installHint: "Install the GitHub CLI — https://cli.github.com (`brew install gh`).",
    authHint: "Run `gh auth login` to authenticate.",
  },
  checkHealth: () => probeHealth(() => runGh(["auth", "status"])),
});
