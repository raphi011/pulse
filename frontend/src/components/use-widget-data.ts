"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CacheRow } from "@/lib/backend";
import { fetchWidgetData } from "@/lib/dashboard-data";
import { useToast } from "./toast-context";

async function fetchData(id: string, refresh: boolean): Promise<CacheRow> {
  return fetchWidgetData(id, refresh);
}

const msg = (err: unknown) => (err instanceof Error ? err.message : "unknown error");

export function useWidgetData(id: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const key = ["widget", id] as const;

  // Monotonic write generation: every writer (the cache-first read below, or a refresh) claims a
  // generation before it starts and only commits if it's still the latest when it resolves. This
  // stops a slow initial cache-read from landing *after* a refresh and overwriting the fresh row.
  const gen = useRef(0);
  // The in-flight refresh, if any. Concurrent triggers (event invalidation + manual) reuse it
  // instead of starting a second fetch — so the spinner tracks one refresh to completion, not a race.
  const inFlight = useRef<Promise<void> | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Initial load is cache-first (instant); refresh() forces an upstream fetch. The Go scheduler
  // owns auto-refresh and emits cache-updated events, which invalidate this query (see app-root).
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const g = ++gen.current;
      const row = await fetchData(id, false);
      // A refresh started after us already owns the cache — don't clobber it with this stale read.
      if (gen.current !== g) return qc.getQueryData<CacheRow>(key) ?? row;
      return row;
    },
  });

  const refresh = useCallback(async () => {
    if (inFlight.current) return inFlight.current; // dedup overlapping refreshes
    const g = ++gen.current;
    setIsRefreshing(true);
    const run = (async () => {
      try {
        const fresh = await fetchData(id, true);
        if (gen.current === g) qc.setQueryData(key, fresh); // only the latest writer commits
      } catch (err) {
        // Keep the last cached row visible, but surface the failure to the user.
        console.error(`Widget ${id} refresh failed`, err);
        toast(`Refresh failed: ${msg(err)}`);
      } finally {
        inFlight.current = null;
        setIsRefreshing(false);
      }
    })();
    inFlight.current = run;
    return run;
  }, [id, qc, toast]);

  // Surface an initial cache-load failure too.
  useEffect(() => {
    if (query.isError) toast(`Failed to load widget: ${msg(query.error)}`);
  }, [query.isError, query.error, toast]);

  return { ...query, refresh, isRefreshing };
}
