# Global Auto-Refresh — Design

**Date:** 2026-07-10
**Status:** Approved (pending spec review)

## Problem

The dashboard refreshes widget data only manually, via the per-card `↻` button. There is no way to keep all panels fresh automatically. We want a single global control at the top of the page:

- An **on/off toggle** for auto-refresh (fixed 5-minute cadence, refreshes every panel).
- A **force-refresh-now** button that refreshes all panels immediately, independent of the toggle.

## Current state

- `src/components/use-widget-data.ts` already owns per-widget refresh: cache-first `useQuery` on `["widget", id]`, plus `refresh()` which forces `GET /api/widgets/:id/data?refresh=1` and writes the result via `qc.setQueryData` (a plain refetch would only re-read the server cache). Failures are swallowed so stale data stays visible.
- The hook already contains an interval primitive (`setInterval(refresh, refreshInterval*1000)`) keyed off a per-widget `refreshInterval`.
- **That per-widget field is dead code:** `refreshInterval` is defined in `schema.ts:11`, read by the hook and passed by `widget-card.tsx:17`, but nothing ever *writes* it — no config UI exposes it and `addWidget` hardcodes `null` (`config-repo.ts:30`). Every widget is therefore manual-only in practice.
- No `localStorage` usage anywhere in `src`.
- The sticky top bar is `Toolbar` in `src/components/dashboard.tsx:66-83`.

## Decisions

- **Global-only model.** Drop the dead per-widget `refreshInterval` path rather than layer a global control on top of it (avoids two competing interval sources). Per-widget cadences are YAGNI for a personal single-user app; add back later against a real use case if ever needed.
- **Fixed interval:** 5 minutes, a module constant (not user-configurable).
- **Toggle defaults to OFF** (feature-flag-style toggles default disabled, per project convention).
- **Persistence:** `localStorage` (new pattern, but the right weight for a client-side UI preference — no DB migration, no round-trip). Key: `pulse:auto-refresh`.

## Architecture

### 1. `AutoRefreshProvider` + `useAutoRefresh` (new — `src/components/auto-refresh-context.tsx`)

React context exposing:

- `enabled: boolean` — persisted to `localStorage`. Initialized to `false` on both server and client render (no localStorage read during render → no hydration mismatch); a mount `useEffect` hydrates the stored value, a second effect persists on change.
- `toggle(): void` — flips `enabled`.
- `refreshAll(): void` — increments an in-memory `nonce`.
- `nonce: number` — bumped by `refreshAll`; widgets watch it to trigger an immediate refresh.
- `INTERVAL_MS = 5 * 60 * 1000` — exported constant.

Provider wraps the dashboard. Placed in `src/app/providers.tsx` inside `QueryClientProvider` (keeps all client-wide providers in one place).

### 2. Toolbar control (`dashboard.tsx`, `Toolbar`)

Add a control group on the right of the sticky bar, before `<AddWidgetDrawer>`:

- An **auto-refresh toggle** (labeled, e.g. "Auto-refresh") wired to `enabled` / `toggle()`.
- A **`↻` force button** wired to `refreshAll()`, always enabled regardless of `enabled`.

Styling follows the existing Toolbar/AddWidgetDrawer patterns (Tailwind v4 tokens already in use). `Toolbar` takes the two handlers (or reads the context directly — it is already inside the provider).

### 3. `use-widget-data.ts` refactor

- Drop the `refreshInterval` parameter; signature becomes `useWidgetData(id)`.
- Consume `useAutoRefresh()`.
- **Interval effect:** when `enabled`, `setInterval(() => void refresh(), INTERVAL_MS)`; cleared when disabled or on unmount. (Each mounted widget runs its own timer — negligible at this scale.)
- **Nonce effect:** when `nonce` changes, call `refresh()`; skip the initial render so mount doesn't force a fetch. Fans force-refresh out to every mounted widget.
- `refresh()` itself is unchanged — per-widget failure isolation is preserved (each swallows its own error).

### 4. Dead-field removal

- `widget-card.tsx:17` → `useWidgetData(widget.id)` (drop 2nd arg).
- `schema.ts:11` → remove the `refreshInterval` column.
- `config-repo.ts:30` → remove `refreshInterval: null` from the `addWidget` row.
- Generate a Drizzle migration (`npm run db:generate`) dropping the `refresh_interval` column; it becomes `drizzle/0002_*.sql`.

## Data flow

Toggle/force live in `Toolbar` → `AutoRefreshContext` → every `useWidgetData` reacts (interval when `enabled`, immediate on `nonce` bump). No backend/API changes — the existing `?refresh=1` path and `widget_cache` are untouched.

## Testing

Vitest + Testing Library, jsdom env (localStorage available).

1. **`tests/components/auto-refresh-context.test.tsx`**
   - Defaults to `enabled: false` with empty storage.
   - Hydrates `enabled: true` from a pre-seeded `localStorage` value.
   - `toggle()` flips state and persists to `localStorage`.
   - `refreshAll()` increments `nonce`.

2. **`tests/components/use-widget-data.test.tsx`** (fake timers, mocked `fetch`)
   - When `enabled`, advancing `INTERVAL_MS` calls `refresh` (a `?refresh=1` fetch).
   - When disabled, advancing time triggers no refresh.
   - Bumping `nonce` (via `refreshAll`) triggers a `refresh`; initial mount does not.

## Out of scope

- Per-widget refresh intervals (removed).
- User-configurable interval length.
- Pausing auto-refresh on window blur / visibility (existing `refetchOnWindowFocus: false` stays).
