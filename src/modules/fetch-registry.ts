import "server-only";
import type { FetchWidget } from "./contracts";

const registry = new Map<string, FetchWidget>();

export function registerFetchWidget<Data, Config>(def: FetchWidget<Data, Config>): void {
  if (registry.has(def.type)) throw new Error(`Fetch widget already registered: ${def.type}`);
  registry.set(def.type, def as FetchWidget);
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
