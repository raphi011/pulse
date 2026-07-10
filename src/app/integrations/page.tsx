import "@/modules/fetch";
import "@/modules/render";
import "@/modules/integrations";
import { getIntegrationStatuses } from "@/server/integration-service";
import { IntegrationsPanel } from "@/components/integrations-panel";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const initial = await getIntegrationStatuses();
  return <IntegrationsPanel initial={initial} />;
}
