import { platform, version, arch } from "@tauri-apps/plugin-os";
import { registerFetch } from "@/modules/fetch-registry";
import { statusManifest, type StatusData } from "./manifest";

export async function fetchStatus(): Promise<StatusData> {
  // plugin-os platform()/version()/arch() are synchronous getters in v2.
  return { now: new Date().toISOString(), platform: platform(), osVersion: version(), arch: arch() };
}

registerFetch(statusManifest, { fetch: fetchStatus });
