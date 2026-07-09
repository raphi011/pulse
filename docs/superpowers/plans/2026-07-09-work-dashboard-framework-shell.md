# Work Dashboard — Framework Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, single-user, rearrangeable dashboard shell with a pluggable widget module system, proven end-to-end by one trivial built-in widget.

**Architecture:** Next.js (App Router) app. Widget integrations are self-contained modules split into a server side (`fetch`/actions, registered into a server-only registry) and a client side (React body component, registered into a client registry) linked by a shared manifest. Layout, cache, and refresh are framework concerns persisted in SQLite (Drizzle). A masonry column layout with dnd-kit handles rearranging; TanStack Query drives cache-first fetching.

**Tech Stack:** Next.js 15 + React + TypeScript, Tailwind v4 (CSS-native), Drizzle ORM + better-sqlite3, dnd-kit, TanStack Query, Zod, Vitest + Testing Library.

**Design note:** Task 24 is a dedicated visual pass using the impeccable skill. Earlier UI tasks use plain, correct Tailwind; polish comes at the end so we don't churn styling while structure moves.

---

## File Structure

```
src/
  app/
    layout.tsx                         # root, imports globals, wraps Providers
    providers.tsx                      # "use client" TanStack Query provider
    page.tsx                           # server: load layout, seed default, render Dashboard
    globals.css                        # Tailwind v4 @import + @theme + base
    api/
      layout/route.ts                  # GET layout, PATCH positions
      widgets/route.ts                 # POST add widget
      widgets/[id]/route.ts            # PATCH hidden, DELETE remove
      widgets/[id]/data/route.ts       # GET cached data (?refresh=1)
  db/
    schema.ts                          # Drizzle tables
    client.ts                          # getDb() singleton from env path
  modules/
    contracts.ts                       # ServerWidget, ClientWidget, WidgetBodyProps, WidgetAction
    server-registry.ts                 # register/get/list ServerWidget ("server-only")
    client-registry.ts                 # register/get/list ClientWidget
    server.ts                          # side-effect import of every module's server side
    client.ts                          # side-effect import of every module's client side
    core/
      manifest.ts                      # type ids, Config, defaultConfig, configSchema, Data
      server.ts                        # registers core.status ServerWidget (fetch)
      client.ts                        # registers core.status ClientWidget
      widgets/status-widget.tsx        # "use client" body component
  server/
    config-repo.ts                     # widgets + prefs CRUD
    cache-repo.ts                      # widget_cache get/upsert
    widget-service.ts                  # getWidgetData(id, refresh)
    errors.ts                          # NotFoundError
  lib/
    layout.ts                          # pure column reducer (move/reorder/positions)
  components/
    widget-shell.tsx                   # chrome + loading/error/empty/data states
    use-widget-data.ts                 # "use client" TanStack Query hook
    widget-card.tsx                    # resolves module Component, wraps in shell
    dashboard.tsx                      # "use client" masonry + dnd-kit
    add-widget-drawer.tsx              # "use client" picker from client registry
    edit-mode.tsx                      # "use client" edit-mode context + toggle
tests/                                 # mirrors src for unit/integration/component tests
drizzle/                               # generated migrations
drizzle.config.ts
vitest.config.ts
vitest.setup.ts
```

---

## Task 1: Scaffold the Next.js app

**Files:** whole project (generated).

- [ ] **Step 1: Scaffold into a temp sibling dir** (the repo already contains `.git`, `docs/`, `.superpowers/`, so `create-next-app` cannot run in place)

Run:
```bash
cd /Users/raphaelgruber/Git
npx create-next-app@latest work-dashboard-scaffold \
  --typescript --tailwind --app --src-dir --eslint --use-npm \
  --no-turbopack --import-alias "@/*"
```
Expected: a new `work-dashboard-scaffold/` with Next 15, Tailwind v4, `src/app`.

- [ ] **Step 2: Merge scaffold into the repo, then delete the scaffold**

Run:
```bash
rsync -a --exclude '.git' /Users/raphaelgruber/Git/work-dashboard-scaffold/ /Users/raphaelgruber/Git/work-dashboard/
rm -rf /Users/raphaelgruber/Git/work-dashboard-scaffold
cd /Users/raphaelgruber/Git/work-dashboard
```

- [ ] **Step 3: Verify the dev server boots**

Run:
```bash
npm run dev
```
Expected: "Ready" on http://localhost:3000. Stop it with Ctrl-C.

- [ ] **Step 4: Ignore the SQLite DB file**

Append to `.gitignore`:
```
# local database
dashboard.db
dashboard.db-*
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app"
```

---

## Task 2: Install dependencies

**Files:** `package.json`.

- [ ] **Step 1: Install runtime + dev deps**

Run:
```bash
npm install drizzle-orm better-sqlite3 @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities @tanstack/react-query zod
npm install -D drizzle-kit @types/better-sqlite3 vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

- [ ] **Step 2: Verify install**

Run: `npm ls drizzle-orm better-sqlite3 @dnd-kit/core @tanstack/react-query vitest`
Expected: all resolve with no missing-peer errors.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "Add project dependencies"
```

---

## Task 3: Configure Vitest

**Files:**
- Create: `vitest.config.ts`, `vitest.setup.ts`, `tests/smoke.test.ts`

- [ ] **Step 1: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: { "@": resolve(__dirname, "./src") },
  },
});
```

- [ ] **Step 2: Write `vitest.setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 3: Add test scripts to `package.json`**

Add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Write a smoke test `tests/smoke.test.ts`**

```ts
import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run it**

Run: `npm test`
Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Configure Vitest"
```

---

## Task 4: Tailwind v4 theme + base styles

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Replace `src/app/globals.css` with tokens + dark mode**

```css
@import "tailwindcss";

@theme {
  --color-surface: #f8fafc;
  --color-surface-dark: #0b0f17;
  --color-card: #ffffff;
  --color-card-dark: #121826;
  --color-border: #e2e8f0;
  --color-border-dark: #232c3d;
  --color-muted: #64748b;

  --color-primary-400: #818cf8;
  --color-primary-500: #6366f1;
  --color-primary-600: #4f46e5;

  --color-ok: #16a34a;
  --color-warn: #d97706;
  --color-danger: #dc2626;
}

@variant dark (&:where(.dark, .dark *));

@layer base {
  body {
    @apply bg-surface text-slate-900 dark:bg-surface-dark dark:text-slate-100;
  }
}
```

- [ ] **Step 2: Force dark mode on the root for now**

In `src/app/layout.tsx`, set the html class:
```tsx
<html lang="en" className="dark">
```

- [ ] **Step 3: Verify build compiles**

Run: `npm run build`
Expected: build succeeds (Tailwind v4 already wired by the scaffold via `@tailwindcss/postcss`).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Add Tailwind theme tokens and dark base"
```

---

## Task 5: Database schema + client + migrations

**Files:**
- Create: `src/db/schema.ts`, `src/db/client.ts`, `drizzle.config.ts`

- [ ] **Step 1: Write `src/db/schema.ts`**

```ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const widgets = sqliteTable("widgets", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  column: integer("column").notNull().default(0),
  order: integer("order").notNull().default(0),
  hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
  config: text("config", { mode: "json" }).notNull().$type<Record<string, unknown>>(),
  refreshInterval: integer("refresh_interval"), // seconds, null = manual only
});

export const bookmarks = sqliteTable("bookmarks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  icon: text("icon"),
  order: integer("order").notNull().default(0),
});

export const prefs = sqliteTable("prefs", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const widgetCache = sqliteTable("widget_cache", {
  widgetId: text("widget_id").primaryKey(),
  payload: text("payload", { mode: "json" }),
  fetchedAt: integer("fetched_at").notNull(),
  status: text("status", { enum: ["ok", "error"] }).notNull(),
  error: text("error"),
});
```

- [ ] **Step 2: Write `src/db/client.ts`**

```ts
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

let db: BetterSQLite3Database<typeof schema> | null = null;

export function getDb(): BetterSQLite3Database<typeof schema> {
  if (!db) {
    const path = process.env.DASHBOARD_DB ?? "dashboard.db";
    const sqlite = new Database(path);
    sqlite.pragma("journal_mode = WAL");
    db = drizzle(sqlite, { schema });
  }
  return db;
}

// Test helper: point at a fresh db and reset the singleton.
export function __resetDbForTests() {
  db = null;
}

export { schema };
```

- [ ] **Step 3: Write `drizzle.config.ts`**

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DASHBOARD_DB ?? "dashboard.db" },
});
```

- [ ] **Step 4: Generate the migration**

Run: `npx drizzle-kit generate`
Expected: a `drizzle/0000_*.sql` file plus `drizzle/meta/`.

- [ ] **Step 5: Add db scripts to `package.json`**

Add to `"scripts"`:
```json
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate"
```

- [ ] **Step 6: Apply migration to the local db**

Run: `npm run db:migrate`
Expected: `dashboard.db` created, tables applied.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Add Drizzle schema, client, and initial migration"
```

---

## Task 6: Pure layout reducer (TDD)

**Files:**
- Create: `src/lib/layout.ts`, `tests/lib/layout.test.ts`

- [ ] **Step 1: Write the failing test `tests/lib/layout.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { findColumn, moveWidget, toPositions, type Columns } from "@/lib/layout";

const cols: Columns = [["a", "b"], ["c"], []];

describe("layout reducer", () => {
  it("finds the column of a widget", () => {
    expect(findColumn(cols, "c")).toBe(1);
    expect(findColumn(cols, "z")).toBe(-1);
  });

  it("reorders within a column", () => {
    expect(moveWidget(cols, "a", 0, 1)).toEqual([["b", "a"], ["c"], []]);
  });

  it("moves across columns at an index", () => {
    expect(moveWidget(cols, "a", 2, 0)).toEqual([["b"], ["c"], ["a"]]);
  });

  it("clamps the target index to column length", () => {
    expect(moveWidget(cols, "c", 0, 99)).toEqual([["a", "b", "c"], [], []]);
  });

  it("serializes to positions", () => {
    expect(toPositions([["b", "a"], ["c"]])).toEqual([
      { id: "b", column: 0, order: 0 },
      { id: "a", column: 0, order: 1 },
      { id: "c", column: 1, order: 0 },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- layout`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/layout.ts`**

```ts
export type Columns = string[][];

export function findColumn(cols: Columns, id: string): number {
  return cols.findIndex((col) => col.includes(id));
}

export function moveWidget(cols: Columns, id: string, toCol: number, toIndex: number): Columns {
  const next = cols.map((col) => col.filter((x) => x !== id));
  const target = next[toCol] ?? (next[toCol] = []);
  const index = Math.max(0, Math.min(toIndex, target.length));
  target.splice(index, 0, id);
  return next;
}

export function toPositions(cols: Columns): { id: string; column: number; order: number }[] {
  return cols.flatMap((col, column) => col.map((id, order) => ({ id, column, order })));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- layout`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add pure layout reducer"
```

---

## Task 7: Widget contracts + registries (TDD)

**Files:**
- Create: `src/modules/contracts.ts`, `src/modules/server-registry.ts`, `src/modules/client-registry.ts`, `tests/modules/registry.test.ts`

- [ ] **Step 1: Write `src/modules/contracts.ts`**

```ts
import type { ZodType } from "zod";
import type { FC } from "react";

export interface WidgetAction {
  id: string;
  label: string;
  run(config: unknown, params: Record<string, unknown>): Promise<void>;
}

/** Server-only: how a widget gets its data. Never imported by client code. */
export interface ServerWidget<Data = unknown, Config = unknown> {
  type: string;
  configSchema: ZodType<Config>;
  defaultConfig: Config;
  fetch(config: Config): Promise<Data>;
  actions?: WidgetAction[];
}

export interface WidgetBodyProps<Data = unknown, Config = unknown> {
  data: Data;
  config: Config;
  runAction: (actionId: string, params?: Record<string, unknown>) => Promise<void>;
}

/** Client-only: how a widget renders. */
export interface ClientWidget<Data = unknown, Config = unknown> {
  type: string;
  title: string;
  Component: FC<WidgetBodyProps<Data, Config>>;
}
```

- [ ] **Step 2: Write the failing test `tests/modules/registry.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import {
  registerServerWidget, getServerWidget, listServerTypes, __clearServerRegistry,
} from "@/modules/server-registry";
import {
  registerClientWidget, getClientWidget, listClientWidgets, __clearClientRegistry,
} from "@/modules/client-registry";

beforeEach(() => {
  __clearServerRegistry();
  __clearClientRegistry();
});

describe("registries", () => {
  it("registers and resolves a server widget", () => {
    registerServerWidget({
      type: "t.a", configSchema: z.object({}), defaultConfig: {},
      fetch: async () => 1,
    });
    expect(getServerWidget("t.a")?.type).toBe("t.a");
    expect(listServerTypes()).toContain("t.a");
  });

  it("throws on duplicate server registration", () => {
    const def = { type: "t.a", configSchema: z.object({}), defaultConfig: {}, fetch: async () => 1 };
    registerServerWidget(def);
    expect(() => registerServerWidget(def)).toThrow(/already registered/);
  });

  it("registers and lists a client widget", () => {
    registerClientWidget({ type: "t.a", title: "A", Component: () => null });
    expect(getClientWidget("t.a")?.title).toBe("A");
    expect(listClientWidgets()).toEqual([{ type: "t.a", title: "A" }]);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- registry`
Expected: FAIL (modules not found).

- [ ] **Step 4: Implement `src/modules/server-registry.ts`**

```ts
import "server-only";
import type { ServerWidget } from "./contracts";

const registry = new Map<string, ServerWidget>();

export function registerServerWidget(def: ServerWidget<any, any>): void {
  if (registry.has(def.type)) throw new Error(`Server widget already registered: ${def.type}`);
  registry.set(def.type, def as ServerWidget);
}

export function getServerWidget(type: string): ServerWidget | undefined {
  return registry.get(type);
}

export function listServerTypes(): string[] {
  return [...registry.keys()];
}

export function __clearServerRegistry(): void {
  registry.clear();
}
```

- [ ] **Step 5: Implement `src/modules/client-registry.ts`**

```ts
import type { ClientWidget } from "./contracts";

const registry = new Map<string, ClientWidget>();

export function registerClientWidget(def: ClientWidget<any, any>): void {
  if (registry.has(def.type)) throw new Error(`Client widget already registered: ${def.type}`);
  registry.set(def.type, def as ClientWidget);
}

export function getClientWidget(type: string): ClientWidget | undefined {
  return registry.get(type);
}

export function listClientWidgets(): { type: string; title: string }[] {
  return [...registry.values()].map((d) => ({ type: d.type, title: d.title }));
}

export function __clearClientRegistry(): void {
  registry.clear();
}
```

- [ ] **Step 6: Neutralize `server-only` in tests**

The `server-only` package throws if imported outside an RSC bundler. Add an alias in `vitest.config.ts` `resolve.alias`:
```ts
"server-only": resolve(__dirname, "./tests/stubs/server-only.ts"),
```
Create `tests/stubs/server-only.ts`:
```ts
export {};
```

- [ ] **Step 7: Run to verify it passes**

Run: `npm test -- registry`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Add widget contracts and server/client registries"
```

---

## Task 8: Config repository (TDD)

**Files:**
- Create: `src/server/errors.ts`, `src/server/config-repo.ts`, `tests/server/config-repo.test.ts`, `tests/helpers/db.ts`

- [ ] **Step 1: Write the temp-db helper `tests/helpers/db.ts`**

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { __resetDbForTests } from "@/db/client";

export function useTempDb(): void {
  const dir = mkdtempSync(join(tmpdir(), "wd-"));
  const path = join(dir, "test.db");
  const sqlite = new Database(path);
  migrate(drizzle(sqlite), { migrationsFolder: "drizzle" });
  sqlite.close();
  process.env.DASHBOARD_DB = path;
  __resetDbForTests();
}
```

- [ ] **Step 2: Write `src/server/errors.ts`**

```ts
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}
```

- [ ] **Step 3: Write the failing test `tests/server/config-repo.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useTempDb } from "../helpers/db";
import * as repo from "@/server/config-repo";

beforeEach(() => useTempDb());

describe("config-repo", () => {
  it("adds widgets into the shortest column", () => {
    const a = repo.addWidget("core.status", { label: "A" });
    const b = repo.addWidget("core.status", { label: "B" });
    expect(a.column).toBe(0);
    expect(b.column).toBe(1); // spread across columns
    expect(repo.getWidgets()).toHaveLength(2);
  });

  it("persists positions", () => {
    const a = repo.addWidget("core.status", {});
    repo.setPositions([{ id: a.id, column: 2, order: 5 }]);
    expect(repo.getWidget(a.id)!.column).toBe(2);
    expect(repo.getWidget(a.id)!.order).toBe(5);
  });

  it("hides and removes widgets", () => {
    const a = repo.addWidget("core.status", {});
    repo.setHidden(a.id, true);
    expect(repo.getWidget(a.id)!.hidden).toBe(true);
    repo.removeWidget(a.id);
    expect(repo.getWidget(a.id)).toBeUndefined();
  });

  it("reads and writes prefs with defaults", () => {
    expect(repo.getPref("columnCount", "3")).toBe("3");
    repo.setPref("columnCount", "4");
    expect(repo.getPref("columnCount", "3")).toBe("4");
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `npm test -- config-repo`
Expected: FAIL (module not found).

- [ ] **Step 5: Implement `src/server/config-repo.ts`**

```ts
import { randomUUID } from "node:crypto";
import { eq, asc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { widgets, prefs } from "@/db/schema";

export type Widget = typeof widgets.$inferSelect;

export function getWidgets(): Widget[] {
  return getDb().select().from(widgets).orderBy(asc(widgets.column), asc(widgets.order)).all();
}

export function getWidget(id: string): Widget | undefined {
  return getDb().select().from(widgets).where(eq(widgets.id, id)).get();
}

const COLUMN_COUNT_DEFAULT = 3;

export function addWidget(type: string, config: Record<string, unknown>): Widget {
  const columnCount = Number(getPref("columnCount", String(COLUMN_COUNT_DEFAULT)));
  const existing = getWidgets();
  const counts = Array.from({ length: columnCount }, () => 0);
  for (const w of existing) if (w.column < columnCount) counts[w.column]++;
  const column = counts.indexOf(Math.min(...counts));
  const order = existing.filter((w) => w.column === column).length;
  const row: Widget = {
    id: randomUUID(), type, column, order, hidden: false, config, refreshInterval: null,
  };
  getDb().insert(widgets).values(row).run();
  return row;
}

export function setPositions(positions: { id: string; column: number; order: number }[]): void {
  const db = getDb();
  const tx = db.transaction((ps: typeof positions) => {
    for (const p of ps) {
      db.update(widgets).set({ column: p.column, order: p.order }).where(eq(widgets.id, p.id)).run();
    }
  });
  tx(positions);
}

export function setHidden(id: string, hidden: boolean): void {
  getDb().update(widgets).set({ hidden }).where(eq(widgets.id, id)).run();
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
```

- [ ] **Step 6: Run to verify it passes**

Run: `npm test -- config-repo`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Add config repository"
```

---

## Task 9: Cache repository (TDD)

**Files:**
- Create: `src/server/cache-repo.ts`, `tests/server/cache-repo.test.ts`

- [ ] **Step 1: Write the failing test `tests/server/cache-repo.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useTempDb } from "../helpers/db";
import * as cache from "@/server/cache-repo";

beforeEach(() => useTempDb());

describe("cache-repo", () => {
  it("returns undefined for a miss", () => {
    expect(cache.get("w1")).toBeUndefined();
  });

  it("upserts and reads back a payload with a timestamp", () => {
    const row = cache.set("w1", { status: "ok", payload: { n: 1 }, error: null });
    expect(row.status).toBe("ok");
    expect(row.payload).toEqual({ n: 1 });
    expect(row.fetchedAt).toBeGreaterThan(0);
    expect(cache.get("w1")!.payload).toEqual({ n: 1 });
  });

  it("overwrites on second set", () => {
    cache.set("w1", { status: "ok", payload: { n: 1 }, error: null });
    cache.set("w1", { status: "error", payload: { n: 1 }, error: "boom" });
    const row = cache.get("w1")!;
    expect(row.status).toBe("error");
    expect(row.error).toBe("boom");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- cache-repo`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/server/cache-repo.ts`**

```ts
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { widgetCache } from "@/db/schema";

export type CacheRow = typeof widgetCache.$inferSelect;
export type CacheInput = { status: "ok" | "error"; payload: unknown; error: string | null };

export function get(widgetId: string): CacheRow | undefined {
  return getDb().select().from(widgetCache).where(eq(widgetCache.widgetId, widgetId)).get();
}

export function set(widgetId: string, input: CacheInput): CacheRow {
  const row: CacheRow = {
    widgetId, payload: input.payload, fetchedAt: Date.now(), status: input.status, error: input.error,
  };
  getDb().insert(widgetCache).values(row)
    .onConflictDoUpdate({
      target: widgetCache.widgetId,
      set: { payload: row.payload, fetchedAt: row.fetchedAt, status: row.status, error: row.error },
    }).run();
  return row;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- cache-repo`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add cache repository"
```

---

## Task 10: Widget data service (TDD)

**Files:**
- Create: `src/server/widget-service.ts`, `tests/server/widget-service.test.ts`

- [ ] **Step 1: Write the failing test `tests/server/widget-service.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { useTempDb } from "../helpers/db";
import * as repo from "@/server/config-repo";
import { registerServerWidget, __clearServerRegistry } from "@/modules/server-registry";
import { getWidgetData } from "@/server/widget-service";
import { NotFoundError } from "@/server/errors";

let calls = 0;
beforeEach(() => {
  useTempDb();
  __clearServerRegistry();
  calls = 0;
  registerServerWidget({
    type: "test.count", configSchema: z.object({}), defaultConfig: {},
    fetch: async () => ({ n: ++calls }),
  });
  registerServerWidget({
    type: "test.boom", configSchema: z.object({}), defaultConfig: {},
    fetch: async () => { throw new Error("kaput"); },
  });
});

describe("widget-service", () => {
  it("throws NotFound for an unknown widget id", async () => {
    await expect(getWidgetData("nope", false)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("fetches and caches on first call, serves cache without refresh", async () => {
    const w = repo.addWidget("test.count", {});
    const first = await getWidgetData(w.id, false);
    expect(first.payload).toEqual({ n: 1 });
    const second = await getWidgetData(w.id, false); // cache hit, no fetch
    expect(second.payload).toEqual({ n: 1 });
    expect(calls).toBe(1);
  });

  it("refetches when refresh=true", async () => {
    const w = repo.addWidget("test.count", {});
    await getWidgetData(w.id, false);
    const refreshed = await getWidgetData(w.id, true);
    expect(refreshed.payload).toEqual({ n: 2 });
  });

  it("stores error status and keeps last good payload", async () => {
    const w = repo.addWidget("test.count", {});
    await getWidgetData(w.id, true); // ok, payload {n:1}
    // swap the type to the failing widget to simulate a later failure
    repo.removeWidget(w.id);
    const b = repo.addWidget("test.boom", {});
    const errored = await getWidgetData(b.id, true);
    expect(errored.status).toBe("error");
    expect(errored.error).toContain("kaput");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- widget-service`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/server/widget-service.ts`**

```ts
import "server-only";
import { getWidget } from "./config-repo";
import * as cache from "./cache-repo";
import { getServerWidget } from "@/modules/server-registry";
import { NotFoundError } from "./errors";

export async function getWidgetData(widgetId: string, refresh: boolean): Promise<cache.CacheRow> {
  const widget = getWidget(widgetId);
  if (!widget) throw new NotFoundError(`Widget not found: ${widgetId}`);

  if (!refresh) {
    const cached = cache.get(widgetId);
    if (cached) return cached;
  }

  const def = getServerWidget(widget.type);
  const prev = cache.get(widgetId);

  if (!def) {
    return cache.set(widgetId, {
      status: "error", payload: prev?.payload ?? null, error: `Unknown widget type: ${widget.type}`,
    });
  }

  try {
    const payload = await def.fetch(widget.config);
    return cache.set(widgetId, { status: "ok", payload, error: null });
  } catch (err) {
    return cache.set(widgetId, {
      status: "error", payload: prev?.payload ?? null, error: err instanceof Error ? err.message : String(err),
    });
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- widget-service`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add cache-first widget data service"
```

---

## Task 11: Core "status" module (TDD)

**Files:**
- Create: `src/modules/core/manifest.ts`, `src/modules/core/server.ts`, `tests/modules/core-status.test.ts`

- [ ] **Step 1: Write `src/modules/core/manifest.ts`**

```ts
import { z } from "zod";

export const STATUS_TYPE = "core.status";

export const statusConfigSchema = z.object({
  label: z.string().default("System"),
});
export type StatusConfig = z.infer<typeof statusConfigSchema>;
export const statusDefaultConfig: StatusConfig = { label: "System" };

export type StatusData = {
  now: string;      // ISO timestamp
  node: string;     // process.version
  platform: string; // process.platform
};
```

- [ ] **Step 2: Write the failing test `tests/modules/core-status.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { fetchStatus } from "@/modules/core/server";

describe("core.status fetch", () => {
  it("returns a timestamp, node version, and platform", async () => {
    const data = await fetchStatus();
    expect(typeof data.now).toBe("string");
    expect(data.node).toBe(process.version);
    expect(data.platform).toBe(process.platform);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- core-status`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement `src/modules/core/server.ts`**

```ts
import "server-only";
import { registerServerWidget } from "@/modules/server-registry";
import { STATUS_TYPE, statusConfigSchema, statusDefaultConfig, type StatusData } from "./manifest";

export async function fetchStatus(): Promise<StatusData> {
  return { now: new Date().toISOString(), node: process.version, platform: process.platform };
}

registerServerWidget({
  type: STATUS_TYPE,
  configSchema: statusConfigSchema,
  defaultConfig: statusDefaultConfig,
  fetch: fetchStatus,
});
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- core-status`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add core.status server module"
```

---

## Task 12: Core client widget + module registration barrels

**Files:**
- Create: `src/modules/core/widgets/status-widget.tsx`, `src/modules/core/client.ts`, `src/modules/server.ts`, `src/modules/client.ts`, `tests/modules/core-registration.test.ts`

- [ ] **Step 1: Write `src/modules/core/widgets/status-widget.tsx`**

```tsx
"use client";
import type { WidgetBodyProps } from "@/modules/contracts";
import type { StatusData, StatusConfig } from "../manifest";

export function StatusWidget({ data, config }: WidgetBodyProps<StatusData, StatusConfig>) {
  return (
    <dl className="grid grid-cols-2 gap-y-1 text-sm">
      <dt className="text-muted">Label</dt>
      <dd className="text-right">{config.label}</dd>
      <dt className="text-muted">Time</dt>
      <dd className="text-right tabular-nums">{new Date(data.now).toLocaleTimeString()}</dd>
      <dt className="text-muted">Node</dt>
      <dd className="text-right">{data.node}</dd>
      <dt className="text-muted">Platform</dt>
      <dd className="text-right">{data.platform}</dd>
    </dl>
  );
}
```

- [ ] **Step 2: Write `src/modules/core/client.ts`**

```ts
import { registerClientWidget } from "@/modules/client-registry";
import { STATUS_TYPE } from "./manifest";
import { StatusWidget } from "./widgets/status-widget";

registerClientWidget({ type: STATUS_TYPE, title: "System Status", Component: StatusWidget });
```

- [ ] **Step 3: Write the barrels**

`src/modules/server.ts`:
```ts
import "server-only";
import "./core/server";
// Register future modules' server side here.
```

`src/modules/client.ts`:
```ts
import "./core/client";
// Register future modules' client side here.
```

- [ ] **Step 4: Write the failing test `tests/modules/core-registration.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import "@/modules/server";
import "@/modules/client";
import { getServerWidget } from "@/modules/server-registry";
import { getClientWidget } from "@/modules/client-registry";
import { STATUS_TYPE } from "@/modules/core/manifest";

describe("core registration barrels", () => {
  it("registers core.status on both sides", () => {
    expect(getServerWidget(STATUS_TYPE)).toBeDefined();
    expect(getClientWidget(STATUS_TYPE)?.title).toBe("System Status");
  });
});
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- core-registration`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add core.status client widget and registration barrels"
```

---

## Task 13: Layout + widget mutation API (integration TDD)

**Files:**
- Create: `src/app/api/layout/route.ts`, `src/app/api/widgets/route.ts`, `src/app/api/widgets/[id]/route.ts`, `tests/api/layout.test.ts`

- [ ] **Step 1: Write the failing test `tests/api/layout.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useTempDb } from "../helpers/db";
import "@/modules/server";
import { GET as getLayout, PATCH as patchLayout } from "@/app/api/layout/route";
import { POST as addWidget } from "@/app/api/widgets/route";
import { PATCH as patchWidget, DELETE as delWidget } from "@/app/api/widgets/[id]/route";

beforeEach(() => useTempDb());

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("layout API", () => {
  it("adds a widget and returns it in the layout", async () => {
    const res = await addWidget(new Request("http://x/api/widgets", {
      method: "POST", body: JSON.stringify({ type: "core.status" }),
    }));
    expect(res.status).toBe(201);
    const layout = await (await getLayout()).json();
    expect(layout.widgets).toHaveLength(1);
    expect(layout.prefs.columnCount).toBe("3");
  });

  it("rejects an unknown widget type", async () => {
    const res = await addWidget(new Request("http://x/api/widgets", {
      method: "POST", body: JSON.stringify({ type: "does.not.exist" }),
    }));
    expect(res.status).toBe(400);
  });

  it("persists positions via PATCH /api/layout", async () => {
    const added = await (await addWidget(new Request("http://x/api/widgets", {
      method: "POST", body: JSON.stringify({ type: "core.status" }),
    }))).json();
    const res = await patchLayout(new Request("http://x/api/layout", {
      method: "PATCH", body: JSON.stringify({ positions: [{ id: added.id, column: 2, order: 0 }] }),
    }));
    expect(res.status).toBe(200);
    const layout = await (await getLayout()).json();
    expect(layout.widgets[0].column).toBe(2);
  });

  it("hides then deletes a widget", async () => {
    const added = await (await addWidget(new Request("http://x/api/widgets", {
      method: "POST", body: JSON.stringify({ type: "core.status" }),
    }))).json();
    await patchWidget(new Request("http://x", { method: "PATCH", body: JSON.stringify({ hidden: true }) }), ctx(added.id));
    let layout = await (await getLayout()).json();
    expect(layout.widgets[0].hidden).toBe(true);
    const del = await delWidget(new Request("http://x", { method: "DELETE" }), ctx(added.id));
    expect(del.status).toBe(200);
    layout = await (await getLayout()).json();
    expect(layout.widgets).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- api/layout`
Expected: FAIL (routes not found).

- [ ] **Step 3: Implement `src/app/api/layout/route.ts`**

```ts
import { NextResponse } from "next/server";
import { getWidgets, setPositions, getPref } from "@/server/config-repo";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    widgets: getWidgets(),
    prefs: { columnCount: getPref("columnCount", "3"), theme: getPref("theme", "dark") },
  });
}

export async function PATCH(req: Request) {
  const body = (await req.json()) as { positions?: { id: string; column: number; order: number }[] };
  if (body.positions) setPositions(body.positions);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Implement `src/app/api/widgets/route.ts`**

```ts
import { NextResponse } from "next/server";
import "@/modules/server";
import { getServerWidget } from "@/modules/server-registry";
import { addWidget } from "@/server/config-repo";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { type } = (await req.json()) as { type: string };
  const def = getServerWidget(type);
  if (!def) return NextResponse.json({ error: `Unknown widget type: ${type}` }, { status: 400 });
  const widget = addWidget(type, def.defaultConfig as Record<string, unknown>);
  return NextResponse.json(widget, { status: 201 });
}
```

- [ ] **Step 5: Implement `src/app/api/widgets/[id]/route.ts`**

```ts
import { NextResponse } from "next/server";
import { setHidden, removeWidget, getWidget } from "@/server/config-repo";

export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getWidget(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json()) as { hidden?: boolean };
  if (typeof body.hidden === "boolean") setHidden(id, body.hidden);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  removeWidget(id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `npm test -- api/layout`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Add layout and widget mutation API routes"
```

---

## Task 14: Widget data API (integration TDD)

**Files:**
- Create: `src/app/api/widgets/[id]/data/route.ts`, `tests/api/widget-data.test.ts`

- [ ] **Step 1: Write the failing test `tests/api/widget-data.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useTempDb } from "../helpers/db";
import "@/modules/server";
import { addWidget } from "@/server/config-repo";
import { GET } from "@/app/api/widgets/[id]/data/route";

beforeEach(() => useTempDb());

describe("widget data API", () => {
  it("404s for unknown widget", async () => {
    const res = await GET(new Request("http://x/api/widgets/nope/data"), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });

  it("returns cached data with status ok", async () => {
    const w = addWidget("core.status", { label: "System" });
    const res = await GET(new Request(`http://x/api/widgets/${w.id}/data`), { params: Promise.resolve({ id: w.id }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.payload.node).toBe(process.version);
    expect(body.fetchedAt).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- widget-data`
Expected: FAIL (route not found).

- [ ] **Step 3: Implement `src/app/api/widgets/[id]/data/route.ts`**

```ts
import { NextResponse } from "next/server";
import "@/modules/server";
import { getWidgetData } from "@/server/widget-service";
import { NotFoundError } from "@/server/errors";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  try {
    const row = await getWidgetData(id, refresh);
    return NextResponse.json(row);
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    throw err;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- widget-data`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add cache-first widget data API route"
```

---

## Task 15: TanStack Query provider

**Files:**
- Create: `src/app/providers.tsx`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Write `src/app/providers.tsx`**

```tsx
"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
  }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
```

- [ ] **Step 2: Wrap children in `src/app/layout.tsx`**

Import and wrap the body content:
```tsx
import { Providers } from "./providers";
// inside <body>:
<Providers>{children}</Providers>
```

- [ ] **Step 3: Verify build compiles**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Add TanStack Query provider"
```

---

## Task 16: Widget shell (component TDD)

**Files:**
- Create: `src/components/widget-shell.tsx`, `tests/components/widget-shell.test.tsx`

- [ ] **Step 1: Write the failing test `tests/components/widget-shell.test.tsx`**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WidgetShell } from "@/components/widget-shell";

describe("WidgetShell", () => {
  it("shows a loading state", () => {
    render(<WidgetShell title="X" state="loading" fetchedAt={null} onRefresh={() => {}} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows an error message", () => {
    render(<WidgetShell title="X" state="error" error="gh not found" fetchedAt={null} onRefresh={() => {}} />);
    expect(screen.getByText(/gh not found/i)).toBeInTheDocument();
  });

  it("renders children when ok and fires refresh", async () => {
    const onRefresh = vi.fn();
    render(
      <WidgetShell title="X" state="ok" fetchedAt={Date.now()} onRefresh={onRefresh}>
        <p>body</p>
      </WidgetShell>,
    );
    expect(screen.getByText("body")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- widget-shell`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/components/widget-shell.tsx`**

```tsx
"use client";
import type { ReactNode } from "react";

export type WidgetState = "loading" | "error" | "empty" | "ok";

function ago(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export function WidgetShell({
  title, state, error, fetchedAt, onRefresh, children, headerExtra,
}: {
  title: string;
  state: WidgetState;
  error?: string | null;
  fetchedAt: number | null;
  onRefresh: () => void;
  children?: ReactNode;
  headerExtra?: ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-card ring-1 ring-border dark:bg-card-dark dark:ring-border-dark">
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5 dark:border-border-dark">
        <h3 className="text-sm font-semibold">{title}</h3>
        <div className="flex items-center gap-2 text-xs text-muted">
          {fetchedAt && <span>{ago(fetchedAt)}</span>}
          {headerExtra}
          <button aria-label="Refresh" onClick={onRefresh} className="rounded-md px-1.5 py-1 hover:bg-black/5 dark:hover:bg-white/10">↻</button>
        </div>
      </header>
      <div className="p-4">
        {state === "loading" && <p className="text-sm text-muted">Loading…</p>}
        {state === "error" && <p className="text-sm text-danger">{error ?? "Something went wrong"}</p>}
        {state === "empty" && <p className="text-sm text-muted">Nothing here yet.</p>}
        {state === "ok" && children}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- widget-shell`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add widget shell with loading/error/empty/ok states"
```

---

## Task 17: Widget data hook + widget card

**Files:**
- Create: `src/components/use-widget-data.ts`, `src/components/widget-card.tsx`

- [ ] **Step 1: Write `src/components/use-widget-data.ts`**

```ts
"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CacheRow } from "@/server/cache-repo";

async function fetchData(id: string, refresh: boolean): Promise<CacheRow> {
  const res = await fetch(`/api/widgets/${id}/data${refresh ? "?refresh=1" : ""}`);
  if (!res.ok) throw new Error(`Data request failed: ${res.status}`);
  return res.json();
}

export function useWidgetData(id: string, refreshInterval: number | null) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["widget", id],
    queryFn: () => fetchData(id, false),
    refetchInterval: refreshInterval ? refreshInterval * 1000 : false,
  });
  const refresh = async () => {
    const fresh = await fetchData(id, true);
    qc.setQueryData(["widget", id], fresh);
  };
  return { ...query, refresh };
}
```

- [ ] **Step 2: Write `src/components/widget-card.tsx`**

```tsx
"use client";
import { getClientWidget } from "@/modules/client-registry";
import type { Widget } from "@/server/config-repo";
import { WidgetShell, type WidgetState } from "./widget-shell";
import { useWidgetData } from "./use-widget-data";

export function WidgetCard({ widget }: { widget: Widget }) {
  const def = getClientWidget(widget.type);
  const { data, isLoading, refresh } = useWidgetData(widget.id, widget.refreshInterval);

  if (!def) {
    return <WidgetShell title={widget.type} state="error" error={`No renderer for ${widget.type}`} fetchedAt={null} onRefresh={() => {}} />;
  }

  const state: WidgetState = isLoading ? "loading" : data?.status === "error" ? "error" : "ok";
  const Body = def.Component;

  return (
    <WidgetShell
      title={def.title}
      state={state}
      error={data?.error}
      fetchedAt={data?.fetchedAt ?? null}
      onRefresh={refresh}
    >
      {data && data.payload != null && (
        <Body data={data.payload} config={widget.config} runAction={async () => {}} />
      )}
    </WidgetShell>
  );
}
```

- [ ] **Step 3: Verify build compiles**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Add widget data hook and widget card"
```

---

## Task 18: Edit-mode context + add-widget drawer

**Files:**
- Create: `src/components/edit-mode.tsx`, `src/components/add-widget-drawer.tsx`

- [ ] **Step 1: Write `src/components/edit-mode.tsx`**

```tsx
"use client";
import { createContext, useContext, useState, type ReactNode } from "react";

const EditModeContext = createContext<{ editing: boolean; toggle: () => void }>({ editing: false, toggle: () => {} });

export function EditModeProvider({ children }: { children: ReactNode }) {
  const [editing, setEditing] = useState(false);
  return <EditModeContext.Provider value={{ editing, toggle: () => setEditing((v) => !v) }}>{children}</EditModeContext.Provider>;
}

export const useEditMode = () => useContext(EditModeContext);
```

- [ ] **Step 2: Write `src/components/add-widget-drawer.tsx`**

```tsx
"use client";
import { useState } from "react";
import { listClientWidgets } from "@/modules/client-registry";

export function AddWidgetDrawer({ onAdd }: { onAdd: (type: string) => void }) {
  const [open, setOpen] = useState(false);
  const types = listClientWidgets();
  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-xl bg-primary-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-600">
        + Add widget
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setOpen(false)}>
          <div className="h-full w-80 bg-card p-4 dark:bg-card-dark" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-3 text-sm font-semibold">Add a widget</h2>
            <ul className="space-y-2">
              {types.map((t) => (
                <li key={t.type}>
                  <button
                    onClick={() => { onAdd(t.type); setOpen(false); }}
                    className="w-full rounded-lg px-3 py-2 text-left text-sm ring-1 ring-border hover:bg-black/5 dark:ring-border-dark dark:hover:bg-white/10"
                  >
                    {t.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 3: Verify build compiles**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Add edit-mode context and add-widget drawer"
```

---

## Task 19: Dashboard with dnd-kit masonry

**Files:**
- Create: `src/components/dashboard.tsx`, `src/components/sortable-card.tsx`

- [ ] **Step 1: Write `src/components/sortable-card.tsx`**

```tsx
"use client";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Widget } from "@/server/config-repo";
import { WidgetCard } from "./widget-card";
import { useEditMode } from "./edit-mode";

export function SortableCard({ widget, onRemove }: { widget: Widget; onRemove: (id: string) => void }) {
  const { editing } = useEditMode();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: widget.id });
  const style = { transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <div ref={setNodeRef} style={style} className="relative">
      {editing && (
        <div className="absolute -top-2 right-2 z-10 flex gap-1">
          <button {...attributes} {...listeners} aria-label="Drag" className="cursor-grab rounded-md bg-primary-500 px-2 text-xs text-white">⠿</button>
          <button onClick={() => onRemove(widget.id)} aria-label="Remove" className="rounded-md bg-danger px-2 text-xs text-white">✕</button>
        </div>
      )}
      <WidgetCard widget={widget} />
    </div>
  );
}
```

- [ ] **Step 2: Write `src/components/dashboard.tsx`**

```tsx
"use client";
import { useState } from "react";
import { DndContext, closestCorners, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Widget } from "@/server/config-repo";
import { buildColumns, applyDragEnd, persistPositions } from "@/components/dashboard-logic";
import { SortableCard } from "./sortable-card";
import { AddWidgetDrawer } from "./add-widget-drawer";
import { EditModeProvider, useEditMode } from "./edit-mode";

function Toolbar({ onAdd }: { onAdd: (type: string) => void }) {
  const { editing, toggle } = useEditMode();
  return (
    <div className="mb-6 flex items-center justify-between">
      <h1 className="text-lg font-bold">Work Dashboard</h1>
      <div className="flex items-center gap-2">
        <button onClick={toggle} className="rounded-xl px-3 py-1.5 text-sm ring-1 ring-border dark:ring-border-dark">
          {editing ? "Done" : "Edit"}
        </button>
        <AddWidgetDrawer onAdd={onAdd} />
      </div>
    </div>
  );
}

export function Dashboard({ initialWidgets, columnCount }: { initialWidgets: Widget[]; columnCount: number }) {
  const [widgets, setWidgets] = useState(initialWidgets);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const columns = buildColumns(widgets, columnCount);

  async function onAdd(type: string) {
    const res = await fetch("/api/widgets", { method: "POST", body: JSON.stringify({ type }) });
    if (res.ok) setWidgets((w) => [...w, await res.json()]);
  }
  async function onRemove(id: string) {
    await fetch(`/api/widgets/${id}`, { method: "DELETE" });
    setWidgets((w) => w.filter((x) => x.id !== id));
  }
  function onDragEnd(e: DragEndEvent) {
    const next = applyDragEnd(widgets, columnCount, e);
    if (next) { setWidgets(next); void persistPositions(next); }
  }

  return (
    <EditModeProvider>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <Toolbar onAdd={onAdd} />
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
          <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}>
            {columns.map((col, i) => (
              <SortableContext key={i} items={col.map((w) => w.id)} strategy={verticalListSortingStrategy}>
                <div className="flex flex-col gap-4">
                  {col.map((w) => <SortableCard key={w.id} widget={w} onRemove={onRemove} />)}
                </div>
              </SortableContext>
            ))}
          </div>
        </DndContext>
      </main>
    </EditModeProvider>
  );
}
```

- [ ] **Step 3: Verify build compiles** (dashboard-logic is added and tested in Task 20; create a temporary re-export to keep the build green, replaced in Task 20)

Create `src/components/dashboard-logic.ts` with a stub to be filled by Task 20:
```ts
import type { Widget } from "@/server/config-repo";
import type { DragEndEvent } from "@dnd-kit/core";
export function buildColumns(widgets: Widget[], columnCount: number): Widget[][] {
  const cols: Widget[][] = Array.from({ length: columnCount }, () => []);
  for (const w of widgets.filter((x) => !x.hidden)) cols[Math.min(w.column, columnCount - 1)].push(w);
  cols.forEach((c) => c.sort((a, b) => a.order - b.order));
  return cols;
}
export function applyDragEnd(_w: Widget[], _c: number, _e: DragEndEvent): Widget[] | null { return null; }
export async function persistPositions(_w: Widget[]): Promise<void> {}
```

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Add dnd-kit masonry dashboard (logic stubbed)"
```

---

## Task 20: Dashboard drag logic (TDD)

**Files:**
- Modify: `src/components/dashboard-logic.ts`
- Create: `tests/components/dashboard-logic.test.ts`

- [ ] **Step 1: Write the failing test `tests/components/dashboard-logic.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { buildColumns, reorderWidgets } from "@/components/dashboard-logic";
import type { Widget } from "@/server/config-repo";

const mk = (id: string, column: number, order: number): Widget => ({
  id, type: "core.status", column, order, hidden: false, config: {}, refreshInterval: null,
});

describe("dashboard-logic", () => {
  it("builds columns sorted by order, skipping hidden", () => {
    const ws = [mk("a", 0, 1), mk("b", 0, 0), { ...mk("c", 1, 0), hidden: true }];
    const cols = buildColumns(ws, 3);
    expect(cols[0].map((w) => w.id)).toEqual(["b", "a"]);
    expect(cols[1]).toHaveLength(0);
  });

  it("reorders a widget onto another and reassigns column/order", () => {
    const ws = [mk("a", 0, 0), mk("b", 0, 1), mk("c", 1, 0)];
    const next = reorderWidgets(ws, 3, "c", "a"); // move c above a in column 0
    const map = Object.fromEntries(next.map((w) => [w.id, w]));
    expect(map.c.column).toBe(0);
    expect(map.c.order).toBe(0);
    expect(map.a.order).toBe(1);
    expect(map.b.order).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- dashboard-logic`
Expected: FAIL (`reorderWidgets` not exported).

- [ ] **Step 3: Replace `src/components/dashboard-logic.ts`**

```ts
import type { Widget } from "@/server/config-repo";
import type { DragEndEvent } from "@dnd-kit/core";
import { findColumn, moveWidget, toPositions, type Columns } from "@/lib/layout";

export function buildColumns(widgets: Widget[], columnCount: number): Widget[][] {
  const cols: Widget[][] = Array.from({ length: columnCount }, () => []);
  for (const w of widgets.filter((x) => !x.hidden)) cols[Math.min(w.column, columnCount - 1)].push(w);
  cols.forEach((c) => c.sort((a, b) => a.order - b.order));
  return cols;
}

function idColumns(widgets: Widget[], columnCount: number): Columns {
  return buildColumns(widgets, columnCount).map((c) => c.map((w) => w.id));
}

/** Move `activeId` to the position of `overId` (or empty column key `col:N`). */
export function reorderWidgets(widgets: Widget[], columnCount: number, activeId: string, overId: string): Widget[] {
  const cols = idColumns(widgets, columnCount);
  let toCol: number;
  let toIndex: number;
  if (overId.startsWith("col:")) {
    toCol = Number(overId.slice(4));
    toIndex = cols[toCol]?.length ?? 0;
  } else {
    toCol = findColumn(cols, overId);
    toIndex = cols[toCol].indexOf(overId);
  }
  if (toCol < 0) return widgets;
  const moved = moveWidget(cols, activeId, toCol, toIndex);
  const positions = toPositions(moved);
  const byId = Object.fromEntries(widgets.map((w) => [w.id, w]));
  return positions.map((p) => ({ ...byId[p.id], column: p.column, order: p.order }));
}

export function applyDragEnd(widgets: Widget[], columnCount: number, e: DragEndEvent): Widget[] | null {
  if (!e.over || e.active.id === e.over.id) return null;
  return reorderWidgets(widgets, columnCount, String(e.active.id), String(e.over.id));
}

export async function persistPositions(widgets: Widget[]): Promise<void> {
  const positions = widgets.map((w) => ({ id: w.id, column: w.column, order: w.order }));
  await fetch("/api/layout", { method: "PATCH", body: JSON.stringify({ positions }) });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- dashboard-logic`
Expected: PASS (2 tests).

- [ ] **Step 5: Verify full build + test suite**

Run: `npm run build && npm test`
Expected: build success; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Implement dashboard drag reorder logic"
```

---

## Task 21: Page — load layout, seed default, render

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Replace `src/app/page.tsx`**

```tsx
import "@/modules/server";
import { getWidgets, addWidget, getPref } from "@/server/config-repo";
import { statusDefaultConfig } from "@/modules/core/manifest";
import { Dashboard } from "@/components/dashboard";
import "@/modules/client";

export const dynamic = "force-dynamic";

export default function Page() {
  let widgets = getWidgets();
  if (widgets.length === 0) {
    addWidget("core.status", statusDefaultConfig as Record<string, unknown>);
    widgets = getWidgets();
  }
  const columnCount = Number(getPref("columnCount", "3"));
  return <Dashboard initialWidgets={widgets} columnCount={columnCount} />;
}
```

- [ ] **Step 2: Ensure client widgets register in the browser bundle**

The `import "@/modules/client"` in `page.tsx` runs on the server. To register client widgets in the browser too, add the import to `src/app/providers.tsx` (a client module):
```tsx
import "@/modules/client";
```
(Place it at the top, after "use client".)

- [ ] **Step 3: Run the app and verify end-to-end**

Run: `npm run dev`
Open http://localhost:3000. Expected:
- One "System Status" card renders with node version + time.
- Refresh (↻) updates the time.
- "Edit" reveals drag/remove handles; "+ Add widget" adds another status card.
- Drag a card to another column; reload the page — position persists.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Wire dashboard page with default seed"
```

---

## Task 22: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# Work Dashboard

Local, single-user, pluggable work dashboard.

## Develop
- `npm run dev` — start dev server
- `npm test` — run tests
- `npm run db:generate` / `npm run db:migrate` — schema migrations

## Add a module
1. Create `src/modules/<name>/manifest.ts` (types, Zod config, defaults).
2. `server.ts` — call `registerServerWidget({ type, configSchema, defaultConfig, fetch })`.
3. `widgets/*.tsx` + `client.ts` — call `registerClientWidget({ type, title, Component })`.
4. Add `import "./<name>/server"` to `src/modules/server.ts` and `import "./<name>/client"` to `src/modules/client.ts`.

Storage lives in `dashboard.db` (SQLite). Layout is the `widgets` table; cached fetch results live in `widget_cache`.
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "Add README with module authoring guide"
```

---

## Task 23: Full verification gate

- [ ] **Step 1: Lint, build, test**

Run: `npm run lint && npm run build && npm test`
Expected: all green.

- [ ] **Step 2: Manual smoke** (from Task 21 Step 3) — confirm add / remove / drag-persist / refresh all work.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "Verification fixes"
```

---

## Task 24: Design pass with impeccable

**Files:** `src/app/globals.css`, `src/components/*.tsx` (visual only).

- [ ] **Step 1: Invoke the impeccable skill** and apply its guidance to the dashboard shell: spacing rhythm, card elevation, header hierarchy, refresh/edit affordances, empty/error state polish, dark-mode contrast. Keep structure and props unchanged — visual classes only.

- [ ] **Step 2: Re-run the verification gate**

Run: `npm run build && npm test`
Expected: all green (no structural changes, so tests still pass).

- [ ] **Step 3: Manual visual check** at http://localhost:3000 in light and dark.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Polish dashboard visuals (impeccable pass)"
```

---

## Self-Review Notes

- **Spec coverage:** modular module system (Tasks 7, 11, 12, 22), server/client split (7, 11, 12), SQLite config+cache split (5, 8, 9), cache-first data flow with refresh (10, 14, 17), masonry + drag rearrange (19, 20), hide/remove + add (13, 18, 19), error/loading/empty states (16), testing across unit/integration/component (6–20), Tailwind v4 + dark (4), design via impeccable (24). GitHub module and per-widget config UI are intentionally deferred to Plan 2.
- **Deferred to Plan 2:** CLI runner + error classification, `gh` integration and its widgets, the widget action endpoint (`POST /api/widgets/[id]/action`), per-widget configure UI, bookmarks/links widget.
- **Type consistency:** `Widget` (config-repo), `CacheRow`/`CacheInput` (cache-repo), `ServerWidget`/`ClientWidget`/`WidgetBodyProps` (contracts), `Columns`/`moveWidget`/`toPositions` (lib/layout) are used consistently across tasks. Route handler `params` typed as `Promise<{id}>` per Next 15.
