import type { BrandMark, RenderWidget } from "./contracts";

const registry = new Map<string, RenderWidget>();

export function registerRenderWidget<Data, Config>(def: RenderWidget<Data, Config>): void {
  if (registry.has(def.type)) throw new Error(`Render widget already registered: ${def.type}`);
  registry.set(def.type, def as RenderWidget);
}

export function getRenderWidget(type: string): RenderWidget | undefined {
  return registry.get(type);
}

export function listRenderWidgets(): { type: string; title: string; integration?: string; icon?: BrandMark }[] {
  return [...registry.values()].map((d) => ({ type: d.type, title: d.title, integration: d.integration, icon: d.icon }));
}

export function __clearRenderRegistry(): void {
  registry.clear();
}
