# Plugin Architecture Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the widget contract around a shared manifest (explicit `refreshable`, additive `HeaderControls`, no dead actions API), move bookmarks to a module-owned table, and harden the data flow (config parse on read, per-card ErrorBoundary, cache versioning, squashed migrations).

**Architecture:** Each widget exports one `WidgetManifest` object from its `manifest.ts`; both `registerFetch` and `registerRender` consume the same object, so shared fields cannot drift. Widget bodies get `{ data, config, refresh }` — mutations are plain module-function calls followed by `refresh()`. Storage stays Drizzle/SQLite via `getDb()`; migrations are squashed to a single baseline (greenfield, no back-compat).

**Tech Stack:** Tauri v2, Vite 6, React 19, TypeScript, Zod, Drizzle ORM (sqlite-proxy), TanStack Query, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-11-plugin-architecture-hardening-design.md`

## Global Constraints

- Personal project: **no Jira prefix** on commits/branches; plain conventional commits (e.g. `feat: …`).
- End every commit message with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Greenfield: breaking contract changes land in one commit each; no deprecation shims. The local `dashboard.db` is reset once in Task 8 (existing bookmarks in the old DB are re-added manually afterwards).
- All repo functions are **async** (`getDb()` uses the sqlite-proxy driver); always `await`.
- Match existing idioms: Tailwind v4 utility classes as in neighboring files, `@/` path alias, `.get()` for single-row Drizzle reads.
- Tests run with `npm test` (Vitest; `tests/helpers/db.ts` gives a migrated temp DB via `useTempDb()`).
- Verify types with `npx tsc --noEmit` before each commit (Vitest does not typecheck).

---

### Task 1: Bookmarks repo (module-owned table)

The `bookmarks` table already exists in `src/db/schema.ts:14` (`id`, `title`, `url`, `icon`, `order`) — it is currently orphaned. Give it a repo.

**Files:**
- Create: `src/modules/bookmarks/repo.ts`
- Test: `tests/modules/bookmarks-repo.test.ts`

**Interfaces:**
- Consumes: `getDb()` from `@/db/client`, `bookmarks` from `@/db/schema`.
- Produces (used by Task 3):
  - `type BookmarkRow = typeof bookmarks.$inferSelect` (`{ id: string; title: string; url: string; icon: string | null; order: number }`)
  - `listBookmarks(): Promise<BookmarkRow[]>`
  - `addBookmark(title: string, url: string): Promise<BookmarkRow>`
  - `removeBookmark(id: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `tests/modules/bookmarks-repo.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useTempDb } from "../helpers/db";
import { listBookmarks, addBookmark, removeBookmark } from "@/modules/bookmarks/repo";

beforeEach(() => useTempDb());

describe("bookmarks repo", () => {
  it("starts empty", async () => {
    expect(await listBookmarks()).toEqual([]);
  });

  it("adds bookmarks and lists them in insertion order", async () => {
    const a = await addBookmark("Acme", "https://example.com/");
    await addBookmark("GitHub", "https://github.com/");
    const rows = await listBookmarks();
    expect(rows.map((r) => r.title)).toEqual(["Acme", "GitHub"]);
    expect(rows[0].id).toBe(a.id);
    expect(rows[1].order).toBeGreaterThan(rows[0].order);
  });

  it("removes a bookmark by id", async () => {
    const a = await addBookmark("Acme", "https://example.com/");
    await addBookmark("GitHub", "https://github.com/");
    await removeBookmark(a.id);
    expect((await listBookmarks()).map((r) => r.title)).toEqual(["GitHub"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/modules/bookmarks-repo.test.ts`
Expected: FAIL — cannot resolve `@/modules/bookmarks/repo`.

- [ ] **Step 3: Write the implementation**

Create `src/modules/bookmarks/repo.ts`:

```ts
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { bookmarks } from "@/db/schema";

export type BookmarkRow = typeof bookmarks.$inferSelect;

export async function listBookmarks(): Promise<BookmarkRow[]> {
  return getDb().select().from(bookmarks).orderBy(asc(bookmarks.order));
}

export async function addBookmark(title: string, url: string): Promise<BookmarkRow> {
  const existing = await listBookmarks();
  const order = existing.reduce((max, b) => Math.max(max, b.order + 1), 0);
  const row: BookmarkRow = { id: crypto.randomUUID(), title, url, icon: null, order };
  await getDb().insert(bookmarks).values(row);
  return row;
}

export async function removeBookmark(id: string): Promise<void> {
  await getDb().delete(bookmarks).where(eq(bookmarks.id, id));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/modules/bookmarks-repo.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit
git add src/modules/bookmarks/repo.ts tests/modules/bookmarks-repo.test.ts
git commit -m "feat: bookmarks repo over the (previously orphaned) bookmarks table

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Manifest-based contract + registry migration

One atomic breaking change: shared `WidgetManifest`, `registerFetch(manifest, {fetch})` / `registerRender(manifest, extras)`, delete the dead actions API (`WidgetAction`, `FetchWidget.actions`, `runAction`). `saveConfig` survives until Task 3. `refreshable` is declared here but consumed by the UI in Task 4.

**Files:**
- Modify: `src/modules/contracts.ts` (full rewrite)
- Modify: `src/modules/fetch-registry.ts`, `src/modules/render-registry.ts` (full rewrites)
- Modify: `src/modules/{core,github,jira,gws,bookmarks}/manifest.ts` (add manifest objects)
- Modify: `src/modules/{core,github,jira,gws,bookmarks}/{fetch,render}.ts` (new registration calls)
- Modify: `src/lib/dashboard-data.ts:26-28,40-41`, `src/server/config-repo.ts:19-20`, `src/components/widget-card.tsx`, `src/components/configure-dialog.tsx`
- Test: `tests/modules/registry.test.ts` (rewrite), `tests/server/widget-service.test.ts`, `tests/modules/*-registration.test.ts`, `tests/modules/github-widgets.test.tsx`, `tests/modules/jira-widget.test.tsx`

**Interfaces:**
- Produces (used by every later task):
  - `WidgetManifest<Config>` = `{ type: string; title: string; configSchema: ZodType<Config>; defaultConfig: Config; refreshable?: boolean; integration?: string }`
  - `defineManifest<Config>(m): WidgetManifest<Config>` (identity; infers `Config`)
  - `FetchWidget<Data, Config>` = `{ manifest: WidgetManifest<Config>; fetch(config: Config): Promise<Data> }`
  - `RenderWidget<Data, Config>` = `{ manifest; Component; icon?; count?; HeaderControls?; formEditable? }`
  - `registerFetch(manifest, { fetch })`, `registerRender(manifest, extras)`; `getFetchWidget` / `getRenderWidget` / `listFetchTypes` / `listRenderWidgets` keep their names and (for `listRenderWidgets`) their output shape `{ type, title, integration?, icon? }`.
- Consumer access-path change everywhere: `def.type/title/configSchema/defaultConfig/integration` → `def.manifest.*`. `def.fetch`, `def.Component`, `def.icon`, `def.count`, `def.HeaderControls`, `def.formEditable` stay top-level.

- [ ] **Step 1: Rewrite `src/modules/contracts.ts`**

```ts
import type { ZodType } from "zod";
import type { FC } from "react";
import type { IconType } from "react-icons";

/** A brand logo + the classes that carry its brand color (incl. any dark-mode override). */
export interface BrandMark {
  Icon: IconType;
  className?: string;
}

/**
 * Widget identity + everything shared by the fetch and render sides.
 * Lives in the module's manifest.ts (no runtime deps) and is passed to BOTH
 * registerFetch and registerRender, so shared fields cannot drift.
 */
export interface WidgetManifest<Config = unknown> {
  type: string;
  title: string;
  configSchema: ZodType<Config>;
  defaultConfig: Config;
  /** Default true. False = no refresh button, no fetchedAt, no auto-refresh. */
  refreshable?: boolean;
  /** Id of the integration this widget belongs to; omit for always-available widgets (e.g. core). */
  integration?: string;
}

/** Identity helper so Config is inferred from configSchema/defaultConfig. */
export function defineManifest<Config>(m: WidgetManifest<Config>): WidgetManifest<Config> {
  return m;
}

export interface WidgetBodyProps<Data = unknown, Config = unknown> {
  data: Data;
  config: Config;
  /**
   * Persist a new config for this widget (PATCH + re-fetch + cache update).
   * Only `data` is refreshed, not the `config` prop — derive the next config
   * from `data`, not from the (now stale) `config` prop.
   */
  saveConfig: (next: Config) => Promise<void>;
}

/** How a widget gets its data: the shared manifest + the fetch side. */
export interface FetchWidget<Data = unknown, Config = unknown> {
  manifest: WidgetManifest<Config>;
  fetch(config: Config): Promise<Data>;
}

/** How a widget renders: the shared manifest + the render side. */
export interface RenderWidget<Data = unknown, Config = unknown> {
  manifest: WidgetManifest<Config>;
  Component: FC<WidgetBodyProps<Data, Config>>;
  /** Brand logo shown beside the title; stays render-side (react-icons is a runtime dep). */
  icon?: BrandMark;
  /** Item count shown next to the title (total fetched, pre-limit). Omit to show no count. */
  count?(data: Data, config: Config): number | null;
  /** Optional extra header control(s); rendered next to the built-in refresh button (Task 4). */
  HeaderControls?: FC<WidgetBodyProps<Data, Config>>;
  /** When false, the Configure dialog hides the auto-generated config form. Default true. */
  formEditable?: boolean;
}
```

(`WidgetAction` and `FetchWidget.actions` are gone; `runAction` is gone from `WidgetBodyProps`.)

- [ ] **Step 2: Rewrite `src/modules/fetch-registry.ts`**

```ts
import type { FetchWidget, WidgetManifest } from "./contracts";

const registry = new Map<string, FetchWidget>();

export function registerFetch<Data, Config>(
  manifest: WidgetManifest<Config>,
  extras: { fetch(config: Config): Promise<Data> },
): void {
  if (registry.has(manifest.type)) throw new Error(`Fetch widget already registered: ${manifest.type}`);
  registry.set(manifest.type, { manifest, fetch: extras.fetch } as FetchWidget);
}

export function getFetchWidget(type: string): FetchWidget | undefined {
  return registry.get(type);
}

export function listFetchTypes(): string[] {
  return [...registry.keys()];
}

export function __clearFetchRegistry(): void {
  registry.clear();
}
```

- [ ] **Step 3: Rewrite `src/modules/render-registry.ts`**

```ts
import type { BrandMark, RenderWidget, WidgetManifest } from "./contracts";

const registry = new Map<string, RenderWidget>();

export function registerRender<Data, Config>(
  manifest: WidgetManifest<Config>,
  extras: Omit<RenderWidget<Data, Config>, "manifest">,
): void {
  if (registry.has(manifest.type)) throw new Error(`Render widget already registered: ${manifest.type}`);
  registry.set(manifest.type, { manifest, ...extras } as unknown as RenderWidget);
}

export function getRenderWidget(type: string): RenderWidget | undefined {
  return registry.get(type);
}

export function listRenderWidgets(): { type: string; title: string; integration?: string; icon?: BrandMark }[] {
  return [...registry.values()].map((d) => ({
    type: d.manifest.type,
    title: d.manifest.title,
    integration: d.manifest.integration,
    icon: d.icon,
  }));
}

export function __clearRenderRegistry(): void {
  registry.clear();
}
```

- [ ] **Step 4: Add manifest objects to each module's `manifest.ts`**

Titles move here from `render.ts`; `integration` moves here from the render registrations. Append to each file (imports: add `defineManifest` from `@/modules/contracts`):

`src/modules/core/manifest.ts`:

```ts
export const statusManifest = defineManifest({
  type: STATUS_TYPE,
  title: "System Status",
  configSchema: statusConfigSchema,
  defaultConfig: statusDefaultConfig,
});
```

`src/modules/github/manifest.ts`:

```ts
export const prsManifest = defineManifest({
  type: PRS_TYPE, title: "Pull Requests",
  configSchema: prsConfigSchema, defaultConfig: prsDefaultConfig,
  integration: "github",
});
export const failingActionsManifest = defineManifest({
  type: FAILING_ACTIONS_TYPE, title: "Failing Actions",
  configSchema: failingActionsConfigSchema, defaultConfig: failingActionsDefaultConfig,
  integration: "github",
});
export const dependabotManifest = defineManifest({
  type: DEPENDABOT_TYPE, title: "Dependabot Alerts",
  configSchema: dependabotConfigSchema, defaultConfig: dependabotDefaultConfig,
  integration: "github",
});
```

`src/modules/jira/manifest.ts`:

```ts
export const jqlManifest = defineManifest({
  type: JQL_TYPE, title: "Jira Query",
  configSchema: jqlConfigSchema, defaultConfig: jqlDefaultConfig,
  integration: "jira",
});
```

`src/modules/gws/manifest.ts`:

```ts
export const gmailManifest = defineManifest({
  type: GMAIL_TYPE, title: "Gmail",
  configSchema: gmailConfigSchema, defaultConfig: gmailDefaultConfig,
  integration: "gws",
});
export const calendarManifest = defineManifest({
  type: CALENDAR_TYPE, title: "Calendar",
  configSchema: calendarConfigSchema, defaultConfig: calendarDefaultConfig,
  integration: "gws",
});
export const chatDmsManifest = defineManifest({
  type: CHAT_DMS_TYPE, title: "Unread DMs",
  configSchema: chatDmsConfigSchema, defaultConfig: chatDmsDefaultConfig,
  integration: "gws",
});
export const chatChannelsManifest = defineManifest({
  type: CHAT_CHANNELS_TYPE, title: "Chat Channels",
  configSchema: chatChannelsConfigSchema, defaultConfig: chatChannelsDefaultConfig,
  integration: "gws",
});
export const driveManifest = defineManifest({
  type: DRIVE_TYPE, title: "Starred files",
  configSchema: driveConfigSchema, defaultConfig: driveDefaultConfig,
  integration: "gws",
});
export const tasksManifest = defineManifest({
  type: TASKS_TYPE, title: "Tasks",
  configSchema: tasksConfigSchema, defaultConfig: tasksDefaultConfig,
  integration: "gws",
});
```

`src/modules/bookmarks/manifest.ts` (config schema still carries bookmarks until Task 3):

```ts
export const bookmarksManifest = defineManifest({
  type: BOOKMARKS_TYPE, title: "Bookmarks",
  configSchema: bookmarksConfigSchema, defaultConfig: bookmarksDefaultConfig,
  refreshable: false,
});
```

- [ ] **Step 5: Update every module's `fetch.ts` and `render.ts`**

`src/modules/core/fetch.ts`:

```ts
import { platform, version, arch } from "@tauri-apps/plugin-os";
import { registerFetch } from "@/modules/fetch-registry";
import { statusManifest, type StatusData } from "./manifest";

export async function fetchStatus(): Promise<StatusData> {
  // plugin-os platform()/version()/arch() are synchronous getters in v2.
  return { now: new Date().toISOString(), platform: platform(), osVersion: version(), arch: arch() };
}

registerFetch(statusManifest, { fetch: fetchStatus });
```

`src/modules/core/render.ts`:

```ts
import { registerRender } from "@/modules/render-registry";
import { statusManifest } from "./manifest";
import { StatusWidget } from "./widgets/status-widget";

registerRender(statusManifest, { Component: StatusWidget });
```

`src/modules/github/fetch.ts`:

```ts
import { registerFetch } from "@/modules/fetch-registry";
import { prsManifest, failingActionsManifest, dependabotManifest } from "./manifest";
import { fetchPrs } from "./prs";
import { fetchFailingActions } from "./runs";
import { fetchDependabot } from "./dependabot";

registerFetch(prsManifest, { fetch: fetchPrs });
registerFetch(failingActionsManifest, { fetch: fetchFailingActions });
registerFetch(dependabotManifest, { fetch: fetchDependabot });
```

`src/modules/github/render.ts`:

```ts
import { SiGithub, SiGithubactions, SiDependabot } from "react-icons/si";
import { registerRender } from "@/modules/render-registry";
import { prsManifest, failingActionsManifest, dependabotManifest } from "./manifest";
import { PrListWidget } from "./widgets/pr-list-widget";
import { FailingActionsWidget } from "./widgets/failing-actions-widget";
import { DependabotWidget } from "./widgets/dependabot-widget";

registerRender(prsManifest, {
  Component: PrListWidget,
  count: (d) => d.prs.length,
  icon: { Icon: SiGithub, className: "text-[#181717] dark:text-white" },
});
registerRender(failingActionsManifest, {
  Component: FailingActionsWidget,
  count: (d) => d.runs.length,
  icon: { Icon: SiGithubactions, className: "text-[#2088FF]" },
});
registerRender(dependabotManifest, {
  Component: DependabotWidget,
  count: (d) => d.alerts.length,
  icon: { Icon: SiDependabot, className: "text-[#025E8C]" },
});
```

`src/modules/jira/fetch.ts`:

```ts
import { registerFetch } from "@/modules/fetch-registry";
import { jqlManifest } from "./manifest";
import { fetchJql } from "./jql";

registerFetch(jqlManifest, { fetch: fetchJql });
```

`src/modules/jira/render.ts`:

```ts
import { SiJira } from "react-icons/si";
import { registerRender } from "@/modules/render-registry";
import { jqlManifest } from "./manifest";
import { JqlWidget } from "./widgets/jql-widget";

registerRender(jqlManifest, {
  Component: JqlWidget,
  count: (d) => d.issues.length,
  icon: { Icon: SiJira, className: "text-[#0052CC]" },
});
```

`src/modules/gws/fetch.ts`:

```ts
import { registerFetch } from "@/modules/fetch-registry";
import {
  gmailManifest, calendarManifest, chatDmsManifest, chatChannelsManifest, driveManifest, tasksManifest,
} from "./manifest";
import { fetchGmail } from "./gmail";
import { fetchCalendar } from "./calendar";
import { fetchChatDms, fetchChatChannels } from "./chat";
import { fetchDrive } from "./drive";
import { fetchTasks } from "./tasks";

registerFetch(gmailManifest, { fetch: fetchGmail });
registerFetch(calendarManifest, { fetch: fetchCalendar });
registerFetch(chatDmsManifest, { fetch: fetchChatDms });
registerFetch(chatChannelsManifest, { fetch: fetchChatChannels });
registerFetch(driveManifest, { fetch: fetchDrive });
registerFetch(tasksManifest, { fetch: fetchTasks });
```

`src/modules/gws/render.ts`:

```ts
import {
  SiGmail, SiGooglecalendar, SiGooglechat, SiGoogledrive, SiGoogletasks,
} from "react-icons/si";
import { registerRender } from "@/modules/render-registry";
import {
  gmailManifest, calendarManifest, chatDmsManifest, chatChannelsManifest, driveManifest, tasksManifest,
  filterDriveFiles,
} from "./manifest";
import { GmailWidget } from "./widgets/gmail-widget";
import { CalendarWidget } from "./widgets/calendar-widget";
import { ChatDmsWidget } from "./widgets/chat-dms-widget";
import { ChatChannelsWidget } from "./widgets/chat-channels-widget";
import { DriveWidget } from "./widgets/drive-widget";
import { TasksWidget } from "./widgets/tasks-widget";

registerRender(gmailManifest, {
  Component: GmailWidget,
  count: (d) => d.emails.length,
  icon: { Icon: SiGmail, className: "text-[#EA4335]" },
});
registerRender(calendarManifest, {
  Component: CalendarWidget,
  count: (d) => d.events.length,
  icon: { Icon: SiGooglecalendar, className: "text-[#4285F4]" },
});
registerRender(chatDmsManifest, {
  Component: ChatDmsWidget,
  count: (d) => d.dms.length,
  icon: { Icon: SiGooglechat, className: "text-[#34A853]" },
});
registerRender(chatChannelsManifest, {
  Component: ChatChannelsWidget,
  count: (d) => d.channels.length,
  icon: { Icon: SiGooglechat, className: "text-[#34A853]" },
});
registerRender(driveManifest, {
  Component: DriveWidget,
  count: (d, c) => filterDriveFiles(d.files, c).length,
  icon: { Icon: SiGoogledrive, className: "text-[#4285F4]" },
});
registerRender(tasksManifest, {
  Component: TasksWidget,
  count: (d) => d.tasks.length,
  icon: { Icon: SiGoogletasks, className: "text-[#4285F4]" },
});
```

`src/modules/bookmarks/fetch.ts`:

```ts
import { registerFetch } from "@/modules/fetch-registry";
import { bookmarksManifest, type BookmarksConfig, type BookmarksData } from "./manifest";

export async function fetchBookmarks(config: BookmarksConfig): Promise<BookmarksData> {
  return { bookmarks: config.bookmarks };
}

registerFetch(bookmarksManifest, { fetch: fetchBookmarks });
```

`src/modules/bookmarks/render.ts`:

```ts
import { FaRegBookmark } from "react-icons/fa6";
import { registerRender } from "@/modules/render-registry";
import { bookmarksManifest } from "./manifest";
import { BookmarksWidget, BookmarksHeaderControls } from "./widgets/bookmarks-widget";

registerRender(bookmarksManifest, {
  Component: BookmarksWidget,
  count: (d) => d.bookmarks.length,
  formEditable: false,
  HeaderControls: BookmarksHeaderControls,
  icon: { Icon: FaRegBookmark, className: "text-slate-500 dark:text-slate-400" },
});
```

- [ ] **Step 6: Update the shell consumers (access-path changes)**

`src/lib/dashboard-data.ts` — in `createWidget` (line 28) and `updateWidget` (line 41):

```ts
  return repoAddWidget(type, def.manifest.defaultConfig as Record<string, unknown>);
```

```ts
    const parsed = def?.manifest.configSchema.safeParse(patch.config);
```

`src/server/config-repo.ts:20`:

```ts
  const validated = def ? (def.manifest.configSchema.parse(config) as Record<string, unknown>) : config;
```

`src/components/widget-card.tsx`:
- `title={widget.title ?? def.title}` → `title={widget.title ?? def.manifest.title}`
- Remove `runAction={async () => {}}` from BOTH the `<HeaderControls …>` and `<Body …>` call sites (keep `saveConfig`).

`src/components/configure-dialog.tsx` — replace every `def.title` with `def.manifest.title` (aria-label, `<h2>`, title-input `placeholder`, help text) and `def.configSchema` with `def.manifest.configSchema` in the `<SchemaForm>` call. `def.formEditable` stays.

(`src/components/add-widget-drawer.tsx` and `src/server/integration-service.ts` need no change — `listRenderWidgets()` keeps its output shape.)

- [ ] **Step 7: Rewrite `tests/modules/registry.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { defineManifest } from "@/modules/contracts";
import {
  registerFetch, getFetchWidget, listFetchTypes, __clearFetchRegistry,
} from "@/modules/fetch-registry";
import {
  registerRender, getRenderWidget, listRenderWidgets, __clearRenderRegistry,
} from "@/modules/render-registry";

const manifest = defineManifest({
  type: "t.a", title: "A", configSchema: z.object({}), defaultConfig: {},
});

beforeEach(() => {
  __clearFetchRegistry();
  __clearRenderRegistry();
});

describe("registries", () => {
  it("registers and resolves a fetch widget", () => {
    registerFetch(manifest, { fetch: async () => 1 });
    expect(getFetchWidget("t.a")?.manifest.type).toBe("t.a");
    expect(listFetchTypes()).toContain("t.a");
  });

  it("throws on duplicate fetch registration", () => {
    registerFetch(manifest, { fetch: async () => 1 });
    expect(() => registerFetch(manifest, { fetch: async () => 1 })).toThrow(/already registered/);
  });

  it("registers and lists a render widget", () => {
    registerRender(manifest, { Component: () => null });
    expect(getRenderWidget("t.a")?.manifest.title).toBe("A");
    expect(listRenderWidgets()).toEqual([{ type: "t.a", title: "A", integration: undefined, icon: undefined }]);
  });

  it("both registries share the same manifest object", () => {
    registerFetch(manifest, { fetch: async () => 1 });
    registerRender(manifest, { Component: () => null });
    expect(getFetchWidget("t.a")!.manifest).toBe(getRenderWidget("t.a")!.manifest);
  });

  it("render widgets carry an integration id where applicable", async () => {
    await import("@/modules/render");
    const { listRenderWidgets } = await import("@/modules/render-registry");
    const byType = Object.fromEntries(listRenderWidgets().map((w) => [w.type, w.integration]));
    expect(byType["github.prs"]).toBe("github");
    expect(byType["jira.jql"]).toBe("jira");
    expect(byType["gws.gmail"]).toBe("gws");
    expect(byType["core.status"]).toBeUndefined();
  });
});
```

- [ ] **Step 8: Update the remaining tests to the new API**

`tests/server/widget-service.test.ts` — replace the three `registerFetchWidget({...})` calls (imports: `registerFetch` instead of `registerFetchWidget`; add `defineManifest` from `@/modules/contracts`):

```ts
  registerFetch(
    defineManifest({ type: "test.count", title: "Count", configSchema: z.object({}), defaultConfig: {} }),
    { fetch: async () => ({ n: ++calls }) },
  );
  registerFetch(
    defineManifest({ type: "test.boom", title: "Boom", configSchema: z.object({}), defaultConfig: {} }),
    { fetch: async () => { throw new Error("kaput"); } },
  );
```

and in the CliError test:

```ts
    registerFetch(
      defineManifest({ type: "fake.authfail", title: "Auth", configSchema: z.object({}), defaultConfig: {} }),
      { fetch: async () => { throw new CliError("Not authenticated — run `gh auth login`", "auth"); } },
    );
```

`tests/modules/core-registration.test.ts` — `getRenderWidget(STATUS_TYPE)?.title` → `getRenderWidget(STATUS_TYPE)?.manifest.title`.

`tests/modules/bookmarks-registration.test.ts` — change `def!.defaultConfig` to `def!.manifest.defaultConfig` (both describe blocks), `def!.title` to `def!.manifest.title`, `def!.configSchema` to `def!.manifest.configSchema`.

Add to EVERY per-module registration test (`core`, `github`, `jira`, `gws`, `bookmarks`) an assertion that both sides share the manifest, e.g. for github inside the existing loop:

```ts
      expect(getFetchWidget(t)!.manifest).toBe(getRenderWidget(t)!.manifest);
```

(same one-liner with the module's type constant(s) in the other four files).

`tests/modules/github-widgets.test.tsx` and `tests/modules/jira-widget.test.tsx` — delete `runAction={noop}` from every render call (keep `saveConfig={noop}`).

Check the `gws`/`jira`/`integrations` registration tests for any other `def.title`/`def.defaultConfig` access and apply the same `def.manifest.*` rewrite.

- [ ] **Step 9: Run the full suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all tests PASS, no type errors.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor!: manifest-based widget contract; drop dead actions API

Both registries now consume one WidgetManifest per widget (type/title/
schema/defaults/refreshable/integration), so fetch/render can't drift.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `WidgetBodyProps` → `{ data, config, refresh }`; bookmarks on the repo

Removes `saveConfig` (and the `onConfigChange` chain that existed only for it) and rewrites bookmarks to mutate its own table.

**Files:**
- Modify: `src/modules/contracts.ts` (WidgetBodyProps), `src/components/widget-card.tsx`, `src/components/sortable-card.tsx`, `src/components/dashboard.tsx`
- Modify: `src/modules/bookmarks/manifest.ts`, `src/modules/bookmarks/fetch.ts`, `src/modules/bookmarks/widgets/bookmarks-widget.tsx`
- Test: `tests/modules/bookmarks-server.test.ts` (rewrite), `tests/modules/bookmarks-registration.test.ts`, `tests/modules/github-widgets.test.tsx`, `tests/modules/jira-widget.test.tsx`

**Interfaces:**
- Consumes: `listBookmarks`/`addBookmark`/`removeBookmark` from Task 1; `bookmarksManifest` from Task 2.
- Produces: `WidgetBodyProps<Data, Config>` = `{ data: Data; config: Config; refresh: () => Promise<void> }` — final shape, used by Tasks 4/6.
- `BookmarksData` becomes `{ bookmarks: { id: string; title: string; url: string }[] }`; `BookmarksConfig` becomes `{}`.

- [ ] **Step 1: Write the failing test (bookmarks fetch reads the table)**

Rewrite `tests/modules/bookmarks-server.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useTempDb } from "../helpers/db";
import { addBookmark } from "@/modules/bookmarks/repo";
import { fetchBookmarks } from "@/modules/bookmarks/fetch";
import { normalizeUrl } from "@/modules/bookmarks/manifest";

beforeEach(() => useTempDb());

describe("bookmarks fetch (reads the module table)", () => {
  it("returns an empty list on a fresh table", async () => {
    await expect(fetchBookmarks()).resolves.toEqual({ bookmarks: [] });
  });

  it("returns stored bookmarks as {id,title,url} in order", async () => {
    const a = await addBookmark("Acme", "https://example.com/");
    await addBookmark("GitHub", "https://github.com/");
    const data = await fetchBookmarks();
    expect(data.bookmarks).toEqual([
      { id: a.id, title: "Acme", url: "https://example.com/" },
      { id: data.bookmarks[1].id, title: "GitHub", url: "https://github.com/" },
    ]);
  });
});

describe("normalizeUrl", () => {
  it("prepends https:// when no scheme is present", () => {
    expect(normalizeUrl("example.com")).toBe("https://example.com/");
  });

  it("keeps an existing http/https scheme", () => {
    expect(normalizeUrl("http://foo.com/bar")).toBe("http://foo.com/bar");
  });

  it("rejects blank input", () => {
    expect(normalizeUrl("   ")).toBeNull();
  });

  it("rejects input that cannot form a URL", () => {
    expect(normalizeUrl("has spaces in it")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/modules/bookmarks-server.test.ts`
Expected: FAIL — `fetchBookmarks` still expects a config argument / returns config bookmarks.

- [ ] **Step 3: Rewrite the bookmarks module data side**

`src/modules/bookmarks/manifest.ts`:

```ts
import { z } from "zod";
import { defineManifest } from "@/modules/contracts";

export const BOOKMARKS_TYPE = "bookmarks.links";

export type Bookmark = { id: string; title: string; url: string };

/** Bookmark data lives in the module-owned `bookmarks` table, not in config. */
export const bookmarksConfigSchema = z.object({});
export type BookmarksConfig = z.infer<typeof bookmarksConfigSchema>;
export const bookmarksDefaultConfig: BookmarksConfig = {};

export type BookmarksData = { bookmarks: Bookmark[] };

export const bookmarksManifest = defineManifest({
  type: BOOKMARKS_TYPE, title: "Bookmarks",
  configSchema: bookmarksConfigSchema, defaultConfig: bookmarksDefaultConfig,
  refreshable: false,
});

/**
 * Normalize a user-typed URL: prepend `https://` when no scheme is present,
 * then validate with the URL constructor. Returns the canonical href, or
 * `null` when the input can't form a valid URL.
 */
export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme).href;
  } catch {
    return null;
  }
}
```

`src/modules/bookmarks/fetch.ts`:

```ts
import { registerFetch } from "@/modules/fetch-registry";
import { bookmarksManifest, type BookmarksData } from "./manifest";
import { listBookmarks } from "./repo";

export async function fetchBookmarks(): Promise<BookmarksData> {
  const rows = await listBookmarks();
  return { bookmarks: rows.map(({ id, title, url }) => ({ id, title, url })) };
}

registerFetch(bookmarksManifest, { fetch: fetchBookmarks });
```

- [ ] **Step 4: Finalize `WidgetBodyProps` in `src/modules/contracts.ts`**

Replace the `WidgetBodyProps` interface with:

```ts
export interface WidgetBodyProps<Data = unknown, Config = unknown> {
  data: Data;
  config: Config;
  /**
   * Force a re-fetch + re-cache (same as the header refresh button).
   * Call after mutating module-owned data (e.g. addBookmark) to show the result.
   */
  refresh: () => Promise<void>;
}
```

- [ ] **Step 5: Update `src/components/widget-card.tsx`**

Remove the `saveConfig` callback, the `onConfigChange` prop, and the now-unused `useCallback`/`useQueryClient`/`updateWidget`/`fetchWidgetData` imports. New file:

```tsx
"use client";
import { getRenderWidget } from "@/modules/render-registry";
import type { Widget } from "@/server/config-repo";
import { WidgetShell, type WidgetState, type DragHandle } from "./widget-shell";
import { useWidgetData } from "./use-widget-data";
import { CardMenu } from "./card-menu";
import { BrandIcon } from "./brand-icon";

export function WidgetCard({
  widget, onConfigure, onRemove, dragHandle,
}: {
  widget: Widget;
  onConfigure?: (w: Widget) => void;
  onRemove?: (id: string) => void;
  dragHandle?: DragHandle;
}) {
  const def = getRenderWidget(widget.type);
  const { data, isLoading, refresh, isRefreshing } = useWidgetData(widget.id);

  if (!def) {
    return <WidgetShell title={widget.title ?? widget.type} state="error" error={`No renderer for ${widget.type}`} fetchedAt={null} onRefresh={() => {}} dragHandle={dragHandle} />;
  }

  const hasData = data != null && data.payload != null;
  const errored = data?.status === "error";
  // Keep showing last-good data on error (per spec); only blank to an error state
  // when there's nothing cached to fall back to.
  const state: WidgetState = isLoading ? "loading" : hasData ? "ok" : errored ? "error" : "empty";
  const count = def.count && hasData ? def.count(data!.payload, widget.config) : null;
  const Body = def.Component;
  const menu =
    onConfigure && onRemove ? (
      <CardMenu onConfigure={() => onConfigure(widget)} onRemove={() => onRemove(widget.id)} />
    ) : undefined;
  const HeaderControls = def.HeaderControls;
  const headerAction =
    HeaderControls && hasData ? (
      <HeaderControls data={data!.payload} config={widget.config} refresh={refresh} />
    ) : undefined;

  return (
    <WidgetShell
      title={widget.title ?? def.manifest.title}
      icon={def.icon && <BrandIcon mark={def.icon} />}
      count={count}
      state={state}
      error={data?.error}
      fetchedAt={data?.fetchedAt ?? null}
      onRefresh={refresh}
      refreshing={isRefreshing}
      menu={menu}
      headerAction={headerAction}
      dragHandle={dragHandle}
      issue={errored ? { message: data?.error ?? "Refresh failed", kind: data?.errorKind } : null}
    >
      {hasData && <Body data={data!.payload} config={widget.config} refresh={refresh} />}
    </WidgetShell>
  );
}
```

(`headerAction` still replaces the refresh button here; Task 4 makes it additive.)

- [ ] **Step 6: Drop the `onConfigChange` chain**

`src/components/sortable-card.tsx` — remove `onConfigChange` from the props type, the destructure, and the `<WidgetCard>` call.

`src/components/dashboard.tsx` — delete the `onConfigChange` function (lines 135-137) and the `onConfigChange={onConfigChange}` prop on `<SortableCard>` (line 164). (`onConfigSaved` for the ConfigureDialog stays.)

- [ ] **Step 7: Rewrite `src/modules/bookmarks/widgets/bookmarks-widget.tsx`**

Same UI; mutations go through the repo, then `refresh()`:

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import type { WidgetBodyProps } from "@/modules/contracts";
import { normalizeUrl, type BookmarksConfig, type BookmarksData } from "../manifest";
import { addBookmark, removeBookmark } from "../repo";

type Props = WidgetBodyProps<BookmarksData, BookmarksConfig>;

function faviconUrl(url: string): string | null {
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=32`;
  } catch {
    return null;
  }
}

/** Favicon from Google's service; on load error, fall back to a blank spacer (keeps row alignment). */
function Favicon({ url }: { url: string }) {
  const src = faviconUrl(url);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) return <span className="h-4 w-4 shrink-0" aria-hidden />;
  return (
    <img
      src={src}
      alt=""
      className="h-4 w-4 shrink-0 rounded-sm"
      onError={() => setFailedSrc(src)}
    />
  );
}

export function BookmarksWidget({ data, refresh }: Props) {
  const bookmarks = data.bookmarks;
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  if (bookmarks.length === 0) {
    return (
      <p className="py-2 text-sm text-slate-500 dark:text-slate-400">
        No bookmarks yet — use +
      </p>
    );
  }

  async function remove(id: string) {
    try {
      await removeBookmark(id);
      await refresh();
    } catch {
      // Delete or refresh failed; the row stays visible. Swallow to avoid an unhandled rejection.
    }
    setPendingRemove(null);
  }

  return (
    <ul className="space-y-0.5">
      {bookmarks.map((b) => (
        <li
          key={b.id}
          className="group/row flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-slate-100 dark:hover:bg-white/5"
        >
          <Favicon url={b.url} />
          <a
            href={b.url}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 flex-1 truncate text-sm text-slate-700 hover:text-primary-600 dark:text-slate-200 dark:hover:text-primary-400"
          >
            {b.title}
          </a>
          {pendingRemove === b.id ? (
            <span className="flex shrink-0 items-center gap-1 text-xs">
              <span className="text-slate-500 dark:text-slate-400">Remove?</span>
              <button aria-label="Confirm remove" onClick={() => remove(b.id)} className="icon-btn text-danger">
                ✓
              </button>
              <button aria-label="Cancel remove" onClick={() => setPendingRemove(null)} className="icon-btn">
                ✕
              </button>
            </span>
          ) : (
            <button
              aria-label={`Remove ${b.title}`}
              onClick={() => setPendingRemove(b.id)}
              className="icon-btn shrink-0 opacity-0 transition-opacity group-hover/row:opacity-100"
            >
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function BookmarksHeaderControls({ refresh }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDoc = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  function toggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    }
    setError(null);
    setOpen((v) => !v);
  }

  async function add() {
    const normalized = normalizeUrl(url);
    if (!title.trim() || !normalized) {
      setError("Enter a title and a valid URL.");
      return;
    }
    setSaving(true);
    try {
      await addBookmark(title.trim(), normalized);
      await refresh();
    } catch {
      setError("Couldn't save. Try again.");
      setSaving(false);
      return;
    }
    setTitle("");
    setUrl("");
    setError(null);
    setSaving(false);
    setOpen(false);
  }

  const inputCls =
    "w-full rounded-lg bg-surface px-2.5 py-1.5 text-sm ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-primary-500/50 dark:bg-surface-dark dark:ring-border-dark";

  return (
    <>
      <button ref={btnRef} aria-label="Add bookmark" aria-expanded={open} onClick={toggle} className="icon-btn">
        <span className="text-[0.95rem] leading-none">＋</span>
      </button>
      {open && pos && (
        <div
          ref={popRef}
          style={{ position: "fixed", top: pos.top, right: pos.right }}
          className="z-50 w-60 space-y-2 rounded-lg bg-panel p-3 text-left shadow-xl ring-1 ring-border [animation:wd-fade-in_.12s_ease-out] dark:bg-panel-dark dark:ring-border-dark"
        >
          <input aria-label="Title" className={inputCls} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input
            aria-label="URL"
            className={inputCls}
            placeholder="example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex justify-end">
            <button onClick={add} disabled={saving} className="btn btn-primary disabled:opacity-60">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 8: Update remaining tests**

`tests/modules/github-widgets.test.tsx` and `tests/modules/jira-widget.test.tsx` — replace `saveConfig={noop}` with `refresh={noop}` in every render call.

`tests/modules/bookmarks-registration.test.ts` — the defaultConfig expectations change: `expect(def!.manifest.defaultConfig).toEqual({})` in both describe blocks (was `toMatchObject({ bookmarks: [] })`).

- [ ] **Step 9: Run the full suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat!: bookmarks on the module-owned table; WidgetBodyProps gets refresh, loses saveConfig

Bookmark data now survives widget deletion. Widget mutations are plain
module-function calls followed by refresh() — the blessed local-data pattern.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `refreshable` UI semantics; additive `HeaderControls`

**Files:**
- Modify: `src/components/widget-shell.tsx`, `src/components/widget-card.tsx`, `src/components/use-widget-data.ts`
- Test: `tests/components/widget-shell.test.tsx`, `tests/components/use-widget-data.test.tsx`

**Interfaces:**
- Consumes: `manifest.refreshable` from Task 2; `WidgetBodyProps.refresh` from Task 3.
- Produces:
  - `WidgetShell` props: `headerAction` REMOVED; `refreshable?: boolean` ADDED (default true). `headerExtra` is the slot for module header controls (rendered before the menu + refresh button). When `refreshable` is false, the refresh button and fetchedAt are omitted.
  - `useWidgetData(id: string, refreshable = true)` — when false, the 5-minute interval and the global refresh-all nonce are ignored; manual `refresh()` still works.

- [ ] **Step 1: Write the failing tests**

Append to `tests/components/widget-shell.test.tsx`:

```tsx
describe("WidgetShell refreshable", () => {
  it("shows the refresh button and timestamp by default", () => {
    render(
      <WidgetShell title="PRs" state="ok" fetchedAt={Date.now()} onRefresh={() => {}}>
        <div>body</div>
      </WidgetShell>
    );
    expect(screen.getByLabelText("Refresh")).toBeInTheDocument();
    expect(screen.getByText("just now")).toBeInTheDocument();
  });

  it("hides the refresh button and timestamp when refreshable is false", () => {
    render(
      <WidgetShell title="Bookmarks" state="ok" fetchedAt={Date.now()} onRefresh={() => {}} refreshable={false}>
        <div>body</div>
      </WidgetShell>
    );
    expect(screen.queryByLabelText("Refresh")).not.toBeInTheDocument();
    expect(screen.queryByText("just now")).not.toBeInTheDocument();
  });

  it("renders headerExtra alongside the refresh button", () => {
    render(
      <WidgetShell title="X" state="ok" fetchedAt={null} onRefresh={() => {}}
        headerExtra={<button aria-label="Add bookmark">＋</button>}>
        <div>body</div>
      </WidgetShell>
    );
    expect(screen.getByLabelText("Add bookmark")).toBeInTheDocument();
    expect(screen.getByLabelText("Refresh")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm test -- tests/components/widget-shell.test.tsx`
Expected: the two new assertions about `refreshable={false}` FAIL (prop doesn't exist yet, button renders anyway). The `headerExtra`-alongside-refresh test may already pass — keep it as a regression guard.

- [ ] **Step 3: Update `src/components/widget-shell.tsx`**

Change the signature: remove `headerAction`, add `refreshable = true`:

```tsx
export function WidgetShell({
  title, icon, count, state, error, fetchedAt, onRefresh, refreshing, refreshable = true, children, headerExtra, menu, dragHandle, issue,
}: {
  title: string;
  icon?: ReactNode;
  count?: number | null;
  state: WidgetState;
  error?: string | null;
  fetchedAt: number | null;
  onRefresh: () => void;
  refreshing?: boolean;
  /** False = widget data only changes through its own controls: no refresh button, no timestamp. */
  refreshable?: boolean;
  children?: ReactNode;
  headerExtra?: ReactNode;
  menu?: ReactNode;
  dragHandle?: DragHandle;
  issue?: { message: string; kind?: string | null } | null;
}) {
```

and replace the right-hand header block (`{!headerAction && fetchedAt && …}` through the `headerAction ?? (<button …>)` expression) with:

```tsx
          {refreshable && fetchedAt && <span className="tabular-nums">{ago(fetchedAt)}</span>}
          {headerExtra}
          {menu}
          {refreshable && (
            <button
              aria-label="Refresh"
              onClick={onRefresh}
              disabled={refreshing}
              className="icon-btn hover:[&>span]:rotate-90 disabled:cursor-default"
            >
              <span
                className={`inline-block text-[0.95rem] leading-none transition-transform duration-300 ease-out ${
                  refreshing ? "animate-spin" : ""
                }`}
              >
                ↻
              </span>
            </button>
          )}
```

- [ ] **Step 4: Update `src/components/use-widget-data.ts`**

```ts
export function useWidgetData(id: string, refreshable = true) {
```

Gate the two effects:

```ts
  // Auto-refresh must force refresh=1; a plain refetch would only re-read the cache.
  useEffect(() => {
    if (!enabled || !refreshable) return;
    const t = setInterval(() => void refresh(), INTERVAL_MS);
    return () => clearInterval(t);
  }, [enabled, refreshable, refresh]);

  // Force-refresh-now: refresh when the global nonce bumps, but not on initial mount.
  const initialNonce = useRef(nonce);
  useEffect(() => {
    if (!refreshable || nonce === initialNonce.current) return;
    void refresh();
  }, [nonce, refreshable, refresh]);
```

- [ ] **Step 5: Update `src/components/widget-card.tsx`**

Compute `refreshable` from the manifest, feed it to the hook and the shell, and move `HeaderControls` to the `headerExtra` slot:

```tsx
  const def = getRenderWidget(widget.type);
  const refreshable = def?.manifest.refreshable !== false;
  const { data, isLoading, refresh, isRefreshing } = useWidgetData(widget.id, refreshable);
```

```tsx
  const HeaderControls = def.HeaderControls;
  const headerExtra =
    HeaderControls && hasData ? (
      <HeaderControls data={data!.payload} config={widget.config} refresh={refresh} />
    ) : undefined;
```

and in the `<WidgetShell>` call replace `headerAction={headerAction}` with:

```tsx
      refreshable={refreshable}
      headerExtra={headerExtra}
```

- [ ] **Step 6: Add a hook test for the refreshable gate**

In `tests/components/use-widget-data.test.tsx`, following the file's existing pattern (fake timers, `mockFetchWidgetData`, `Probe`/`Controls` helpers), add a probe for a non-refreshable widget and a test that neither the interval nor refreshAll triggers an upstream fetch:

```tsx
function StaticProbe() {
  const { refresh } = useWidgetData("w1", false);
  void refresh;
  return <span>ready</span>;
}
```

```tsx
test("refreshable=false ignores auto-refresh interval and refreshAll", async () => {
  mockFetchWidgetData.mockResolvedValue({
    widgetId: "w1", payload: { ok: true }, fetchedAt: Date.now(), status: "ok", error: null, errorKind: null,
  });
  renderStaticProbe(); // same wrapper as renderProbe but rendering <StaticProbe />
  await screen.findByText("ready");
  const initialCalls = mockFetchWidgetData.mock.calls.length; // the cache-first load
  await act(async () => { screen.getByText("toggle").click(); });        // enable auto-refresh
  await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1000); });
  await act(async () => { screen.getByText("refreshAll").click(); });
  expect(
    mockFetchWidgetData.mock.calls.slice(initialCalls).filter(([, refresh]) => refresh === true),
  ).toHaveLength(0);
});
```

(Add a `renderStaticProbe` helper mirroring `renderProbe`; reuse the existing timer setup in that file.)

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all PASS. If any existing test passed `headerAction` to `WidgetShell`, switch it to `headerExtra`/`refreshable` semantics.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: explicit refreshable flag; HeaderControls render beside the refresh button

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Validate stored config on read

**Files:**
- Modify: `src/server/widget-service.ts`
- Test: `tests/server/widget-service.test.ts`

**Interfaces:**
- Consumes: `def.manifest.configSchema` (Task 2).
- Produces: `getWidgetData` passes the **parsed** config to `fetch()`; invalid stored config yields an error cache row and leaves the stored config untouched.

- [ ] **Step 1: Write the failing tests**

Append to `tests/server/widget-service.test.ts` (inside the `describe`; `registerFetch`/`defineManifest` already imported after Task 2):

```ts
  it("caches a fixable error when the stored config no longer matches the schema", async () => {
    registerFetch(
      defineManifest({ type: "test.strict", title: "Strict", configSchema: z.object({ q: z.string() }), defaultConfig: { q: "x" } }),
      { fetch: async (c) => c },
    );
    const w = await repo.addWidget("test.strict", { q: "ok" });
    await repo.setConfig(w.id, {} as Record<string, unknown>); // simulate a breaking schema change
    const row = await getWidgetData(w.id, true);
    expect(row.status).toBe("error");
    expect(row.error).toContain("Invalid config");
    expect((await repo.getWidget(w.id))!.config).toEqual({}); // stored config untouched
  });

  it("backfills Zod defaults from the schema on read", async () => {
    let seen: unknown;
    registerFetch(
      defineManifest({ type: "test.defaults", title: "D", configSchema: z.object({ limit: z.number().default(5) }), defaultConfig: { limit: 5 } }),
      { fetch: async (c) => { seen = c; return c; } },
    );
    const w = await repo.addWidget("test.defaults", { limit: 5 });
    await repo.setConfig(w.id, {} as Record<string, unknown>); // an additive schema change
    await getWidgetData(w.id, true);
    expect(seen).toEqual({ limit: 5 });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/server/widget-service.test.ts`
Expected: both new tests FAIL (raw config is passed straight through today).

- [ ] **Step 3: Implement in `src/server/widget-service.ts`**

Between the `if (!def)` block and the `try`, insert:

```ts
  // Validate stored config before fetching: Zod defaults backfill additive schema
  // changes for free; a breaking change surfaces as a fixable error instead of a
  // crash — the stored config is NOT overwritten.
  const parsed = def.manifest.configSchema.safeParse(widget.config);
  if (!parsed.success) {
    return cache.set(widgetId, {
      status: "error",
      payload: prev?.payload ?? null,
      error: "Invalid config — open Configure and re-save this widget.",
      errorKind: "failed",
    });
  }
```

and change the fetch line to use the parsed value:

```ts
    const payload = await def.fetch(parsed.data);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/server/widget-service.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add src/server/widget-service.ts tests/server/widget-service.test.ts
git commit -m "feat: validate stored widget config against the schema on every read

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Per-card ErrorBoundary

**Files:**
- Create: `src/components/widget-error-boundary.tsx`
- Modify: `src/components/widget-card.tsx`
- Test: `tests/components/widget-error-boundary.test.tsx`

**Interfaces:**
- Produces: `WidgetErrorBoundary` — props `{ resetKey: unknown; children: ReactNode }`. Catches render errors from the widget body; a changed `resetKey` (the cache row's `fetchedAt`) clears the error so a successful refresh gets a fresh render.

- [ ] **Step 1: Write the failing test**

Create `tests/components/widget-error-boundary.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { WidgetErrorBoundary } from "@/components/widget-error-boundary";

function Boom(): never {
  throw new Error("stale payload shape");
}

afterEach(() => vi.restoreAllMocks());

describe("WidgetErrorBoundary", () => {
  it("renders an in-card error instead of crashing the tree", () => {
    vi.spyOn(console, "error").mockImplementation(() => {}); // React logs caught errors
    render(
      <>
        <WidgetErrorBoundary resetKey={1}>
          <Boom />
        </WidgetErrorBoundary>
        <div>sibling widget</div>
      </>
    );
    expect(screen.getByText(/stale payload shape/)).toBeInTheDocument();
    expect(screen.getByText("sibling widget")).toBeInTheDocument();
  });

  it("re-renders children when resetKey changes", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let shouldThrow = true;
    function Sometimes() {
      if (shouldThrow) throw new Error("boom once");
      return <div>recovered</div>;
    }
    const { rerender } = render(
      <WidgetErrorBoundary resetKey={1}><Sometimes /></WidgetErrorBoundary>
    );
    expect(screen.getByText(/boom once/)).toBeInTheDocument();
    shouldThrow = false;
    rerender(<WidgetErrorBoundary resetKey={2}><Sometimes /></WidgetErrorBoundary>);
    expect(screen.getByText("recovered")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/components/widget-error-boundary.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/components/widget-error-boundary.tsx`**

```tsx
"use client";
import { Component, type ReactNode } from "react";

/** Catches render errors from one widget body so a bad widget can't take down the dashboard. */
export class WidgetErrorBoundary extends Component<
  { resetKey: unknown; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey: unknown }) {
    // A new payload (e.g. after a successful refresh) gets a fresh chance to render.
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex items-start gap-2 text-sm text-danger">
          <span aria-hidden className="mt-px select-none">⚠</span>
          <p className="min-w-0 break-words">Widget crashed: {this.state.error.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}
```

- [ ] **Step 4: Wrap the body in `src/components/widget-card.tsx`**

Add the import and wrap the body render:

```tsx
import { WidgetErrorBoundary } from "./widget-error-boundary";
```

```tsx
      {hasData && (
        <WidgetErrorBoundary resetKey={data!.fetchedAt}>
          <Body data={data!.payload} config={widget.config} refresh={refresh} />
        </WidgetErrorBoundary>
      )}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/components/widget-error-boundary.test.tsx && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/widget-error-boundary.tsx src/components/widget-card.tsx tests/components/widget-error-boundary.test.tsx
git commit -m "feat: per-card error boundary around widget bodies

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Cache versioning

**Files:**
- Create: `src/server/cache-version.ts`
- Modify: `src/app-root.tsx`
- Test: `tests/server/cache-version.test.ts`

**Interfaces:**
- Produces: `CACHE_VERSION: number` (bump manually whenever any widget's `Data` payload shape changes) and `ensureCacheVersion(): Promise<void>` (wipes `widget_cache` on mismatch, then records the version in `prefs` under key `cacheVersion`). Called once at startup before any widget renders.

- [ ] **Step 1: Write the failing test**

Create `tests/server/cache-version.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useTempDb } from "../helpers/db";
import { CACHE_VERSION, ensureCacheVersion } from "@/server/cache-version";
import { getPref } from "@/server/config-repo";
import * as cache from "@/server/cache-repo";

beforeEach(() => useTempDb());

describe("cache versioning", () => {
  it("wipes the cache when the stored version differs (incl. fresh DB)", async () => {
    await cache.set("w1", { status: "ok", payload: { a: 1 }, error: null });
    await ensureCacheVersion();
    expect(await cache.get("w1")).toBeUndefined();
    expect(await getPref("cacheVersion", "")).toBe(String(CACHE_VERSION));
  });

  it("keeps the cache when the version matches", async () => {
    await ensureCacheVersion();
    await cache.set("w1", { status: "ok", payload: { a: 1 }, error: null });
    await ensureCacheVersion();
    expect((await cache.get("w1"))?.payload).toEqual({ a: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/server/cache-version.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/server/cache-version.ts`**

```ts
import { getDb } from "@/db/client";
import { widgetCache } from "@/db/schema";
import { getPref, setPref } from "./config-repo";

/**
 * Bump whenever any widget's Data payload shape changes. The cache is
 * disposable by design (everything is re-fetchable), so a mismatch wipes it —
 * no per-widget payload migrations.
 */
export const CACHE_VERSION = 1;

export async function ensureCacheVersion(): Promise<void> {
  const stored = await getPref("cacheVersion", "");
  if (stored === String(CACHE_VERSION)) return;
  await getDb().delete(widgetCache);
  await setPref("cacheVersion", String(CACHE_VERSION));
}
```

- [ ] **Step 4: Gate startup on it in `src/app-root.tsx`**

Add the import and a `dbReady` state to `AppRoot`:

```tsx
import { ensureCacheVersion } from "@/server/cache-version";
```

```tsx
export function AppRoot() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
      }),
  );
  const [dbReady, setDbReady] = useState(false);
  const route = useHashRoute();
  useEffect(() => {
    void ensureCacheVersion().then(() => setDbReady(true));
  }, []);
  if (!dbReady) return null;
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

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/cache-version.ts src/app-root.tsx tests/server/cache-version.test.ts
git commit -m "feat: wipe widget_cache on CACHE_VERSION bump at startup

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Squash migrations to a single baseline

Greenfield reset: one `0000_` baseline generated from the final schema. **The user's existing bookmarks (stored in widget config in the old DB) are lost by the reset — they re-add them in-app afterwards; this was accepted in the design.**

**Files:**
- Delete: `drizzle/0000_short_cannonball.sql` … `drizzle/0004_yummy_boom_boom.sql`, `drizzle/meta/`
- Create (generated): `drizzle/0000_<generated-name>.sql`, `drizzle/meta/`
- Modify: `src-tauri/src/lib.rs:8-15`

- [ ] **Step 1: Regenerate the baseline**

```bash
rm drizzle/*.sql
rm -rf drizzle/meta
npm run db:generate
ls drizzle/
```

Expected: exactly one new `0000_<name>.sql` (plus `meta/`). Open it and confirm it creates all four tables: `widgets`, `prefs`, `widget_cache`, `bookmarks`.

- [ ] **Step 2: Update `src-tauri/src/lib.rs`**

Replace the body of `migrations()` (substitute the actual generated filename from Step 1):

```rust
fn migrations() -> Vec<Migration> {
    vec![
        Migration { version: 1, description: "baseline", sql: include_str!("../../drizzle/0000_<generated-name>.sql"), kind: MigrationKind::Up },
    ]
}
```

- [ ] **Step 3: Verify Rust compiles and tests pass**

```bash
(cd src-tauri && cargo check)
npm test
```

Expected: `cargo check` clean; all tests PASS (`tests/helpers/db.ts` migrates from the `drizzle/` folder, so it picks up the new baseline automatically).

- [ ] **Step 4: Reset the local DB**

```bash
rm -f "$HOME/Library/Application Support/com.pulse.dashboard/dashboard.db"*
```

(The glob also removes the WAL/SHM files. The app recreates the DB via the plugin's migration runner on next launch.)

- [ ] **Step 5: Live smoke test**

Run: `npm run dev`
Expected: app boots, seeds the `core.status` widget, Add-widget drawer lists Bookmarks. Add a Bookmarks widget, add a bookmark via ＋ (appears without a refresh button in the header), remove it, delete the card, re-add the card — bookmarks persist across card deletion. Quit.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore!: squash drizzle migrations to a single baseline

Greenfield reset; local dashboard.db is recreated on launch.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Docs + final verification

**Files:**
- Modify: `CLAUDE.md` (Architecture + Gotchas), `.claude/skills/create-module/SKILL.md` (+ any snippet files inside that skill dir), `CONTEXT.md` (only if it references the old contract)

- [ ] **Step 1: Update `CLAUDE.md`**

In **Architecture**, replace the module-split bullets with:

```markdown
Integrations are self-contained **modules** under `src/modules/<name>/`, split into:
- `manifest.ts` — shared types, Zod config schema, defaults, and one `WidgetManifest` per widget (`type/title/configSchema/defaultConfig/refreshable?/integration?`) via `defineManifest` (no runtime deps)
- `fetch.ts` — `registerFetch(manifest, { fetch })`; CLI-first, but API is fine
- `widgets/*.tsx` + `render.ts` — `registerRender(manifest, { Component, icon?, count?, HeaderControls?, formEditable? })`
- `repo.ts` (only for local-data modules, e.g. bookmarks) — module-owned table + CRUD functions
```

In **Gotchas / patterns**, add/replace these bullets (keep the others):

```markdown
- Widget bodies get `{ data, config, refresh }`. There is no action/RPC API: widgets that mutate module data import the module's repo functions directly (no server boundary) and call `refresh()` after — see `bookmarks`. Local user data lives in a module-owned table, never in widget config.
- `refreshable: false` in the manifest hides the refresh button + fetchedAt and skips auto-refresh; `HeaderControls` render *next to* the refresh button, never instead of it.
- Stored config is validated against the manifest schema on every read (`widget-service.ts`); Zod `.default()`s backfill additive schema changes, breaking ones surface as an in-card "Invalid config" error without overwriting the stored config.
- Payload shape changed? Bump `CACHE_VERSION` (`src/server/cache-version.ts`) — the cache is wiped on startup mismatch. Widget bodies are wrapped in a per-card ErrorBoundary.
```

- [ ] **Step 2: Update the create-module skill**

Read `.claude/skills/create-module/SKILL.md` (and any referenced template/snippet files in that directory). Replace every `registerFetchWidget`/`registerRenderWidget` example with the manifest-based API, using this canonical scaffold:

```ts
// manifest.ts
export const FOO_TYPE = "example.foo";
export const fooConfigSchema = z.object({ limit: z.number().default(10).describe("Max items") });
export type FooConfig = z.infer<typeof fooConfigSchema>;
export const fooDefaultConfig: FooConfig = { limit: 10 };
export type FooData = { items: string[] };
export const fooManifest = defineManifest({
  type: FOO_TYPE, title: "Foo",
  configSchema: fooConfigSchema, defaultConfig: fooDefaultConfig,
  integration: "example", // omit for always-available widgets
});

// fetch.ts
registerFetch(fooManifest, { fetch: fetchFoo });

// render.ts
registerRender(fooManifest, {
  Component: FooWidget,
  count: (d) => d.items.length,
  icon: { Icon: SiExample, className: "text-[#123456]" },
});
```

Also document in the skill: widget body props are `{ data, config, refresh }`; local-data modules add a `repo.ts` and call repo functions + `refresh()` from the widget (reference `src/modules/bookmarks/`); the registration test must assert both registries share the manifest object.

- [ ] **Step 3: Check `CONTEXT.md`**

Run: `grep -n "registerFetchWidget\|registerRenderWidget\|saveConfig\|runAction\|WidgetAction" CONTEXT.md`
Update any hits to the new vocabulary (manifest, registerFetch/registerRender, refresh).

- [ ] **Step 4: Full verification**

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build:vite
```

Expected: all clean/green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: manifest contract + local-data pattern in CLAUDE.md and create-module skill

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
