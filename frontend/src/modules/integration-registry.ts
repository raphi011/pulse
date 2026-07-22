import type { Integration } from "./integration-contracts";

const registry = new Map<string, Integration>();

export function registerIntegration(def: Integration): void {
  if (registry.has(def.id)) throw new Error(`Integration already registered: ${def.id}`);
  registry.set(def.id, def);
}

export function getIntegration(id: string): Integration | undefined {
  return registry.get(id);
}

export function listIntegrations(): Integration[] {
  return [...registry.values()];
}

export function __clearIntegrationRegistry(): void {
  registry.clear();
}
