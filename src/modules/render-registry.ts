import type { BrandMark, RenderWidget, WidgetManifest } from "./contracts";

const registry = new Map<string, RenderWidget>();

export function registerRender<Data, Config>(
  manifest: WidgetManifest<Config>,
  extras: Omit<RenderWidget<Data, Config>, "manifest">,
): void {
  if (registry.has(manifest.type)) throw new Error(`Render widget already registered: ${manifest.type}`);
  registry.set(manifest.type, { manifest, ...extras } as unknown as RenderWidget);
}

export function getRenderWidget(type: string): RenderWidget | undefined {
  return registry.get(type);
}

export function listRenderWidgets(): { type: string; title: string; integration?: string; icon?: BrandMark }[] {
  return [...registry.values()].map((d) => ({
    type: d.manifest.type,
    title: d.manifest.title,
    integration: d.manifest.integration,
    icon: d.icon,
  }));
}

export function __clearRenderRegistry(): void {
  registry.clear();
}
