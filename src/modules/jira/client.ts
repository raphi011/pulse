import { SiJira } from "react-icons/si";
import { registerClientWidget } from "@/modules/client-registry";
import { JQL_TYPE, jqlConfigSchema, jqlDefaultConfig } from "./manifest";
import { JqlWidget } from "./widgets/jql-widget";

registerClientWidget({
  type: JQL_TYPE, title: "Jira Query", Component: JqlWidget,
  configSchema: jqlConfigSchema, defaultConfig: jqlDefaultConfig,
  count: (d) => d.issues.length,
  integration: "jira",
  icon: { Icon: SiJira, className: "text-[#0052CC]" },
});
