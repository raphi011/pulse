# Bookmarks Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `bookmarks.links` widget that stores `{title,url}` links in its own `widgets.config`, managed inline (add via a `+` header action, remove via a per-row `× → Remove? ✓ ✕`), with no external data source.

**Architecture:** A self-contained module under `src/modules/bookmarks/` whose `fetch()` is the identity of its config (config *is* the data). Three small, reusable framework seams let a widget persist its own config (`saveConfig`), replace the header refresh button with a custom action (`headerAction`/`HeaderControls`), and opt out of the auto-generated config form (`formEditable: false`).

**Tech Stack:** Next.js App Router, React, TypeScript, Zod, TanStack Query, Tailwind v4, Vitest + Testing Library, react-icons.

---

## Reference: how the seams fit existing code (read before starting)

- **`saveConfig` pattern** already exists in `src/components/configure-dialog.tsx:30-53`: `PATCH /api/widgets/:id { config }`, then `GET /api/widgets/:id/data?refresh=1`, then `qc.setQueryData(["widget", id], fresh)`. The widget-data query key is `["widget", id]` (`src/components/use-widget-data.tsx`).
- **Identity fetch → `hasData`**: `WidgetCard` treats a non-null `payload` as `hasData` (`src/components/widget-card.tsx:24-28`). `fetch` returning `{ bookmarks: [] }` is non-null, so the body renders (never the shell's generic empty state).
- **No-integration widgets are always available** — `core` registers no `integration` and shows unconditionally. Bookmarks mirrors `core`.
- **`describeSchema` throws** on array-of-object configs (`src/components/schema-form.tsx:38`, `Unsupported array item type`). That is why the config form must be skipped for this widget; the throw stays intact for genuine authoring mistakes.

---

## Task 1: Module manifest + identity server fetch

**Files:**
- Create: `src/modules/bookmarks/manifest.ts`
- Create: `src/modules/bookmarks/server.ts`
- Create: `tests/modules/bookmarks-server.test.ts`

- [ ] **Step 1: Write `manifest.ts`** (types, schema, defaults, and the pure URL helper — no runtime deps)

```ts
import { z } from "zod";

export const BOOKMARKS_TYPE = "bookmarks.links";

export type Bookmark = { title: string; url: string };

export const bookmarksConfigSchema = z.object({
  bookmarks: z
    .array(z.object({ title: z.string(), url: z.string() }))
    .default([]),
});
export type BookmarksConfig = z.infer<typeof bookmarksConfigSchema>;

export const bookmarksDefaultConfig: BookmarksConfig = { bookmarks: [] };

export type BookmarksData = { bookmarks: Bookmark[] };

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

- [ ] **Step 2: Write `server.ts`** (identity fetch + registration)

```ts
import "server-only";
import { registerServerWidget } from "@/modules/server-registry";
import {
  BOOKMARKS_TYPE,
  bookmarksConfigSchema,
  bookmarksDefaultConfig,
  type BookmarksConfig,
  type BookmarksData,
} from "./manifest";

export async function fetchBookmarks(config: BookmarksConfig): Promise<BookmarksData> {
  return { bookmarks: config.bookmarks };
}

registerServerWidget({
  type: BOOKMARKS_TYPE,
  configSchema: bookmarksConfigSchema,
  defaultConfig: bookmarksDefaultConfig,
  fetch: fetchBookmarks,
});
```

- [ ] **Step 3: Write the failing test** `tests/modules/bookmarks-server.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { fetchBookmarks } from "@/modules/bookmarks/server";
import { normalizeUrl } from "@/modules/bookmarks/manifest";

describe("bookmarks fetch (identity)", () => {
  it("returns the config bookmarks unchanged", async () => {
    const bookmarks = [{ title: "Acme", url: "https://example.com/" }];
    await expect(fetchBookmarks({ bookmarks })).resolves.toEqual({ bookmarks });
  });

  it("returns an empty list for empty config", async () => {
    await expect(fetchBookmarks({ bookmarks: [] })).resolves.toEqual({ bookmarks: [] });
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

- [ ] **Step 4: Run the test — expect PASS**

Run: `npm test -- bookmarks-server`
Expected: 6 assertions pass (fetch identity + normalizeUrl).

- [ ] **Step 5: Commit**

```bash
git add src/modules/bookmarks/manifest.ts src/modules/bookmarks/server.ts tests/modules/bookmarks-server.test.ts
git commit -m "feat: bookmarks module manifest + identity fetch"
```

---

## Task 2: Framework seams on the contracts

**Files:**
- Modify: `src/modules/contracts.ts`

- [ ] **Step 1: Add `saveConfig` to `WidgetBodyProps`**

Replace the `WidgetBodyProps` interface (`src/modules/contracts.ts:26-30`) with:

```ts
export interface WidgetBodyProps<Data = unknown, Config = unknown> {
  data: Data;
  config: Config;
  runAction: (actionId: string, params?: Record<string, unknown>) => Promise<void>;
  /** Persist a new config for this widget (PATCH + re-fetch + cache update). */
  saveConfig: (next: Config) => Promise<void>;
}
```

- [ ] **Step 2: Add `HeaderControls` and `formEditable` to `ClientWidget`**

Inside the `ClientWidget` interface (`src/modules/contracts.ts:33-45`), after the `icon?: BrandMark;` line, add:

```ts
  /** Optional header action rendered in place of the built-in refresh button. */
  HeaderControls?: FC<WidgetBodyProps<Data, Config>>;
  /** When false, the Configure dialog hides the auto-generated config form. Default true. */
  formEditable?: boolean;
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run lint`
Expected: no new errors (existing widgets still satisfy the contract because both new fields are optional and `saveConfig` will be supplied by `WidgetCard` in Task 4).

Note: TypeScript will now flag any `WidgetBodyProps` object literal missing `saveConfig`. The only construction site is `WidgetCard` (Task 4); the seam tasks are sequenced so lint is green again after Task 4. If running lint here reports the `widget-card.tsx` construction site, that is expected and fixed in Task 4 — do not patch it here.

- [ ] **Step 4: Commit**

```bash
git add src/modules/contracts.ts
git commit -m "feat: widget contract seams (saveConfig, HeaderControls, formEditable)"
```

---

## Task 3: `headerAction` slot in WidgetShell

**Files:**
- Modify: `src/components/widget-shell.tsx`

- [ ] **Step 1: Add the `headerAction` prop**

In the `WidgetShell` destructured params (`src/components/widget-shell.tsx:40`) add `headerAction` to the list:

```ts
  title, icon, count, state, error, fetchedAt, onRefresh, refreshing, children, headerExtra, headerAction, menu, dragHandle, issue,
```

In the props type block (after `headerExtra?: ReactNode;`, line 51) add:

```ts
  headerAction?: ReactNode;
```

- [ ] **Step 2: Render `headerAction` in place of the refresh button**

Replace the refresh `<button>` block (`src/components/widget-shell.tsx:97-110`) with:

```tsx
          {headerAction ?? (
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

- [ ] **Step 3: Verify it compiles**

Run: `npm run lint`
Expected: no new errors (all existing callers omit `headerAction`, so the refresh button still renders).

- [ ] **Step 4: Commit**

```bash
git add src/components/widget-shell.tsx
git commit -m "feat: optional headerAction slot replacing refresh in WidgetShell"
```

---

## Task 4: WidgetCard implements `saveConfig` and computes `headerAction`

**Files:**
- Modify: `src/components/widget-card.tsx`

- [ ] **Step 1: Add imports**

At the top of `src/components/widget-card.tsx`, after the existing imports, add:

```tsx
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
```

- [ ] **Step 2: Build `saveConfig` inside the component**

After the `const { data, isLoading, refresh, isRefreshing } = useWidgetData(widget.id);` line (`widget-card.tsx:18`), add:

```tsx
  const qc = useQueryClient();
  const saveConfig = useCallback(
    async (next: unknown) => {
      const res = await fetch(`/api/widgets/${widget.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config: next }),
      });
      if (!res.ok) throw new Error("Failed to save config");
      const fresh = await fetch(`/api/widgets/${widget.id}/data?refresh=1`).then((r) => r.json());
      qc.setQueryData(["widget", widget.id], fresh);
    },
    [widget.id, qc],
  );
```

- [ ] **Step 3: Compute `headerAction` from `HeaderControls`**

After the `const menu = ...` block (`widget-card.tsx:31-34`), add:

```tsx
  const HeaderControls = def.HeaderControls;
  const headerAction =
    HeaderControls && hasData ? (
      <HeaderControls
        data={data!.payload}
        config={widget.config}
        runAction={async () => {}}
        saveConfig={saveConfig}
      />
    ) : undefined;
```

- [ ] **Step 4: Pass `headerAction` to WidgetShell and `saveConfig` to the body**

Add `headerAction={headerAction}` to the `<WidgetShell ...>` props (alongside `menu={menu}`), and update the body render (`widget-card.tsx:50-52`) to:

```tsx
      {hasData && (
        <Body
          data={data!.payload}
          config={widget.config}
          runAction={async () => {}}
          saveConfig={saveConfig}
        />
      )}
```

- [ ] **Step 5: Verify it compiles**

Run: `npm run lint`
Expected: green — the `WidgetBodyProps` construction sites now supply `saveConfig`.

- [ ] **Step 6: Commit**

```bash
git add src/components/widget-card.tsx
git commit -m "feat: WidgetCard saveConfig + headerAction from HeaderControls"
```

---

## Task 5: ConfigureDialog skips the form when `formEditable === false`

**Files:**
- Modify: `src/components/configure-dialog.tsx`

- [ ] **Step 1: Guard the `<SchemaForm>` render**

Replace the `<SchemaForm ... />` line (`src/components/configure-dialog.tsx:80`) with:

```tsx
        {def.formEditable !== false && (
          <SchemaForm schema={def.configSchema} values={values} onChange={setValues} />
        )}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run lint`
Expected: no new errors. Widgets that omit `formEditable` (all existing ones) still render the form.

- [ ] **Step 3: Commit**

```bash
git add src/components/configure-dialog.tsx
git commit -m "feat: ConfigureDialog opt-out of auto config form via formEditable"
```

---

## Task 6: Bookmarks widget body + add-popover

**Files:**
- Create: `src/modules/bookmarks/widgets/bookmarks-widget.tsx`

- [ ] **Step 1: Write the widget body and header controls**

```tsx
"use client";
import { useState } from "react";
import { FaRegBookmark } from "react-icons/fa6";
import type { WidgetBodyProps } from "@/modules/contracts";
import {
  normalizeUrl,
  type BookmarksConfig,
  type BookmarksData,
} from "../manifest";

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
  const [failed, setFailed] = useState(false);
  const src = faviconUrl(url);
  if (!src || failed) return <span className="h-4 w-4 shrink-0" aria-hidden />;
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={src}
      alt=""
      className="h-4 w-4 shrink-0 rounded-sm"
      onError={() => setFailed(true)}
    />
  );
}

export function BookmarksWidget({ data, saveConfig }: Props) {
  const bookmarks = data.bookmarks;
  const [pendingRemove, setPendingRemove] = useState<number | null>(null);

  if (bookmarks.length === 0) {
    return (
      <p className="py-2 text-sm text-slate-500 dark:text-slate-400">
        No bookmarks yet — use +
      </p>
    );
  }

  async function remove(index: number) {
    await saveConfig({ bookmarks: bookmarks.filter((_, i) => i !== index) });
    setPendingRemove(null);
  }

  return (
    <ul className="space-y-0.5">
      {bookmarks.map((b, i) => (
        <li
          key={i}
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
          {pendingRemove === i ? (
            <span className="flex shrink-0 items-center gap-1 text-xs">
              <span className="text-slate-500 dark:text-slate-400">Remove?</span>
              <button aria-label="Confirm remove" onClick={() => remove(i)} className="icon-btn text-danger">
                ✓
              </button>
              <button aria-label="Cancel remove" onClick={() => setPendingRemove(null)} className="icon-btn">
                ✕
              </button>
            </span>
          ) : (
            <button
              aria-label={`Remove ${b.title}`}
              onClick={() => setPendingRemove(i)}
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

export function BookmarksHeaderControls({ data, saveConfig }: Props) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function add() {
    const normalized = normalizeUrl(url);
    if (!title.trim() || !normalized) {
      setError("Enter a title and a valid URL.");
      return;
    }
    await saveConfig({ bookmarks: [...data.bookmarks, { title: title.trim(), url: normalized }] });
    setTitle("");
    setUrl("");
    setError(null);
    setOpen(false);
  }

  const inputCls =
    "w-full rounded-lg bg-surface px-2.5 py-1.5 text-sm ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-primary-500/50 dark:bg-surface-dark dark:ring-border-dark";

  return (
    <div className="relative">
      <button aria-label="Add bookmark" onClick={() => setOpen((o) => !o)} className="icon-btn">
        <span className="text-[0.95rem] leading-none">＋</span>
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-20 w-60 space-y-2 rounded-lg bg-panel p-3 text-left shadow-xl ring-1 ring-border dark:bg-panel-dark dark:ring-border-dark">
          <input
            className={inputCls}
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input
            className={inputCls}
            placeholder="example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex justify-end">
            <button onClick={add} className="btn btn-primary">
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run lint`
Expected: no errors. (`icon-btn`, `btn btn-primary`, `bg-panel`, `bg-surface`, `text-danger`, `text-primary-*` are all existing utilities — confirmed used in `widget-shell.tsx`, `configure-dialog.tsx`, and `schema-form.tsx`.)

- [ ] **Step 3: Commit**

```bash
git add src/modules/bookmarks/widgets/bookmarks-widget.tsx
git commit -m "feat: bookmarks widget body + add-popover header control"
```

---

## Task 7: Register the client widget + wire the module

**Files:**
- Create: `src/modules/bookmarks/client.ts`
- Modify: `src/modules/server.ts`
- Modify: `src/modules/client.ts`

- [ ] **Step 1: Write `client.ts`**

```ts
import { FaRegBookmark } from "react-icons/fa6";
import { registerClientWidget } from "@/modules/client-registry";
import {
  BOOKMARKS_TYPE,
  bookmarksConfigSchema,
  bookmarksDefaultConfig,
} from "./manifest";
import { BookmarksWidget, BookmarksHeaderControls } from "./widgets/bookmarks-widget";

registerClientWidget({
  type: BOOKMARKS_TYPE,
  title: "Bookmarks",
  Component: BookmarksWidget,
  configSchema: bookmarksConfigSchema,
  defaultConfig: bookmarksDefaultConfig,
  count: (d) => d.bookmarks.length,
  formEditable: false,
  HeaderControls: BookmarksHeaderControls,
  icon: { Icon: FaRegBookmark, className: "text-slate-500 dark:text-slate-400" },
});
```

- [ ] **Step 2: Wire the server side**

In `src/modules/server.ts`, add after the `./gws/server` import:

```ts
import "./bookmarks/server";
```

- [ ] **Step 3: Wire the client side**

In `src/modules/client.ts`, add after the `./gws/client` import:

```ts
import "./bookmarks/client";
```

- [ ] **Step 4: Verify it compiles**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/bookmarks/client.ts src/modules/server.ts src/modules/client.ts
git commit -m "feat: register bookmarks widget + wire module"
```

---

## Task 8: Registration test

**Files:**
- Create: `tests/modules/bookmarks-registration.test.ts`

- [ ] **Step 1: Write the test** (mirrors `tests/modules/jira-registration.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import "@/modules/server";
import { getServerWidget } from "@/modules/server-registry";
import { BOOKMARKS_TYPE } from "@/modules/bookmarks/manifest";

describe("bookmarks server registration", () => {
  it("registers bookmarks.links on the server registry with defaults", () => {
    const def = getServerWidget(BOOKMARKS_TYPE);
    expect(def).toBeDefined();
    expect(def!.defaultConfig).toMatchObject({ bookmarks: [] });
    expect(typeof def!.fetch).toBe("function");
  });
});

import "@/modules/client";
import { getClientWidget } from "@/modules/client-registry";

describe("bookmarks client registration", () => {
  it("registers bookmarks.links on the client registry with title, schema, and seams", () => {
    const def = getClientWidget(BOOKMARKS_TYPE);
    expect(def).toBeDefined();
    expect(def!.title).toBe("Bookmarks");
    expect(def!.configSchema).toBeDefined();
    expect(def!.defaultConfig).toMatchObject({ bookmarks: [] });
    expect(def!.formEditable).toBe(false);
    expect(def!.HeaderControls).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the test — expect PASS**

Run: `npm test -- bookmarks-registration`
Expected: both registration assertions pass.

- [ ] **Step 3: Commit**

```bash
git add tests/modules/bookmarks-registration.test.ts
git commit -m "test: bookmarks widget registration"
```

---

## Task 9: Full verification

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: all tests pass (no regressions in existing module/registration/shell tests).

- [ ] **Step 2: Lint + build**

Run: `npm run lint && npm run build`
Expected: both succeed.

- [ ] **Step 3: Manual smoke (dev server)**

Run: `npm run dev`, then in the dashboard:
1. Add a "Bookmarks" widget from the add-widget drawer (it appears with a bookmark icon; no integration gate).
2. Empty body shows "No bookmarks yet — use +".
3. Click the `+` header action (in the refresh slot) → popover with Title/URL → add `example.com` → row appears with favicon + title, count shows `(1)`, link opens in a new tab.
4. Hover a row → `×` appears → click → `Remove? ✓ ✕` → `✓` removes the row and persists; reload the page to confirm persistence.
5. Open the card menu → Configure → the dialog shows only the Title-override field (no schema form, no crash).

---

## Self-Review

**Spec coverage:**
- Data shape & module (manifest/server/client/widget) → Tasks 1, 6, 7. ✔
- Seam 1 `saveConfig` on body props → Tasks 2 (contract), 4 (WidgetCard impl). ✔
- Seam 2 custom header action replacing refresh → Tasks 2 (`HeaderControls`), 3 (`headerAction` slot), 4 (compute + pass). ✔
- Seam 3 opt out of auto config-form → Tasks 2 (`formEditable`), 5 (ConfigureDialog guard). ✔
- Rendering a row (favicon + error fallback, target=_blank, hover `×` + inline confirm) → Task 6. ✔
- Empty state ("No bookmarks yet — use +") → Task 6. ✔
- Adding via `+` popover (normalize+validate URL, inline error, append, close) → Task 6 (`BookmarksHeaderControls` + `normalizeUrl`). ✔
- Testing: fetch identity, URL helper, registration → Tasks 1, 8. ✔
- Files touched list → all covered across Tasks 1–8. ✔
- Privacy note: favicon hostname sent to Google — documented in Task 6 code comment + spec. ✔ (no code action beyond the fallback.)

**Placeholder scan:** none — every code step has complete content.

**Type consistency:** `BookmarksConfig` / `BookmarksData` / `Bookmark` / `normalizeUrl` / `BOOKMARKS_TYPE` are defined in Task 1 and used consistently in Tasks 6–8. `saveConfig`, `HeaderControls`, `formEditable` names match between contract (Task 2) and consumers (Tasks 4, 5, 7). `headerAction` matches between shell (Task 3) and WidgetCard (Task 4). Cache key `["widget", id]` matches `use-widget-data.tsx`.
