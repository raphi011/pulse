import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import "@/modules/render";
import { AutoRefreshProvider } from "@/components/auto-refresh-context";
import { ToastProvider } from "@/components/toast-context";
import { Dashboard } from "@/components/dashboard";
import { IntegrationsPanel } from "@/components/integrations-panel";
import { LoadError } from "@/components/load-error";
import { useAsyncResource } from "@/components/use-async-resource";
import { fetchLayout, fetchIntegrations } from "@/lib/dashboard-data";
import { onCacheUpdated } from "@/lib/backend";

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
  const { data: layout, error, reload } = useAsyncResource(fetchLayout);
  if (error) return <LoadError error={error} onRetry={reload} />;
  if (!layout) return null;
  return (
    <Dashboard
      initialWidgets={layout.widgets}
      initialTabs={layout.tabs}
      initialActiveTabId={layout.activeTabId}
    />
  );
}

function IntegrationsView() {
  const { data: initial, error, reload } = useAsyncResource(fetchIntegrations);
  if (error) return <LoadError error={error} onRetry={reload} />;
  if (!initial) return null;
  return <IntegrationsPanel initial={initial} />;
}

/** Global bridge: the Go scheduler emits a cache-updated event per widget; invalidate its query. */
function CacheEventBridge() {
  const qc = useQueryClient();
  useEffect(() => {
    return onCacheUpdated((widgetId) => {
      void qc.invalidateQueries({ queryKey: ["widget", widgetId] });
    });
  }, [qc]);
  return null;
}

export function AppRoot() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
      }),
  );
  const route = useHashRoute();
  // Cache-version bump + migrations now run in Go at startup (main.go), so the webview no longer
  // gates on a readiness effect before mounting.
  return (
    <QueryClientProvider client={client}>
      <CacheEventBridge />
      <AutoRefreshProvider>
        <ToastProvider>
          {route.startsWith("/integrations") ? <IntegrationsView /> : <DashboardView />}
        </ToastProvider>
      </AutoRefreshProvider>
    </QueryClientProvider>
  );
}
