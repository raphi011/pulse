import type { ZodType } from "zod";
import type { FC } from "react";
import type { IconType } from "react-icons";

/** A brand logo + the classes that carry its brand color (incl. any dark-mode override). */
export interface BrandMark {
  Icon: IconType;
  className?: string;
}

/**
 * Widget identity + everything shared by the fetch and render sides.
 * Lives in the module's manifest.ts (no runtime deps) and is passed to BOTH
 * registerFetch and registerRender, so shared fields cannot drift.
 */
export interface WidgetManifest<Config = unknown> {
  type: string;
  title: string;
  configSchema: ZodType<Config>;
  defaultConfig: Config;
  /** Default true. False = no refresh button, no fetchedAt, no auto-refresh. */
  refreshable?: boolean;
  /** Id of the integration this widget belongs to; omit for always-available widgets (e.g. core). */
  integration?: string;
}

/** Identity helper so Config is inferred from configSchema/defaultConfig. */
export function defineManifest<Config>(m: WidgetManifest<Config>): WidgetManifest<Config> {
  return m;
}

export interface WidgetBodyProps<Data = unknown, Config = unknown> {
  data: Data;
  config: Config;
  /**
   * Persist a new config for this widget (PATCH + re-fetch + cache update).
   * Only `data` is refreshed, not the `config` prop — derive the next config
   * from `data`, not from the (now stale) `config` prop.
   */
  saveConfig: (next: Config) => Promise<void>;
}

/** How a widget gets its data: the shared manifest + the fetch side. */
export interface FetchWidget<Data = unknown, Config = unknown> {
  manifest: WidgetManifest<Config>;
  fetch(config: Config): Promise<Data>;
}

/** How a widget renders: the shared manifest + the render side. */
export interface RenderWidget<Data = unknown, Config = unknown> {
  manifest: WidgetManifest<Config>;
  Component: FC<WidgetBodyProps<Data, Config>>;
  /** Brand logo shown beside the title; stays render-side (react-icons is a runtime dep). */
  icon?: BrandMark;
  /** Item count shown next to the title (total fetched, pre-limit). Omit to show no count. */
  count?(data: Data, config: Config): number | null;
  /** Optional extra header control(s); rendered next to the built-in refresh button (Task 4). */
  HeaderControls?: FC<WidgetBodyProps<Data, Config>>;
  /** When false, the Configure dialog hides the auto-generated config form. Default true. */
  formEditable?: boolean;
}
