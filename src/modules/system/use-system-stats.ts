import { useEffect, useSyncExternalStore } from "react";
import { systemSampler, type SamplerSnapshot } from "./sampler";
import type { SystemStatsConfig } from "./manifest";

/** Subscribe this component to the live sampler and keep it tuned to the widget config. */
export function useSystemStats(config: SystemStatsConfig): SamplerSnapshot {
  // configure() no-ops when values are unchanged, so a fresh config object
  // identity per render costs nothing.
  useEffect(() => {
    systemSampler.configure(config);
  }, [config]);
  return useSyncExternalStore(systemSampler.subscribe, systemSampler.getSnapshot);
}
