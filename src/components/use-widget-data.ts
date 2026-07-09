"use client";
import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CacheRow } from "@/server/cache-repo";

async function fetchData(id: string, refresh: boolean): Promise<CacheRow> {
  const res = await fetch(`/api/widgets/${id}/data${refresh ? "?refresh=1" : ""}`);
  if (!res.ok) throw new Error(`Data request failed: ${res.status}`);
  return res.json();
}

export function useWidgetData(id: string, refreshInterval: number | null) {
  const qc = useQueryClient();

  // Initial load is cache-first (instant); refresh() forces an upstream fetch.
  const query = useQuery({
    queryKey: ["widget", id],
    queryFn: () => fetchData(id, false),
  });

  const refresh = useCallback(async () => {
    try {
      const fresh = await fetchData(id, true);
      qc.setQueryData(["widget", id], fresh);
    } catch (err) {
      // Swallow — a failed manual/interval refresh keeps the last cached row visible.
      console.error(`Widget ${id} refresh failed`, err);
    }
  }, [id, qc]);

  // Auto-refresh must force refresh=1; a plain refetch would only re-read the cache.
  useEffect(() => {
    if (!refreshInterval) return;
    const t = setInterval(() => void refresh(), refreshInterval * 1000);
    return () => clearInterval(t);
  }, [refreshInterval, refresh]);

  return { ...query, refresh };
}
