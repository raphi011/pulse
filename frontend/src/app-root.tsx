import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/modules/render";
import "@/modules/integrations";
import { AutoRefreshProvider } from "@/components/auto-refresh-context";
import { ToastProvider } from "@/components/toast-context";
import { Dashboard } from "@/components/dashboard";
import { IntegrationsPanel } from "@/components/integrations-panel";
import { LoadError } from "@/components/load-error";
import { useAsyncResource } from "@/components/use-async-resource";
import { fetchLayout, fetchIntegrations } from "@/lib/dashboard-data";
import { ensureCacheVersion } from "@/server/cache-version";
import { warmToolPath } from "@/server/cli";

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
    // Best-effort startup, gated before any widget fetch: a failed cache wipe must not blank the
    // app (widgets surface DB errors themselves), and warmToolPath folds home-relative CLI dirs
    // (bun, where `gws` lives) into the spawn PATH. Neither blocks readiness on failure.
    Promise.allSettled([ensureCacheVersion(), warmToolPath()])
      .then(([cache]) => {
        if (cache.status === "rejected") console.error("cache version check failed", cache.reason);
      })
      .finally(() => setDbReady(true));
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
