# Global Auto-Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global auto-refresh toggle + force-refresh-now button to the dashboard toolbar that refreshes every widget on a fixed 5-minute cadence, and remove the dead per-widget `refreshInterval` field.

**Architecture:** A new `AutoRefreshProvider` context holds `enabled` (persisted to localStorage), a `nonce` counter, and the interval constant. `use-widget-data` consumes the context: it runs a 5-minute interval when enabled and calls `refresh()` whenever `nonce` bumps. The toolbar renders a toggle + `↻` button wired to the context. No backend/API changes.

**Tech Stack:** Next.js (App Router) + React + TypeScript, TanStack Query, Tailwind v4, Drizzle ORM + better-sqlite3, Vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-07-10-global-auto-refresh-design.md`

---

## File Structure

- **Create** `src/components/auto-refresh-context.tsx` — `AutoRefreshProvider`, `useAutoRefresh`, `INTERVAL_MS`. Owns global toggle state + localStorage persistence + force-refresh nonce.
- **Create** `tests/components/auto-refresh-context.test.tsx` — context behavior tests.
- **Create** `tests/components/use-widget-data.test.tsx` — hook interval + nonce tests.
- **Modify** `src/app/providers.tsx` — wrap children in `AutoRefreshProvider`.
- **Modify** `src/components/use-widget-data.ts` — drop `refreshInterval` param; consume context.
- **Modify** `src/components/widget-card.tsx:17` — drop 2nd arg.
- **Modify** `src/components/dashboard.tsx` — add `AutoRefreshControls` to `Toolbar`.
- **Modify** `src/db/schema.ts:11` — remove `refreshInterval` column.
- **Modify** `src/server/config-repo.ts:30` — remove `refreshInterval: null`.
- **Modify** `tests/components/dashboard-logic.test.ts:6` — remove `refreshInterval: null` from the factory.
- **Generate** `drizzle/0002_*.sql` — drop `refresh_interval` column.

---

## Task 1: AutoRefresh context

**Files:**
- Create: `src/components/auto-refresh-context.tsx`
- Test: `tests/components/auto-refresh-context.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/auto-refresh-context.test.tsx
import { render, screen, act } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import { AutoRefreshProvider, useAutoRefresh } from "@/components/auto-refresh-context";

function Probe() {
  const { enabled, nonce, toggle, refreshAll } = useAutoRefresh();
  return (
    <div>
      <span data-testid="enabled">{String(enabled)}</span>
      <span data-testid="nonce">{nonce}</span>
      <button onClick={toggle}>toggle</button>
      <button onClick={refreshAll}>refreshAll</button>
    </div>
  );
}

function renderProbe() {
  return render(
    <AutoRefreshProvider>
      <Probe />
    </AutoRefreshProvider>,
  );
}

beforeEach(() => localStorage.clear());

test("defaults to disabled with empty storage", () => {
  renderProbe();
  expect(screen.getByTestId("enabled").textContent).toBe("false");
});

test("hydrates enabled from localStorage", () => {
  localStorage.setItem("pulse:auto-refresh", "1");
  renderProbe();
  expect(screen.getByTestId("enabled").textContent).toBe("true");
});

test("toggle flips state and persists to localStorage", () => {
  renderProbe();
  act(() => screen.getByText("toggle").click());
  expect(screen.getByTestId("enabled").textContent).toBe("true");
  expect(localStorage.getItem("pulse:auto-refresh")).toBe("1");
});

test("refreshAll bumps nonce", () => {
  renderProbe();
  expect(screen.getByTestId("nonce").textContent).toBe("0");
  act(() => screen.getByText("refreshAll").click());
  expect(screen.getByTestId("nonce").textContent).toBe("1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/auto-refresh-context.test.tsx`
Expected: FAIL — cannot resolve `@/components/auto-refresh-context`.

- [ ] **Step 3: Write the implementation**

```tsx
// src/components/auto-refresh-context.tsx
"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export const INTERVAL_MS = 5 * 60 * 1000;
const STORAGE_KEY = "pulse:auto-refresh";

type AutoRefreshValue = {
  enabled: boolean;
  toggle: () => void;
  refreshAll: () => void;
  nonce: number;
};

const AutoRefreshContext = createContext<AutoRefreshValue | null>(null);

export function AutoRefreshProvider({ children }: { children: ReactNode }) {
  // Initialize false on both server and client render, then hydrate after mount
  // so the stored value never diverges the SSR markup (no hydration mismatch).
  const [enabled, setEnabled] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY) === "1") setEnabled(true);
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  }, [enabled]);

  const toggle = useCallback(() => setEnabled((e) => !e), []);
  const refreshAll = useCallback(() => setNonce((n) => n + 1), []);

  return (
    <AutoRefreshContext.Provider value={{ enabled, toggle, refreshAll, nonce }}>
      {children}
    </AutoRefreshContext.Provider>
  );
}

export function useAutoRefresh(): AutoRefreshValue {
  const ctx = useContext(AutoRefreshContext);
  if (!ctx) throw new Error("useAutoRefresh must be used within AutoRefreshProvider");
  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/auto-refresh-context.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/auto-refresh-context.tsx tests/components/auto-refresh-context.test.tsx
git commit -m "feat: add global auto-refresh context"
```

---

## Task 2: Wire provider into the app

**Files:**
- Modify: `src/app/providers.tsx`

- [ ] **Step 1: Add the provider**

Replace the file contents with:

```tsx
// src/app/providers.tsx
"use client";
import "@/modules/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { AutoRefreshProvider } from "@/components/auto-refresh-context";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
  }));
  return (
    <QueryClientProvider client={client}>
      <AutoRefreshProvider>{children}</AutoRefreshProvider>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run lint`
Expected: no errors from `providers.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/app/providers.tsx
git commit -m "feat: mount AutoRefreshProvider"
```

---

## Task 3: Consume the context in use-widget-data

Refactor the hook and its one caller together so the tree compiles at this commit. The hook now reads global `enabled`/`nonce` instead of a per-widget interval.

**Files:**
- Modify: `src/components/use-widget-data.ts`
- Modify: `src/components/widget-card.tsx:17`
- Test: `tests/components/use-widget-data.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/use-widget-data.test.tsx
import { render, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AutoRefreshProvider } from "@/components/auto-refresh-context";
import { useWidgetData } from "@/components/use-widget-data";

function Probe() {
  const { refresh } = useWidgetData("w1");
  // touch refresh so it isn't flagged unused; not otherwise needed here
  void refresh;
  return <span>ready</span>;
}

function renderProbe() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AutoRefreshProvider>
        <Probe />
        <Controls />
      </AutoRefreshProvider>
    </QueryClientProvider>,
  );
}

// Renders buttons to drive the global context from within the provider.
import { useAutoRefresh } from "@/components/auto-refresh-context";
function Controls() {
  const { toggle, refreshAll } = useAutoRefresh();
  return (
    <>
      <button onClick={toggle}>toggle</button>
      <button onClick={refreshAll}>refreshAll</button>
    </>
  );
}

function refreshCallCount() {
  return (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
    ([url]) => String(url).includes("refresh=1"),
  ).length;
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ widgetId: "w1", payload: {}, fetchedAt: 0, status: "ok", error: null }),
    })),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("does not auto-refresh while disabled", async () => {
  renderProbe();
  await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000); });
  expect(refreshCallCount()).toBe(0);
});

test("auto-refreshes every 5 minutes while enabled", async () => {
  renderProbe();
  await act(async () => { screen.getByText("toggle").click(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000); });
  expect(refreshCallCount()).toBe(1);
});

test("force-refresh (nonce bump) triggers a refresh, mount does not", async () => {
  renderProbe();
  expect(refreshCallCount()).toBe(0); // mount alone does not force refresh
  await act(async () => { screen.getByText("refreshAll").click(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(refreshCallCount()).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/use-widget-data.test.tsx`
Expected: FAIL — `useWidgetData` still requires a second argument / does not consume the context.

- [ ] **Step 3: Refactor the hook**

Replace `src/components/use-widget-data.ts` with:

```tsx
"use client";
import { useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CacheRow } from "@/server/cache-repo";
import { useAutoRefresh, INTERVAL_MS } from "./auto-refresh-context";

async function fetchData(id: string, refresh: boolean): Promise<CacheRow> {
  const res = await fetch(`/api/widgets/${id}/data${refresh ? "?refresh=1" : ""}`);
  if (!res.ok) throw new Error(`Data request failed: ${res.status}`);
  return res.json();
}

export function useWidgetData(id: string) {
  const qc = useQueryClient();
  const { enabled, nonce } = useAutoRefresh();

  // Initial load is cache-first (instant); refresh() forces an upstream fetch.
  const query = useQuery({
    queryKey: ["widget", id],
    queryFn: () => fetchData(id, false),
  });

  const refresh = useCallback(async () => {
    try {
      const fresh = await fetchData(id, true);
      qc.setQueryData(["widget", id], fresh);
    } catch (err) {
      // Swallow — a failed manual/interval refresh keeps the last cached row visible.
      console.error(`Widget ${id} refresh failed`, err);
    }
  }, [id, qc]);

  // Auto-refresh must force refresh=1; a plain refetch would only re-read the cache.
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => void refresh(), INTERVAL_MS);
    return () => clearInterval(t);
  }, [enabled, refresh]);

  // Force-refresh-now: refresh when the global nonce bumps, but not on initial mount.
  const initialNonce = useRef(nonce);
  useEffect(() => {
    if (nonce === initialNonce.current) return;
    void refresh();
  }, [nonce, refresh]);

  return { ...query, refresh };
}
```

- [ ] **Step 4: Update the caller**

In `src/components/widget-card.tsx`, change line 17 from:

```tsx
  const { data, isLoading, refresh } = useWidgetData(widget.id, widget.refreshInterval);
```

to:

```tsx
  const { data, isLoading, refresh } = useWidgetData(widget.id);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/components/use-widget-data.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/use-widget-data.ts src/components/widget-card.tsx tests/components/use-widget-data.test.tsx
git commit -m "feat: drive widget refresh from global auto-refresh context"
```

---

## Task 4: Toolbar controls

Add a toggle + force-refresh button to the sticky toolbar. `Toolbar` is already inside `AutoRefreshProvider`, so a small subcomponent can read the context directly.

**Files:**
- Modify: `src/components/dashboard.tsx`

- [ ] **Step 1: Add the import**

At the top of `src/components/dashboard.tsx`, alongside the other component imports (after line 14), add:

```tsx
import { useAutoRefresh } from "./auto-refresh-context";
```

- [ ] **Step 2: Add the controls component**

Immediately above the `Toolbar` function (before line 66 `function Toolbar(...)`), add:

```tsx
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
```

- [ ] **Step 3: Render the controls in the toolbar**

In `Toolbar`, replace the lone `<AddWidgetDrawer onAdd={onAdd} />` (line 79) with a grouped right side:

```tsx
        <div className="flex items-center gap-3">
          <AutoRefreshControls />
          <AddWidgetDrawer onAdd={onAdd} />
        </div>
```

- [ ] **Step 4: Verify it compiles and existing tests pass**

Run: `npm run lint && npx vitest run`
Expected: lint clean; full suite green.

- [ ] **Step 5: Manually verify in the browser**

Run: `npm run dev`, open the dashboard. Confirm: the toggle appears in the toolbar, defaults to "off", flips to "on" and survives a page reload; the `↻` button forces every widget to show a fresh "just now" timestamp. Stop the dev server when done.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard.tsx
git commit -m "feat: add auto-refresh toggle and force-refresh button to toolbar"
```

---

## Task 5: Remove the dead per-widget refreshInterval field

Now that nothing reads `widget.refreshInterval`, drop the column and its remaining references, and generate the migration.

**Files:**
- Modify: `src/db/schema.ts:11`
- Modify: `src/server/config-repo.ts:30`
- Modify: `tests/components/dashboard-logic.test.ts:6`
- Generate: `drizzle/0002_*.sql`

- [ ] **Step 1: Remove the schema column**

In `src/db/schema.ts`, delete line 11:

```tsx
  refreshInterval: integer("refresh_interval"), // seconds, null = manual only
```

The `widgets` table's last field becomes `config`.

- [ ] **Step 2: Remove the config-repo reference**

In `src/server/config-repo.ts`, change the `row` literal (line 30) from:

```tsx
    id: randomUUID(), type, title: null, column, order, hidden: false, config: validated, refreshInterval: null,
```

to:

```tsx
    id: randomUUID(), type, title: null, column, order, hidden: false, config: validated,
```

- [ ] **Step 3: Remove the test-factory reference**

In `tests/components/dashboard-logic.test.ts`, change line 6 from:

```ts
  id, type: "core.status", title: null, column, order, hidden: false, config: {}, refreshInterval: null,
```

to:

```ts
  id, type: "core.status", title: null, column, order, hidden: false, config: {},
```

- [ ] **Step 4: Confirm no references remain**

Run: `grep -rn "refreshInterval\|refresh_interval" src tests | grep -v docs`
Expected: no output.

- [ ] **Step 5: Generate the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/0002_*.sql` is created dropping the `refresh_interval` column (`ALTER TABLE ... DROP COLUMN` / SQLite table-rebuild). Inspect the generated SQL to confirm it targets `refresh_interval` and nothing else.

- [ ] **Step 6: Apply the migration to the local DB**

Run: `npm run db:migrate`
Expected: migration applies cleanly against `dashboard.db`.

- [ ] **Step 7: Run the full suite and lint**

Run: `npm run lint && npx vitest run`
Expected: lint clean; all tests green.

- [ ] **Step 8: Commit**

```bash
git add src/db/schema.ts src/server/config-repo.ts tests/components/dashboard-logic.test.ts drizzle/
git commit -m "refactor: drop dead per-widget refreshInterval field"
```

---

## Self-Review Notes

- **Spec coverage:** toggle (Task 1/4); localStorage persistence + default-off (Task 1); force-refresh-now (Task 1 nonce → Task 3 hook → Task 4 button); 5-min fixed interval (`INTERVAL_MS`, Task 1/3); provider wiring (Task 2); dead-field removal + migration (Task 5); tests (Tasks 1, 3); no backend changes. All covered.
- **Type consistency:** `useWidgetData(id)` single-arg used identically in Task 3 hook, caller, and test. `useAutoRefresh()` returns `{ enabled, toggle, refreshAll, nonce }` — same shape consumed in Tasks 3 and 4. `INTERVAL_MS` defined once (Task 1), imported in Task 3.
- **Ordering:** hook + caller change together (Task 3) before the schema column is dropped (Task 5), so the tree compiles at every commit.
