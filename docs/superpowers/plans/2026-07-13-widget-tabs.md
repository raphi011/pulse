# Widget Tabs (Tab Groups) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Organize widgets into named tabs shown at the top of the dashboard; each tab is a separate board that owns its own widgets.

**Architecture:** A new `tabs` table plus a `tabId` column on `widgets`. The grid renders only the active tab's widgets (filtered in-component). Tab reordering and dragging a widget card onto a tab share ONE dashboard-level `DndContext`; `onDragEnd` branches on the dragged item's type. Pure reorder/classify logic lives in `dashboard-logic.ts` (unit-tested); wiring lives in `dashboard.tsx`.

**Tech Stack:** Tauri v2 + Vite + React 19 + TypeScript, Drizzle ORM (sqlite-proxy in-app, better-sqlite3 in tests), dnd-kit, TanStack Query, Vitest + Testing Library, Tailwind v4.

## Global Constraints

- No Jira prefix on commits/branches. Plain conventional-style messages (e.g. `feat: add widget tabs`).
- Commit message trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Match existing patterns; keep changes surgical. Feature toggles default disabled (n/a here).
- All repo/data functions are async — `await` them. `getDb()` from `src/db/client.ts`. Multi-statement atomic writes use `db.batch([...])`, never `db.transaction()`.
- Migrations: generate with `npm run db:generate`, then wire the generated `drizzle/*.sql` into `src-tauri/src/lib.rs` via `include_str!` with the next `version`. Tests apply migrations from the `drizzle/` folder automatically (`tests/helpers/db.ts`).
- Tests: `npm test` (Vitest). Component tests use Testing Library.
- `Widget` type is `typeof widgets.$inferSelect` — adding a column changes it everywhere. Every `Widget` literal must include the new field.

---

## File Structure

- `src/db/schema.ts` — add `tabs` table; add `widgets.tabId` column.
- `drizzle/0003_*.sql` (generated, then hand-edited) — create `tabs`, seed default tab, add `tab_id`.
- `src-tauri/src/lib.rs` — register migration version 4.
- `src/server/tabs-repo.ts` (new) — `Tab` type + tabs CRUD/reorder (async, `getDb()`).
- `src/server/config-repo.ts` — `addWidget` gains a `tabId` param; new `setWidgetTab`.
- `src/lib/dashboard-data.ts` — data-access wrappers (`getTabs`/`createTab`/`renameTab`/`deleteTab`/`reorderTabs`/`setActiveTab`/`moveWidgetToTab`), `createWidget(type, tabId)`, extend `fetchLayout`.
- `src/components/dashboard-logic.ts` — pure `widgetsForTab`, `applyReorderTabs`, `assignWidgetToTab`, `classifyDrag`, dnd id helpers.
- `src/components/confirm-dialog.tsx` (new) — reusable confirm modal.
- `src/components/tab-bar.tsx` (new) — the tab strip (sortable tabs, inline rename, add, delete).
- `src/components/card-menu.tsx` — "Move to tab…" submenu.
- `src/components/widget-card.tsx`, `sortable-card.tsx` — thread move-to-tab props to `CardMenu`.
- `src/components/dashboard.tsx` — single `DndContext`, tab state, filter grid, wire tab bar + drag branches + add-to-active-tab.
- `src/app-root.tsx` — pass tabs + activeTabId into `Dashboard`.
- Tests: `tests/server/tabs-repo.test.ts`, extend `tests/components/dashboard-logic.test.ts`, `tests/components/confirm-dialog.test.tsx`, `tests/components/tab-bar.test.tsx`, extend `tests/components/widget-card.test.tsx`.

---

## Task 1: DB schema, migration, tabs repo

**Files:**
- Modify: `src/db/schema.ts`
- Create: `drizzle/0003_*.sql` (via `npm run db:generate`, then hand-edit)
- Modify: `src-tauri/src/lib.rs:10-13`
- Create: `src/server/tabs-repo.ts`
- Modify: `src/server/config-repo.ts:18-29` (`addWidget`), add `setWidgetTab`
- Test: `tests/server/tabs-repo.test.ts`

**Interfaces:**
- Produces:
  - `tabs` table `{ id: string; name: string; order: number }`
  - `widgets.tabId: string` (column `tab_id`, NOT NULL DEFAULT `'default'`)
  - `src/server/tabs-repo.ts`:
    - `type Tab = { id: string; name: string; order: number }`
    - `getTabs(): Promise<Tab[]>` (ordered by `order` asc)
    - `addTab(name: string): Promise<Tab>` (new uuid id, `order` = max+1)
    - `renameTab(id: string, name: string): Promise<void>`
    - `deleteTab(id: string): Promise<void>` (atomically deletes the tab's widgets AND the tab row via `db.batch`)
    - `setTabOrder(orders: { id: string; order: number }[]): Promise<void>`
  - `src/server/config-repo.ts`:
    - `addWidget(type: string, config: Record<string, unknown>, tabId?: string): Promise<Widget>` (defaults `tabId` to `"default"`)
    - `setWidgetTab(id: string, tabId: string): Promise<void>`

- [ ] **Step 1: Add the `tabs` table and `tabId` column to the schema**

In `src/db/schema.ts`, add the new column to the existing `widgets` table (after `hidden`, before `config`):

```typescript
  hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
  tabId: text("tab_id").notNull().default("default"),
  config: text("config", { mode: "json" }).notNull().$type<Record<string, unknown>>(),
```

And add a new table after `widgets`:

```typescript
export const tabs = sqliteTable("tabs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  order: integer("order").notNull().default(0),
});
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new file `drizzle/0003_<name>.sql` appears and `drizzle/meta/_journal.json` is updated.

- [ ] **Step 3: Hand-edit the generated migration to seed the default tab**

Open the generated `drizzle/0003_<name>.sql`. Ensure its contents are exactly (adjust table/column DDL only if drizzle emitted a different but equivalent form — keep the INSERT and column order):

```sql
CREATE TABLE `tabs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO `tabs` (`id`, `name`, `order`) VALUES ('default', 'Dashboard', 0);
--> statement-breakpoint
ALTER TABLE `widgets` ADD `tab_id` text DEFAULT 'default' NOT NULL;
```

(The `INSERT` is not auto-generated — add it by hand. It seeds the one default tab so every existing widget's `tab_id` default of `'default'` points at a real tab.)

- [ ] **Step 4: Register the migration in Tauri**

In `src-tauri/src/lib.rs`, add a fourth migration after version 3 (use the real generated filename):

```rust
        Migration { version: 3, description: "pomodoro sessions", sql: include_str!("../../drizzle/0002_equal_gorilla_man.sql"), kind: MigrationKind::Up },
        Migration { version: 4, description: "widget tabs", sql: include_str!("../../drizzle/0003_<name>.sql"), kind: MigrationKind::Up },
```

- [ ] **Step 5: Write the failing tabs-repo test**

Create `tests/server/tabs-repo.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { useTempDb } from "../helpers/db";
import { FIXTURE_TYPE } from "../helpers/fixture-widget";
import * as tabs from "@/server/tabs-repo";
import * as widgetsRepo from "@/server/config-repo";

beforeEach(() => useTempDb());

describe("tabs-repo", () => {
  it("seeds a default tab from the migration", async () => {
    const all = await tabs.getTabs();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: "default", name: "Dashboard", order: 0 });
  });

  it("adds tabs with an incrementing order", async () => {
    const a = await tabs.addTab("Work");
    const b = await tabs.addTab("Personal");
    expect(a.order).toBe(1);
    expect(b.order).toBe(2);
    expect(await tabs.getTabs()).toHaveLength(3);
  });

  it("renames a tab", async () => {
    const a = await tabs.addTab("Work");
    await tabs.renameTab(a.id, "Focus");
    expect((await tabs.getTabs()).find((t) => t.id === a.id)!.name).toBe("Focus");
  });

  it("reorders tabs", async () => {
    const a = await tabs.addTab("A");
    const b = await tabs.addTab("B");
    await tabs.setTabOrder([{ id: a.id, order: 5 }, { id: b.id, order: 4 }]);
    const got = await tabs.getTabs();
    expect(got.find((t) => t.id === b.id)!.order).toBe(4);
    expect(got.find((t) => t.id === a.id)!.order).toBe(5);
  });

  it("deleting a tab removes the tab and its widgets atomically", async () => {
    const a = await tabs.addTab("Work");
    const w = await widgetsRepo.addWidget(FIXTURE_TYPE, {}, a.id);
    const other = await widgetsRepo.addWidget(FIXTURE_TYPE, {}, "default");
    await tabs.deleteTab(a.id);
    expect((await tabs.getTabs()).some((t) => t.id === a.id)).toBe(false);
    expect(await widgetsRepo.getWidget(w.id)).toBeUndefined();
    expect(await widgetsRepo.getWidget(other.id)).toBeDefined();
  });

  it("addWidget assigns the given tab and setWidgetTab moves it", async () => {
    const a = await tabs.addTab("Work");
    const w = await widgetsRepo.addWidget(FIXTURE_TYPE, {}, a.id);
    expect((await widgetsRepo.getWidget(w.id))!.tabId).toBe(a.id);
    await widgetsRepo.setWidgetTab(w.id, "default");
    expect((await widgetsRepo.getWidget(w.id))!.tabId).toBe("default");
  });

  it("addWidget defaults to the 'default' tab", async () => {
    const w = await widgetsRepo.addWidget(FIXTURE_TYPE, {});
    expect((await widgetsRepo.getWidget(w.id))!.tabId).toBe("default");
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm test -- tabs-repo`
Expected: FAIL — `@/server/tabs-repo` cannot be resolved / `setWidgetTab` not a function.

- [ ] **Step 7: Create the tabs repo**

Create `src/server/tabs-repo.ts`:

```typescript
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
```

- [ ] **Step 8: Extend config-repo (`addWidget` tabId + `setWidgetTab`)**

In `src/server/config-repo.ts`, change `addWidget` to accept `tabId` and set it on the row:

```typescript
export async function addWidget(
  type: string, config: Record<string, unknown>, tabId = "default",
): Promise<Widget> {
  const def = getFetchWidget(type);
  const validated = def ? (def.manifest.configSchema.parse(config) as Record<string, unknown>) : config;
  const existing = await getWidgets();
  const order = existing.reduce((max, w) => Math.max(max, w.order + 1), 0);
  const row: Widget = {
    id: crypto.randomUUID(), type, title: null, accent: null, order, colSpan: 1, rowSpan: DEFAULT_ROW_SPAN,
    hidden: false, tabId, config: validated,
  };
  await getDb().insert(widgets).values(row);
  return row;
}
```

And add, next to `setHidden`:

```typescript
export async function setWidgetTab(id: string, tabId: string): Promise<void> {
  await getDb().update(widgets).set({ tabId }).where(eq(widgets.id, id));
}
```

- [ ] **Step 9: Run the tabs-repo test to verify it passes**

Run: `npm test -- tabs-repo`
Expected: PASS (7 tests).

- [ ] **Step 10: Run the full suite to catch Widget-literal breakage**

Run: `npm test`
Expected: `tests/components/dashboard-logic.test.ts` FAILS to type-check/run because its `mk()` helper builds a `Widget` without `tabId`. Fix it now: in `tests/components/dashboard-logic.test.ts`, add `tabId` to the `mk` literal:

```typescript
const mk = (id: string, order: number, extra: Partial<Widget> = {}): Widget => ({
  id, type: FIXTURE_TYPE, title: null, accent: null, order, colSpan: 1, rowSpan: 6,
  hidden: false, tabId: "default", config: {}, ...extra,
});
```

Then re-run `npm test`. Expected: PASS (search for any other `Widget` literal the compiler flags and add `tabId: "default"`).

- [ ] **Step 11: Commit**

```bash
git add src/db/schema.ts drizzle/ src-tauri/src/lib.rs src/server/tabs-repo.ts src/server/config-repo.ts tests/server/tabs-repo.test.ts tests/components/dashboard-logic.test.ts
git commit -m "feat: add tabs table, tab_id column, and tabs repo"
```

---

## Task 2: Data-access wrappers + fetchLayout

**Files:**
- Modify: `src/lib/dashboard-data.ts`
- Test: `tests/server/tabs-repo.test.ts` is enough for repo coverage; add a light data-layer test only for `fetchLayout` active-tab fallback.

**Interfaces:**
- Consumes: `src/server/tabs-repo.ts` (Task 1), `getPref`/`setPref` from `config-repo`.
- Produces (all in `src/lib/dashboard-data.ts`):
  - `type LayoutSnapshot = { widgets: Widget[]; tabs: Tab[]; activeTabId: string; prefs: { theme: string } }`
  - `getTabs(): Promise<Tab[]>`
  - `createTab(name: string): Promise<Tab>`
  - `renameTab(id: string, name: string): Promise<void>`
  - `deleteTab(id: string): Promise<void>`
  - `reorderTabs(orders: { id: string; order: number }[]): Promise<void>`
  - `setActiveTab(id: string): Promise<void>` (persists `ui.activeTab`)
  - `moveWidgetToTab(widgetId: string, tabId: string): Promise<void>`
  - `createWidget(type: string, tabId: string): Promise<Widget>`

- [ ] **Step 1: Write the failing fetchLayout test**

Create `tests/lib/dashboard-data.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { useTempDb } from "../helpers/db";
import { registerFixtureWidget, FIXTURE_TYPE } from "../helpers/fixture-widget";
import * as data from "@/lib/dashboard-data";
import * as tabsRepo from "@/server/tabs-repo";

beforeEach(() => { useTempDb(); registerFixtureWidget(); });

describe("dashboard-data tabs", () => {
  it("fetchLayout returns tabs and defaults activeTabId to the first tab", async () => {
    const layout = await data.fetchLayout();
    expect(layout.tabs.map((t) => t.id)).toContain("default");
    expect(layout.activeTabId).toBe("default");
  });

  it("fetchLayout honors a persisted active tab, falling back when it is gone", async () => {
    const t = await tabsRepo.addTab("Work");
    await data.setActiveTab(t.id);
    expect((await data.fetchLayout()).activeTabId).toBe(t.id);
    await data.deleteTab(t.id);
    expect((await data.fetchLayout()).activeTabId).toBe("default");
  });

  it("createWidget assigns the given tab and moveWidgetToTab reassigns it", async () => {
    const t = await tabsRepo.addTab("Work");
    const w = await data.createWidget(FIXTURE_TYPE, t.id);
    expect(w.tabId).toBe(t.id);
    await data.moveWidgetToTab(w.id, "default");
    const layout = await data.fetchLayout();
    expect(layout.widgets.find((x) => x.id === w.id)!.tabId).toBe("default");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- dashboard-data`
Expected: FAIL — `layout.tabs` is undefined / `setActiveTab` not exported.

- [ ] **Step 3: Implement the wrappers**

In `src/lib/dashboard-data.ts`, update imports and add the functions.

Add to the `config-repo` import list `getPref, setPref` (getPref is already imported — add `setPref`), and import the tabs repo + Tab type:

```typescript
import {
  addWidget as repoAddWidget, getWidget, getWidgets, getPref, setPref,
  setHidden, setConfig, setTitle, removeWidget, setPositions, setAccent, setWidgetTab,
  type Widget,
} from "@/server/config-repo";
import {
  getTabs as repoGetTabs, addTab, renameTab as repoRenameTab,
  deleteTab as repoDeleteTab, setTabOrder, type Tab,
} from "@/server/tabs-repo";
```

Replace the `LayoutSnapshot` type and `fetchLayout`:

```typescript
export type LayoutSnapshot = {
  widgets: Widget[];
  tabs: Tab[];
  activeTabId: string;
  prefs: { theme: string };
};

export async function fetchLayout(): Promise<LayoutSnapshot> {
  const [widgets, tabs, theme, savedActive] = await Promise.all([
    getWidgets(), repoGetTabs(), getPref("theme", "dark"), getPref("ui.activeTab", ""),
  ]);
  const activeTabId = tabs.some((t) => t.id === savedActive)
    ? savedActive
    : tabs[0]?.id ?? "default";
  return { widgets, tabs, activeTabId, prefs: { theme } };
}
```

Change `createWidget` to require a `tabId`:

```typescript
export async function createWidget(type: string, tabId: string): Promise<Widget> {
  const def = getFetchWidget(type);
  if (!def) throw new Error(`Unknown widget type: ${type}`);
  return repoAddWidget(type, def.manifest.defaultConfig as Record<string, unknown>, tabId);
}
```

Add the tab wrappers (near the bottom, before `fetchIntegrations`):

```typescript
export async function getTabs(): Promise<Tab[]> {
  return repoGetTabs();
}
export async function createTab(name: string): Promise<Tab> {
  return addTab(name);
}
export async function renameTab(id: string, name: string): Promise<void> {
  await repoRenameTab(id, name);
}
export async function deleteTab(id: string): Promise<void> {
  await repoDeleteTab(id);
}
export async function reorderTabs(orders: { id: string; order: number }[]): Promise<void> {
  await setTabOrder(orders);
}
export async function setActiveTab(id: string): Promise<void> {
  await setPref("ui.activeTab", id);
}
export async function moveWidgetToTab(widgetId: string, tabId: string): Promise<void> {
  await setWidgetTab(widgetId, tabId);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- dashboard-data`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard-data.ts tests/lib/dashboard-data.test.ts
git commit -m "feat: tabs data-access wrappers and layout with active tab"
```

---

## Task 3: Pure dashboard logic (filter, reorder tabs, move, classify drag)

**Files:**
- Modify: `src/components/dashboard-logic.ts`
- Test: `tests/components/dashboard-logic.test.ts`

**Interfaces:**
- Consumes: `Widget` from `config-repo`, `Tab` from `tabs-repo`.
- Produces (in `src/components/dashboard-logic.ts`):
  - `widgetsForTab(widgets: Widget[], tabId: string): Widget[]` — visible widgets on a tab, in order.
  - `applyReorderTabs(tabs: Tab[], activeId: string, overId: string): Tab[]` — dense 0..n order.
  - `assignWidgetToTab(widgets: Widget[], widgetId: string, tabId: string): Widget[]`.
  - `TAB_DND_PREFIX = "tab:"`, `tabDndId(id: string): string`, `parseTabDndId(id: string): string | null`.
  - `type DragAction` and `classifyDrag(active, over): DragAction` (see code).

- [ ] **Step 1: Write the failing tests**

Append to `tests/components/dashboard-logic.test.ts` (add the imports to the top import line):

```typescript
import {
  orderedWidgets, applyReorder, applyResize,
  widgetsForTab, applyReorderTabs, assignWidgetToTab,
  tabDndId, parseTabDndId, classifyDrag,
} from "@/components/dashboard-logic";
import type { Tab } from "@/server/tabs-repo";
```

Then add a new `describe` block at the end of the file:

```typescript
describe("dashboard-logic tabs", () => {
  const mkTab = (id: string, order: number, name = id): Tab => ({ id, name, order });

  it("filters visible widgets to a tab, in order", () => {
    const ws = [
      mk("a", 1, { tabId: "t1" }),
      mk("b", 0, { tabId: "t1" }),
      mk("c", 2, { tabId: "t2" }),
      mk("h", 3, { tabId: "t1", hidden: true }),
    ];
    expect(widgetsForTab(ws, "t1").map((w) => w.id)).toEqual(["b", "a"]);
    expect(widgetsForTab(ws, "t2").map((w) => w.id)).toEqual(["c"]);
  });

  it("reorders tabs and reassigns a dense 0..n order", () => {
    const ts = [mkTab("a", 0), mkTab("b", 1), mkTab("c", 2)];
    const next = applyReorderTabs(ts, "c", "a");
    expect(next.map((t) => [t.id, t.order])).toEqual([["c", 0], ["a", 1], ["b", 2]]);
  });

  it("assigns a widget to a different tab", () => {
    const ws = [mk("a", 0, { tabId: "t1" }), mk("b", 1, { tabId: "t1" })];
    const next = assignWidgetToTab(ws, "a", "t2");
    expect(next.find((w) => w.id === "a")!.tabId).toBe("t2");
    expect(next.find((w) => w.id === "b")!.tabId).toBe("t1");
  });

  it("round-trips tab dnd ids", () => {
    expect(tabDndId("x")).toBe("tab:x");
    expect(parseTabDndId("tab:x")).toBe("x");
    expect(parseTabDndId("plain-uuid")).toBeNull();
  });

  it("classifies drag actions by type", () => {
    expect(classifyDrag({ id: "w1", type: "widget" }, { id: "w2", type: "widget" }))
      .toEqual({ kind: "reorder-widgets", activeId: "w1", overId: "w2" });
    expect(classifyDrag({ id: "tab:a", type: "tab" }, { id: "tab:b", type: "tab" }))
      .toEqual({ kind: "reorder-tabs", activeTabId: "a", overTabId: "b" });
    expect(classifyDrag({ id: "w1", type: "widget" }, { id: "tab:b", type: "tab" }))
      .toEqual({ kind: "move-widget-to-tab", widgetId: "w1", tabId: "b" });
    expect(classifyDrag({ id: "w1", type: "widget" }, null)).toEqual({ kind: "none" });
    expect(classifyDrag({ id: "w1", type: "widget" }, { id: "w1", type: "widget" }))
      .toEqual({ kind: "none" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- dashboard-logic`
Expected: FAIL — `widgetsForTab` etc. not exported.

- [ ] **Step 3: Implement the pure functions**

Append to `src/components/dashboard-logic.ts` (and add `import type { Tab } from "@/server/tabs-repo";` at the top):

```typescript
/** Visible widgets belonging to one tab, in global flow order. */
export function widgetsForTab(widgets: Widget[], tabId: string): Widget[] {
  return orderedWidgets(widgets).filter((w) => w.tabId === tabId);
}

/** Move `activeId` tab to `overId`'s slot; reassign a dense 0..n order. */
export function applyReorderTabs(tabs: Tab[], activeId: string, overId: string): Tab[] {
  const sorted = [...tabs].sort((a, b) => a.order - b.order);
  const from = sorted.findIndex((t) => t.id === activeId);
  const to = sorted.findIndex((t) => t.id === overId);
  if (from < 0 || to < 0) return tabs;
  const [moved] = sorted.splice(from, 1);
  sorted.splice(to, 0, moved);
  return sorted.map((t, i) => ({ ...t, order: i }));
}

/** Reassign one widget to a tab. */
export function assignWidgetToTab(widgets: Widget[], widgetId: string, tabId: string): Widget[] {
  return widgets.map((w) => (w.id === widgetId ? { ...w, tabId } : w));
}

export const TAB_DND_PREFIX = "tab:";
export function tabDndId(id: string): string {
  return TAB_DND_PREFIX + id;
}
export function parseTabDndId(id: string): string | null {
  return id.startsWith(TAB_DND_PREFIX) ? id.slice(TAB_DND_PREFIX.length) : null;
}

export type DragAction =
  | { kind: "reorder-widgets"; activeId: string; overId: string }
  | { kind: "reorder-tabs"; activeTabId: string; overTabId: string }
  | { kind: "move-widget-to-tab"; widgetId: string; tabId: string }
  | { kind: "none" };

/** Decide what a drag means from the dragged/over item ids and their `data.type`. */
export function classifyDrag(
  active: { id: string; type?: string },
  over: { id: string; type?: string } | null,
): DragAction {
  if (!over) return { kind: "none" };
  if (active.type === "widget" && over.type === "widget") {
    return active.id === over.id
      ? { kind: "none" }
      : { kind: "reorder-widgets", activeId: active.id, overId: over.id };
  }
  if (active.type === "tab" && over.type === "tab") {
    const at = parseTabDndId(active.id);
    const ot = parseTabDndId(over.id);
    if (!at || !ot || at === ot) return { kind: "none" };
    return { kind: "reorder-tabs", activeTabId: at, overTabId: ot };
  }
  if (active.type === "widget" && over.type === "tab") {
    const t = parseTabDndId(over.id);
    return t ? { kind: "move-widget-to-tab", widgetId: active.id, tabId: t } : { kind: "none" };
  }
  return { kind: "none" };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- dashboard-logic`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard-logic.ts tests/components/dashboard-logic.test.ts
git commit -m "feat: tab-aware widget filtering and drag classification"
```

---

## Task 4: ConfirmDialog component

**Files:**
- Create: `src/components/confirm-dialog.tsx`
- Test: `tests/components/confirm-dialog.test.tsx`

**Interfaces:**
- Produces: `ConfirmDialog` React component with props
  `{ title: string; message: string; confirmLabel?: string; onConfirm: () => void; onCancel: () => void }`.
  Renders a portal overlay; clicking the backdrop or Cancel calls `onCancel`; the confirm button calls `onConfirm`.

- [ ] **Step 1: Write the failing test**

Create `tests/components/confirm-dialog.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfirmDialog } from "@/components/confirm-dialog";

describe("ConfirmDialog", () => {
  it("renders title and message and fires callbacks", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        title="Delete tab?"
        message="This removes the tab and its widgets."
        confirmLabel="Delete"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText("Delete tab?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- confirm-dialog`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement ConfirmDialog**

Create `src/components/confirm-dialog.tsx` (mirrors the overlay pattern of `add-widget-drawer.tsx`):

```tsx
"use client";
import { useEffect } from "react";
import { createPortal } from "react-dom";

export function ConfirmDialog({
  title, message, confirmLabel = "Confirm", onConfirm, onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 [animation:wd-fade-in_.15s_ease-out] dark:bg-black/60"
      onClick={onCancel}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-80 rounded-xl border border-border bg-panel p-5 shadow-xl dark:border-border-dark dark:bg-panel-dark"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 ring-1 ring-border transition-colors hover:bg-slate-50 dark:text-slate-300 dark:ring-border-dark dark:hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-danger px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-danger/90"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- confirm-dialog`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/confirm-dialog.tsx tests/components/confirm-dialog.test.tsx
git commit -m "feat: reusable confirm dialog"
```

---

## Task 5: TabBar component

**Files:**
- Create: `src/components/tab-bar.tsx`
- Test: `tests/components/tab-bar.test.tsx`

**Interfaces:**
- Consumes: `Tab` from `tabs-repo`; `tabDndId` from `dashboard-logic`; dnd-kit `useSortable`, `SortableContext`, `horizontalListSortingStrategy`.
- Produces: `TabBar` component with props:

```typescript
{
  tabs: Tab[];
  activeTabId: string;
  autoEditId: string | null;      // tab id to open directly in rename mode (after "+")
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void; // parent shows the confirm dialog
  canDelete: boolean;             // false when only one tab remains
}
```

Requirement notes:
- Tabs are sortable (`SortableContext` with `horizontalListSortingStrategy`, items = `tabs.map((t) => tabDndId(t.id))`). The `DndContext` is provided by the parent (Task 7), NOT here.
- Active tab: `primary-600` text + a 2px underline bar; inactive: slate text, hover background.
- Double-click a tab label → inline `<input>`; Enter or blur commits via `onRename` (skip if unchanged/empty), Escape cancels. While editing, drag listeners are NOT attached so text selection works.
- When `autoEditId` matches a tab, it starts in edit mode (used right after creating a tab).
- A `×` delete button shows on the active tab only when `canDelete`; clicking it calls `onDelete` (stopPropagation so it doesn't select/drag).
- A trailing `+` button calls `onAdd`.

- [ ] **Step 1: Write the failing test**

Create `tests/components/tab-bar.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { TabBar } from "@/components/tab-bar";
import type { Tab } from "@/server/tabs-repo";

const tabs: Tab[] = [
  { id: "t1", name: "Work", order: 0 },
  { id: "t2", name: "Personal", order: 1 },
];

function renderBar(props: Partial<React.ComponentProps<typeof TabBar>> = {}) {
  const merged = {
    tabs, activeTabId: "t1", autoEditId: null,
    onSelect: vi.fn(), onAdd: vi.fn(), onRename: vi.fn(), onDelete: vi.fn(),
    canDelete: true, ...props,
  };
  render(<DndContext>{<TabBar {...merged} />}</DndContext>);
  return merged;
}

describe("TabBar", () => {
  it("selects a tab on click", () => {
    const p = renderBar();
    fireEvent.click(screen.getByText("Personal"));
    expect(p.onSelect).toHaveBeenCalledWith("t2");
  });

  it("adds a tab", () => {
    const p = renderBar();
    fireEvent.click(screen.getByRole("button", { name: /add tab/i }));
    expect(p.onAdd).toHaveBeenCalledOnce();
  });

  it("renames on double-click + Enter", () => {
    const p = renderBar();
    fireEvent.doubleClick(screen.getByText("Work"));
    const input = screen.getByDisplayValue("Work");
    fireEvent.change(input, { target: { value: "Focus" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(p.onRename).toHaveBeenCalledWith("t1", "Focus");
  });

  it("shows delete only for the active tab when canDelete", () => {
    renderBar();
    expect(screen.getByRole("button", { name: /delete tab/i })).toBeInTheDocument();
  });

  it("hides delete when only one tab remains", () => {
    renderBar({ tabs: [tabs[0]], canDelete: false });
    expect(screen.queryByRole("button", { name: /delete tab/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tab-bar`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement TabBar**

Create `src/components/tab-bar.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { SortableContext, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Tab } from "@/server/tabs-repo";
import { tabDndId } from "@/components/dashboard-logic";

type TabBarProps = {
  tabs: Tab[];
  activeTabId: string;
  autoEditId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  canDelete: boolean;
};

function SortableTab({
  tab, active, editing, canDelete, onSelect, onStartEdit, onCommit, onCancel, onDelete,
}: {
  tab: Tab;
  active: boolean;
  editing: boolean;
  canDelete: boolean;
  onSelect: () => void;
  onStartEdit: () => void;
  onCommit: (name: string) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tabDndId(tab.id),
    data: { type: "tab" },
  });
  const [draft, setDraft] = useState(tab.name);
  useEffect(() => { if (editing) setDraft(tab.name); }, [editing, tab.name]);

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  function commit() {
    const next = draft.trim();
    if (next && next !== tab.name) onCommit(next);
    else onCancel();
  }

  return (
    <div ref={setNodeRef} style={style} className="relative flex items-center">
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") onCancel();
          }}
          className="w-24 rounded-md bg-transparent px-2 py-1 text-sm font-medium text-slate-800 outline-none ring-1 ring-primary-500 dark:text-slate-100"
        />
      ) : (
        <button
          type="button"
          {...attributes}
          {...listeners}
          onClick={onSelect}
          onDoubleClick={onStartEdit}
          className={`relative px-3 py-2 text-sm font-medium transition-colors ${
            active
              ? "text-primary-600 dark:text-primary-400"
              : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
          }`}
        >
          {tab.name}
          {active && (
            <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary-600 dark:bg-primary-400" />
          )}
        </button>
      )}
      {active && canDelete && !editing && (
        <button
          type="button"
          aria-label="Delete tab"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="mr-1 grid h-5 w-5 place-items-center rounded text-slate-400 hover:bg-danger/10 hover:text-danger"
        >
          <span className="text-xs leading-none">✕</span>
        </button>
      )}
    </div>
  );
}

export function TabBar({
  tabs, activeTabId, autoEditId, onSelect, onAdd, onRename, onDelete, canDelete,
}: TabBarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  useEffect(() => { setEditingId(autoEditId); }, [autoEditId]);

  return (
    <div className="flex items-center gap-1">
      <SortableContext items={tabs.map((t) => tabDndId(t.id))} strategy={horizontalListSortingStrategy}>
        {tabs.map((tab) => (
          <SortableTab
            key={tab.id}
            tab={tab}
            active={tab.id === activeTabId}
            editing={editingId === tab.id}
            canDelete={canDelete}
            onSelect={() => onSelect(tab.id)}
            onStartEdit={() => setEditingId(tab.id)}
            onCommit={(name) => { setEditingId(null); onRename(tab.id, name); }}
            onCancel={() => setEditingId(null)}
            onDelete={() => onDelete(tab.id)}
          />
        ))}
      </SortableContext>
      <button
        type="button"
        aria-label="Add tab"
        title="Add tab"
        onClick={onAdd}
        className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/5 dark:hover:text-slate-200"
      >
        <span className="text-base leading-none">+</span>
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tab-bar`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/tab-bar.tsx tests/components/tab-bar.test.tsx
git commit -m "feat: tab bar with sortable tabs, inline rename, add/delete"
```

---

## Task 6: CardMenu "Move to tab…" submenu + thread props

**Files:**
- Modify: `src/components/card-menu.tsx`
- Modify: `src/components/widget-card.tsx`
- Modify: `src/components/sortable-card.tsx`
- Test: extend `tests/components/widget-card.test.tsx`

**Interfaces:**
- `CardMenu` gains optional props:
  `moveTargets?: { id: string; name: string }[]` (tabs OTHER than the current one) and
  `onMove?: (tabId: string) => void`. When `moveTargets` is non-empty and `onMove` is set, a "Move to tab…" item is shown; clicking it swaps the menu to a list of the target tabs; clicking a target calls `onMove(tabId)` and closes.
- `WidgetCard` and `SortableCard` gain matching optional props `moveTargets` / `onMoveToTab: (widgetId, tabId) => void` and pass them through.

- [ ] **Step 1: Write the failing test**

First inspect the existing `tests/components/widget-card.test.tsx` to match its render setup, then add a case. Append this test (adjust the import list / render helper to the file's existing style):

```tsx
import { CardMenu } from "@/components/card-menu";
// ... existing imports ...

describe("CardMenu move-to-tab", () => {
  it("lists other tabs and moves on click", async () => {
    const onMove = vi.fn();
    render(
      <CardMenu
        onConfigure={() => {}}
        onRemove={() => {}}
        moveTargets={[{ id: "t2", name: "Personal" }]}
        onMove={onMove}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /widget menu/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /move to tab/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Personal" }));
    expect(onMove).toHaveBeenCalledWith("t2");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- widget-card`
Expected: FAIL — no "Move to tab" menuitem.

- [ ] **Step 3: Add the submenu to CardMenu**

In `src/components/card-menu.tsx`, extend the props and add a `view` state. Replace the component signature and the menu body:

```tsx
export function CardMenu({
  onConfigure, onRemove, moveTargets = [], onMove,
}: {
  onConfigure: () => void;
  onRemove: () => void;
  moveTargets?: { id: string; name: string }[];
  onMove?: (tabId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"root" | "move">("root");
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  // ... keep the existing btnRef, menuRef, and the useEffect unchanged ...
```

In the existing `useEffect` that closes the menu, also reset the view when closing — change the `close`/`setOpen(false)` paths to also `setView("root")`. Simplest: add `useEffect(() => { if (!open) setView("root"); }, [open]);` right after the existing effect.

Replace the menu markup (the `{open && pos && (...)}` block's inner buttons) so it renders either the root view or the move view:

```tsx
      {open && pos && (
        <div
          ref={menuRef}
          role="menu"
          style={{ position: "fixed", top: pos.top, right: pos.right }}
          className="z-50 w-44 overflow-hidden rounded-lg bg-panel py-1 shadow-lg ring-1 ring-border [animation:wd-fade-in_.12s_ease-out] dark:bg-panel-dark dark:ring-border-dark"
        >
          {view === "root" ? (
            <>
              <button
                role="menuitem"
                onClick={() => { setOpen(false); onConfigure(); }}
                className="block w-full px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/5"
              >
                Configure
              </button>
              {onMove && moveTargets.length > 0 && (
                <button
                  role="menuitem"
                  onClick={() => setView("move")}
                  className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/5"
                >
                  Move to tab… <span aria-hidden className="text-slate-400">›</span>
                </button>
              )}
              <button
                role="menuitem"
                onClick={() => { setOpen(false); onRemove(); }}
                className="block w-full px-3 py-1.5 text-left text-sm text-danger hover:bg-danger/10"
              >
                Remove
              </button>
            </>
          ) : (
            <>
              <button
                role="menuitem"
                onClick={() => setView("root")}
                className="flex w-full items-center gap-1 px-3 py-1.5 text-left text-sm text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5"
              >
                <span aria-hidden>‹</span> Back
              </button>
              {moveTargets.map((t) => (
                <button
                  key={t.id}
                  role="menuitem"
                  onClick={() => { setOpen(false); onMove?.(t.id); }}
                  className="block w-full truncate px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/5"
                >
                  {t.name}
                </button>
              ))}
            </>
          )}
        </div>
      )}
```

- [ ] **Step 4: Thread props through WidgetCard and SortableCard**

In `src/components/widget-card.tsx`, add optional props and pass them to `CardMenu`. Update the props type (near line 11-15) to include:

```tsx
  moveTargets?: { id: string; name: string }[];
  onMoveToTab?: (widgetId: string) => void;
```

and update the `CardMenu` usage (around line 42-43) to:

```tsx
    onConfigure && onRemove ? (
      <CardMenu
        onConfigure={() => onConfigure(widget)}
        onRemove={() => onRemove(widget.id)}
        moveTargets={moveTargets}
        onMove={onMoveToTab ? () => onMoveToTab(widget.id) : undefined}
      />
    ) : (
```

Wait — `onMove` needs the target tab id. Change the prop shape: `WidgetCard` receives `onMoveToTab?: (widgetId: string, tabId: string) => void`, and passes `onMove={onMoveToTab ? (tabId) => onMoveToTab(widget.id, tabId) : undefined}`. Use this exact form:

```tsx
  moveTargets?: { id: string; name: string }[];
  onMoveToTab?: (widgetId: string, tabId: string) => void;
```

```tsx
      <CardMenu
        onConfigure={() => onConfigure(widget)}
        onRemove={() => onRemove(widget.id)}
        moveTargets={moveTargets}
        onMove={onMoveToTab ? (tabId) => onMoveToTab(widget.id, tabId) : undefined}
      />
```

In `src/components/sortable-card.tsx`, add the same two optional props to the props type and forward them to `WidgetCard`:

```tsx
  moveTargets?: { id: string; name: string }[];
  onMoveToTab?: (widgetId: string, tabId: string) => void;
```

```tsx
      <WidgetCard
        widget={widget}
        onRemove={onRemove}
        onConfigure={onConfigure}
        moveTargets={moveTargets}
        onMoveToTab={onMoveToTab}
        dragHandle={{ setRef: setActivatorNodeRef, attributes, listeners }}
      />
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- widget-card`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/card-menu.tsx src/components/widget-card.tsx src/components/sortable-card.tsx tests/components/widget-card.test.tsx
git commit -m "feat: move-to-tab submenu in the widget card menu"
```

---

## Task 7: Dashboard wiring (single DndContext, tab state, drag branches)

**Files:**
- Modify: `src/components/dashboard.tsx`
- Modify: `src/app-root.tsx`
- Test: manual verification via the running app (component integration is exercised by Tasks 3–6 unit tests).

**Interfaces:**
- Consumes: everything from Tasks 2–6 — `fetchLayout` (now returns `tabs`/`activeTabId`), `createTab`/`renameTab`/`deleteTab`/`reorderTabs`/`setActiveTab`/`moveWidgetToTab`/`createWidget(type, tabId)` from `dashboard-data`; `widgetsForTab`/`applyReorderTabs`/`assignWidgetToTab`/`classifyDrag`/`tabDndId` from `dashboard-logic`; `TabBar`, `ConfirmDialog`.
- `Dashboard` prop change: `Dashboard({ initialWidgets, initialTabs, initialActiveTabId }: { initialWidgets: Widget[]; initialTabs: Tab[]; initialActiveTabId: string })`.

- [ ] **Step 1: Update app-root to load and pass tabs**

In `src/app-root.tsx`, add `Tab` import and pass the new props. Replace `DashboardView`:

```tsx
import type { Tab } from "@/server/tabs-repo";

function DashboardView() {
  const [layout, setLayout] = useState<Awaited<ReturnType<typeof fetchLayout>> | null>(null);
  useEffect(() => {
    (async () => setLayout(await fetchLayout()))();
  }, []);
  if (!layout) return null;
  return (
    <Dashboard
      initialWidgets={layout.widgets}
      initialTabs={layout.tabs}
      initialActiveTabId={layout.activeTabId}
    />
  );
}
```

(The unused `Tab` import can be dropped if the inferred type covers it; keep the import only if you reference `Tab` directly.)

- [ ] **Step 2: Rewrite Dashboard with tab state and one DndContext**

Replace `src/components/dashboard.tsx` in full:

```tsx
"use client";
import { AppLink as Link } from "@/components/app-link";
import { useEffect, useRef, useState } from "react";
import {
  DndContext, DragOverlay, pointerWithin, closestCenter,
  PointerSensor, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import type { Widget } from "@/server/config-repo";
import type { Tab } from "@/server/tabs-repo";
import {
  widgetsForTab, applyReorder, applyResize, assignWidgetToTab,
  applyReorderTabs, classifyDrag, persistPositions, tabDndId,
} from "@/components/dashboard-logic";
import {
  createWidget, deleteWidget, createTab, renameTab as saveTabName,
  deleteTab as removeTab, reorderTabs, setActiveTab, moveWidgetToTab,
} from "@/lib/dashboard-data";
import { columnCountForWidth, ROW_UNIT_PX } from "@/lib/grid";
import { SortableCard } from "./sortable-card";
import { WidgetCard } from "./widget-card";
import { AddWidgetDrawer } from "./add-widget-drawer";
import { ConfigureDialog } from "./configure-dialog";
import { ConfirmDialog } from "./confirm-dialog";
import { TabBar } from "./tab-bar";
import { useAutoRefresh } from "./auto-refresh-context";

function AutoRefreshControls() {
  const { enabled, toggle, refreshAll } = useAutoRefresh();
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={enabled}
        className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 transition-colors ${
          enabled
            ? "bg-primary-600 text-white ring-primary-600"
            : "text-slate-600 ring-border hover:bg-slate-50 dark:text-slate-300 dark:ring-border-dark dark:hover:bg-white/5"
        }`}
      >
        Auto-refresh {enabled ? "on" : "off"}
      </button>
      <button
        type="button"
        onClick={refreshAll}
        aria-label="Refresh all widgets"
        title="Refresh all widgets"
        className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 ring-1 ring-border transition-colors hover:bg-slate-50 hover:text-slate-700 dark:text-slate-400 dark:ring-border-dark dark:hover:bg-white/5"
      >
        ↻
      </button>
    </div>
  );
}

function Toolbar({ tabBar, onAdd }: { tabBar: React.ReactNode; onAdd: (type: string) => void }) {
  return (
    <div className="sticky top-0 z-30 border-b border-border/80 bg-surface/80 backdrop-blur dark:border-border-dark/80 dark:bg-surface-dark/70">
      <div className="flex items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        {tabBar}
        <div className="flex items-center gap-3">
          <AutoRefreshControls />
          <Link
            href="/integrations"
            aria-label="Integrations"
            title="Integrations"
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 ring-1 ring-border transition-colors hover:bg-slate-50 hover:text-slate-700 dark:text-slate-400 dark:ring-border-dark dark:hover:bg-white/5"
          >
            🔌
          </Link>
          <AddWidgetDrawer onAdd={onAdd} />
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mt-16 flex flex-col items-center justify-center text-center" style={{ gridColumn: "1 / -1" }}>
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-xl text-slate-400 ring-1 ring-border dark:bg-white/5 dark:ring-border-dark">
        ▦
      </div>
      <p className="mt-4 text-sm font-medium">This tab is empty</p>
      <p className="mt-1 max-w-xs text-sm text-slate-500 dark:text-slate-400">
        Use <span className="font-medium text-slate-700 dark:text-slate-300">Add widget</span> to start
        assembling this tab.
      </p>
    </div>
  );
}

// Prefer the tab under the pointer (small targets) then fall back to nearest center.
const collision: CollisionDetection = (args) => {
  const p = pointerWithin(args);
  return p.length ? p : closestCenter(args);
};

export function Dashboard({
  initialWidgets, initialTabs, initialActiveTabId,
}: {
  initialWidgets: Widget[];
  initialTabs: Tab[];
  initialActiveTabId: string;
}) {
  const [widgets, setWidgets] = useState(initialWidgets);
  const [tabs, setTabs] = useState(initialTabs);
  const [activeTabId, setActiveTabId] = useState(initialActiveTabId);
  const [autoEditTabId, setAutoEditTabId] = useState<string | null>(null);
  const [deletingTabId, setDeletingTabId] = useState<string | null>(null);
  const [configuring, setConfiguring] = useState<Widget | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cols = width > 0 ? columnCountForWidth(width) : 1;
  const cellWidth = width > 0 ? (width - (cols - 1) * 16) / cols : ROW_UNIT_PX;
  const visible = widgetsForTab(widgets, activeTabId);
  const isEmpty = visible.length === 0;
  const activeWidget = activeId ? widgets.find((w) => w.id === activeId) ?? null : null;
  const moveTargets = tabs.filter((t) => t.id !== activeTabId).map((t) => ({ id: t.id, name: t.name }));

  async function onAdd(type: string) {
    try {
      const added = await createWidget(type, activeTabId);
      setWidgets((w) => [...w, added]);
    } catch (err) {
      console.error("Failed to add widget", err);
    }
  }
  async function onRemove(id: string) {
    await deleteWidget(id);
    setWidgets((w) => w.filter((x) => x.id !== id));
  }
  async function onMoveWidgetToTab(widgetId: string, tabId: string) {
    setWidgets((w) => assignWidgetToTab(w, widgetId, tabId));
    await moveWidgetToTab(widgetId, tabId);
  }

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }
  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const action = classifyDrag(
      { id: String(e.active.id), type: e.active.data.current?.type as string | undefined },
      e.over ? { id: String(e.over.id), type: e.over.data.current?.type as string | undefined } : null,
    );
    if (action.kind === "reorder-widgets") {
      const next = applyReorder(widgets, action.activeId, action.overId);
      setWidgets(next);
      void persistPositions(next);
    } else if (action.kind === "reorder-tabs") {
      const next = applyReorderTabs(tabs, action.activeTabId, action.overTabId);
      setTabs(next);
      void reorderTabs(next.map((t) => ({ id: t.id, order: t.order })));
    } else if (action.kind === "move-widget-to-tab") {
      void onMoveWidgetToTab(action.widgetId, action.tabId);
    }
  }
  function onResize(id: string, colSpan: number, rowSpan: number) {
    const next = applyResize(widgets, id, colSpan, rowSpan);
    setWidgets(next);
    void persistPositions(next);
  }
  function onConfigSaved(id: string, config: Record<string, unknown>, title: string | null, accent: string | null) {
    setWidgets((ws) => ws.map((w) => (w.id === id ? { ...w, config, title, accent } : w)));
  }

  function onSelectTab(id: string) {
    setActiveTabId(id);
    void setActiveTab(id);
  }
  async function onAddTab() {
    const tab = await createTab("New tab");
    setTabs((t) => [...t, tab]);
    setActiveTabId(tab.id);
    setAutoEditTabId(tab.id);
    void setActiveTab(tab.id);
  }
  function onRenameTab(id: string, name: string) {
    setAutoEditTabId(null);
    setTabs((t) => t.map((x) => (x.id === id ? { ...x, name } : x)));
    void saveTabName(id, name);
  }
  async function onConfirmDeleteTab() {
    const id = deletingTabId;
    setDeletingTabId(null);
    if (!id) return;
    await removeTab(id);
    const remaining = tabs.filter((t) => t.id !== id);
    setTabs(remaining);
    setWidgets((w) => w.filter((x) => x.tabId !== id));
    if (activeTabId === id) {
      const nextActive = remaining[0]?.id ?? "";
      setActiveTabId(nextActive);
      void setActiveTab(nextActive);
    }
  }

  const deletingTab = tabs.find((t) => t.id === deletingTabId) ?? null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <Toolbar
        onAdd={onAdd}
        tabBar={
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            autoEditId={autoEditTabId}
            onSelect={onSelectTab}
            onAdd={onAddTab}
            onRename={onRenameTab}
            onDelete={(id) => setDeletingTabId(id)}
            canDelete={tabs.length > 1}
          />
        }
      />
      <main className="px-4 py-6 sm:px-6 lg:px-8">
        <div ref={gridRef} className="wd-grid" style={{ ["--wd-cols" as string]: cols, ["--wd-row-unit" as string]: `${ROW_UNIT_PX}px` }}>
          {isEmpty ? (
            <EmptyState />
          ) : (
            <SortableContext items={visible.map((w) => w.id)} strategy={rectSortingStrategy}>
              {visible.map((w) => (
                <SortableCard
                  key={w.id}
                  widget={w}
                  cols={cols}
                  cellWidth={cellWidth}
                  onRemove={onRemove}
                  onConfigure={setConfiguring}
                  onResize={onResize}
                  moveTargets={moveTargets}
                  onMoveToTab={onMoveWidgetToTab}
                />
              ))}
            </SortableContext>
          )}
        </div>
      </main>
      <DragOverlay>
        {activeWidget ? (
          <div className="cursor-grabbing rounded-xl shadow-2xl ring-1 ring-black/5 dark:ring-white/10">
            <WidgetCard widget={activeWidget} />
          </div>
        ) : null}
      </DragOverlay>
      {configuring && (
        <ConfigureDialog
          widget={configuring}
          onClose={() => setConfiguring(null)}
          onSaved={onConfigSaved}
        />
      )}
      {deletingTab && (
        <ConfirmDialog
          title={`Delete "${deletingTab.name}"?`}
          message="This permanently deletes the tab and all of its widgets."
          confirmLabel="Delete tab"
          onConfirm={onConfirmDeleteTab}
          onCancel={() => setDeletingTabId(null)}
        />
      )}
    </DndContext>
  );
}
```

Note: the widget `SortableCard` items must carry `data: { type: "widget" }` so `classifyDrag` sees the type. Update `useSortable` in `src/components/sortable-card.tsx`:

```tsx
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: widget.id, data: { type: "widget" } });
```

- [ ] **Step 3: Typecheck and run the full suite**

Run: `npm run lint && npm test`
Expected: lint clean; all tests PASS. Fix any remaining `Widget`-literal or import errors the compiler flags.

- [ ] **Step 4: Manual verification in the app**

Use the **verify** skill (or run `npm run dev:vite` and drive it in the browser — do NOT restart the user's running packaged app without asking). Confirm:
1. Existing widgets appear under the default "Dashboard" tab.
2. `+` creates a tab that opens in rename mode; typing + Enter renames it.
3. Switching tabs swaps the grid; adding a widget lands it on the active tab.
4. Dragging a card onto another tab moves it there (it leaves the current grid).
5. Card menu → "Move to tab…" → picking a tab moves the widget.
6. Dragging tabs reorders them; the order persists across reload.
7. Deleting a non-active/active tab prompts; confirming removes the tab and its widgets; the last tab shows no delete affordance.
8. Reload the app: active tab, tab order, names, and widget assignments persist.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard.tsx src/components/sortable-card.tsx src/app-root.tsx
git commit -m "feat: wire tab bar into the dashboard with shared drag context"
```

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** separate-boards model (Task 3 `widgetsForTab` + Task 7 filter); create/rename/delete (Tasks 5, 7); reorder tabs (Tasks 3, 5, 7); move widget via BOTH card menu (Task 6) and drag-onto-tab (Tasks 3, 7); confirm-then-delete-with-widgets (Tasks 1 `deleteTab`, 4, 7); last-tab-undeletable (`canDelete = tabs.length > 1`, Tasks 5, 7); new widgets → active tab (Task 7 `onAdd`); migration seeds default tab + backfills (Task 1); active tab persisted in `ui.activeTab` with fallback (Task 2).
- **Refinement vs spec:** the spec mentioned "a small caret/menu on the active tab" for rename/delete; this plan implements the simpler, cleaner equivalent — double-click to rename + an inline `✕` on the active tab. Same capability, fewer moving parts.
- **Type consistency:** `moveTargets: { id: string; name: string }[]` and `onMoveToTab: (widgetId, tabId) => void` are identical across `CardMenu`/`WidgetCard`/`SortableCard`/`Dashboard`. Widget sortables and tab sortables both attach `data: { type }` so `classifyDrag` can branch.
```
