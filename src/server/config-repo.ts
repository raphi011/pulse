import "server-only";
import { randomUUID } from "node:crypto";
import { eq, asc } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDb } from "@/db/client";
import { widgets, prefs } from "@/db/schema";
import { getFetchWidget } from "@/modules/fetch-registry";
import { DEFAULT_ROW_SPAN } from "@/lib/grid";

export type Widget = typeof widgets.$inferSelect;

export async function getWidgets(): Promise<Widget[]> {
  return getDb().select().from(widgets).orderBy(asc(widgets.order));
}

export async function getWidget(id: string): Promise<Widget | undefined> {
  return getDb().select().from(widgets).where(eq(widgets.id, id)).get();
}

export async function addWidget(type: string, config: Record<string, unknown>): Promise<Widget> {
  const def = getFetchWidget(type);
  const validated = def ? (def.configSchema.parse(config) as Record<string, unknown>) : config;
  const existing = await getWidgets();
  const order = existing.reduce((max, w) => Math.max(max, w.order + 1), 0);
  const row: Widget = {
    id: randomUUID(), type, title: null, order, colSpan: 1, rowSpan: DEFAULT_ROW_SPAN,
    hidden: false, config: validated,
  };
  await getDb().insert(widgets).values(row);
  return row;
}

export async function setPositions(
  positions: { id: string; order: number; colSpan: number; rowSpan: number }[],
): Promise<void> {
  if (positions.length === 0) return;
  const db = getDb();
  const stmts: BatchItem<"sqlite">[] = positions.map((p) =>
    db.update(widgets).set({ order: p.order, colSpan: p.colSpan, rowSpan: p.rowSpan }).where(eq(widgets.id, p.id)),
  );
  await db.batch(stmts as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
}

export async function setHidden(id: string, hidden: boolean): Promise<void> {
  await getDb().update(widgets).set({ hidden }).where(eq(widgets.id, id));
}

export async function setConfig(id: string, config: Record<string, unknown>): Promise<void> {
  await getDb().update(widgets).set({ config }).where(eq(widgets.id, id));
}

/** Per-widget display title override; null/empty restores the definition default. */
export async function setTitle(id: string, title: string | null): Promise<void> {
  await getDb().update(widgets).set({ title: title || null }).where(eq(widgets.id, id));
}

export async function removeWidget(id: string): Promise<void> {
  await getDb().delete(widgets).where(eq(widgets.id, id));
}

export async function getPref(key: string, fallback: string): Promise<string> {
  const row = await getDb().select().from(prefs).where(eq(prefs.key, key)).get();
  return row?.value ?? fallback;
}

export async function setPref(key: string, value: string): Promise<void> {
  await getDb().insert(prefs).values({ key, value }).onConflictDoUpdate({ target: prefs.key, set: { value } });
}

/** Manual enable/disable override for an integration. null = follow computed default. */
export async function getIntegrationOverride(id: string): Promise<boolean | null> {
  const raw = await getPref(`integration.${id}.enabled`, "");
  if (raw === "") return null;
  return raw === "true";
}

export async function setIntegrationOverride(id: string, enabled: boolean): Promise<void> {
  await setPref(`integration.${id}.enabled`, enabled ? "true" : "false");
}
