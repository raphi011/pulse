import { FiDollarSign } from "react-icons/fi";
import { registerRender } from "@/modules/render-registry";
import { CCUSAGE_SPEND_TYPE } from "./manifest";
import { CcusageWidget } from "./widgets/ccusage-widget";

registerRender(CCUSAGE_SPEND_TYPE, {
  Component: CcusageWidget,
  icon: { Icon: FiDollarSign, className: "text-emerald-600 dark:text-emerald-400" },
});
