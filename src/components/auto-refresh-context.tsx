"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export const INTERVAL_MS = 5 * 60 * 1000;
const STORAGE_KEY = "pulse:auto-refresh";

type AutoRefreshValue = {
  enabled: boolean;
  toggle: () => void;
  refreshAll: () => void;
  nonce: number;
};

const AutoRefreshContext = createContext<AutoRefreshValue | null>(null);

export function AutoRefreshProvider({ children }: { children: ReactNode }) {
  // Initialize false on both server and client render, then hydrate after mount
  // so the stored value never diverges the SSR markup (no hydration mismatch).
  const [enabled, setEnabled] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY) === "1") setEnabled(true);
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  }, [enabled]);

  const toggle = useCallback(() => setEnabled((e) => !e), []);
  const refreshAll = useCallback(() => setNonce((n) => n + 1), []);

  return (
    <AutoRefreshContext.Provider value={{ enabled, toggle, refreshAll, nonce }}>
      {children}
    </AutoRefreshContext.Provider>
  );
}

export function useAutoRefresh(): AutoRefreshValue {
  const ctx = useContext(AutoRefreshContext);
  if (!ctx) throw new Error("useAutoRefresh must be used within AutoRefreshProvider");
  return ctx;
}
