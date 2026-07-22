import type { FC } from "react";
import type { IconType } from "react-icons";
import type { Field } from "@/components/schema-form";

/** Server-owned manifest, served by dashboard.Service.Manifests(). */
export interface WidgetManifest {
  type: string;
  title: string;
  configFields: Field[];
  refreshable: boolean;
  integration?: string;
}

export interface BrandMark { Icon: IconType; className?: string }

export interface WidgetBodyProps<Data = unknown, Config = unknown> {
  data: Data;
  config: Config;
  refresh: () => Promise<void>;
}

/** Render-side registration: keyed by widget type; manifests live on the server. */
export interface RenderWidget<Data = unknown, Config = unknown> {
  type: string;
  Component: FC<WidgetBodyProps<Data, Config>>;
  icon?: BrandMark;
  count?(data: Data, config: Config): number | null;
  HeaderControls?: FC<WidgetBodyProps<Data, Config>>;
  formEditable?: boolean;
}
