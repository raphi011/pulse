import "server-only";
import { registerFetchWidget } from "@/modules/fetch-registry";
import { STATUS_TYPE, statusConfigSchema, statusDefaultConfig, type StatusData } from "./manifest";

export async function fetchStatus(): Promise<StatusData> {
  return { now: new Date().toISOString(), node: process.version, platform: process.platform };
}

registerFetchWidget({
  type: STATUS_TYPE,
  configSchema: statusConfigSchema,
  defaultConfig: statusDefaultConfig,
  fetch: fetchStatus,
});
