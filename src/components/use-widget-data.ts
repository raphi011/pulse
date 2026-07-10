"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CacheRow } from "@/server/cache-repo";
import { useAutoRefresh, INTERVAL_MS } from "./auto-refresh-context";
import { useToast } from "./toast-context";

async function fetchData(id: string, refresh: boolean): Promise<CacheRow> {
  const res = await fetch(`/api/widgets/${id}/data${refresh ? "?refresh=1" : ""}`);
  if (!res.ok) throw new Error(`Data request failed: ${res.status}`);
  return res.json();
}

const msg = (err: unknown) => (err instanceof Error ? err.message : "unknown error");

export function useWidgetData(id: string) {
  const qc = useQueryClient();
  const { enabled, nonce } = useAutoRefresh();
  const { toast } = useToast();
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Initial load is cache-first (instant); refresh() forces an upstream fetch.
  const query = useQuery({
    queryKey: ["widget", id],
    queryFn: () => fetchData(id, false),
  });

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const fresh = await fetchData(id, true);
      qc.setQueryData(["widget", id], fresh);
    } catch (err) {
      // Keep the last cached row visible, but surface the failure to the user.
      console.error(`Widget ${id} refresh failed`, err);
      toast(`Refresh failed: ${msg(err)}`);
    } finally {
      setIsRefreshing(false);
    }
  }, [id, qc, toast]);

  // Auto-refresh must force refresh=1; a plain refetch would only re-read the cache.
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => void refresh(), INTERVAL_MS);
    return () => clearInterval(t);
  }, [enabled, refresh]);

  // Force-refresh-now: refresh when the global nonce bumps, but not on initial mount.
  const initialNonce = useRef(nonce);
  useEffect(() => {
    if (nonce === initialNonce.current) return;
    void refresh();
  }, [nonce, refresh]);

  // Surface an initial cache-load failure too.
  useEffect(() => {
    if (query.isError) toast(`Failed to load widget: ${msg(query.error)}`);
  }, [query.isError, query.error, toast]);

  return { ...query, refresh, isRefreshing };
}
