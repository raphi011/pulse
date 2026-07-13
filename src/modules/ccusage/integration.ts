import { registerIntegration } from "@/modules/integration-registry";
import { probeHealth } from "@/modules/integration-health";
import { runCcusage } from "./ccusage";

registerIntegration({
  id: "ccusage",
  name: "Claude Usage (ccusage)",
  tool: {
    bin: "ccusage",
    installHint: "Install ccusage — `npm i -g ccusage`.",
    authHint: "No authentication needed — ccusage reads local ~/.claude logs.",
  },
  checkHealth: () => probeHealth(() => runCcusage(["--version"])),
});
