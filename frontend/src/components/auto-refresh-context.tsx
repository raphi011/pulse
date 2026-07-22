"use client";
import { createContext, useCallback, useContext, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dashboard } from "@/lib/backend";

// Auto-refresh state is now backend-owned (the "autoRefresh" pref) and the Go
// scheduler drives the actual refreshes, delivering results via cache-updated
// events. This context just reflects the pref and forwards toggle/refresh-all.
type AutoRefreshValue = {
  enabled: boolean;
  toggle: () => void;
  refreshAll: () => void;
};

const AutoRefreshContext = createContext<AutoRefreshValue | null>(null);

export function AutoRefreshProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data: enabled = false } = useQuery({
    queryKey: ["autoRefresh"],
    queryFn: () => Dashboard.AutoRefresh(),
    staleTime: Infinity,
  });

  const toggle = useCallback(() => {
    void (async () => {
      await Dashboard.SetAutoRefresh(!enabled);
      await qc.invalidateQueries({ queryKey: ["autoRefresh"] });
    })();
  }, [enabled, qc]);

  // The scheduler owns the refresh; its cache-updated events invalidate each widget query.
  const refreshAll = useCallback(() => {
    void Dashboard.RefreshAll();
  }, []);

  return (
    <AutoRefreshContext.Provider value={{ enabled, toggle, refreshAll }}>
      {children}
    </AutoRefreshContext.Provider>
  );
}

export function useAutoRefresh(): AutoRefreshValue {
  const ctx = useContext(AutoRefreshContext);
  if (!ctx) throw new Error("useAutoRefresh must be used within AutoRefreshProvider");
  return ctx;
}
