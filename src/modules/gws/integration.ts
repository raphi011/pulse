import { registerIntegration } from "@/modules/integration-registry";
import { probeHealth } from "@/modules/integration-health";
import { gwsJson } from "./gws";

registerIntegration({
  id: "gws",
  name: "Google Workspace",
  tool: {
    bin: "gws",
    installHint: "Install the `gws` CLI and configure OAuth credentials.",
    authHint: "Run `gws auth login` to authenticate.",
  },
  // getProfile is a cheap authenticated Gmail call — 401 when unauthenticated.
  checkHealth: () => probeHealth(() =>
    gwsJson(["gmail", "users", "getProfile", "--params", JSON.stringify({ userId: "me" })])
  ),
});
