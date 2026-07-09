import "server-only";
import { registerServerWidget } from "@/modules/server-registry";
import { STATUS_TYPE, statusConfigSchema, statusDefaultConfig, type StatusData } from "./manifest";

export async function fetchStatus(): Promise<StatusData> {
  return { now: new Date().toISOString(), node: process.version, platform: process.platform };
}

registerServerWidget({
  type: STATUS_TYPE,
  configSchema: statusConfigSchema,
  defaultConfig: statusDefaultConfig,
  fetch: fetchStatus,
});
