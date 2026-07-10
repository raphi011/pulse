import type { ZodType } from "zod";
import type { FC } from "react";

export interface WidgetAction {
  id: string;
  label: string;
  run(config: unknown, params: Record<string, unknown>): Promise<void>;
}

/** Server-only: how a widget gets its data. Never imported by client code. */
export interface ServerWidget<Data = unknown, Config = unknown> {
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
}

/** Client-only: how a widget renders. */
export interface ClientWidget<Data = unknown, Config = unknown> {
  type: string;
  title: string;
  Component: FC<WidgetBodyProps<Data, Config>>;
  configSchema: ZodType<Config>;
  defaultConfig: Config;
  /** Item count shown next to the title (total fetched, pre-limit). Omit to show no count. */
  count?(data: Data, config: Config): number | null;
}
