import { SiJira } from "react-icons/si";
import { registerRender } from "@/modules/render-registry";
import { JQL_TYPE } from "./manifest";
import { JqlWidget } from "./widgets/jql-widget";

registerRender(JQL_TYPE, {
  Component: JqlWidget,
  count: (d) => d.issues.length,
  icon: { Icon: SiJira, className: "text-[#0052CC]" },
});
