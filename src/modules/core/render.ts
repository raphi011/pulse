import { registerRenderWidget } from "@/modules/render-registry";
import { STATUS_TYPE, statusConfigSchema, statusDefaultConfig } from "./manifest";
import { StatusWidget } from "./widgets/status-widget";

registerRenderWidget({
  type: STATUS_TYPE,
  title: "System Status",
  Component: StatusWidget,
  configSchema: statusConfigSchema,
  defaultConfig: statusDefaultConfig,
});
