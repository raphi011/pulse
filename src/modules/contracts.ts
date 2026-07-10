import type { ZodType } from "zod";
import type { FC } from "react";
import type { IconType } from "react-icons";

/** A brand logo + the classes that carry its brand color (incl. any dark-mode override). */
export interface BrandMark {
  Icon: IconType;
  className?: string;
}

export interface WidgetAction {
  id: string;
  label: string;
  run(config: unknown, params: Record<string, unknown>): Promise<void>;
}

/** Server-only: how a widget gets its data. Never imported by client code. */
export interface FetchWidget<Data = unknown, Config = unknown> {
  type: string;
  configSchema: ZodType<Config>;
  defaultConfig: Config;
  fetch(config: Config): Promise<Data>;
  actions?: WidgetAction[];
}

export interface WidgetBodyProps<Data = unknown, Config = unknown> {
  data: Data;
  config: Config;
  runAction: (actionId: string, params?: Record<string, unknown>) => Promise<void>;
  /**
   * Persist a new config for this widget (PATCH + re-fetch + cache update).
   * Only `data` is refreshed, not the `config` prop — derive the next config
   * from `data`, not from the (now stale) `config` prop.
   */
  saveConfig: (next: Config) => Promise<void>;
}

/** Client-only: how a widget renders. */
export interface RenderWidget<Data = unknown, Config = unknown> {
  type: string;
  title: string;
  Component: FC<WidgetBodyProps<Data, Config>>;
  configSchema: ZodType<Config>;
  defaultConfig: Config;
  /** Item count shown next to the title (total fetched, pre-limit). Omit to show no count. */
  count?(data: Data, config: Config): number | null;
  /** Id of the integration this widget belongs to; omit for always-available widgets (e.g. core). */
  integration?: string;
  /** Brand logo shown beside the title; omit for widgets with no brand (e.g. core). */
  icon?: BrandMark;
  /** Optional header action rendered in place of the built-in refresh button. */
  HeaderControls?: FC<WidgetBodyProps<Data, Config>>;
  /** When false, the Configure dialog hides the auto-generated config form. Default true. */
  formEditable?: boolean;
}
