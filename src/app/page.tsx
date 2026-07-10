import "@/modules/fetch";
import { getWidgets, addWidget } from "@/server/config-repo";
import { statusDefaultConfig } from "@/modules/core/manifest";
import { Dashboard } from "@/components/dashboard";
import "@/modules/render";

export const dynamic = "force-dynamic";

export default function Page() {
  let widgets = getWidgets();
  if (widgets.length === 0) {
    addWidget("core.status", statusDefaultConfig as Record<string, unknown>);
    widgets = getWidgets();
  }
  return <Dashboard initialWidgets={widgets} />;
}
