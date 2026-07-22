import type { BrandMark, RenderWidget } from "./contracts";

const registry = new Map<string, RenderWidget>();

export function registerRender<Data, Config>(
  type: string,
  widget: Omit<RenderWidget<Data, Config>, "type">,
): void {
  if (registry.has(type)) throw new Error(`Render widget already registered: ${type}`);
  registry.set(type, { type, ...widget } as unknown as RenderWidget);
}

export function getRenderWidget(type: string): RenderWidget | undefined {
  return registry.get(type);
}

export function listRenderWidgets(): { type: string; icon?: BrandMark }[] {
  return [...registry.values()].map((d) => ({ type: d.type, icon: d.icon }));
}

export function __clearRenderRegistry(): void {
  registry.clear();
}
