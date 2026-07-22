"use client";
import { createContext, useCallback, useContext, useState, useSyncExternalStore, type ReactNode } from "react";

export const INTERVAL_MS = 5 * 60 * 1000;
const STORAGE_KEY = "pulse:auto-refresh";

// Back the toggle with localStorage via an external store so it survives reloads
// without a setState-in-effect hydration hack. The server snapshot is always
// false; after hydration React re-reads the real client value.
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function getSnapshot(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "1";
}

function getServerSnapshot(): boolean {
  return false;
}

function persistEnabled(value: boolean): void {
  localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  listeners.forEach((l) => l());
}

type AutoRefreshValue = {
  enabled: boolean;
  toggle: () => void;
  refreshAll: () => void;
  nonce: number;
};

const AutoRefreshContext = createContext<AutoRefreshValue | null>(null);

export function AutoRefreshProvider({ children }: { children: ReactNode }) {
  const enabled = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [nonce, setNonce] = useState(0);

  const toggle = useCallback(() => persistEnabled(!getSnapshot()), []);
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
