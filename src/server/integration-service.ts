import "server-only";
import { listIntegrations, getIntegration } from "@/modules/integration-registry";
import { listClientWidgets } from "@/modules/client-registry";
import { getWidgets, removeWidget, getIntegrationOverride, setIntegrationOverride } from "./config-repo";
import type { IntegrationHealth, IntegrationStatus } from "@/modules/integration-contracts";

const HEALTH_TTL_MS = 30_000;
const healthCache = new Map<string, { at: number; health: IntegrationHealth }>();

async function healthFor(id: string, force: boolean): Promise<IntegrationHealth> {
  const hit = healthCache.get(id);
  if (!force && hit && Date.now() - hit.at < HEALTH_TTL_MS) return hit.health;
  const health = await getIntegration(id)!.checkHealth();
  healthCache.set(id, { at: Date.now(), health });
  return health;
}

export function resolveEnabled(hasTool: boolean, installed: boolean, override: boolean | null): boolean {
  if (override !== null) return override;
  return !hasTool || installed;
}

function typesForIntegration(id: string): Set<string> {
  return new Set(listClientWidgets().filter((w) => w.integration === id).map((w) => w.type));
}

function widgetCountForIntegration(id: string): number {
  const types = typesForIntegration(id);
  return getWidgets().filter((w) => types.has(w.type)).length;
}

export async function getIntegrationStatuses(force = false): Promise<IntegrationStatus[]> {
  const out: IntegrationStatus[] = [];
  for (const integ of listIntegrations()) {
    const health = await healthFor(integ.id, force);
    const override = getIntegrationOverride(integ.id);
    out.push({
      id: integ.id,
      name: integ.name,
      tool: integ.tool ?? null,
      health,
      override,
      enabled: resolveEnabled(!!integ.tool, health.installed, override),
      widgetCount: widgetCountForIntegration(integ.id),
    });
  }
  return out;
}

export function enableIntegration(id: string): void {
  setIntegrationOverride(id, true);
}

/** Disable an integration. Deletes its widgets; throws "confirm-required" if any exist and !deleteWidgets. */
export function disableIntegration(id: string, deleteWidgets: boolean): { deleted: number } {
  const types = typesForIntegration(id);
  const victims = getWidgets().filter((w) => types.has(w.type));
  if (victims.length && !deleteWidgets) throw new Error("confirm-required");
  for (const w of victims) removeWidget(w.id);
  setIntegrationOverride(id, false);
  return { deleted: victims.length };
}
