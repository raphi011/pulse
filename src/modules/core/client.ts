import { registerClientWidget } from "@/modules/client-registry";
import { STATUS_TYPE, statusConfigSchema, statusDefaultConfig } from "./manifest";
import { StatusWidget } from "./widgets/status-widget";

registerClientWidget({
  type: STATUS_TYPE,
  title: "System Status",
  Component: StatusWidget,
  configSchema: statusConfigSchema,
  defaultConfig: statusDefaultConfig,
});
