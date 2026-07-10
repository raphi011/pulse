# Global Auto-Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global auto-refresh toggle + force-refresh-now button to the dashboard toolbar (fixed 5-minute cadence, refreshes every widget), spin each widget's refresh button while it updates, surface refresh/data failures as toast notifications, and remove the dead per-widget `refreshInterval` field.

**Architecture:** A new `AutoRefreshProvider` context holds `enabled` (persisted to localStorage), a `nonce` counter, and the interval constant. A new `ToastProvider` context exposes `toast()` and renders a fixed toast stack. `use-widget-data` consumes both: it runs a 5-minute interval when enabled, calls `refresh()` when `nonce` bumps, exposes `isRefreshing`, and fires a toast on refresh/load failure. The toolbar renders a toggle + `↻` button. No backend/API changes.

**Tech Stack:** Next.js (App Router) + React + TypeScript, TanStack Query, Tailwind v4, Drizzle ORM + better-sqlite3, Vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-07-10-global-auto-refresh-design.md`

---

## File Structure

- **Create** `src/components/auto-refresh-context.tsx` — `AutoRefreshProvider`, `useAutoRefresh`, `INTERVAL_MS`.
- **Create** `src/components/toast-context.tsx` — `ToastProvider`, `useToast`, toast stack UI.
- **Create** `tests/components/auto-refresh-context.test.tsx`
- **Create** `tests/components/toast-context.test.tsx`
- **Create** `tests/components/use-widget-data.test.tsx`
- **Modify** `src/app/providers.tsx` — wrap children in `AutoRefreshProvider` + `ToastProvider`.
- **Modify** `src/components/widget-shell.tsx` — add `refreshing` prop; spin the `↻` icon.
- **Modify** `src/components/use-widget-data.ts` — drop `refreshInterval` param; consume both contexts; add `isRefreshing`; toast on error.
- **Modify** `src/components/widget-card.tsx:17,42` — drop 2nd arg; pass `refreshing`.
- **Modify** `src/components/dashboard.tsx` — add `AutoRefreshControls` to `Toolbar`.
- **Modify** `src/db/schema.ts:11`, `src/server/config-repo.ts:30`, `tests/components/dashboard-logic.test.ts:6` — remove `refreshInterval`.
- **Generate** `drizzle/0002_*.sql` — drop `refresh_interval` column.

**Follow-up (out of scope):** toasts here cover widget refresh/data errors only. Wiring the other failing call sites (add/remove widget, config save, drag persist — currently silent) into `useToast` is a separate, well-scoped plan.

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

## Task 2: Toast context

A lightweight, dependency-free toast system: context + hook + a fixed bottom-right stack with auto-dismiss. Tailwind tokens (`danger`, `card`, `border`) match existing usage in `widget-shell.tsx`.

**Files:**
- Create: `src/components/toast-context.tsx`
- Test: `tests/components/toast-context.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/toast-context.test.tsx
import { render, screen, act } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ToastProvider, useToast } from "@/components/toast-context";

function Trigger() {
  const { toast } = useToast();
  return <button onClick={() => toast("boom")}>fire</button>;
}

function renderTrigger() {
  return render(<ToastProvider><Trigger /></ToastProvider>);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test("shows a toast when fired", () => {
  renderTrigger();
  act(() => screen.getByText("fire").click());
  expect(screen.getByRole("alert").textContent).toContain("boom");
});

test("auto-dismisses after the timeout", () => {
  renderTrigger();
  act(() => screen.getByText("fire").click());
  expect(screen.queryByRole("alert")).not.toBeNull();
  act(() => vi.advanceTimersByTime(6000));
  expect(screen.queryByRole("alert")).toBeNull();
});

test("dismiss button removes the toast", () => {
  renderTrigger();
  act(() => screen.getByText("fire").click());
  act(() => screen.getByLabelText("Dismiss").click());
  expect(screen.queryByRole("alert")).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/toast-context.test.tsx`
Expected: FAIL — cannot resolve `@/components/toast-context`.

- [ ] **Step 3: Write the implementation**

```tsx
// src/components/toast-context.tsx
"use client";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

type ToastVariant = "error" | "info";
type Toast = { id: number; message: string; variant: ToastVariant };
type ToastValue = { toast: (message: string, variant?: ToastVariant) => void };

const ToastContext = createContext<ToastValue | null>(null);
const DISMISS_MS = 6000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, variant: ToastVariant = "error") => {
      const id = nextId.current++;
      setToasts((ts) => [...ts, { id, message, variant }]);
      setTimeout(() => dismiss(id), DISMISS_MS);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="alert"
            className={`pointer-events-auto flex items-start gap-2 rounded-lg px-3.5 py-2.5 text-sm shadow-lg ring-1 ${
              t.variant === "error"
                ? "bg-danger/10 text-danger ring-danger/30"
                : "bg-card text-slate-700 ring-border dark:bg-card-dark dark:text-slate-200 dark:ring-border-dark"
            }`}
          >
            <span aria-hidden className="mt-px select-none">{t.variant === "error" ? "⚠" : "ℹ"}</span>
            <p className="min-w-0 flex-1 break-words">{t.message}</p>
            <button
              aria-label="Dismiss"
              onClick={() => dismiss(t.id)}
              className="shrink-0 text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-200"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/toast-context.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/toast-context.tsx tests/components/toast-context.test.tsx
git commit -m "feat: add lightweight toast context"
```

---

## Task 3: Wire providers into the app

**Files:**
- Modify: `src/app/providers.tsx`

- [ ] **Step 1: Add the providers**

Replace the file contents with:

```tsx
// src/app/providers.tsx
"use client";
import "@/modules/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { AutoRefreshProvider } from "@/components/auto-refresh-context";
import { ToastProvider } from "@/components/toast-context";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
  }));
  return (
    <QueryClientProvider client={client}>
      <AutoRefreshProvider>
        <ToastProvider>{children}</ToastProvider>
      </AutoRefreshProvider>
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
git commit -m "feat: mount AutoRefresh and Toast providers"
```

---

## Task 4: Spin the refresh button while refreshing

Add an optional `refreshing` prop to `WidgetShell`; when true, the `↻` icon spins and the button is disabled. Existing callers pass nothing, so behavior is unchanged until Task 5 wires it.

**Files:**
- Modify: `src/components/widget-shell.tsx`
- Test: `tests/components/widget-shell.test.tsx`

- [ ] **Step 1: Write the failing test**

Add this test to `tests/components/widget-shell.test.tsx` (keep existing tests):

```tsx
import { render } from "@testing-library/react";
import { expect, test } from "vitest";
import { WidgetShell } from "@/components/widget-shell";

test("spins and disables the refresh button while refreshing", () => {
  const { getByLabelText, container } = render(
    <WidgetShell title="X" state="ok" fetchedAt={null} onRefresh={() => {}} refreshing>
      <div>body</div>
    </WidgetShell>,
  );
  expect(getByLabelText("Refresh")).toBeDisabled();
  expect(container.querySelector(".animate-spin")).not.toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/widget-shell.test.tsx`
Expected: FAIL — `refreshing` is not a prop; button not disabled / no `.animate-spin`.

- [ ] **Step 3: Add the prop**

In `src/components/widget-shell.tsx`, add `refreshing` to the destructured props (line 31) and its type (in the props type block, e.g. after `onRefresh: () => void;`):

```tsx
  title, state, error, fetchedAt, onRefresh, refreshing, children, headerExtra, menu, dragHandle,
```

```tsx
  onRefresh: () => void;
  refreshing?: boolean;
```

Then replace the refresh button (lines 64-70) with:

```tsx
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/components/widget-shell.test.tsx`
Expected: PASS (existing tests + the new one).

- [ ] **Step 5: Commit**

```bash
git add src/components/widget-shell.tsx tests/components/widget-shell.test.tsx
git commit -m "feat: spin widget refresh button while refreshing"
```

---

## Task 5: Consume the contexts in use-widget-data

Refactor the hook and its caller together so the tree compiles at this commit. The hook now reads global `enabled`/`nonce`, exposes `isRefreshing`, and toasts on refresh/load failure.

**Files:**
- Modify: `src/components/use-widget-data.ts`
- Modify: `src/components/widget-card.tsx:17,42`
- Test: `tests/components/use-widget-data.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/use-widget-data.test.tsx
import { render, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AutoRefreshProvider, useAutoRefresh } from "@/components/auto-refresh-context";
import { ToastProvider } from "@/components/toast-context";
import { useWidgetData } from "@/components/use-widget-data";

function Probe() {
  const { refresh } = useWidgetData("w1");
  void refresh;
  return <span>ready</span>;
}

// Buttons to drive the global context from within the provider.
function Controls() {
  const { toggle, refreshAll } = useAutoRefresh();
  return (
    <>
      <button onClick={toggle}>toggle</button>
      <button onClick={refreshAll}>refreshAll</button>
    </>
  );
}

function renderProbe() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AutoRefreshProvider>
        <ToastProvider>
          <Probe />
          <Controls />
        </ToastProvider>
      </AutoRefreshProvider>
    </QueryClientProvider>,
  );
}

function refreshCallCount() {
  return (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
    ([url]) => String(url).includes("refresh=1"),
  ).length;
}

const okRow = { widgetId: "w1", payload: {}, fetchedAt: 0, status: "ok", error: null };

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => okRow })));
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
  expect(refreshCallCount()).toBe(0);
  await act(async () => { screen.getByText("refreshAll").click(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(refreshCallCount()).toBe(1);
});

test("fires a toast when a refresh fails", async () => {
  (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) =>
    String(url).includes("refresh=1")
      ? { ok: false, status: 500, json: async () => ({}) }
      : { ok: true, json: async () => okRow },
  );
  renderProbe();
  await act(async () => { screen.getByText("refreshAll").click(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByRole("alert").textContent).toContain("Refresh failed");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/use-widget-data.test.tsx`
Expected: FAIL — `useWidgetData` still requires a second argument / does not consume the contexts.

- [ ] **Step 3: Refactor the hook**

Replace `src/components/use-widget-data.ts` with:

```tsx
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CacheRow } from "@/server/cache-repo";
import { useAutoRefresh, INTERVAL_MS } from "./auto-refresh-context";
import { useToast } from "./toast-context";

async function fetchData(id: string, refresh: boolean): Promise<CacheRow> {
  const res = await fetch(`/api/widgets/${id}/data${refresh ? "?refresh=1" : ""}`);
  if (!res.ok) throw new Error(`Data request failed: ${res.status}`);
  return res.json();
}

const msg = (err: unknown) => (err instanceof Error ? err.message : "unknown error");

export function useWidgetData(id: string) {
  const qc = useQueryClient();
  const { enabled, nonce } = useAutoRefresh();
  const { toast } = useToast();
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Initial load is cache-first (instant); refresh() forces an upstream fetch.
  const query = useQuery({
    queryKey: ["widget", id],
    queryFn: () => fetchData(id, false),
  });

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const fresh = await fetchData(id, true);
      qc.setQueryData(["widget", id], fresh);
    } catch (err) {
      // Keep the last cached row visible, but surface the failure to the user.
      console.error(`Widget ${id} refresh failed`, err);
      toast(`Refresh failed: ${msg(err)}`);
    } finally {
      setIsRefreshing(false);
    }
  }, [id, qc, toast]);

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

  // Surface an initial cache-load failure too.
  useEffect(() => {
    if (query.isError) toast(`Failed to load widget: ${msg(query.error)}`);
  }, [query.isError, query.error, toast]);

  return { ...query, refresh, isRefreshing };
}
```

- [ ] **Step 4: Update the caller**

In `src/components/widget-card.tsx`, change line 17 from:

```tsx
  const { data, isLoading, refresh } = useWidgetData(widget.id, widget.refreshInterval);
```

to:

```tsx
  const { data, isLoading, refresh, isRefreshing } = useWidgetData(widget.id);
```

And add `refreshing={isRefreshing}` to the `<WidgetShell>` props (alongside `onRefresh={refresh}` at line 40):

```tsx
      onRefresh={refresh}
      refreshing={isRefreshing}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/components/use-widget-data.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/use-widget-data.ts src/components/widget-card.tsx tests/components/use-widget-data.test.tsx
git commit -m "feat: drive widget refresh from context, toast on failure, expose isRefreshing"
```

---

## Task 6: Toolbar controls

Add a toggle + force-refresh button to the sticky toolbar. `Toolbar` is already inside `AutoRefreshProvider`, so a small subcomponent reads the context directly.

**Files:**
- Modify: `src/components/dashboard.tsx`

- [ ] **Step 1: Add the import**

At the top of `src/components/dashboard.tsx`, after line 14, add:

```tsx
import { useAutoRefresh } from "./auto-refresh-context";
```

- [ ] **Step 2: Add the controls component**

Immediately above `function Toolbar(` (before line 66), add:

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

In `Toolbar`, replace the lone `<AddWidgetDrawer onAdd={onAdd} />` (line 79) with:

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

Run: `npm run dev`, open the dashboard. Confirm: the toggle appears, defaults to "off", flips to "on" and survives a page reload; clicking `↻` makes every card's refresh button spin and updates its "just now" timestamp; a forced refresh against a broken source shows an error toast bottom-right. Stop the dev server when done.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard.tsx
git commit -m "feat: add auto-refresh toggle and force-refresh button to toolbar"
```

---

## Task 7: Remove the dead per-widget refreshInterval field

Nothing reads `widget.refreshInterval` anymore. Drop the column and its remaining references, and generate the migration.

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
Expected: a new `drizzle/0002_*.sql` dropping the `refresh_interval` column. Inspect the SQL to confirm it targets `refresh_interval` and nothing else.

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

- **Spec + new requests coverage:** toggle (Task 1/6); localStorage persistence + default-off (Task 1); force-refresh-now (Task 1 nonce → Task 5 hook → Task 6 button); 5-min fixed interval (`INTERVAL_MS`, Task 1/5); provider wiring (Task 3); refresh button spins while updating (Task 4 shell prop + Task 5 `isRefreshing`); errors surfaced as toasts (Task 2 system + Task 5 refresh/load wiring); dead-field removal + migration (Task 7); tests (Tasks 1, 2, 4, 5); no backend changes. All covered.
- **Type consistency:** `useWidgetData(id)` single-arg, returning `{ ...query, refresh, isRefreshing }`, used identically in hook, caller, and test. `useAutoRefresh()` → `{ enabled, toggle, refreshAll, nonce }`. `useToast()` → `{ toast }` with `toast(message, variant?)`. `WidgetShell` gains optional `refreshing?: boolean`. `INTERVAL_MS` defined once (Task 1), imported in Task 5.
- **Ordering:** `WidgetShell` gains the optional `refreshing` prop (Task 4) before `widget-card` passes it (Task 5); hook + caller change together (Task 5) before the schema column is dropped (Task 7) — so the tree compiles at every commit.
- **Scope note:** toasts cover widget refresh/data errors only; extending to other call sites is a flagged follow-up, not in this plan.
```
