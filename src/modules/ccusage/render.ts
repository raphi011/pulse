import { FiDollarSign } from "react-icons/fi";
import { registerRender } from "@/modules/render-registry";
import { ccusageSpendManifest } from "./manifest";
import { CcusageWidget } from "./widgets/ccusage-widget";

registerRender(ccusageSpendManifest, {
  Component: CcusageWidget,
  icon: { Icon: FiDollarSign, className: "text-emerald-600 dark:text-emerald-400" },
});
