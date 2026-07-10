# Tauri Rebuild — Plan 2: Async DB Seam (sqlite-proxy)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route Drizzle through the `drizzle-orm/sqlite-proxy` driver (transport still backed by `better-sqlite3`), making every repo function `async`, converting the two `db.transaction()` calls to `db.batch()`, and updating all server-side callers — with the app still on Next.js and the full suite green.

**Architecture:** The dashboard's DB access goes through a single `getDb()`. Today it returns a synchronous `better-sqlite3` Drizzle instance. This plan swaps it for the `sqlite-proxy` async driver whose transport callback executes SQL against `better-sqlite3` (using `.raw()` so rows come back as column-ordered arrays, which is exactly what the proxy contract expects). A batch callback wraps `better-sqlite3`'s `.transaction()` to preserve atomicity for multi-statement writes. This proxy callback is the **permanent seam**: Plan 3 (Tauri cutover) swaps only its body to call `tauri-plugin-sql`, changing nothing above it. Because the proxy driver is async, `cache-repo` and `config-repo` become `async`, rippling `await` into `widget-service`, `integration-service`, the six API routes, and the two RSC pages. React components are unaffected (they import only `type { Widget }` and the render registry).

**Tech Stack:** TypeScript, Drizzle ORM `0.45.2` (`drizzle-orm/sqlite-proxy`), `better-sqlite3` (now used only as the proxy transport + as the test DB), Next.js App Router, Vitest.

**Prerequisite:** Plan 1 (fetch/render rename) is merged/committed. Baseline: **46 files / 204 tests passing**.

**Known risk — proxy return shape:** The exact `{ rows }` shape the `sqlite-proxy` callback must return (especially for `method === "get"` on a miss) is version-specific and easy to get subtly wrong. This plan pins a strong candidate implementation **and** adds a dedicated adapter test plus relies on the existing repo tests as the oracle. If a repo test like cache-repo's "returns undefined for a miss" fails, the adapter shape is the thing to iterate on — do NOT weaken the test.

---

## File structure

| File | Change |
|---|---|
| `src/db/client.ts` | Rewrite: `sqlite-proxy` driver + row adapter + batch callback + param binder. `getDb()` stays synchronous (returns the proxy db); queries become async. `__resetDbForTests` kept. |
| `src/server/cache-repo.ts` | `get`/`set` become `async` (return `Promise<…>`). |
| `src/server/config-repo.ts` | All functions become `async`; `setPositions` uses `db.batch()`; `getPref`/`getIntegrationOverride` awaited internally. |
| `src/server/widget-service.ts` | `await` the now-async `getWidget` and `cache.get/set`. |
| `src/server/integration-service.ts` | `typesForIntegration` stays sync (registry is sync) but `widgetCountForIntegration` becomes async (`getWidgets`); `getIntegrationStatuses` awaits; `enableIntegration`/`disableIntegration` become async; `disableIntegration` transaction → `db.batch()`. |
| `src/app/api/**` (6 route files) | `await` repo/service calls. |
| `src/app/page.tsx` | `await getWidgets()`/`addWidget()` (already allowed — async RSC). |
| `src/app/integrations/page.tsx` | already `await`s `getIntegrationStatuses()`; no change beyond it staying valid. |
| `tests/db/proxy-adapter.test.ts` | **New:** drives `getDb()` directly to pin the adapter round-trip + get-miss behavior. |
| `tests/server/cache-repo.test.ts`, `tests/server/config-repo.test.ts`, `tests/server/widget-service.test.ts`, `tests/server/integration-service.test.ts` | Add `await` to repo/service calls. |
| `tests/api/*.test.ts` | Add `await` where they call repos/services directly (if any). |
| `tests/helpers/db.ts` | Unchanged — still migrates a fresh `better-sqlite3` file; the proxy transport reads the same file. |

`better-sqlite3` remains a **runtime** dependency in Plan 2 (it is the proxy transport). Plan 3 moves it to test-only.

---

## Task 1: Rewrite `getDb()` as the sqlite-proxy seam + pin it with an adapter test

**Files:**
- Modify: `src/db/client.ts`
- Test: `tests/db/proxy-adapter.test.ts` (create)

This task is intentionally first and isolated to the adapter so its shape is nailed before the async ripple. Note `tsc` across the whole project will be RED until Task 2 converts the repos (they still have sync signatures) — that is expected; Task 1's checkpoint is its own adapter test passing, not full-project typecheck.

- [ ] **Step 1: Write the failing adapter test**

Create `tests/db/proxy-adapter.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { useTempDb } from "../helpers/db";
import { getDb, schema } from "@/db/client";

beforeEach(() => useTempDb());

describe("sqlite-proxy adapter", () => {
  it("round-trips a row through insert + select().all()", async () => {
    await getDb().insert(schema.prefs).values({ key: "k", value: "v" });
    const rows = await getDb().select().from(schema.prefs);
    expect(rows).toEqual([{ key: "k", value: "v" }]);
  });

  it("select().get() returns the row on a hit", async () => {
    await getDb().insert(schema.prefs).values({ key: "k", value: "v" });
    const row = await getDb().select().from(schema.prefs).where(eq(schema.prefs.key, "k")).get();
    expect(row).toEqual({ key: "k", value: "v" });
  });

  it("select().get() returns undefined on a miss", async () => {
    const row = await getDb().select().from(schema.prefs).where(eq(schema.prefs.key, "nope")).get();
    expect(row).toBeUndefined();
  });

  it("decodes json columns and boolean columns", async () => {
    await getDb().insert(schema.widgets).values({
      id: "w1", type: "core.status", title: null, order: 0, colSpan: 1, rowSpan: 6,
      hidden: true, config: { a: 1 },
    });
    const row = await getDb().select().from(schema.widgets).where(eq(schema.widgets.id, "w1")).get();
    expect(row!.hidden).toBe(true);
    expect(row!.config).toEqual({ a: 1 });
  });

  it("batch() runs multiple writes atomically", async () => {
    const db = getDb();
    await db.batch([
      db.insert(schema.prefs).values({ key: "a", value: "1" }),
      db.insert(schema.prefs).values({ key: "b", value: "2" }),
    ]);
    const rows = await db.select().from(schema.prefs);
    expect(rows).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/db/proxy-adapter.test.ts`
Expected: FAIL — the current `getDb()` returns a synchronous `better-sqlite3` Drizzle instance that has no `.batch()` and whose `.get()` is not a promise, so the awaited/`batch` calls error.

- [ ] **Step 3: Rewrite `src/db/client.ts` to the sqlite-proxy driver**

Replace the entire file with:

```ts
import "server-only";
import Database from "better-sqlite3";
import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import * as schema from "./schema";

let db: SqliteRemoteDatabase<typeof schema> | null = null;

/**
 * better-sqlite3 binds only numbers, strings, bigints, buffers, and null.
 * The proxy hands params through raw, so coerce JS booleans → 0/1 and
 * undefined → null defensively. (Drizzle usually pre-encodes these, but this
 * keeps the transport robust and is the single place that touches raw params.)
 */
function bind(params: unknown[]): unknown[] {
  return params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p === undefined ? null : p));
}

/**
 * Execute one statement against better-sqlite3, returning rows as
 * column-ordered arrays — the shape drizzle's sqlite-proxy expects.
 * For "get" misses, return { rows: [] } so drizzle maps it to undefined.
 */
function exec(sqlite: Database.Database, sql: string, params: unknown[], method: string): { rows: unknown[] } {
  const stmt = sqlite.prepare(sql);
  if (method === "run") {
    stmt.run(...bind(params));
    return { rows: [] };
  }
  if (method === "get") {
    const row = stmt.raw().get(...bind(params)) as unknown[] | undefined;
    return { rows: row ?? [] };
  }
  // "all" | "values"
  return { rows: stmt.raw().all(...bind(params)) as unknown[] };
}

export function getDb(): SqliteRemoteDatabase<typeof schema> {
  if (!db) {
    const path = process.env.DASHBOARD_DB ?? "dashboard.db";
    const sqlite = new Database(path);
    sqlite.pragma("journal_mode = WAL");

    db = drizzle(
      async (sql, params, method) => exec(sqlite, sql, params, method),
      async (queries) => {
        const runAll = sqlite.transaction(
          (qs: { sql: string; params: unknown[]; method: string }[]) =>
            qs.map((q) => exec(sqlite, q.sql, q.params, q.method)),
        );
        return runAll(queries);
      },
      { schema },
    );
  }
  return db;
}

// Test helper: point at a fresh db and reset the singleton.
export function __resetDbForTests() {
  db = null;
}

export { schema };
```

- [ ] **Step 4: Run the adapter test until green**

Run: `npx vitest run tests/db/proxy-adapter.test.ts`
Expected: PASS (all 5 cases).

If "returns undefined on a miss" fails (drizzle maps `{ rows: [] }` differently in this version), adjust ONLY the `get` branch of `exec` — the correct shapes to try, in order: `return { rows: row ?? [] }` (candidate), then `return { rows: row === undefined ? [] : row }`. Do not change the test. If the json/boolean case fails, confirm `{ schema }` is passed to `drizzle(...)` (drizzle needs the schema to decode column types on read).

- [ ] **Step 5: Commit**

```bash
git add src/db/client.ts tests/db/proxy-adapter.test.ts
git commit -m "feat: route Drizzle through sqlite-proxy driver (better-sqlite3 transport)"
```

---

## Task 2: Make the repos async and ripple `await` through server callers

**Files:**
- Modify: `src/server/cache-repo.ts`
- Modify: `src/server/config-repo.ts`
- Modify: `src/server/widget-service.ts`
- Modify: `src/server/integration-service.ts`
- Modify: `src/app/api/widgets/route.ts`, `src/app/api/widgets/[id]/route.ts`, `src/app/api/widgets/[id]/data/route.ts`, `src/app/api/layout/route.ts`, `src/app/api/integrations/route.ts`, `src/app/api/integrations/[id]/toggle/route.ts`
- Modify: `src/app/page.tsx`
- Modify tests: `tests/server/cache-repo.test.ts`, `tests/server/config-repo.test.ts`, `tests/server/widget-service.test.ts`, `tests/server/integration-service.test.ts`, and any `tests/api/*.test.ts` that call repos/services directly

This is one atomic change — the shared `getDb()` is now async, so every query site converts together. Work through the steps, then verify with tsc + full suite at the end.

- [ ] **Step 1: `cache-repo.ts` — make `get`/`set` async**

Replace the two function signatures/bodies:

```ts
export async function get(widgetId: string): Promise<CacheRow | undefined> {
  return getDb().select().from(widgetCache).where(eq(widgetCache.widgetId, widgetId)).get();
}

export async function set(widgetId: string, input: CacheInput): Promise<CacheRow> {
  const row: CacheRow = {
    widgetId,
    payload: input.payload,
    fetchedAt: Date.now(),
    status: input.status,
    error: input.error,
    errorKind: input.errorKind ?? null,
  };
  await getDb().insert(widgetCache).values(row)
    .onConflictDoUpdate({
      target: widgetCache.widgetId,
      set: { payload: row.payload, fetchedAt: row.fetchedAt, status: row.status, error: row.error, errorKind: row.errorKind },
    });
  return row;
}
```

- [ ] **Step 2: `config-repo.ts` — make every function async; convert `setPositions` to `db.batch()`**

Rewrite the function bodies (imports unchanged except adding `BatchItem` type import):

```ts
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
  const stmts = positions.map((p) =>
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
```

> If `drizzle-orm/batch` is not the correct import path for `BatchItem` in `0.45.2`, import it from `drizzle-orm` instead (`import type { BatchItem } from "drizzle-orm";`). Verify with `npx tsc --noEmit` in Step 8; use whichever resolves.

- [ ] **Step 3: `widget-service.ts` — await the now-async repo calls**

Update the three call sites:

```ts
export async function getWidgetData(widgetId: string, refresh: boolean): Promise<cache.CacheRow> {
  const widget = await getWidget(widgetId);
  if (!widget) throw new NotFoundError(`Widget not found: ${widgetId}`);

  if (!refresh) {
    const cached = await cache.get(widgetId);
    if (cached) return cached;
  }

  const def = getFetchWidget(widget.type);
  const prev = await cache.get(widgetId);

  if (!def) {
    return cache.set(widgetId, {
      status: "error", payload: prev?.payload ?? null, error: `Unknown widget type: ${widget.type}`, errorKind: "failed",
    });
  }

  try {
    const payload = await def.fetch(widget.config);
    return cache.set(widgetId, { status: "ok", payload, error: null, errorKind: null });
  } catch (err) {
    return cache.set(widgetId, {
      status: "error",
      payload: prev?.payload ?? null,
      error: err instanceof Error ? err.message : String(err),
      errorKind: err instanceof CliError ? err.kind : "failed",
    });
  }
}
```

(The two `return cache.set(...)` lines already return the promise the function's `Promise<CacheRow>` expects — no `await` needed there.)

- [ ] **Step 4: `integration-service.ts` — await config-repo; convert `disableIntegration` transaction to batch**

`typesForIntegration` stays synchronous (the registry `listRenderWidgets()` is sync). `widgetCountForIntegration` must await `getWidgets()`. Update:

```ts
import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { widgets, prefs } from "@/db/schema";
import { listIntegrations, getIntegration } from "@/modules/integration-registry";
import { listRenderWidgets } from "@/modules/render-registry";
import { getWidgets, getIntegrationOverride, setIntegrationOverride } from "./config-repo";
import type { IntegrationHealth, IntegrationStatus } from "@/modules/integration-contracts";
```

Change these functions:

```ts
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
  await db.batch([
    ...victims.map((w) => db.delete(widgets).where(eq(widgets.id, w.id))),
    db.insert(prefs).values({ key, value: "false" }).onConflictDoUpdate({ target: prefs.key, set: { value: "false" } }),
  ] as [import("drizzle-orm/batch").BatchItem<"sqlite">, ...import("drizzle-orm/batch").BatchItem<"sqlite">[]]);
  return { deleted: victims.length };
}
```

> `disableIntegration` no longer calls the `removeWidget`/`setIntegrationOverride` repo wrappers — it inlines the equivalent statements into one atomic `db.batch()` (the batch array is always non-empty because it always includes the pref upsert). Remove the now-unused `removeWidget`/`setIntegrationOverride` from the import if nothing else in the file uses them (verify: `setIntegrationOverride` is still used by `enableIntegration`, so keep it; `removeWidget` is no longer used here — drop it from the import). Adjust the import line accordingly.

- [ ] **Step 5: Await in the six API route files**

Each route calls repo/service functions that are now async. Add `await`:

- `src/app/api/widgets/route.ts`: `const widget = await addWidget(type, def.defaultConfig as Record<string, unknown>);`
- `src/app/api/widgets/[id]/route.ts`: `const widget = await getWidget(id);` (top of PATCH); `if (typeof body.hidden === "boolean") await setHidden(id, body.hidden);`; `if (body.title !== undefined) await setTitle(id, body.title);`; `await setConfig(id, ...);`; `const fresh = await getWidget(id);`; and in DELETE: `await removeWidget(id);`
- `src/app/api/widgets/[id]/data/route.ts`: unchanged — it already `await`s `getWidgetData(...)`.
- `src/app/api/layout/route.ts`: GET → `widgets: await getWidgets()` and `theme: await getPref("theme", "dark")` (await both inside the object; build them into locals first for clarity):
  ```ts
  export async function GET() {
    const [widgetRows, theme] = await Promise.all([getWidgets(), getPref("theme", "dark")]);
    return NextResponse.json({ widgets: widgetRows, prefs: { theme } });
  }
  ```
  PATCH → `await setPositions(body.positions);`
- `src/app/api/integrations/route.ts`: unchanged — already `await`s `getIntegrationStatuses(recheck)`.
- `src/app/api/integrations/[id]/toggle/route.ts`: `await enableIntegration(id);`; `await disableIntegration(id, deleteWidgets);` (inside the try); the trailing `getIntegrationStatuses(true)` is already awaited.

- [ ] **Step 6: `src/app/page.tsx` — await the async repo calls**

```tsx
export default async function Page() {
  let widgets = await getWidgets();
  if (widgets.length === 0) {
    await addWidget("core.status", statusDefaultConfig as Record<string, unknown>);
    widgets = await getWidgets();
  }
  return <Dashboard initialWidgets={widgets} />;
}
```

- [ ] **Step 7: Update tests to await repo/service calls**

In `tests/server/cache-repo.test.ts`, `tests/server/config-repo.test.ts`, `tests/server/widget-service.test.ts`, `tests/server/integration-service.test.ts`, and any `tests/api/*.test.ts` that call repos/services directly: make each `it(...)` callback `async` and add `await` to every `repo.*`/`cache.*`/service call and to any expression that reads their result. Example (cache-repo):

```ts
it("upserts and reads back a payload with a timestamp", async () => {
  const row = await cache.set("w1", { status: "ok", payload: { n: 1 }, error: null });
  expect(row.status).toBe("ok");
  expect(row.payload).toEqual({ n: 1 });
  expect(row.fetchedAt).toBeGreaterThan(0);
  expect((await cache.get("w1"))!.payload).toEqual({ n: 1 });
});
```

Apply the same mechanical `async`/`await` conversion everywhere a now-async function is called. Do NOT change any assertion values or test intent.

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. If `BatchItem` import path is wrong, switch it per the note in Task 2 Step 2 and re-run.

- [ ] **Step 9: Full suite**

Run: `npm test`
Expected: PASS. Count is now **47 files / 209 tests** (46+1 new file from Task 1's adapter test = 47 files; 204+5 new adapter cases = 209). Confirm no pre-existing test was dropped or its assertions weakened.

- [ ] **Step 10: Lint + build**

Run: `npm run lint` → no errors.
Run: `npm run build` → succeeds (async RSC `page.tsx` compiles).

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "refactor: make DB repos async over the sqlite-proxy seam"
```

---

## Task 3: Update `CONTEXT.md`/`CLAUDE.md` to note the async seam

**Files:**
- Modify: `CONTEXT.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Note the seam in `CLAUDE.md` gotchas**

Add one bullet under "Gotchas / patterns (code-verified):" in `CLAUDE.md`:

> - DB access goes through `getDb()` (`src/db/client.ts`), which uses Drizzle's `sqlite-proxy` async driver over a `better-sqlite3` transport. **All repo functions (`cache-repo`, `config-repo`) are async** — `await` them. Multi-statement atomic writes use `db.batch([...])`, not `db.transaction()` (the async proxy driver does not support interactive transactions). This proxy callback is the seam the Tauri build swaps to `tauri-plugin-sql`.

- [ ] **Step 2: Note it in `CONTEXT.md`**

Add/adjust the glossary entry for the DB/repo layer to state the repos are async and that `getDb()` is the sqlite-proxy seam. Keep wording consistent with the existing glossary style.

- [ ] **Step 3: Suite still green (docs-only)**

Run: `npm test`
Expected: PASS, 47 files / 209 tests.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md CONTEXT.md
git commit -m "docs: note async sqlite-proxy DB seam"
```

---

## Self-review checklist

- **Spec coverage:** Implements the spec's "DB location, migrations, async ripple" and "Drizzle over the sql plugin" sections at the seam level (transport is still better-sqlite3; Plan 3 swaps it to tauri-plugin-sql and handles migrations + app-data path). The transaction→batch conversion (both `setPositions` and `disableIntegration`) is covered. Async ripple to all six routes + `page.tsx` + services is enumerated. Components correctly untouched (type-only imports).
- **Placeholder scan:** No TBDs. Every code step shows full replacement code. The two version-sensitive spots (proxy `get`-miss shape; `BatchItem` import path) have explicit fallback instructions rather than being left vague.
- **Type consistency:** `getDb()` returns `SqliteRemoteDatabase<typeof schema>` in Task 1 and is consumed as async everywhere in Task 2. Repo return types are `Promise<…>` and every caller awaits. `CacheRow`/`Widget` types are unchanged (`$inferSelect`), so component `type` imports remain valid.

## Out of scope (Plan 3 — Tauri cutover)

- Swapping the proxy transport from `better-sqlite3` to `tauri-plugin-sql`; migrations via the plugin runner; app-data DB path.
- Removing `import "server-only"`; deleting the API routes + RSC; SPA entry (`main.tsx`/`index.html`); calling `getWidgetData` directly from `use-widget-data.ts`.
- `cli.ts` → shell plugin + login-shell PATH probe; `src-tauri` config; tray/autostart; moving `better-sqlite3` to a test-only dependency.
