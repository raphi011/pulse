"use client";
import { useQuery } from "@tanstack/react-query";
import { fetchManifests } from "@/lib/dashboard-data";
import type { WidgetManifest } from "@/modules/contracts";

/** Server-owned widget manifests, cached under ["manifests"]. */
export function useManifests(): { manifests: WidgetManifest[]; isPending: boolean; isError: boolean } {
  const { data, isPending, isError } = useQuery({
    queryKey: ["manifests"],
    queryFn: fetchManifests,
    staleTime: 5 * 60_000,
  });
  return { manifests: data ?? [], isPending, isError };
}

/** The manifest for one widget type, or undefined until manifests load / unknown type. */
export function useManifest(type: string): WidgetManifest | undefined {
  return useManifests().manifests.find((m) => m.type === type);
}
