import type { BrandMark, ClientWidget } from "./contracts";

const registry = new Map<string, ClientWidget>();

export function registerClientWidget<Data, Config>(def: ClientWidget<Data, Config>): void {
  if (registry.has(def.type)) throw new Error(`Client widget already registered: ${def.type}`);
  registry.set(def.type, def as ClientWidget);
}

export function getClientWidget(type: string): ClientWidget | undefined {
  return registry.get(type);
}

export function listClientWidgets(): { type: string; title: string; integration?: string; icon?: BrandMark }[] {
  return [...registry.values()].map((d) => ({ type: d.type, title: d.title, integration: d.integration, icon: d.icon }));
}

export function __clearClientRegistry(): void {
  registry.clear();
}
