import "server-only";
import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDb } from "@/db/client";
import { widgets, prefs } from "@/db/schema";
import { listIntegrations, getIntegration } from "@/modules/integration-registry";
import { listRenderWidgets } from "@/modules/render-registry";
import { getWidgets, getIntegrationOverride, setIntegrationOverride } from "./config-repo";
import type { IntegrationHealth, IntegrationStatus } from "@/modules/integration-contracts";

export class ConfirmRequiredError extends Error {
  constructor(readonly widgetCount: number) {
    super(`confirm-required: ${widgetCount} widget(s) would be deleted`);
    this.name = "ConfirmRequiredError";
  }
}

const HEALTH_TTL_MS = 30_000;
const healthCache = new Map<string, { at: number; health: IntegrationHealth }>();

export function __resetHealthCache(): void {
  healthCache.clear();
}

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
  return new Set(listRenderWidgets().filter((w) => w.integration === id).map((w) => w.type));
}

async function widgetCountForIntegration(id: string): Promise<number> {
  const types = typesForIntegration(id);
  const all = await getWidgets();
  return all.filter((w) => types.has(w.type)).length;
}

export async function getIntegrationStatuses(force = false): Promise<IntegrationStatus[]> {
  const out: IntegrationStatus[] = [];
  for (const integ of listIntegrations()) {
    const health = await healthFor(integ.id, force);
    const override = await getIntegrationOverride(integ.id);
    out.push({
      id: integ.id,
      name: integ.name,
      tool: integ.tool ?? null,
      health,
      override,
      enabled: resolveEnabled(!!integ.tool, health.installed, override),
      widgetCount: await widgetCountForIntegration(integ.id),
    });
  }
  return out;
}

export async function enableIntegration(id: string): Promise<void> {
  await setIntegrationOverride(id, true);
}

/** Disable an integration. Deletes its widgets; throws ConfirmRequiredError if any exist and !deleteWidgets. */
export async function disableIntegration(id: string, deleteWidgets: boolean): Promise<{ deleted: number }> {
  const types = typesForIntegration(id);
  const victims = (await getWidgets()).filter((w) => types.has(w.type));
  if (victims.length && !deleteWidgets) throw new ConfirmRequiredError(victims.length);
  const db = getDb();
  const key = `integration.${id}.enabled`;
  const stmts: BatchItem<"sqlite">[] = [
    ...victims.map((w) => db.delete(widgets).where(eq(widgets.id, w.id))),
    db.insert(prefs).values({ key, value: "false" }).onConflictDoUpdate({ target: prefs.key, set: { value: "false" } }),
  ];
  await db.batch(stmts as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  return { deleted: victims.length };
}
