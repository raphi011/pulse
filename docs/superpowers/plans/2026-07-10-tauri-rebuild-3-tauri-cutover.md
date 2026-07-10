# Tauri Rebuild — Plan 3: Tauri Cutover

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **This plan will be executed in a fresh conversation — it is written to stand alone.**

**Goal:** Turn the Next.js dashboard into a native Tauri desktop app: a Vite + React SPA in the webview, SQLite via `tauri-plugin-sql`, CLIs via `tauri-plugin-shell`, the HTTP/API layer deleted, and a distributable `.app` that launches and works.

**Architecture:** All non-UI TypeScript (module `fetch()`/parse, Zod, Drizzle queries, cache/config repos, `widget-service`, `integration-service`) runs **in the webview**. Two OS-touching edges call thin Tauri plugins: `getDb()`'s transport calls `tauri-plugin-sql`; `cli.ts` calls `tauri-plugin-shell`. The Rust core (`src-tauri/`) is declarative config: window, tray, autostart, SQL migrations, and the shell allowlist. The six Next API routes and RSC pages are deleted; React calls `widget-service`/`integration-service` **directly** (still wrapped by TanStack Query, so cache-first UX is unchanged).

**Tech Stack:** Tauri v2 (`@tauri-apps/cli` ~2.x, `tauri` 2.11), `@tauri-apps/plugin-sql`, `@tauri-apps/plugin-shell`, `@tauri-apps/plugin-autostart`, Vite 6 + `@vitejs/plugin-react`, React 19, Drizzle `sqlite-proxy` (transport swapped to the SQL plugin; `better-sqlite3` kept only for tests), Tailwind v4, Vitest.

**Prerequisites:** Plans 1 (fetch/render rename) and 2 (async sqlite-proxy seam) are done. Rust toolchain is installed (`~/.cargo`). Baseline: **47 files / 209 tests passing**. Feasibility on the corporate laptop was verified (unsigned local builds run).

**How this plan verifies:** Vitest runs in Node with mocks and stays the per-task guardrail (**must stay green**). The *running app* can only be exercised after the DB (Task 5) and CLI (Task 6) edges are ported and `server-only` is removed (Task 7) — so the `tauri dev`/`tauri build` launch smoke test is **Task 9**. Intermediate tasks verify with `npm test` + `npx tsc --noEmit`; `cargo check` verifies Rust.

**Version-sensitivity note:** Tauri v2 config/permission schemas and plugin APIs have version-specific details. Where a step gives Tauri config or a plugin call, it is a **strong candidate** — if the installed plugin version rejects it, load that plugin's docs (`v2.tauri.app/plugin/<name>`) and adjust. The running app is the oracle. Do NOT invent APIs; verify against installed `node_modules`/`Cargo` versions.

---

## File structure (created/changed by this plan)

```
index.html                       (new — Vite entry HTML)
vite.config.ts                   (new — Vite + React, port 1420, better-sqlite3 external)
src/main.tsx                     (new — SPA bootstrap: providers + router)
src/app-root.tsx                 (new — hash router: dashboard + integrations views)
src/lib/dashboard-data.ts        (new — client data layer; mirrors the deleted routes' logic)
src/components/app-link.tsx      (new — next/link replacement, hash hrefs)
src/db/client.ts                 (rewrite — env-detected transport: Tauri SQL plugin vs better-sqlite3)
src/server/cli.ts                (rewrite — shell-plugin spawn + pure classifiers + PATH)
src-tauri/                       (new — Rust crate)
  Cargo.toml
  tauri.conf.json
  build.rs
  src/lib.rs                     (plugins, migrations, tray, window)
  src/main.rs
  capabilities/default.json      (core + sql + shell allowlist + autostart)
  icons/                         (generated)
src/app/**                       (DELETED — layout, page, providers, api routes)
src/components/dashboard.tsx, integrations-panel.tsx, use-widget-data.ts, ... (fetch → data layer)
package.json                     (scripts → tauri/vite; deps moved; plugins added)
eslint.config.*                  (drop eslint-config-next → minimal flat config)
tests/…                          (cli.test.ts reworked; server-only stub/alias removed)
```

`"use client"` directives (20 files) are inert under Vite (plain string statements) — **leave them**, do not churn.

---

## Task 1: Add Vite + Tauri tooling and the `src-tauri` crate

**Files:** `package.json`, `vite.config.ts` (new), `index.html` (new), `src-tauri/**` (new), `tsconfig.json` (adjust if needed).

- [ ] **Step 1: Install frontend build + plugin deps**

```bash
npm install -D vite @vitejs/plugin-react-swc @tauri-apps/cli@^2
npm install @tauri-apps/api@^2 @tauri-apps/plugin-sql@^2 @tauri-apps/plugin-shell@^2 @tauri-apps/plugin-autostart@^2
```
(`@vitejs/plugin-react` is already a devDep from Vitest; installing `-swc` is optional — if you prefer, reuse the existing `@vitejs/plugin-react` and skip the swc variant. Pick one and use it consistently in `vite.config.ts`.)

- [ ] **Step 2: Create `index.html` at repo root**

```html
<!doctype html>
<html lang="en" class="dark h-full">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Pulse</title>
  </head>
  <body class="min-h-full flex flex-col">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Create `vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  resolve: { alias: { "@": resolve(__dirname, "./src") } },
  build: {
    outDir: "dist",
    // better-sqlite3 is only used by the test transport + drizzle-kit; never bundle it for the webview.
    rollupOptions: { external: ["better-sqlite3"] },
  },
});
```

> If you installed `@vitejs/plugin-react-swc`, import from that package instead. Tailwind v4 is applied via `globals.css` `@import "tailwindcss"` + the PostCSS plugin — ensure `postcss.config.*` exists (it does for the Next build) so Vite picks it up; if Tailwind classes don't apply in `tauri dev`, add `@tailwindcss/postcss` to a `postcss.config.mjs`.

- [ ] **Step 4: Scaffold the Rust crate with the Tauri CLI**

```bash
npx tauri init --app-name Pulse --window-title Pulse --frontend-dist ../dist --dev-url http://localhost:1420 --before-dev-command "" --before-build-command "" --ci
```
This creates `src-tauri/` (Cargo.toml, tauri.conf.json, src/main.rs, src/lib.rs, build.rs, icons). If `npx tauri` isn't found, use `npm run tauri -- init …` after adding a `"tauri": "tauri"` script, or `cargo install tauri-cli` and `cargo tauri init`.

- [ ] **Step 5: Add the Cargo plugin deps**

In `src-tauri/Cargo.toml`, under `[dependencies]`, add:
```toml
tauri-plugin-sql = { version = "2", features = ["sqlite"] }
tauri-plugin-shell = "2"
tauri-plugin-autostart = "2"
```
Run `cd src-tauri && cargo fetch` (or let the first build resolve them).

- [ ] **Step 6: Set `src-tauri/tauri.conf.json`**

Ensure these fields (merge into the generated file; keep generated `bundle`/`icons`):
```json
{
  "productName": "Pulse",
  "identifier": "com.pulse.dashboard",
  "build": {
    "beforeDevCommand": "npm run dev:vite",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm run build:vite",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [{ "title": "Pulse", "width": 1280, "height": 860, "minWidth": 720, "minHeight": 480 }],
    "security": { "csp": null }
  }
}
```

- [ ] **Step 7: Add package.json scripts (do not remove `test`/`db:generate`)**

Replace the `scripts` block's `dev`/`build`/`start` with:
```json
"dev": "tauri dev",
"dev:vite": "vite",
"build": "tauri build",
"build:vite": "vite build",
"tauri": "tauri",
"lint": "eslint",
"test": "vitest run",
"test:watch": "vitest",
"db:generate": "drizzle-kit generate"
```
(Drop `next dev`/`next build`/`next start` and `db:migrate` — migrations run via the SQL plugin now, see Task 5.)

- [ ] **Step 8: Verify tooling resolves**

Run: `cd src-tauri && cargo check` → compiles (generated app). Then `cd .. && npx vite build` will FAIL until `src/main.tsx` exists (Task 3) — that's expected here; only confirm `cargo check` passes and `npx tauri --version` works.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "chore: add Vite + Tauri tooling and src-tauri crate"
```

---

## Task 2: Client data layer (`src/lib/dashboard-data.ts`) mirroring the API routes

Preserve the deleted routes' logic (validation, ConfirmRequired, echo shapes) in one client module the components call, so Task 3 can delete the routes without losing behavior.

**Files:** Create `src/lib/dashboard-data.ts`; Test: create `tests/lib/dashboard-data.test.ts`.

- [ ] **Step 1: Write the module**

```ts
import { getFetchWidget } from "@/modules/fetch-registry";
import {
  addWidget as repoAddWidget, getWidget, getWidgets, getPref,
  setHidden, setConfig, setTitle, removeWidget, setPositions,
  type Widget,
} from "@/server/config-repo";
import { getWidgetData } from "@/server/widget-service";
import {
  getIntegrationStatuses, enableIntegration, disableIntegration, ConfirmRequiredError,
} from "@/server/integration-service";
import type { CacheRow } from "@/server/cache-repo";
import type { IntegrationStatus } from "@/modules/integration-contracts";

export type LayoutSnapshot = { widgets: Widget[]; prefs: { theme: string } };

export async function fetchLayout(): Promise<LayoutSnapshot> {
  const [widgets, theme] = await Promise.all([getWidgets(), getPref("theme", "dark")]);
  return { widgets, prefs: { theme } };
}

export async function fetchWidgetData(id: string, refresh: boolean): Promise<CacheRow> {
  return getWidgetData(id, refresh);
}

export async function createWidget(type: string): Promise<Widget> {
  const def = getFetchWidget(type);
  if (!def) throw new Error(`Unknown widget type: ${type}`);
  return repoAddWidget(type, def.defaultConfig as Record<string, unknown>);
}

export type WidgetPatch = { hidden?: boolean; config?: Record<string, unknown>; title?: string | null };

/** Mirrors PATCH /api/widgets/:id — validates config against the schema, echoes stored config+title. */
export async function updateWidget(id: string, patch: WidgetPatch): Promise<{ config?: unknown; title: string | null }> {
  const widget = await getWidget(id);
  if (!widget) throw new Error("Not found");
  if (typeof patch.hidden === "boolean") await setHidden(id, patch.hidden);
  if (patch.title !== undefined) await setTitle(id, patch.title);
  if (patch.config !== undefined) {
    const def = getFetchWidget(widget.type);
    const parsed = def?.configSchema.safeParse(patch.config);
    if (def && parsed && !parsed.success) throw new Error("Invalid config");
    await setConfig(id, (parsed?.success ? parsed.data : patch.config) as Record<string, unknown>);
  }
  const fresh = await getWidget(id);
  return { config: fresh?.config, title: fresh?.title ?? null };
}

export async function deleteWidget(id: string): Promise<void> {
  await removeWidget(id);
}

export async function savePositions(
  positions: { id: string; order: number; colSpan: number; rowSpan: number }[],
): Promise<void> {
  await setPositions(positions);
}

export async function fetchIntegrations(recheck = false): Promise<IntegrationStatus[]> {
  return getIntegrationStatuses(recheck);
}

/** Returns { deleted } on success, or { confirmRequired, widgetCount } when disabling would delete widgets. */
export async function toggleIntegration(
  id: string, enabled: boolean, deleteWidgets = false,
): Promise<{ statuses: IntegrationStatus[]; confirmRequired?: number }> {
  if (enabled) {
    await enableIntegration(id);
  } else {
    try {
      await disableIntegration(id, deleteWidgets);
    } catch (err) {
      if (err instanceof ConfirmRequiredError) {
        return { statuses: await getIntegrationStatuses(true), confirmRequired: err.widgetCount };
      }
      throw err;
    }
  }
  return { statuses: await getIntegrationStatuses(true) };
}
```

- [ ] **Step 2: Test it against the real repos (better-sqlite3 transport, no Tauri)**

Create `tests/lib/dashboard-data.test.ts`. Use `useTempDb()` and register modules first. Cover: `createWidget` → appears in `fetchLayout().widgets`; `updateWidget` hidden/title/config round-trip + invalid config throws; `deleteWidget`; `savePositions`; `toggleIntegration` disable-with-widgets returns `confirmRequired`. Example skeleton (fill all cases):

```ts
import { describe, it, expect, beforeEach } from "vitest";
import "@/modules/fetch";
import "@/modules/render";
import "@/modules/integrations";
import { useTempDb } from "../helpers/db";
import * as data from "@/lib/dashboard-data";

beforeEach(() => useTempDb());

describe("dashboard-data", () => {
  it("creates a widget and lists it", async () => {
    const w = await data.createWidget("core.status");
    const layout = await data.fetchLayout();
    expect(layout.widgets.map((x) => x.id)).toContain(w.id);
    expect(layout.prefs.theme).toBe("dark");
  });

  it("updates title and rejects invalid config", async () => {
    const w = await data.createWidget("core.status");
    const res = await data.updateWidget(w.id, { title: "Hi" });
    expect(res.title).toBe("Hi");
    // If core.status has a strict schema, assert invalid config throws; otherwise assert a valid config round-trips.
  });

  // ... deleteWidget, savePositions, toggleIntegration confirm-required cases
});
```
Run: `npx vitest run tests/lib/dashboard-data.test.ts` → PASS.

- [ ] **Step 3: Full suite + commit**

Run: `npm test` → all green (count rises by the new file). Then:
```bash
git add src/lib/dashboard-data.ts tests/lib/dashboard-data.test.ts
git commit -m "feat: client data layer mirroring the dashboard API routes"
```

---

## Task 3: SPA shell + routing; point components at the data layer; delete `src/app`

**Files:** Create `src/main.tsx`, `src/app-root.tsx`, `src/components/app-link.tsx`; modify `src/components/dashboard.tsx`, `src/components/integrations-panel.tsx`, `src/components/use-widget-data.ts`, and any component doing `fetch("/api/…")`; delete `src/app/**`.

- [ ] **Step 1: Find every `/api/` call site**

Run: `rg -n 'fetch\(`?["'"'"']/api|/api/' src/components src/modules`
Build the exact list. Replace each per this mapping (all now `await` a `dashboard-data` function; wrap in try/catch where the old code checked `res.ok`):

| Old fetch | New call (`import … from "@/lib/dashboard-data"`) |
|---|---|
| `GET /api/layout` | `fetchLayout()` |
| `PATCH /api/layout {positions}` | `savePositions(positions)` |
| `GET /api/widgets/:id/data?refresh=1` | `fetchWidgetData(id, refresh)` |
| `POST /api/widgets {type}` | `createWidget(type)` |
| `PATCH /api/widgets/:id {…}` | `updateWidget(id, patch)` (returns `{config,title}`) |
| `DELETE /api/widgets/:id` | `deleteWidget(id)` |
| `GET /api/integrations?recheck=1` | `fetchIntegrations(recheck)` |
| `POST /api/integrations/:id/toggle {enabled,deleteWidgets}` | `toggleIntegration(id, enabled, deleteWidgets)` → check `.confirmRequired` |

Note: the old 409 "confirm-required" flow is now `toggleIntegration(...)` returning `{ confirmRequired }`; adapt the integrations-panel handler to read that field instead of a 409 status.

- [ ] **Step 2: `src/components/use-widget-data.ts` — call the data layer directly**

Replace the `fetchData` helper:
```ts
import { fetchWidgetData } from "@/lib/dashboard-data";
// ...
async function fetchData(id: string, refresh: boolean): Promise<CacheRow> {
  return fetchWidgetData(id, refresh);
}
```
Everything else (TanStack Query, auto-refresh, toast) is unchanged.

- [ ] **Step 3: `app-link.tsx` — replace `next/link`**

```tsx
import type { AnchorHTMLAttributes, ReactNode } from "react";
export function AppLink({ href, children, ...rest }: { href: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a href={`#${href}`} {...rest}>{children}</a>;
}
```
In `dashboard.tsx` and `integrations-panel.tsx`, change `import Link from "next/link"` → `import { AppLink as Link } from "@/components/app-link"` (keeps the JSX `<Link href="/…">` usages unchanged).

- [ ] **Step 4: `src/app-root.tsx` — hash router + providers**

```tsx
import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/modules/fetch";
import "@/modules/render";
import "@/modules/integrations";
import { AutoRefreshProvider } from "@/components/auto-refresh-context";
import { ToastProvider } from "@/components/toast-context";
import { Dashboard } from "@/components/dashboard";
import { IntegrationsPanel } from "@/components/integrations-panel";
import { fetchLayout, createWidget, fetchIntegrations } from "@/lib/dashboard-data";
import { statusDefaultConfig } from "@/modules/core/manifest";
import type { Widget } from "@/server/config-repo";
import type { IntegrationStatus } from "@/modules/integration-contracts";

function useHashRoute(): string {
  const [route, setRoute] = useState(() => window.location.hash.replace(/^#/, "") || "/");
  useEffect(() => {
    const on = () => setRoute(window.location.hash.replace(/^#/, "") || "/");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

function DashboardView() {
  const [widgets, setWidgets] = useState<Widget[] | null>(null);
  useEffect(() => {
    (async () => {
      let layout = await fetchLayout();
      if (layout.widgets.length === 0) {
        await createWidget("core.status"); // seed, matches old page.tsx
        layout = await fetchLayout();
      }
      setWidgets(layout.widgets);
    })();
  }, []);
  if (!widgets) return null;
  return <Dashboard initialWidgets={widgets} />;
}

function IntegrationsView() {
  const [initial, setInitial] = useState<IntegrationStatus[] | null>(null);
  useEffect(() => { fetchIntegrations().then(setInitial); }, []);
  if (!initial) return null;
  return <IntegrationsPanel initial={initial} />;
}

export function AppRoot() {
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
  }));
  const route = useHashRoute();
  return (
    <QueryClientProvider client={client}>
      <AutoRefreshProvider>
        <ToastProvider>
          {route.startsWith("/integrations") ? <IntegrationsView /> : <DashboardView />}
        </ToastProvider>
      </AutoRefreshProvider>
    </QueryClientProvider>
  );
}
```
> `createWidget("core.status")` uses the default config from the registry (matches the old seed via `statusDefaultConfig`); the explicit `statusDefaultConfig` import can be dropped if unused — verify with tsc/lint. If `Dashboard`/`IntegrationsPanel` expect props named differently than `initialWidgets`/`initial`, match their actual signatures (read the components).

- [ ] **Step 5: `src/main.tsx` — mount + global styles + fonts**

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import "@/app/globals.css"; // if you move globals.css out of src/app, update this path (see Step 6)
import { AppRoot } from "@/app-root";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppRoot />
  </React.StrictMode>,
);
```

- [ ] **Step 6: Fonts + globals.css relocation**

`next/font/google` (Geist) is gone. Move `src/app/globals.css` → `src/globals.css` (`git mv`) and import it in `main.tsx` as `"@/globals.css"`. Replace the Geist font wiring: install `npm i @fontsource-variable/geist @fontsource-variable/geist-mono`, import both at the top of `main.tsx`, and in `globals.css` set the CSS vars the theme uses:
```css
:root { --font-geist-sans: "Geist Variable", system-ui, sans-serif; --font-geist-mono: "Geist Mono Variable", ui-monospace, monospace; }
```
> If those exact fontsource package/family names don't resolve, fall back to `--font-geist-sans: system-ui, sans-serif;` and `--font-geist-mono: ui-monospace, monospace;` — functional, not pixel-identical. The old `layout.tsx` applied `dark` + font vars on `<html>`; `index.html` already sets `class="dark"` and the CSS vars cover the fonts.

- [ ] **Step 7: Delete the Next app dir**

```bash
git rm -r src/app
```
(Removes `layout.tsx`, `page.tsx`, `providers.tsx`, `integrations/page.tsx`, and all of `api/`.) The old `providers.tsx` is superseded by `AppRoot`.

- [ ] **Step 8: Typecheck + tests**

Run: `npx tsc --noEmit`. Expect errors ONLY of the form "cannot find module `server-only`"/better-sqlite3-in-browser are NOT surfaced by tsc; real errors to fix here are missing props / leftover `next/*` imports / unconverted fetch sites. Fix them. Run `rg -n 'next/' src` → must be empty.
Run: `npm test` → green (API-route tests under `tests/api/**` referencing deleted routes must be removed or rewritten to call `dashboard-data`; prefer moving their assertions into `tests/lib/dashboard-data.test.ts` and deleting the `tests/api/*` files — do NOT leave dead tests importing deleted routes).

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: Vite SPA shell + hash router; drop Next app/API layer"
```

---

## Task 4: (removed — folded into Task 3)

*(Intentionally empty: SPA + route deletion is one coherent change in Task 3.)*

---

## Task 5: Swap `getDb()` transport to `tauri-plugin-sql`; wire migrations; better-sqlite3 test-only

**Files:** `src/db/client.ts`; `src-tauri/src/lib.rs`; `src-tauri/capabilities/default.json`; `package.json` (move `better-sqlite3` to devDependencies).

- [ ] **Step 1: Rewrite `src/db/client.ts` with an environment-detected transport**

The proxy keeps its contract from Plan 2 (rows as column-ordered arrays; `get`-miss → `undefined`). In the Tauri webview, use the SQL plugin; in Node/tests, use `better-sqlite3` (dynamically imported so Vite never bundles it).

```ts
import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import * as schema from "./schema";

let db: SqliteRemoteDatabase<typeof schema> | null = null;

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function makeTauriTransport() {
  // Lazy singleton: Database.load is async; load once, reuse.
  let loading: Promise<import("@tauri-apps/plugin-sql").default> | null = null;
  const load = async () => {
    const { default: Database } = await import("@tauri-apps/plugin-sql");
    return (loading ??= Database.load("sqlite:dashboard.db"));
  };
  const query = async (sql: string, params: unknown[], method: string) => {
    const sqlDb = await load();
    if (method === "run") {
      await sqlDb.execute(sql, params);
      return { rows: [] as unknown[] };
    }
    const objRows = await sqlDb.select<Record<string, unknown>[]>(sql, params);
    const arr = objRows.map((r) => Object.values(r)); // object → column-ordered array (SQLite returns select-order keys)
    if (method === "get") return { rows: arr[0] as unknown }; // undefined on miss → drizzle maps to undefined
    return { rows: arr as unknown };
  };
  return {
    query,
    batch: async (queries: { sql: string; params: unknown[]; method: string }[]) => {
      const sqlDb = await load();
      // tauri-plugin-sql has no multi-statement transaction API from JS; emulate atomicity with BEGIN/COMMIT.
      await sqlDb.execute("BEGIN", []);
      try {
        const out: { rows: unknown }[] = [];
        for (const q of queries) out.push(await query(q.sql, q.params, q.method));
        await sqlDb.execute("COMMIT", []);
        return out;
      } catch (e) {
        await sqlDb.execute("ROLLBACK", []);
        throw e;
      }
    },
  };
}

async function makeNodeTransport() {
  const { default: Database } = await import("better-sqlite3");
  const path = process.env.DASHBOARD_DB ?? "dashboard.db";
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  const bind = (params: unknown[]) => params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p === undefined ? null : p));
  const exec = (sql: string, params: unknown[], method: string): { rows: unknown } => {
    const stmt = sqlite.prepare(sql);
    if (method === "run") { stmt.run(...bind(params)); return { rows: [] }; }
    if (method === "get") { return { rows: stmt.raw().get(...bind(params)) as unknown }; }
    return { rows: stmt.raw().all(...bind(params)) as unknown };
  };
  return {
    query: async (sql: string, params: unknown[], method: string) => exec(sql, params, method),
    batch: async (queries: { sql: string; params: unknown[]; method: string }[]) => {
      const run = sqlite.transaction((qs: typeof queries) => qs.map((q) => exec(q.sql, q.params, q.method)));
      return run(queries);
    },
  };
}
```

Then build `getDb()`. Because the Node transport needs an async import, and the Tauri transport is sync-to-create (its load is lazy inside the callbacks), initialize the transport once. Use a module-level promise the callbacks await:

```ts
type Transport = {
  query: (sql: string, params: unknown[], method: string) => Promise<{ rows: unknown }>;
  batch: (queries: { sql: string; params: unknown[]; method: string }[]) => Promise<{ rows: unknown }[]>;
};
let transport: Promise<Transport> | null = null;
function getTransport(): Promise<Transport> {
  return (transport ??= isTauri ? Promise.resolve(makeTauriTransport()) : makeNodeTransport());
}

export function getDb(): SqliteRemoteDatabase<typeof schema> {
  if (!db) {
    db = drizzle(
      async (sql, params, method) => (await getTransport()).query(sql, params, method),
      async (queries) => (await getTransport()).batch(queries),
      { schema },
    );
  }
  return db;
}

export function __resetDbForTests() { db = null; transport = null; }
export { schema };
```
> Removed `import "server-only"` (this file now runs in the webview). The `Object.values(row)` mapping assumes `tauri-plugin-sql`'s `select` returns keys in SELECT/column order — validate in Task 9's smoke test (a widget listing rows). If ordering is wrong, map explicitly using the query's column list. `import("@tauri-apps/plugin-sql")` types: the plugin's `Database.load`/`select`/`execute` signatures are version-specific; adjust the generic/params to the installed types if tsc complains.

- [ ] **Step 2: Keep the adapter + repo tests green (Node transport)**

The Node branch is exercised by the existing `tests/db/proxy-adapter.test.ts` and all repo tests via `useTempDb`. `useTempDb` still creates the migrated better-sqlite3 file and sets `DASHBOARD_DB`. The dynamic `import("better-sqlite3")` resolves in Node.
Run: `npm test` → **all green** (same counts as before this task). If the async transport init changes timing, ensure `__resetDbForTests` clears both `db` and `transport`.

- [ ] **Step 3: Wire migrations in Rust (`src-tauri/src/lib.rs`)**

Register the SQL plugin with the drizzle-generated migrations (in `./drizzle/000{0..4}_*.sql`). Add, in the `run()` builder:
```rust
use tauri_plugin_sql::{Migration, MigrationKind};

fn migrations() -> Vec<Migration> {
    vec![
        Migration { version: 1, description: "0000", sql: include_str!("../../drizzle/0000_short_cannonball.sql"), kind: MigrationKind::Up },
        Migration { version: 2, description: "0001", sql: include_str!("../../drizzle/0001_bizarre_inertia.sql"), kind: MigrationKind::Up },
        Migration { version: 3, description: "0002", sql: include_str!("../../drizzle/0002_breezy_iceman.sql"), kind: MigrationKind::Up },
        Migration { version: 4, description: "0003", sql: include_str!("../../drizzle/0003_grid_layout.sql"), kind: MigrationKind::Up },
        Migration { version: 5, description: "0004", sql: include_str!("../../drizzle/0004_yummy_boom_boom.sql"), kind: MigrationKind::Up },
    ]
}
```
and in the builder chain:
```rust
.plugin(tauri_plugin_sql::Builder::default()
    .add_migrations("sqlite:dashboard.db", migrations())
    .build())
.plugin(tauri_plugin_shell::init())
```
> Drizzle migration files contain `--> statement-breakpoint` markers; `tauri-plugin-sql` runs the whole `sql` string, which SQLite executes statement-by-statement — fine. Confirm the exact filenames with `ls drizzle/*.sql` before writing the `include_str!` paths. The `sqlite:dashboard.db` connection string resolves under the app-data dir at runtime.

- [ ] **Step 4: SQL capability**

In `src-tauri/capabilities/default.json`, add SQL permissions to the `permissions` array:
```json
"sql:default",
"sql:allow-load",
"sql:allow-execute",
"sql:allow-select"
```
> Use whatever permission identifiers the installed `tauri-plugin-sql` version ships (check `src-tauri/gen/schemas` or the plugin docs). `sql:default` usually bundles load/execute/select.

- [ ] **Step 5: Move `better-sqlite3` to devDependencies**

In `package.json`, move `"better-sqlite3"` from `dependencies` to `devDependencies` (it is now only the test transport + drizzle-kit). Keep `@types/better-sqlite3` in devDependencies. Run `npm install` to update the lockfile.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit` (fix db/client type issues), `npm test` (green), `cd src-tauri && cargo check` (migrations compile; the `include_str!` paths resolve).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: SQLite via tauri-plugin-sql; better-sqlite3 as test transport"
```

---

## Task 6: Port `cli.ts` to `tauri-plugin-shell`; PATH; shell allowlist; rework cli tests

**Files:** `src/server/cli.ts`; `src-tauri/capabilities/default.json`; `tests/server/cli.test.ts`.

- [ ] **Step 1: Refactor `cli.ts` into pure classifiers + a shell-plugin spawn**

Keep `CliError`, `CliErrorKind`, `RunCliOptions`, `ApiError`, `ApiErrorExtractor`, and `runJsonCli` (unchanged — it sits on `runCli`). Replace only the spawn mechanism and factor the classification so it is unit-testable without a Tauri runtime.

```ts
import { Command } from "@tauri-apps/plugin-shell";

export type CliErrorKind = "not-found" | "auth" | "timeout" | "failed";
export class CliError extends Error { /* unchanged */ }
export interface RunCliOptions { notAuthenticatedPattern?: RegExp; notAuthenticatedMessage?: string; timeoutMs?: number; }

// Homebrew-inclusive PATH: a Finder-launched .app inherits only the minimal system PATH,
// so prepend the common Homebrew dirs where gh/jira/gws live. (Simpler + more robust than a
// login-shell probe, which would require allowlisting the user's shell. Revisit only if a
// tool lives elsewhere.)
const TOOL_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

/** Pure: turn a finished process result into a resolved value or a CliError. Unit-testable. */
export function classifyExit(
  bin: string, code: number | null, stdout: string, stderr: string, opts: RunCliOptions,
): { stdout: string; stderr: string } {
  if (code === 0) return { stdout, stderr };
  if (opts.notAuthenticatedPattern?.test(stderr)) {
    throw new CliError(opts.notAuthenticatedMessage ?? "Not authenticated", "auth", stderr, stdout);
  }
  throw new CliError(stderr.trim() || `${bin} exited with code ${code ?? "unknown"}`, "failed", stderr, stdout);
}

/** Pure: classify a spawn/exec failure (missing binary → not-found). Unit-testable. */
export function classifySpawnError(bin: string, message: string): CliError {
  if (/not found|no such file|os error 2|cannot find|failed to (spawn|execute)/i.test(message)) {
    return new CliError(`${bin} not found — install it`, "not-found");
  }
  return new CliError(message || `${bin} failed to start`, "failed");
}

export function runCli(bin: string, args: string[], opts: RunCliOptions = {}): Promise<{ stdout: string; stderr: string }> {
  const timeoutMs = opts.timeoutMs ?? 20000;
  return new Promise((resolve, reject) => {
    let stdout = "", stderr = "", settled = false;
    const cmd = Command.create(bin, args, { env: { PATH: TOOL_PATH } });
    cmd.stdout.on("data", (line) => { stdout += line + "\n"; });
    cmd.stderr.on("data", (line) => { stderr += line + "\n"; });
    cmd.on("error", (msg) => { if (settled) return; settled = true; clearTimeout(timer); reject(classifySpawnError(bin, String(msg))); });
    cmd.on("close", ({ code }) => {
      if (settled) return; settled = true; clearTimeout(timer);
      try { resolve(classifyExit(bin, code, stdout, stderr, opts)); } catch (e) { reject(e); }
    });
    let child: { kill: () => Promise<void> } | undefined;
    const timer = setTimeout(() => {
      if (settled) return; settled = true;
      void child?.kill();
      reject(new CliError(`${bin} timed out after ${timeoutMs / 1000}s`, "timeout"));
    }, timeoutMs);
    cmd.spawn().then((c) => { child = c; }).catch((e) => {
      if (settled) return; settled = true; clearTimeout(timer); reject(classifySpawnError(bin, String(e)));
    });
  });
}

// runJsonCli: keep exactly as in the current file (it only depends on runCli + CliError).
```
> The shell plugin emits `stdout`/`stderr` line events (newline-stripped) — the `+ "\n"` reassembly is approximate; if a module parses exact bytes (e.g. trailing-newline-sensitive JSON), prefer accumulating without re-adding `\n` and `.trim()` at parse sites (they already `JSON.parse`). The `error` event vs `spawn().catch` both funnel to `classifySpawnError`. Validate not-found detection in Task 9 by temporarily renaming a tool.

- [ ] **Step 2: Shell allowlist capability**

In `src-tauri/capabilities/default.json` `permissions`, add the shell execute permission scoped to the three tools:
```json
{
  "identifier": "shell:allow-execute",
  "allow": [
    { "name": "gh", "cmd": "gh", "args": true },
    { "name": "jira", "cmd": "jira", "args": true },
    { "name": "gws", "cmd": "gws", "args": true }
  ]
},
"shell:allow-spawn"
```
> The exact scope schema (`name`/`cmd`/`args`/`sidecar`) is version-specific. If `Command.create("gh", …)` is rejected at runtime with a scope error, consult `v2.tauri.app/plugin/shell` for the installed version's `allow` entry shape and adjust. `args: true` permits arbitrary args (acceptable for this local single-user app; modules pass dynamic args like JQL).

- [ ] **Step 3: Rework `tests/server/cli.test.ts`**

The old tests spawned real processes via `execFile`; that path no longer exists in Node without a Tauri runtime. Rewrite to:
1. Unit-test the pure classifiers directly (no plugin): `classifyExit` (code 0 → returns; auth pattern → auth CliError; non-zero → failed) and `classifySpawnError` (missing-binary message → not-found; other → failed).
2. Optionally, a light `runCli` integration test that mocks `@tauri-apps/plugin-shell` via `vi.mock("@tauri-apps/plugin-shell", () => ({ Command: { create: () => fakeCommand } }))` where `fakeCommand` emits canned stdout/close events — assert stdout aggregation + timeout + spawn-error mapping.
Keep coverage of all four `CliErrorKind`s. Do NOT delete assertions about error classification — move them onto `classifyExit`/`classifySpawnError`.
Run: `npx vitest run tests/server/cli.test.ts` → green.

- [ ] **Step 4: Verify + commit**

Run: `npm test` (green), `npx tsc --noEmit`.
```bash
git add -A && git commit -m "feat: spawn CLIs via tauri-plugin-shell; PATH + testable classifiers"
```

---

## Task 7: Remove `server-only`; ESLint de-Next; contracts doc comments

**Files:** every file with `import "server-only";`; `tests/stubs/server-only.ts` + `vitest.config.ts` alias; `eslint.config.*`; `src/modules/contracts.ts`; `package.json` (drop `eslint-config-next`, `next`).

- [ ] **Step 1: Remove all `import "server-only";` lines**

Run: `rg -l 'import "server-only"' src` → for each file, delete that single import line (nothing else). Then remove the Vitest alias: in `vitest.config.ts` delete the `"server-only": resolve(...)` alias entry, and `git rm tests/stubs/server-only.ts`.
Run: `rg -n 'server-only' src tests` → only non-import mentions may remain (e.g. a doc comment); no `import "server-only"` anywhere.

- [ ] **Step 2: `contracts.ts` doc comments**

The `/** Server-only: … Never imported by client code. */` and `/** Client-only: … */` comments on `FetchWidget`/`RenderWidget` are now inaccurate (both run in the webview). Reword to describe the fetch vs render responsibility without the server/client boundary language. Minimal edit, comments only.

- [ ] **Step 3: Drop Next from ESLint + deps**

Remove `next` and `eslint-config-next` from `package.json`. Replace the ESLint config (currently Next-based) with a minimal flat config for TS + React, e.g. `eslint.config.mjs`:
```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { ignores: ["dist", "src-tauri/target", "drizzle"] },
);
```
Install the config deps if missing: `npm i -D @eslint/js typescript-eslint`. Adjust rules until `npm run lint` passes on the existing code without weakening intent (the code was Next-lint-clean; expect few changes). `npm run build` (= `tauri build`) no longer needs Next.

- [ ] **Step 4: Verify + commit**

Run: `npx tsc --noEmit`, `npm test` (green), `npm run lint` (clean), `npx vite build` (the browser bundle now builds — no `server-only` throw, `better-sqlite3` externalized).
```bash
git add -A && git commit -m "refactor: drop server-only + Next tooling for the webview build"
```

---

## Task 8: Native integration — tray + launch-on-login

**Files:** `src-tauri/src/lib.rs`; `src-tauri/capabilities/default.json`; `src-tauri/tauri.conf.json`.

- [ ] **Step 1: Autostart plugin**

In `lib.rs` builder: `.plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))`. Add the autostart permissions to the capability (`autostart:allow-enable`, `autostart:allow-disable`, `autostart:allow-is-enabled` or `autostart:default`). Enable-on-first-run can be wired later from the UI; for now just register the plugin so the capability exists. (Feature-flag-style: leave autostart DISABLED by default per project conventions.)

- [ ] **Step 2: Tray icon + menu**

In `lib.rs` `setup`, create a `TrayIconBuilder` with a menu (Show/Hide, Quit) and the app icon; on left-click, show/focus the main window. Use the Tauri v2 `tray`/`menu` APIs (`tauri::tray::TrayIconBuilder`, `tauri::menu::{Menu, MenuItem}`). Add `"core:tray:default"`/menu permissions to the capability as required by the installed version.
> Tray/menu APIs are version-specific; follow `v2.tauri.app/learn/system-tray`. Keep it minimal: Quit + toggle window.

- [ ] **Step 3: Verify + commit**

Run: `cd src-tauri && cargo check`.
```bash
git add -A && git commit -m "feat: system tray + autostart plugin (autostart off by default)"
```

---

## Task 9: Build, launch smoke test, and docs

**Files:** `CLAUDE.md`, `CONTEXT.md`, `README` if present.

- [ ] **Step 1: Dev launch**

Run: `npm run dev` (= `tauri dev`). Expect: Vite serves on :1420, Rust compiles, a native window opens showing the dashboard. Watch the terminal for plugin/scope errors.

- [ ] **Step 2: Exercise every edge (this is the real oracle for the ported transports)**

In the running app, verify:
- Dashboard loads; the seeded `core.status` widget renders (proves SQL plugin read/write + migrations ran; DB is at `~/Library/Application Support/com.pulse.dashboard/dashboard.db`).
- Add a widget, reorder (drag), hide, delete, edit config, rename — each persists across an app restart (proves `db.batch`/writes via the SQL plugin, incl. the BEGIN/COMMIT batch path).
- A CLI-backed widget (e.g. a GitHub or gws widget) loads data (proves shell plugin + PATH finds `gh`/`gws`; if "not found", check the allowlist + `TOOL_PATH`).
- Open the integrations view (`#/integrations`) via the header link; toggle an integration; disable one with widgets → the confirm flow appears (proves `toggleIntegration` confirmRequired path).
- Trigger an auth failure (e.g. a tool not logged in) → the widget shows the auth error kind (proves `classifyExit` auth mapping through the shell plugin).

Fix any transport/scope mismatch found here (this is where the Object.values row-order, the shell scope schema, and not-found detection get validated against reality).

- [ ] **Step 3: Release build**

Run: `npm run build` (= `tauri build`). Expect a `.app` + `.dmg` under `src-tauri/target/release/bundle/`. Launch the `.app` from Finder (local build → no quarantine → opens). Repeat a couple of Step-2 checks against the release build.

- [ ] **Step 4: Docs**

Update `CLAUDE.md`: Stack (Tauri v2 + Vite instead of Next.js), Commands (`npm run dev` = `tauri dev`, `npm run build` = `tauri build`, `dev:vite`/`build:vite`), Architecture (webview runs everything; `getDb()` transport = SQL plugin in-app / better-sqlite3 in tests; `cli.ts` = shell plugin + Homebrew PATH; migrations in `src-tauri`). Update `CONTEXT.md` glossary entries that referenced Next/API routes/RSC. Note the DB lives in the app-data dir. Add a short `README`/`docs` note on building the `.app` and the unsigned-app caveat (`xattr -cr` only if downloaded).

- [ ] **Step 5: Full green + commit**

Run: `npm test` (green), `npx tsc --noEmit`, `npm run lint`.
```bash
git add -A && git commit -m "docs: Tauri app build + architecture; finalize cutover"
```

---

## Self-review checklist

- **Spec coverage:** Implements the remaining spec sections — pure-TS-in-webview, delete API/RSC, Vite SPA, `getDb()` → `tauri-plugin-sql` (with the row adapter + batch atomicity via BEGIN/COMMIT), migrations via the plugin runner + app-data path, `cli.ts` → shell plugin, macOS PATH (chose the Homebrew-prepend over the login-shell probe — see note; simpler for this Homebrew setup), shell allowlist, tray + autostart, better-sqlite3 → test-only, `server-only` removal, direct data access from React.
- **Placeholder scan:** Version-sensitive Tauri/plugin specifics are marked as candidates with a concrete fallback and "the running app is the oracle" — not vague TODOs. Full code is given for the parts under our control (data layer, db transport, cli.ts, SPA shell, use-widget-data, capabilities/migrations blocks).
- **Type consistency:** `getDb()` still returns `SqliteRemoteDatabase<typeof schema>`; the proxy `get`-miss → `undefined` contract from Plan 2 is preserved in both transports. `dashboard-data` return types match what components consumed from the old routes.

## Known risks / oracles (call out during execution)
1. **`tauri-plugin-sql` row order** — `Object.values(row)` assumes SELECT-order keys; validated by Step-2 widget listing. Fallback: map columns explicitly.
2. **Shell scope schema** — exact `allow` entry shape is version-specific; validated by a CLI widget loading; fallback to plugin docs.
3. **not-found detection** — string-based now (no ENOENT); validated by renaming a tool.
4. **Fonts** — `@fontsource-variable/geist*` names; fallback to system fonts.
5. **Tray/menu + autostart permission identifiers** — version-specific; `cargo check` + docs.
6. **Batch atomicity via BEGIN/COMMIT** — the SQL-plugin batch path differs from the Node `.transaction()` path; exercise reorder + disable-with-widgets in Step 2.

## Out of scope
- Code signing / notarization (local builds only).
- Windows/Linux bundles.
- Auto-enabling launch-on-login (registered but off by default per project conventions).
