import "server-only";
import { randomUUID } from "node:crypto";
import { eq, asc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { widgets, prefs } from "@/db/schema";
import { getServerWidget } from "@/modules/server-registry";

export type Widget = typeof widgets.$inferSelect;

export function getWidgets(): Widget[] {
  return getDb().select().from(widgets).orderBy(asc(widgets.column), asc(widgets.order)).all();
}

export function getWidget(id: string): Widget | undefined {
  return getDb().select().from(widgets).where(eq(widgets.id, id)).get();
}

const COLUMN_COUNT_DEFAULT = 3;

export function addWidget(type: string, config: Record<string, unknown>): Widget {
  const def = getServerWidget(type);
  const validated = def ? (def.configSchema.parse(config) as Record<string, unknown>) : config;
  const columnCount = Number(getPref("columnCount", String(COLUMN_COUNT_DEFAULT)));
  const existing = getWidgets();
  const counts = Array.from({ length: columnCount }, () => 0);
  for (const w of existing) if (w.column < columnCount) counts[w.column]++;
  const column = counts.indexOf(Math.min(...counts));
  const order = existing.filter((w) => w.column === column).length;
  const row: Widget = {
    id: randomUUID(), type, title: null, column, order, hidden: false, config: validated,
  };
  getDb().insert(widgets).values(row).run();
  return row;
}

export function setPositions(positions: { id: string; column: number; order: number }[]): void {
  const db = getDb();
  db.transaction((tx) => {
    for (const p of positions) {
      tx.update(widgets).set({ column: p.column, order: p.order }).where(eq(widgets.id, p.id)).run();
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
