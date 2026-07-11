import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/modules/fetch";
import "@/modules/render";
import "@/modules/integrations";
import { AutoRefreshProvider } from "@/components/auto-refresh-context";
import { ToastProvider } from "@/components/toast-context";
import { Dashboard } from "@/components/dashboard";
import { IntegrationsPanel } from "@/components/integrations-panel";
import { fetchLayout, createWidget, fetchIntegrations } from "@/lib/dashboard-data";
import { ensureCacheVersion } from "@/server/cache-version";
import type { Widget } from "@/server/config-repo";
import type { IntegrationStatus } from "@/modules/integration-contracts";

function useHashRoute(): string {
  const [route, setRoute] = useState(() => window.location.hash.replace(/^#/, "") || "/");
  useEffect(() => {
    const on = () => setRoute(window.location.hash.replace(/^#/, "") || "/");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

function DashboardView() {
  const [widgets, setWidgets] = useState<Widget[] | null>(null);
  useEffect(() => {
    (async () => {
      let layout = await fetchLayout();
      if (layout.widgets.length === 0) {
        await createWidget("core.status"); // seed, matches old page.tsx
        layout = await fetchLayout();
      }
      setWidgets(layout.widgets);
    })();
  }, []);
  if (!widgets) return null;
  return <Dashboard initialWidgets={widgets} />;
}

function IntegrationsView() {
  const [initial, setInitial] = useState<IntegrationStatus[] | null>(null);
  useEffect(() => {
    fetchIntegrations().then(setInitial);
  }, []);
  if (!initial) return null;
  return <IntegrationsPanel initial={initial} />;
}

export function AppRoot() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
      }),
  );
  const [dbReady, setDbReady] = useState(false);
  const route = useHashRoute();
  useEffect(() => {
    void ensureCacheVersion().then(() => setDbReady(true));
  }, []);
  if (!dbReady) return null;
  return (
    <QueryClientProvider client={client}>
      <AutoRefreshProvider>
        <ToastProvider>
          {route.startsWith("/integrations") ? <IntegrationsView /> : <DashboardView />}
        </ToastProvider>
      </AutoRefreshProvider>
    </QueryClientProvider>
  );
}
