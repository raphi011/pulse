import { eq, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDb } from "@/db/client";
import { widgets, prefs, widgetCache } from "@/db/schema";
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
// Dedup concurrent probes of the same integration: a second caller (e.g. two panel loads,
// or the double getIntegrationStatuses(true) after a toggle) reuses the in-flight promise
// instead of spawning a second health CLI.
const inFlight = new Map<string, Promise<IntegrationHealth>>();

export function __resetHealthCache(): void {
  healthCache.clear();
  inFlight.clear();
}

async function healthFor(id: string, force: boolean): Promise<IntegrationHealth> {
  const hit = healthCache.get(id);
  if (!force && hit && Date.now() - hit.at < HEALTH_TTL_MS) return hit.health;

  const existing = inFlight.get(id);
  if (existing) return existing;

  const probe = (async () => {
    try {
      const health = await getIntegration(id)!.checkHealth();
      healthCache.set(id, { at: Date.now(), health });
      return health;
    } finally {
      inFlight.delete(id);
    }
  })();
  inFlight.set(id, probe);
  return probe;
}

export function resolveEnabled(hasTool: boolean, installed: boolean, override: boolean | null): boolean {
  if (override !== null) return override;
  return !hasTool || installed;
}

function typesForIntegration(id: string): Set<string> {
  return new Set(listRenderWidgets().filter((w) => w.integration === id).map((w) => w.type));
}

export async function getIntegrationStatuses(force = false): Promise<IntegrationStatus[]> {
  // Fetch widgets once (not per integration), and probe health concurrently rather than
  // serially — a hung CLI no longer blocks every integration behind it.
  const allWidgets = await getWidgets();
  return Promise.all(
    listIntegrations().map(async (integ) => {
      const [health, override] = await Promise.all([
        healthFor(integ.id, force),
        getIntegrationOverride(integ.id),
      ]);
      const types = typesForIntegration(integ.id);
      return {
        id: integ.id,
        name: integ.name,
        tool: integ.tool ?? null,
        health,
        override,
        enabled: resolveEnabled(!!integ.tool, health.installed, override),
        widgetCount: allWidgets.filter((w) => types.has(w.type)).length,
      };
    }),
  );
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
  const victimIds = victims.map((w) => w.id);
  const stmts: BatchItem<"sqlite">[] = [
    ...victims.map((w) => db.delete(widgets).where(eq(widgets.id, w.id))),
    // Drop the widgets' cache rows too (widget_cache has no cascade).
    ...(victimIds.length ? [db.delete(widgetCache).where(inArray(widgetCache.widgetId, victimIds))] : []),
    db.insert(prefs).values({ key, value: "false" }).onConflictDoUpdate({ target: prefs.key, set: { value: "false" } }),
  ];
  await db.batch(stmts as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  return { deleted: victims.length };
}
