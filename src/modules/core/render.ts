import { registerRender } from "@/modules/render-registry";
import { statusManifest } from "./manifest";
import { StatusWidget } from "./widgets/status-widget";

registerRender(statusManifest, { Component: StatusWidget });
