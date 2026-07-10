import "server-only";
import { randomUUID } from "node:crypto";
import { eq, asc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { widgets, prefs } from "@/db/schema";
import { getServerWidget } from "@/modules/server-registry";
import { DEFAULT_ROW_SPAN } from "@/lib/grid";

export type Widget = typeof widgets.$inferSelect;

export function getWidgets(): Widget[] {
  return getDb().select().from(widgets).orderBy(asc(widgets.order)).all();
}

export function getWidget(id: string): Widget | undefined {
  return getDb().select().from(widgets).where(eq(widgets.id, id)).get();
}

export function addWidget(type: string, config: Record<string, unknown>): Widget {
  const def = getServerWidget(type);
  const validated = def ? (def.configSchema.parse(config) as Record<string, unknown>) : config;
  const existing = getWidgets();
  const order = existing.reduce((max, w) => Math.max(max, w.order + 1), 0);
  const row: Widget = {
    id: randomUUID(), type, title: null, order, colSpan: 1, rowSpan: DEFAULT_ROW_SPAN,
    hidden: false, config: validated,
  };
  getDb().insert(widgets).values(row).run();
  return row;
}

export function setPositions(
  positions: { id: string; order: number; colSpan: number; rowSpan: number }[],
): void {
  const db = getDb();
  db.transaction((tx) => {
    for (const p of positions) {
      tx.update(widgets)
        .set({ order: p.order, colSpan: p.colSpan, rowSpan: p.rowSpan })
        .where(eq(widgets.id, p.id))
        .run();
    }
  });
}

export function setHidden(id: string, hidden: boolean): void {
  getDb().update(widgets).set({ hidden }).where(eq(widgets.id, id)).run();
}

export function setConfig(id: string, config: Record<string, unknown>): void {
  getDb().update(widgets).set({ config }).where(eq(widgets.id, id)).run();
}

/** Per-widget display title override; null/empty restores the definition default. */
export function setTitle(id: string, title: string | null): void {
  getDb().update(widgets).set({ title: title || null }).where(eq(widgets.id, id)).run();
}

export function removeWidget(id: string): void {
  getDb().delete(widgets).where(eq(widgets.id, id)).run();
}

export function getPref(key: string, fallback: string): string {
  return getDb().select().from(prefs).where(eq(prefs.key, key)).get()?.value ?? fallback;
}

export function setPref(key: string, value: string): void {
  getDb().insert(prefs).values({ key, value }).onConflictDoUpdate({ target: prefs.key, set: { value } }).run();
}
