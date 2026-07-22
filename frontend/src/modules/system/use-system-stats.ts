import { useEffect, useSyncExternalStore } from "react";
import { systemSampler, type SamplerSnapshot } from "./sampler";
import { isValidSystemStatsConfig, systemStatsDefaultConfig, type SystemStatsConfig } from "./manifest";

/** Subscribe this component to the live sampler and keep it tuned to the widget config. */
export function useSystemStats(config: SystemStatsConfig): SamplerSnapshot {
  // configure() no-ops when values are unchanged, so a fresh config object
  // identity per render costs nothing.
  useEffect(() => {
    // On a breaking config-schema change the shell can render the body with
    // stale, now-invalid config (widget-service caches the error but keeps
    // the previous payload). An invalid config must never reach the sampler
    // timer: missing numeric fields make capacity() return NaN (unbounded
    // buffer) and setInterval(cb, NaN) fires as fast as possible.
    systemSampler.configure(isValidSystemStatsConfig(config) ? config : systemStatsDefaultConfig);
  }, [config]);
  return useSyncExternalStore(systemSampler.subscribe, systemSampler.getSnapshot);
}
