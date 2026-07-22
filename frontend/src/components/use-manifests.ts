"use client";
import { useQuery } from "@tanstack/react-query";
import { fetchManifests } from "@/lib/dashboard-data";
import type { WidgetManifest } from "@/modules/contracts";

/** Server-owned widget manifests, cached under ["manifests"]. */
export function useManifests(): WidgetManifest[] {
  const { data } = useQuery({
    queryKey: ["manifests"],
    queryFn: fetchManifests,
    staleTime: 5 * 60_000,
  });
  return data ?? [];
}

/** The manifest for one widget type, or undefined until manifests load / unknown type. */
export function useManifest(type: string): WidgetManifest | undefined {
  return useManifests().find((m) => m.type === type);
}
