import "server-only";
import type { ServerWidget } from "./contracts";

const registry = new Map<string, ServerWidget>();

export function registerServerWidget(def: ServerWidget<any, any>): void {
  if (registry.has(def.type)) throw new Error(`Server widget already registered: ${def.type}`);
  registry.set(def.type, def as ServerWidget);
}

export function getServerWidget(type: string): ServerWidget | undefined {
  return registry.get(type);
}

export function listServerTypes(): string[] {
  return [...registry.keys()];
}

export function __clearServerRegistry(): void {
  registry.clear();
}
