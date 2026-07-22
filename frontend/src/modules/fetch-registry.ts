import type { FetchWidget, WidgetManifest } from "./contracts";

const registry = new Map<string, FetchWidget>();

export function registerFetch<Data, Config>(
  manifest: WidgetManifest<Config>,
  extras: { fetch(config: Config): Promise<Data> },
): void {
  if (registry.has(manifest.type)) throw new Error(`Fetch widget already registered: ${manifest.type}`);
  registry.set(manifest.type, { manifest, fetch: extras.fetch } as FetchWidget);
}

export function getFetchWidget(type: string): FetchWidget | undefined {
  return registry.get(type);
}

export function listFetchTypes(): string[] {
  return [...registry.keys()];
}

export function __clearFetchRegistry(): void {
  registry.clear();
}
