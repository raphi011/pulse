import { eq, asc } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDb } from "@/db/client";
import { tabs, widgets } from "@/db/schema";

export type Tab = typeof tabs.$inferSelect;

export async function getTabs(): Promise<Tab[]> {
  return getDb().select().from(tabs).orderBy(asc(tabs.order));
}

export async function addTab(name: string): Promise<Tab> {
  const existing = await getTabs();
  const order = existing.reduce((max, t) => Math.max(max, t.order + 1), 0);
  const row: Tab = { id: crypto.randomUUID(), name, order };
  await getDb().insert(tabs).values(row);
  return row;
}

export async function renameTab(id: string, name: string): Promise<void> {
  await getDb().update(tabs).set({ name }).where(eq(tabs.id, id));
}

/** Delete the tab and all its widgets in one atomic batch. */
export async function deleteTab(id: string): Promise<void> {
  const db = getDb();
  await db.batch([
    db.delete(widgets).where(eq(widgets.tabId, id)),
    db.delete(tabs).where(eq(tabs.id, id)),
  ] as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
}

export async function setTabOrder(orders: { id: string; order: number }[]): Promise<void> {
  if (orders.length === 0) return;
  const db = getDb();
  const stmts: BatchItem<"sqlite">[] = orders.map((o) =>
    db.update(tabs).set({ order: o.order }).where(eq(tabs.id, o.id)),
  );
  await db.batch(stmts as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
}
