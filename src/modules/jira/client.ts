import { registerClientWidget } from "@/modules/client-registry";
import { JQL_TYPE, jqlConfigSchema, jqlDefaultConfig } from "./manifest";
import { JqlWidget } from "./widgets/jql-widget";

registerClientWidget({
  type: JQL_TYPE, title: "Jira Query", Component: JqlWidget,
  configSchema: jqlConfigSchema, defaultConfig: jqlDefaultConfig,
});
