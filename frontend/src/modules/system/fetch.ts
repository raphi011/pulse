import { registerFetch } from "@/modules/fetch-registry";
import { systemStatsManifest, type SystemStatsData } from "./manifest";

/** Live widget: data flows through the sampler, not the cache — fetch is a contract no-op. */
export async function fetchSystemStats(): Promise<SystemStatsData> {
  return {};
}

registerFetch(systemStatsManifest, { fetch: fetchSystemStats });
