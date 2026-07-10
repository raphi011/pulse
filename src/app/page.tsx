import "@/modules/fetch";
import { getWidgets, addWidget } from "@/server/config-repo";
import { statusDefaultConfig } from "@/modules/core/manifest";
import { Dashboard } from "@/components/dashboard";
import "@/modules/render";

export const dynamic = "force-dynamic";

export default async function Page() {
  let widgets = await getWidgets();
  if (widgets.length === 0) {
    await addWidget("core.status", statusDefaultConfig as Record<string, unknown>);
    widgets = await getWidgets();
  }
  return <Dashboard initialWidgets={widgets} />;
}
