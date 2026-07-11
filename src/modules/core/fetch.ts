import { platform, version, arch } from "@tauri-apps/plugin-os";
import { registerFetchWidget } from "@/modules/fetch-registry";
import { STATUS_TYPE, statusConfigSchema, statusDefaultConfig, type StatusData } from "./manifest";

export async function fetchStatus(): Promise<StatusData> {
  // plugin-os platform()/version()/arch() are synchronous getters in v2.
  return { now: new Date().toISOString(), platform: platform(), osVersion: version(), arch: arch() };
}

registerFetchWidget({
  type: STATUS_TYPE,
  configSchema: statusConfigSchema,
  defaultConfig: statusDefaultConfig,
  fetch: fetchStatus,
});
