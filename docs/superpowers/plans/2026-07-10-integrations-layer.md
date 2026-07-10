# Integrations Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tool-level "integration" abstraction with a `/integrations` status page, gate the add-widget list to enabled integrations, and show a warning "!" on any widget whose last fetch failed.

**Architecture:** A third registry (`integration-registry`) sits beside the server/client widget registries. Each integration is declared once per tool (`id`, `name`, optional `tool` metadata, `checkHealth()`). Client widgets declare which integration they belong to. Enabled state is a computed default (`!tool || installed`) overridable via a `prefs` key. A per-widget `error_kind` is propagated into `widget_cache` so the shell can render a warning icon. The `/integrations` page probes health on open (30s in-memory cache) and lets the user toggle integrations; disabling one deletes its widgets after confirmation.

**Tech Stack:** Next.js App Router, Drizzle + better-sqlite3, TanStack Query, Vitest + Testing Library, Tailwind v4.

**Design spec:** `docs/superpowers/specs/2026-07-10-integrations-layer-design.md`

**Note on spec deviations (resolved during planning):**
- The spec loosely listed `core` and `system` as integrations. **Neither is created.** `core.status` has no integration (always available). The tool-less path (future cpu/mem module) is proven by tests only; that module will register its own integration later (YAGNI — an empty "System" row now has nothing to add).
- Widget→integration association lives on **`ClientWidget` only** (it's a catalog/add-list concern). The server fetch path never needs it.

---

## File Structure

**New files**
- `src/modules/integration-contracts.ts` — `Integration`, `IntegrationHealth`, `IntegrationStatus` types (no runtime deps; client-safe).
- `src/modules/integration-registry.ts` — server-only registry (register/get/list/clear).
- `src/modules/integration-health.ts` — server-only `probeHealth()` helper (classifies a probe fn into health).
- `src/modules/github/integration.ts`, `src/modules/jira/integration.ts`, `src/modules/gws/integration.ts` — one integration declaration each.
- `src/modules/integrations.ts` — barrel importing the three declarations (mirrors `server.ts`/`client.ts`).
- `src/server/integration-service.ts` — status resolution, health cache, enable/disable, widget counts.
- `src/app/api/integrations/route.ts` — GET statuses.
- `src/app/api/integrations/[id]/toggle/route.ts` — POST enable/disable.
- `src/app/integrations/page.tsx` — server page.
- `src/components/integrations-panel.tsx` — client UI (rows, toggle, re-check, confirm dialog).

**Modified files**
- `src/db/schema.ts` — `error_kind` column on `widget_cache` (+ generated migration).
- `src/server/cache-repo.ts` — persist/read `errorKind`.
- `src/server/widget-service.ts` — capture `CliError.kind`.
- `src/modules/contracts.ts` — `integration?: string` on `ClientWidget`.
- `src/modules/client-registry.ts` — expose `integration` from `listClientWidgets()`.
- `src/modules/{github,jira,gws}/client.ts` — pass `integration` on each registration.
- `src/server/config-repo.ts` — `getIntegrationOverride` / `setIntegrationOverride`.
- `src/components/add-widget-drawer.tsx` — filter by enabled integrations.
- `src/components/widget-shell.tsx` / `src/components/widget-card.tsx` — "!" indicator; drop the "stale" pill.
- `src/components/dashboard.tsx` — header link to `/integrations`.

---

## Task 1: `error_kind` column on the widget cache

**Files:**
- Modify: `src/db/schema.ts:27-33`
- Modify: `src/server/cache-repo.ts`
- Test: `tests/server/cache-repo.test.ts`

- [ ] **Step 1: Add the column to the schema**

In `src/db/schema.ts`, add `errorKind` to `widgetCache`:

```ts
export const widgetCache = sqliteTable("widget_cache", {
  widgetId: text("widget_id").primaryKey(),
  payload: text("payload", { mode: "json" }),
  fetchedAt: integer("fetched_at").notNull(),
  status: text("status", { enum: ["ok", "error"] }).notNull(),
  error: text("error"),
  errorKind: text("error_kind"), // CliErrorKind on failure, null otherwise
});
```

- [ ] **Step 2: Generate and apply the migration**

Run: `npm run db:generate`
Expected: a new file under `drizzle/` (e.g. `drizzle/0001_*.sql`) containing `ALTER TABLE widget_cache ADD error_kind text;`. Open it to confirm it's an additive `ALTER TABLE` (no data loss).

Run: `npm run db:migrate`
Expected: migration applies cleanly to `dashboard.db`.

- [ ] **Step 3: Write the failing test for cache round-trip of errorKind**

Add to `tests/server/cache-repo.test.ts`:

```ts
it("persists and reads back errorKind on failure", () => {
  cache.set("w1", { status: "error", payload: null, error: "boom", errorKind: "auth" });
  expect(cache.get("w1")!.errorKind).toBe("auth");
});

it("defaults errorKind to null when omitted", () => {
  cache.set("w2", { status: "ok", payload: { n: 1 }, error: null });
  expect(cache.get("w2")!.errorKind).toBeNull();
});
```

- [ ] **Step 4: Run it to confirm it fails**

Run: `npm test -- cache-repo`
Expected: FAIL — `errorKind` missing from `CacheInput` / not persisted.

- [ ] **Step 5: Update cache-repo to carry errorKind**

Rewrite `src/server/cache-repo.ts`:

```ts
import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { widgetCache } from "@/db/schema";
import type { CliErrorKind } from "@/server/cli";

export type CacheRow = typeof widgetCache.$inferSelect;
export type CacheInput = {
  status: "ok" | "error";
  payload: unknown;
  error: string | null;
  errorKind?: CliErrorKind | null;
};

export function get(widgetId: string): CacheRow | undefined {
  return getDb().select().from(widgetCache).where(eq(widgetCache.widgetId, widgetId)).get();
}

export function set(widgetId: string, input: CacheInput): CacheRow {
  const row: CacheRow = {
    widgetId,
    payload: input.payload,
    fetchedAt: Date.now(),
    status: input.status,
    error: input.error,
    errorKind: input.errorKind ?? null,
  };
  getDb().insert(widgetCache).values(row)
    .onConflictDoUpdate({
      target: widgetCache.widgetId,
      set: { payload: row.payload, fetchedAt: row.fetchedAt, status: row.status, error: row.error, errorKind: row.errorKind },
    }).run();
  return row;
}
```

- [ ] **Step 6: Run the test to confirm it passes**

Run: `npm test -- cache-repo`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts drizzle/ src/server/cache-repo.ts tests/server/cache-repo.test.ts
git commit -m "feat: add error_kind column to widget cache"
```

---

## Task 2: Capture `CliError.kind` in the widget service

**Files:**
- Modify: `src/server/widget-service.ts`
- Test: `tests/server/widget-service.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/server/widget-service.test.ts` (check the file's existing imports/setup first; it uses `useTempDb` and registers a fake widget). Add:

```ts
it("stores CliError.kind in the cache on failure", async () => {
  const { CliError } = await import("@/server/cli");
  registerServerWidget({
    type: "fake.authfail",
    configSchema: z.object({}),
    defaultConfig: {},
    fetch: async () => { throw new CliError("Not authenticated — run `gh auth login`", "auth"); },
  });
  const w = addWidget("fake.authfail", {});
  const row = await getWidgetData(w.id, true);
  expect(row.status).toBe("error");
  expect(row.errorKind).toBe("auth");
});
```

If the test file lacks the imports (`registerServerWidget`, `addWidget`, `getWidgetData`, `z`), add them at the top:

```ts
import { z } from "zod";
import { registerServerWidget } from "@/modules/server-registry";
import { addWidget } from "@/server/config-repo";
import { getWidgetData } from "@/server/widget-service";
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- widget-service`
Expected: FAIL — `row.errorKind` is `undefined`/`null`.

- [ ] **Step 3: Capture the kind in widget-service**

Rewrite `src/server/widget-service.ts`:

```ts
import "server-only";
import { getWidget } from "./config-repo";
import * as cache from "./cache-repo";
import { getServerWidget } from "@/modules/server-registry";
import { NotFoundError } from "./errors";
import { CliError } from "./cli";

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

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- widget-service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/widget-service.ts tests/server/widget-service.test.ts
git commit -m "feat: propagate CliError kind into widget cache"
```

---

## Task 3: Integration contracts + registry

**Files:**
- Create: `src/modules/integration-contracts.ts`
- Create: `src/modules/integration-registry.ts`
- Test: `tests/modules/integration-registry.test.ts`

- [ ] **Step 1: Create the contracts**

`src/modules/integration-contracts.ts`:

```ts
// Types only — no runtime deps, safe to import from client code.

export interface IntegrationHealth {
  installed: boolean;
  authed: boolean | "n/a"; // "n/a" when the tool has no auth
  detail?: string;         // human message when unhealthy
}

export interface IntegrationTool {
  bin: string;
  installHint: string;
  authHint: string;
}

export interface Integration {
  id: string;
  name: string;
  tool?: IntegrationTool;
  checkHealth(): Promise<IntegrationHealth>;
}

/** Resolved, client-facing view of an integration. */
export interface IntegrationStatus {
  id: string;
  name: string;
  tool: IntegrationTool | null;
  health: IntegrationHealth;
  enabled: boolean;
  override: boolean | null;
  widgetCount: number;
}
```

- [ ] **Step 2: Create the registry**

`src/modules/integration-registry.ts`:

```ts
import "server-only";
import type { Integration } from "./integration-contracts";

const registry = new Map<string, Integration>();

export function registerIntegration(def: Integration): void {
  if (registry.has(def.id)) throw new Error(`Integration already registered: ${def.id}`);
  registry.set(def.id, def);
}

export function getIntegration(id: string): Integration | undefined {
  return registry.get(id);
}

export function listIntegrations(): Integration[] {
  return [...registry.values()];
}

export function __clearIntegrationRegistry(): void {
  registry.clear();
}
```

- [ ] **Step 3: Write the failing test**

`tests/modules/integration-registry.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  registerIntegration, getIntegration, listIntegrations, __clearIntegrationRegistry,
} from "@/modules/integration-registry";

const fake = () => ({
  id: "x", name: "X", checkHealth: async () => ({ installed: true, authed: true as const }),
});

beforeEach(() => __clearIntegrationRegistry());

describe("integration registry", () => {
  it("registers and looks up by id", () => {
    registerIntegration(fake());
    expect(getIntegration("x")?.name).toBe("X");
    expect(listIntegrations()).toHaveLength(1);
  });

  it("throws on duplicate id", () => {
    registerIntegration(fake());
    expect(() => registerIntegration(fake())).toThrow(/already registered/);
  });
});
```

- [ ] **Step 4: Run it**

Run: `npm test -- integration-registry`
Expected: PASS (registry + contracts already written).

- [ ] **Step 5: Commit**

```bash
git add src/modules/integration-contracts.ts src/modules/integration-registry.ts tests/modules/integration-registry.test.ts
git commit -m "feat: add integration contracts and registry"
```

---

## Task 4: `probeHealth` helper

**Files:**
- Create: `src/modules/integration-health.ts`
- Test: `tests/modules/integration-health.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/modules/integration-health.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { probeHealth } from "@/modules/integration-health";
import { CliError } from "@/server/cli";

describe("probeHealth", () => {
  it("reports installed+authed when the probe succeeds", async () => {
    expect(await probeHealth(async () => "ok")).toEqual({ installed: true, authed: true });
  });

  it("reports not-installed on a not-found CliError", async () => {
    const h = await probeHealth(async () => { throw new CliError("gh not found", "not-found"); });
    expect(h.installed).toBe(false);
    expect(h.authed).toBe(false);
    expect(h.detail).toMatch(/not found/);
  });

  it("reports installed-but-unauthed on an auth CliError", async () => {
    const h = await probeHealth(async () => { throw new CliError("run gh auth login", "auth"); });
    expect(h.installed).toBe(true);
    expect(h.authed).toBe(false);
    expect(h.detail).toMatch(/auth login/);
  });

  it("treats other failures as installed-but-unhealthy", async () => {
    const h = await probeHealth(async () => { throw new Error("weird"); });
    expect(h.installed).toBe(true);
    expect(h.authed).toBe(false);
    expect(h.detail).toBe("weird");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- integration-health`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

`src/modules/integration-health.ts`:

```ts
import "server-only";
import { CliError } from "@/server/cli";
import type { IntegrationHealth } from "./integration-contracts";

/**
 * Run a lightweight authenticated probe and classify it. A `not-found` CliError
 * means the tool isn't installed; anything else means it's installed but we
 * couldn't confirm auth (auth failure, timeout, or a broken probe).
 */
export async function probeHealth(run: () => Promise<unknown>): Promise<IntegrationHealth> {
  try {
    await run();
    return { installed: true, authed: true };
  } catch (err) {
    if (err instanceof CliError && err.kind === "not-found") {
      return { installed: false, authed: false, detail: err.message };
    }
    return { installed: true, authed: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- integration-health`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/integration-health.ts tests/modules/integration-health.test.ts
git commit -m "feat: add probeHealth classifier"
```

---

## Task 5: Widget → integration association

**Files:**
- Modify: `src/modules/contracts.ts:26-34`
- Modify: `src/modules/client-registry.ts:14-16`
- Modify: `src/modules/github/client.ts`, `src/modules/jira/client.ts`, `src/modules/gws/client.ts`
- Test: `tests/modules/registry.test.ts`

- [ ] **Step 1: Add `integration` to the ClientWidget contract**

In `src/modules/contracts.ts`, add one field to `ClientWidget`:

```ts
export interface ClientWidget<Data = unknown, Config = unknown> {
  type: string;
  title: string;
  Component: FC<WidgetBodyProps<Data, Config>>;
  configSchema: ZodType<Config>;
  defaultConfig: Config;
  /** Item count shown next to the title (total fetched, pre-limit). Omit to show no count. */
  count?(data: Data, config: Config): number | null;
  /** Id of the integration this widget belongs to; omit for always-available widgets (e.g. core). */
  integration?: string;
}
```

- [ ] **Step 2: Expose `integration` from `listClientWidgets`**

In `src/modules/client-registry.ts`:

```ts
export function listClientWidgets(): { type: string; title: string; integration?: string }[] {
  return [...registry.values()].map((d) => ({ type: d.type, title: d.title, integration: d.integration }));
}
```

- [ ] **Step 3: Write the failing test**

Add to `tests/modules/registry.test.ts` (or create a focused test if that file's shape doesn't fit — check it first):

```ts
it("client widgets carry an integration id where applicable", async () => {
  await import("@/modules/client");
  const { listClientWidgets } = await import("@/modules/client-registry");
  const byType = Object.fromEntries(listClientWidgets().map((w) => [w.type, w.integration]));
  expect(byType["github.prs"]).toBe("github");
  expect(byType["jira.jql"]).toBe("jira");
  expect(byType["gws.gmail"]).toBe("gws");
  expect(byType["core.status"]).toBeUndefined();
});
```

- [ ] **Step 4: Run it to confirm it fails**

Run: `npm test -- registry`
Expected: FAIL — integrations are all `undefined`.

- [ ] **Step 5: Set integration ids on each registration**

In `src/modules/github/client.ts`, add `integration: "github",` to all three `registerClientWidget({...})` calls. Example for the first:

```ts
registerClientWidget({
  type: PRS_TYPE, title: "Pull Requests", Component: PrListWidget,
  configSchema: prsConfigSchema, defaultConfig: prsDefaultConfig,
  integration: "github",
});
```

In `src/modules/jira/client.ts`, add `integration: "jira",` to the single `registerClientWidget` call.

In `src/modules/gws/client.ts`, add `integration: "gws",` to all six `registerClientWidget` calls (gmail, calendar, chat dms, chat channels, drive, tasks).

Leave `src/modules/core/client.ts` unchanged (no integration).

- [ ] **Step 6: Run the test to confirm it passes**

Run: `npm test -- registry`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/contracts.ts src/modules/client-registry.ts src/modules/github/client.ts src/modules/jira/client.ts src/modules/gws/client.ts tests/modules/registry.test.ts
git commit -m "feat: associate client widgets with integrations"
```

---

## Task 6: Module integration declarations + barrel

**Files:**
- Create: `src/modules/github/integration.ts`, `src/modules/jira/integration.ts`, `src/modules/gws/integration.ts`
- Create: `src/modules/integrations.ts`
- Test: `tests/modules/integrations-registration.test.ts`

- [ ] **Step 1: GitHub integration**

`src/modules/github/integration.ts`:

```ts
import "server-only";
import { registerIntegration } from "@/modules/integration-registry";
import { probeHealth } from "@/modules/integration-health";
import { runGh } from "./gh";

registerIntegration({
  id: "github",
  name: "GitHub",
  tool: {
    bin: "gh",
    installHint: "Install the GitHub CLI — https://cli.github.com (`brew install gh`).",
    authHint: "Run `gh auth login` to authenticate.",
  },
  checkHealth: () => probeHealth(() => runGh(["auth", "status"])),
});
```

- [ ] **Step 2: Jira integration**

`src/modules/jira/integration.ts`:

```ts
import "server-only";
import { registerIntegration } from "@/modules/integration-registry";
import { probeHealth } from "@/modules/integration-health";
import { runJira } from "./jira";

registerIntegration({
  id: "jira",
  name: "Jira",
  tool: {
    bin: "jira",
    installHint: "Install jira-cli — https://github.com/ankitpokhrel/jira-cli (`brew install ankitpokhrel/jira-cli/jira-cli`).",
    authHint: "Run `jira init` and set the `JIRA_API_TOKEN` environment variable.",
  },
  checkHealth: () => probeHealth(() => runJira(["me"])),
});
```

- [ ] **Step 3: GWS integration**

`src/modules/gws/integration.ts`:

```ts
import "server-only";
import { registerIntegration } from "@/modules/integration-registry";
import { probeHealth } from "@/modules/integration-health";
import { gwsJson } from "./gws";

registerIntegration({
  id: "gws",
  name: "Google Workspace",
  tool: {
    bin: "gws",
    installHint: "Install the `gws` CLI and configure OAuth credentials.",
    authHint: "Run `gws auth login` to authenticate.",
  },
  // getProfile is a cheap authenticated Gmail call — 401 when unauthenticated.
  checkHealth: () => probeHealth(() =>
    gwsJson(["gmail", "users", "getProfile", "--params", JSON.stringify({ userId: "me" })])
  ),
});
```

- [ ] **Step 4: Barrel**

`src/modules/integrations.ts`:

```ts
import "server-only";
import "./github/integration";
import "./jira/integration";
import "./gws/integration";
// Register future integrations here.
```

- [ ] **Step 5: Write the registration test**

`tests/modules/integrations-registration.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import "@/modules/integrations";
import { getIntegration } from "@/modules/integration-registry";

describe("integrations barrel", () => {
  it("registers github, jira and gws with tool metadata", () => {
    for (const id of ["github", "jira", "gws"]) {
      const integ = getIntegration(id);
      expect(integ, id).toBeDefined();
      expect(integ!.tool?.bin, id).toBeTruthy();
      expect(integ!.tool?.installHint, id).toBeTruthy();
      expect(integ!.tool?.authHint, id).toBeTruthy();
    }
  });
});
```

- [ ] **Step 6: Run it**

Run: `npm test -- integrations-registration`
Expected: PASS.

- [ ] **Step 7: Verify probes against the real CLIs (manual)**

Run: `npm run dev`, open `http://localhost:3000/integrations` **after Task 12** — for now just sanity-check the probe commands in a shell:

Run: `gh auth status; jira me; gws gmail users getProfile --params '{"userId":"me"}'`
Expected: each either prints info (authed) or errors with an auth message. If `jira me` or the `gws getProfile` invocation is wrong for the installed version, adjust the `checkHealth` command in the corresponding `integration.ts` (this is the one spot the spec flagged as version-dependent). Re-run Step 6.

- [ ] **Step 8: Commit**

```bash
git add src/modules/github/integration.ts src/modules/jira/integration.ts src/modules/gws/integration.ts src/modules/integrations.ts tests/modules/integrations-registration.test.ts
git commit -m "feat: declare github, jira and gws integrations"
```

---

## Task 7: Enabled-override prefs helpers

**Files:**
- Modify: `src/server/config-repo.ts`
- Test: `tests/server/config-repo.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/server/config-repo.test.ts` (it already uses `useTempDb`; check its imports):

```ts
it("integration override is null until set, then round-trips", () => {
  expect(config.getIntegrationOverride("github")).toBeNull();
  config.setIntegrationOverride("github", false);
  expect(config.getIntegrationOverride("github")).toBe(false);
  config.setIntegrationOverride("github", true);
  expect(config.getIntegrationOverride("github")).toBe(true);
});
```

If the file imports named functions instead of a namespace, add `getIntegrationOverride, setIntegrationOverride` to its import list and drop the `config.` prefix.

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- config-repo`
Expected: FAIL — functions undefined.

- [ ] **Step 3: Implement the helpers**

Append to `src/server/config-repo.ts`:

```ts
/** Manual enable/disable override for an integration. null = follow computed default. */
export function getIntegrationOverride(id: string): boolean | null {
  const raw = getPref(`integration.${id}.enabled`, "");
  if (raw === "") return null;
  return raw === "true";
}

export function setIntegrationOverride(id: string, enabled: boolean): void {
  setPref(`integration.${id}.enabled`, enabled ? "true" : "false");
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- config-repo`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/config-repo.ts tests/server/config-repo.test.ts
git commit -m "feat: add integration enable/disable override prefs"
```

---

## Task 8: Integration status service

**Files:**
- Create: `src/server/integration-service.ts`
- Test: `tests/server/integration-service.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/server/integration-service.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useTempDb } from "../helpers/db";

// Control which integrations & client widgets exist.
vi.mock("@/modules/integration-registry", () => {
  const map = new Map<string, unknown>();
  return {
    listIntegrations: () => [...map.values()],
    getIntegration: (id: string) => map.get(id),
    __seed: (arr: unknown[]) => { map.clear(); for (const i of arr) map.set((i as { id: string }).id, i); },
  };
});
vi.mock("@/modules/client-registry", () => ({
  listClientWidgets: () => [
    { type: "t.a", title: "A", integration: "toolful" },
    { type: "t.none", title: "None" },
  ],
  getClientWidget: () => undefined,
}));

import * as reg from "@/modules/integration-registry";
import { addWidget } from "@/server/config-repo";
import {
  resolveEnabled, getIntegrationStatuses, disableIntegration, enableIntegration,
} from "@/server/integration-service";

const seed = (reg as unknown as { __seed: (a: unknown[]) => void }).__seed;

beforeEach(() => {
  useTempDb();
  seed([
    { id: "toolful", name: "Toolful", tool: { bin: "x", installHint: "i", authHint: "a" },
      checkHealth: async () => ({ installed: true, authed: true }) },
    { id: "toolless", name: "Toolless",
      checkHealth: async () => ({ installed: true, authed: "n/a" }) },
    { id: "missing", name: "Missing", tool: { bin: "y", installHint: "i", authHint: "a" },
      checkHealth: async () => ({ installed: false, authed: false }) },
  ]);
});

describe("resolveEnabled", () => {
  it("defaults on for tool-less and installed tools, off for missing", () => {
    expect(resolveEnabled(false, false, null)).toBe(true);  // no tool
    expect(resolveEnabled(true, true, null)).toBe(true);    // installed
    expect(resolveEnabled(true, false, null)).toBe(false);  // missing
  });
  it("override wins over the computed default", () => {
    expect(resolveEnabled(true, false, true)).toBe(true);
    expect(resolveEnabled(false, true, false)).toBe(false);
  });
});

describe("getIntegrationStatuses", () => {
  it("computes enabled and counts widgets per integration", async () => {
    addWidget("t.a", {});
    addWidget("t.a", {});
    const statuses = await getIntegrationStatuses(true);
    const byId = Object.fromEntries(statuses.map((s) => [s.id, s]));
    expect(byId.toolful.enabled).toBe(true);
    expect(byId.toolful.widgetCount).toBe(2);
    expect(byId.toolless.enabled).toBe(true);
    expect(byId.missing.enabled).toBe(false);
  });
});

describe("disable/enable", () => {
  it("refuses to disable with widgets unless deleteWidgets is set", async () => {
    addWidget("t.a", {});
    expect(() => disableIntegration("toolful", false)).toThrow(/confirm/);
  });
  it("deletes the integration's widgets on confirmed disable", async () => {
    addWidget("t.a", {});
    const res = disableIntegration("toolful", true);
    expect(res.deleted).toBe(1);
    const statuses = await getIntegrationStatuses(true);
    expect(statuses.find((s) => s.id === "toolful")!.enabled).toBe(false);
  });
  it("enable sets the override to true", async () => {
    enableIntegration("missing");
    const statuses = await getIntegrationStatuses(true);
    expect(statuses.find((s) => s.id === "missing")!.enabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- integration-service`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

`src/server/integration-service.ts`:

```ts
import "server-only";
import { listIntegrations, getIntegration } from "@/modules/integration-registry";
import { listClientWidgets } from "@/modules/client-registry";
import { getWidgets, removeWidget, getIntegrationOverride, setIntegrationOverride } from "./config-repo";
import type { IntegrationHealth, IntegrationStatus } from "@/modules/integration-contracts";

const HEALTH_TTL_MS = 30_000;
const healthCache = new Map<string, { at: number; health: IntegrationHealth }>();

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
  return new Set(listClientWidgets().filter((w) => w.integration === id).map((w) => w.type));
}

function widgetCountForIntegration(id: string): number {
  const types = typesForIntegration(id);
  return getWidgets().filter((w) => types.has(w.type)).length;
}

export async function getIntegrationStatuses(force = false): Promise<IntegrationStatus[]> {
  const out: IntegrationStatus[] = [];
  for (const integ of listIntegrations()) {
    const health = await healthFor(integ.id, force);
    const override = getIntegrationOverride(integ.id);
    out.push({
      id: integ.id,
      name: integ.name,
      tool: integ.tool ?? null,
      health,
      override,
      enabled: resolveEnabled(!!integ.tool, health.installed, override),
      widgetCount: widgetCountForIntegration(integ.id),
    });
  }
  return out;
}

export function enableIntegration(id: string): void {
  setIntegrationOverride(id, true);
}

/** Disable an integration. Deletes its widgets; throws "confirm-required" if any exist and !deleteWidgets. */
export function disableIntegration(id: string, deleteWidgets: boolean): { deleted: number } {
  const types = typesForIntegration(id);
  const victims = getWidgets().filter((w) => types.has(w.type));
  if (victims.length && !deleteWidgets) throw new Error("confirm-required");
  for (const w of victims) removeWidget(w.id);
  setIntegrationOverride(id, false);
  return { deleted: victims.length };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- integration-service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/integration-service.ts tests/server/integration-service.test.ts
git commit -m "feat: integration status service (enable/disable, health cache, counts)"
```

---

## Task 9: API routes

**Files:**
- Create: `src/app/api/integrations/route.ts`
- Create: `src/app/api/integrations/[id]/toggle/route.ts`
- Test: `tests/api/integrations.test.ts`

- [ ] **Step 1: GET statuses route**

`src/app/api/integrations/route.ts`:

```ts
import { NextResponse } from "next/server";
import "@/modules/server";
import "@/modules/client";
import "@/modules/integrations";
import { getIntegrationStatuses } from "@/server/integration-service";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const recheck = new URL(req.url).searchParams.get("recheck") === "1";
  return NextResponse.json(await getIntegrationStatuses(recheck));
}
```

- [ ] **Step 2: POST toggle route**

`src/app/api/integrations/[id]/toggle/route.ts`:

```ts
import { NextResponse } from "next/server";
import "@/modules/server";
import "@/modules/client";
import "@/modules/integrations";
import { enableIntegration, disableIntegration, getIntegrationStatuses } from "@/server/integration-service";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { enabled, deleteWidgets = false } = (await req.json()) as { enabled: boolean; deleteWidgets?: boolean };

  if (enabled) {
    enableIntegration(id);
  } else {
    try {
      disableIntegration(id, deleteWidgets);
    } catch (err) {
      if (err instanceof Error && err.message === "confirm-required") {
        const statuses = await getIntegrationStatuses();
        const widgetCount = statuses.find((s) => s.id === id)?.widgetCount ?? 0;
        return NextResponse.json({ error: "confirm-required", widgetCount }, { status: 409 });
      }
      throw err;
    }
  }
  return NextResponse.json(await getIntegrationStatuses(true));
}
```

- [ ] **Step 3: Write the route test**

`tests/api/integrations.test.ts` (check an existing `tests/api/*.test.ts` for the calling convention — routes are plain functions invoked with a `Request`):

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useTempDb } from "../helpers/db";
import { GET } from "@/app/api/integrations/route";
import { POST } from "@/app/api/integrations/[id]/toggle/route";
import { addWidget } from "@/server/config-repo";

beforeEach(() => useTempDb());

async function toggle(id: string, body: object) {
  return POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) });
}

describe("integrations API", () => {
  it("GET returns a status per registered integration", async () => {
    const res = await GET(new Request("http://x/api/integrations"));
    const statuses = await res.json();
    expect(statuses.map((s: { id: string }) => s.id).sort()).toEqual(["github", "gws", "jira"]);
  });

  it("disable with widgets returns 409 confirm-required", async () => {
    addWidget("github.prs", { authors: [], limit: 20 });
    const res = await toggle("github", { enabled: false });
    expect(res.status).toBe(409);
    expect((await res.json()).widgetCount).toBe(1);
  });

  it("confirmed disable deletes widgets and returns updated statuses", async () => {
    addWidget("github.prs", { authors: [], limit: 20 });
    const res = await toggle("github", { enabled: false, deleteWidgets: true });
    expect(res.status).toBe(200);
    const statuses = await res.json();
    expect(statuses.find((s: { id: string }) => s.id === "github").enabled).toBe(false);
  });
});
```

Note: this test hits the real integration probes (spawns `gh`/`jira`/`gws`). If the CI/sandbox lacks those binaries, the probe returns `installed:false` — which is fine, the assertions above don't depend on health, only on ids/enabled-after-override/widget deletion.

- [ ] **Step 4: Run it**

Run: `npm test -- api/integrations`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/integrations tests/api/integrations.test.ts
git commit -m "feat: integrations API routes (status + toggle)"
```

---

## Task 10: Gate the add-widget list to enabled integrations

**Files:**
- Modify: `src/components/add-widget-drawer.tsx`
- Test: `tests/components/add-widget-drawer.test.tsx`

- [ ] **Step 1: Write the failing test**

`tests/components/add-widget-drawer.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AddWidgetDrawer } from "@/components/add-widget-drawer";

vi.mock("@/modules/client-registry", () => ({
  listClientWidgets: () => [
    { type: "github.prs", title: "Pull Requests", integration: "github" },
    { type: "jira.jql", title: "Jira Query", integration: "jira" },
    { type: "core.status", title: "System Status" },
  ],
}));

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([
    { id: "github", enabled: true }, { id: "jira", enabled: false },
  ]))));
});

function open() {
  const qc = new QueryClient();
  render(<QueryClientProvider client={qc}><AddWidgetDrawer onAdd={() => {}} /></QueryClientProvider>);
  fireEvent.click(screen.getByText("Add widget"));
}

describe("AddWidgetDrawer", () => {
  it("shows widgets from enabled integrations and always-available widgets", async () => {
    open();
    expect(await screen.findByText("Pull Requests")).toBeInTheDocument(); // github enabled
    expect(screen.getByText("System Status")).toBeInTheDocument();         // no integration
  });
  it("hides widgets from disabled integrations", async () => {
    open();
    await screen.findByText("Pull Requests");
    expect(screen.queryByText("Jira Query")).not.toBeInTheDocument();      // jira disabled
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- add-widget-drawer`
Expected: FAIL — all widgets currently show regardless of integration.

- [ ] **Step 3: Add the filter**

Edit `src/components/add-widget-drawer.tsx`. Add imports and a query; filter `types` before rendering:

```tsx
"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { listClientWidgets } from "@/modules/client-registry";
import type { IntegrationStatus } from "@/modules/integration-contracts";

export function AddWidgetDrawer({ onAdd }: { onAdd: (type: string) => void }) {
  const [open, setOpen] = useState(false);
  const { data: statuses } = useQuery({
    queryKey: ["integrations"],
    queryFn: async (): Promise<IntegrationStatus[]> => (await fetch("/api/integrations")).json(),
    enabled: open,
  });
  const enabledIds = new Set((statuses ?? []).filter((s) => s.enabled).map((s) => s.id));
  const types = listClientWidgets().filter((t) => !t.integration || enabledIds.has(t.integration));

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    // ...unchanged wrapper/markup down to the <ul>; keep everything else identical...
```

Leave the rest of the component (button, portal, `<ul>` mapping over `types`, empty state) exactly as-is. Only the two computed lines (`enabledIds`, `types`) and the query/imports change.

> UI polish note: the empty-list copy could hint "enable integrations in Settings" — leave functional for now; apply the **impeccable** skill in Task 12's pass if desired.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- add-widget-drawer`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/add-widget-drawer.tsx tests/components/add-widget-drawer.test.tsx
git commit -m "feat: gate add-widget list to enabled integrations"
```

---

## Task 11: Widget "!" indicator

**Files:**
- Modify: `src/components/widget-shell.tsx`
- Modify: `src/components/widget-card.tsx:42-53`
- Test: `tests/components/widget-card.test.tsx` (create if absent)

- [ ] **Step 1: Write the failing test**

`tests/components/widget-card.test.tsx` — render the shell directly (it's the presentational unit):

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WidgetShell } from "@/components/widget-shell";

describe("WidgetShell issue indicator", () => {
  it("renders a warning marker with the message as its title when issue is set", () => {
    render(
      <WidgetShell title="PRs" state="ok" fetchedAt={null} onRefresh={() => {}}
        issue={{ message: "Not authenticated — run `gh auth login`" }}>
        <div>body</div>
      </WidgetShell>
    );
    const marker = screen.getByLabelText("Has an issue");
    expect(marker).toHaveAttribute("title", expect.stringContaining("gh auth login"));
  });

  it("omits the marker when there is no issue", () => {
    render(<WidgetShell title="PRs" state="ok" fetchedAt={null} onRefresh={() => {}}><div>ok</div></WidgetShell>);
    expect(screen.queryByLabelText("Has an issue")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- widget-card`
Expected: FAIL — `issue` prop unknown; marker absent.

- [ ] **Step 3: Add the `issue` prop to WidgetShell**

In `src/components/widget-shell.tsx`, add `issue` to the props type and render a marker in the header cluster (before `fetchedAt`). Add to the destructured props and the type:

```tsx
export function WidgetShell({
  title, state, error, fetchedAt, onRefresh, refreshing, children, headerExtra, menu, dragHandle, issue,
}: {
  title: string;
  state: WidgetState;
  error?: string | null;
  fetchedAt: number | null;
  onRefresh: () => void;
  refreshing?: boolean;
  children?: ReactNode;
  headerExtra?: ReactNode;
  menu?: ReactNode;
  dragHandle?: DragHandle;
  issue?: { message: string } | null;
}) {
```

Then inside the right-hand `<div className="flex shrink-0 items-center gap-1.5 ...">`, add the marker as the first child:

```tsx
<div className="flex shrink-0 items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
  {issue && (
    <span
      aria-label="Has an issue"
      title={issue.message}
      className="grid h-5 w-5 place-items-center rounded text-warn"
    >
      <span aria-hidden className="text-[0.95rem] leading-none">⚠</span>
    </span>
  )}
  {fetchedAt && <span className="tabular-nums">{ago(fetchedAt)}</span>}
  {headerExtra}
  {menu}
  {/* refresh button unchanged */}
```

- [ ] **Step 4: Wire it from WidgetCard and drop the stale pill**

In `src/components/widget-card.tsx`, remove the `headerExtra` stale-pill block and pass `issue` instead:

```tsx
  return (
    <WidgetShell
      title={widget.title ?? def.title}
      state={state}
      error={data?.error}
      fetchedAt={data?.fetchedAt ?? null}
      onRefresh={refresh}
      refreshing={isRefreshing}
      menu={menu}
      dragHandle={dragHandle}
      issue={errored ? { message: data?.error ?? "Refresh failed" } : null}
    >
      {hasData && (
        <Body data={data!.payload} config={widget.config} runAction={async () => {}} />
      )}
    </WidgetShell>
  );
```

(`errored` is already computed as `data?.status === "error"` above.)

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npm test -- widget-card`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/widget-shell.tsx src/components/widget-card.tsx tests/components/widget-card.test.tsx
git commit -m "feat: warning indicator on widgets with a failed fetch"
```

---

## Task 12: `/integrations` page + panel

**Files:**
- Create: `src/app/integrations/page.tsx`
- Create: `src/components/integrations-panel.tsx`
- Test: `tests/components/integrations-panel.test.tsx`

- [ ] **Step 1: Server page**

`src/app/integrations/page.tsx`:

```tsx
import "@/modules/server";
import "@/modules/client";
import "@/modules/integrations";
import { getIntegrationStatuses } from "@/server/integration-service";
import { IntegrationsPanel } from "@/components/integrations-panel";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const initial = await getIntegrationStatuses();
  return <IntegrationsPanel initial={initial} />;
}
```

- [ ] **Step 2: Write the failing test for the panel**

`tests/components/integrations-panel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { IntegrationsPanel } from "@/components/integrations-panel";
import type { IntegrationStatus } from "@/modules/integration-contracts";

const base: IntegrationStatus[] = [
  { id: "github", name: "GitHub", tool: { bin: "gh", installHint: "install gh", authHint: "gh auth login" },
    health: { installed: true, authed: false, detail: "Not authenticated" }, enabled: true, override: null, widgetCount: 0 },
  { id: "gws", name: "Google Workspace", tool: { bin: "gws", installHint: "install gws", authHint: "gws auth login" },
    health: { installed: false, authed: false }, enabled: false, override: null, widgetCount: 0 },
];

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(base))));
});

describe("IntegrationsPanel", () => {
  it("lists integrations and shows the auth hint when unauthenticated", () => {
    render(<IntegrationsPanel initial={base} />);
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.getByText(/gh auth login/)).toBeInTheDocument();      // authHint shown
    expect(screen.getByText(/install gws/)).toBeInTheDocument();        // installHint shown for missing tool
  });

  it("prompts for confirmation before disabling an integration with widgets", async () => {
    const withWidgets = [{ ...base[0], widgetCount: 3 }];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(withWidgets))));
    render(<IntegrationsPanel initial={withWidgets} />);
    fireEvent.click(screen.getByRole("button", { name: /disable github/i }));
    expect(await screen.findByText(/permanently removes 3/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npm test -- integrations-panel`
Expected: FAIL — component not found.

- [ ] **Step 4: Implement the panel**

`src/components/integrations-panel.tsx`:

```tsx
"use client";
import { useState } from "react";
import type { IntegrationStatus } from "@/modules/integration-contracts";

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span aria-hidden className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-500" : "bg-slate-300 dark:bg-white/20"}`} />
      {label}
    </span>
  );
}

export function IntegrationsPanel({ initial }: { initial: IntegrationStatus[] }) {
  const [statuses, setStatuses] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<IntegrationStatus | null>(null);

  async function post(id: string, enabled: boolean, deleteWidgets = false) {
    setBusy(true);
    try {
      const res = await fetch(`/api/integrations/${id}/toggle`, {
        method: "POST", body: JSON.stringify({ enabled, deleteWidgets }),
      });
      if (res.status === 409) { setConfirm(statuses.find((s) => s.id === id) ?? null); return; }
      if (res.ok) setStatuses(await res.json());
    } finally { setBusy(false); }
  }

  async function recheck() {
    setBusy(true);
    try {
      const res = await fetch("/api/integrations?recheck=1");
      if (res.ok) setStatuses(await res.json());
    } finally { setBusy(false); }
  }

  function onToggle(s: IntegrationStatus) {
    if (s.enabled && s.widgetCount > 0) { setConfirm(s); return; }
    void post(s.id, !s.enabled);
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <a href="/" className="text-xs text-slate-500 hover:underline dark:text-slate-400">← Dashboard</a>
          <h1 className="mt-1 text-lg font-semibold tracking-tight">Integrations</h1>
        </div>
        <button onClick={recheck} disabled={busy} className="btn">Re-check</button>
      </div>

      <ul className="space-y-3">
        {statuses.map((s) => {
          const authUnknown = s.health.authed === "n/a";
          const authed = s.health.authed === true;
          return (
            <li key={s.id} className="rounded-xl bg-card p-4 ring-1 ring-border dark:bg-card-dark dark:ring-border-dark">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{s.name}</span>
                    {!authUnknown && s.health.installed && !authed && (
                      <span aria-label="Has an issue" title={s.health.detail ?? "Not authenticated"} className="text-warn">⚠</span>
                    )}
                  </div>
                  <div className="mt-1.5 flex gap-4">
                    {s.tool && <StatusDot ok={s.health.installed} label={s.health.installed ? "Installed" : "Not installed"} />}
                    {s.tool && !authUnknown && <StatusDot ok={authed} label={authed ? "Authenticated" : "Not authenticated"} />}
                  </div>
                </div>
                <button
                  onClick={() => onToggle(s)}
                  disabled={busy}
                  aria-label={`${s.enabled ? "Disable" : "Enable"} ${s.name}`}
                  aria-pressed={s.enabled}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 transition-colors ${
                    s.enabled ? "bg-primary-600 text-white ring-primary-600"
                      : "text-slate-600 ring-border hover:bg-slate-50 dark:text-slate-300 dark:ring-border-dark dark:hover:bg-white/5"
                  }`}
                >
                  {s.enabled ? "Enabled" : "Disabled"}
                </button>
              </div>

              {s.tool && !s.health.installed && (
                <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-white/5 dark:text-slate-300">{s.tool.installHint}</p>
              )}
              {s.tool && s.health.installed && !authed && !authUnknown && (
                <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-white/5 dark:text-slate-300">{s.tool.authHint}</p>
              )}
            </li>
          );
        })}
      </ul>

      {confirm && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 dark:bg-black/60" onClick={() => setConfirm(null)}>
          <div className="w-80 rounded-xl bg-panel p-5 shadow-xl dark:bg-panel-dark" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-sm font-semibold">Disable {confirm.name}?</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              This permanently removes {confirm.widgetCount} {confirm.name} widget{confirm.widgetCount === 1 ? "" : "s"} from your dashboard. Re-enabling won’t bring them back.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn" onClick={() => setConfirm(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => { const c = confirm; setConfirm(null); void post(c.id, false, true); }}>Delete & disable</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
```

> If `btn` / `btn-danger` utility classes don't exist in `globals.css`, either add them or inline equivalent Tailwind. Check `src/app/globals.css` for the existing `btn` definitions (used by `add-widget-drawer`). Apply the **impeccable** and **tailwind** skills for the visual pass here.

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npm test -- integrations-panel`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/integrations/page.tsx src/components/integrations-panel.tsx tests/components/integrations-panel.test.tsx
git commit -m "feat: integrations status page"
```

---

## Task 13: Header link to `/integrations`

**Files:**
- Modify: `src/components/dashboard.tsx:60-63`

- [ ] **Step 1: Add the link in the Toolbar**

In `src/components/dashboard.tsx`, inside the toolbar's right-hand cluster, add a link before `<AddWidgetDrawer .../>`:

```tsx
        <div className="flex items-center gap-3">
          <AutoRefreshControls />
          <a
            href="/integrations"
            aria-label="Integrations"
            title="Integrations"
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 ring-1 ring-border transition-colors hover:bg-slate-50 hover:text-slate-700 dark:text-slate-400 dark:ring-border-dark dark:hover:bg-white/5"
          >
            🔌
          </a>
          <AddWidgetDrawer onAdd={onAdd} />
        </div>
```

- [ ] **Step 2: Verify manually**

Run: `npm run dev`; confirm the plug icon appears in the header and navigates to `/integrations`, which lists GitHub, Jira and Google Workspace with correct install/auth status and working toggles. Add a widget from an enabled integration, then disable that integration and confirm the deletion dialog reports the right count and removes the widget.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard.tsx
git commit -m "feat: link to integrations page from the header"
```

---

## Task 14: Full verification

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: successful production build (catches server/client import boundary issues — e.g. accidental `server-only` in a client path).

- [ ] **Step 4: Final commit (if lint/build produced fixes)**

```bash
git add -A
git commit -m "chore: lint/build fixes for integrations layer"
```

---

## Self-Review Notes (completed during planning)

- **Spec coverage:** integration abstraction (T3–T6), `/integrations` UI with install/auth instructions (T12), add-list gating (T10), warning "!" with hover (T11), enabled computed-default + override (T7–T8), auth orthogonal to enabled (resolver in T8), disable-deletes-with-confirmation (T8/T9/T12), health probe + 30s cache + re-check (T8/T9/T12), error-kind propagation (T1–T2). All covered.
- **Deviations from spec** documented at top: no `core`/`system` integration; association on `ClientWidget` only.
- **Type consistency:** `IntegrationHealth`/`IntegrationStatus`/`IntegrationTool` defined in T3 and used unchanged in T8–T12; `CacheInput.errorKind` (T1) consumed in T2; `resolveEnabled` signature stable across T8 test/impl; `issue={{message}}` prop shape consistent T11 shell/card/test.
- **Probe commands** (`gh auth status`, `jira me`, `gws ... getProfile`) are the one version-dependent risk — T6 Step 7 verifies and adjusts against the installed CLIs.
