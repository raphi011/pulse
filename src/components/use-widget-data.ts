"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CacheRow } from "@/server/cache-repo";

async function fetchData(id: string, refresh: boolean): Promise<CacheRow> {
  const res = await fetch(`/api/widgets/${id}/data${refresh ? "?refresh=1" : ""}`);
  if (!res.ok) throw new Error(`Data request failed: ${res.status}`);
  return res.json();
}

export function useWidgetData(id: string, refreshInterval: number | null) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["widget", id],
    queryFn: () => fetchData(id, false),
    refetchInterval: refreshInterval ? refreshInterval * 1000 : false,
  });
  const refresh = async () => {
    const fresh = await fetchData(id, true);
    qc.setQueryData(["widget", id], fresh);
  };
  return { ...query, refresh };
}
