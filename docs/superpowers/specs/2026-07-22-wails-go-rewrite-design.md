# Wails/Go Rewrite — Design

**Date:** 2026-07-22
**Status:** Approved (pending spec review)

## Goal

Rewrite Pulse from Tauri v2 (Rust + all logic in the webview) to **Wails v3 (Go)**: all
non-UI logic lives in Go; web tech (React) does only rendering. Motivation: preference for
working in Go — future modules are authored in Go.

## Decisions (locked)

- **Framework:** Wails **v3 alpha**, pinned to the current alpha release at implementation
  time. Accepted risk: API churn/alpha bugs. Verify the actual bindings/events API surface
  at plan time; docs in this spec describe intent, not exact v3 symbol names.
- **Structure:** Same repo, replace in place — on a long-lived `wails` branch, since `main`
  is the daily driver (and a live shared workspace for concurrent sessions). Cutover =
  merge when at parity.
- **Data:** Fresh Go-owned schema. **No import** of existing data; old
  `dashboard.db` is left untouched (delete manually later). New DB file `pulse.db` in the
  same app-data dir (`~/Library/Application Support/com.pulse.dashboard/`).
- **Manifests:** Go owns widget manifests (config schema, defaults, titles). Frontend
  auto-generates config forms from a descriptor served by Go. Zod is deleted.
- **Refresh:** Go owns all scheduling. Backend tickers fetch, cache, and push an event;
  the UI is passive and re-reads on event.
- **Backend shape:** Hybrid (approach C) — uniform `Module` interface behind one core
  bound service for everything uniform (manifest/fetch/cache/scheduling), plus small
  per-module bound services only where a module mutates local data (bookmarks, pomodoro).

## Repo layout

```
pulse/
├─ main.go, go.mod            # Wails v3 app entry
├─ internal/
│  ├─ module/                 # Module interface, WidgetManifest, config descriptor DSL, registry
│  ├─ modules/<name>/         # 8 modules: bookmarks, ccusage, github, github-stats,
│  │                          #   gws, jira, pomodoro, system
│  ├─ db/                     # open, embedded migrations + runner, core repos
│  ├─ cli/                    # runCli/runJsonCli port, error classification
│  ├─ scheduler/              # per-widget tickers, refresh orchestration, event emit
│  └─ dashboard/              # core bound service
├─ frontend/                  # current src/ + Vite config move here (Wails convention)
│  └─ bindings/               # generated typed TS clients
└─ docs/, tests/ (frontend)   # Go tests live next to their packages
```

Deleted at cutover: `src-tauri/`, `drizzle/`, `src/server/`, `src/db/`, all module
`fetch.ts` files, Zod, Drizzle, tauri plugins. TanStack Query stays as the client-side
cache (least churn in widget components) but is invalidated by Wails events instead of
running its own refresh intervals.

## Contracts

### Module interface

```go
type Module interface {
    Manifests() []WidgetManifest
    Fetch(ctx context.Context, widgetType string, config json.RawMessage) (any, error)
}
```

Central registry in `internal/module`. Adding a module = drop a package under
`internal/modules/` + one import in the registry wiring (mirrors today's
`src/modules/fetch.ts` / `render.ts` pattern). The shell (core service, scheduler, UI
grid) knows only the widget contract, never a specific integration.

### WidgetManifest & config descriptor

`WidgetManifest`: `Type`, `Title`, `ConfigFields`, `Defaults`, `Refreshable`,
`Integration`. `ConfigFields` is a Go struct DSL restricted to exactly today's seven form
field kinds — `string`, `number` (with min/max), `boolean`, `stringList`, `enum`, plus
`asyncEnum`/`asyncMultiEnum` (an `optionsKey` resolved at form-open time by a
module-registered options provider, today's `field-options.ts`; served via a
`FieldOptions(key)` bound method) — each with label (today's `.describe()`) and default.
Unsupported shapes are unrepresentable in the type system, replacing today's
"schema-form throws" enforcement.

Frontend `schema-form.tsx` re-targets from Zod introspection to this descriptor (fetched
via `Manifests()`).

### Bound services

- **`dashboard` (core):** `Manifests()`, layout CRUD (widgets/tabs/order/hidden/span),
  prefs, `Refresh(widgetID)`, `ReadCache(widgetID)`.
- **Per-module services** (only where local data is mutated): `bookmarks` (CRUD),
  `pomodoro` (session log). Widgets import the generated typed TS client directly and
  call refresh after mutating — same shape as today's "widgets import repo functions"
  pattern, with typed generated bindings instead of an in-process import.

### Config validation (Go, port of widget-service.ts semantics)

Stored config is validated against the manifest on every read. Additive schema changes
are backfilled from defaults. Breaking mismatches surface as an in-card "Invalid config"
error **without** overwriting the stored config.

## Data flow

Cache-first, preserved from today:

1. UI mounts → `ReadCache(widgetID)` → renders instantly from cached rows.
2. Go scheduler ticks per widget → `Fetch` → writes cache row (`ok`/`error` + errorKind)
   → emits `widget:cache-updated {widgetId}`.
3. UI listens, re-reads only that widget.
4. Manual refresh button → `Refresh(widgetID)` → same fetch/cache/emit path.
5. `refreshable: false` manifests: no ticker, no refresh button, no fetchedAt (unchanged).
6. The global auto-refresh toggle and "refresh all now" move from
   localStorage/frontend intervals to a pref + bound methods (`SetAutoRefresh`,
   `RefreshAll`) driving the Go scheduler. Interval stays 5 minutes.
7. Exception (documented): the `system.stats` live sampler keeps its frontend ring
   buffer and poll loop (it is view-state for a live chart and must pause on
   `document.hidden`, which only the webview can observe); it polls a bound
   `system.Stats()` method that owns the stateful CPU/net delta sampling in Go
   (gopsutil), replacing the Rust `system_stats` command.

N+1 enrichment (list → per-item detail, e.g. github PRs) uses per-item goroutines with
collected errors — one item's failure never sinks the widget (allSettled equivalent).

`CACHE_VERSION` mechanism kept: Go const; on startup mismatch the cache table is wiped.

## Schema (fresh, Go-owned)

Same six tables as today — `widgets`, `tabs`, `bookmarks`, `prefs`, `widget_cache`,
`pomodoro_sessions` — with improvements:

- Foreign keys with `ON DELETE CASCADE`: `widgets.tab_id → tabs.id`,
  `widget_cache.widget_id → widgets.id`.
- `created_at` on user-data tables (widgets, tabs, bookmarks).
- `STRICT` tables; `PRAGMA foreign_keys = ON` at open.

**Driver:** `modernc.org/sqlite` (cgo-free) + stdlib `database/sql`, hand-written
queries (6 small tables; sqlc/ORM is overkill). Multi-statement atomic writes use a
plain Go transaction — the entire Rust `db_batch` IPC workaround disappears.

**Migrations:** embedded `.sql` files (`embed.FS`) + a ~40-line runner tracking a
`schema_migrations` table. Runs at startup. No external migration dep.

## CLI runner (`internal/cli`)

Port of `src/server/cli.ts` on `os/exec`:

- Homebrew-inclusive `PATH` prepended so a Finder-launched `.app` finds `gh`/`jira`/`gws`.
- Two error models preserved: process-model CLIs (stderr + non-zero exit → auth regex)
  and payload-model CLIs (errors as JSON on stdout, maybe exit 0 → error extractor).
- Classification: `not-found` / `auth` / `timeout` / `failed`, stored on cache rows.
- Timeouts via `context.WithTimeout`.
- The whole Tauri shell-scope/capabilities gotcha class disappears — no
  `capabilities/default.json` equivalent needed.

**System stats:** `gopsutil` replaces `src-tauri/src/system_stats.rs`.

## Error handling

- Fetch errors → cache row `status: error` + `errorKind`; widget renders the same error
  states as today.
- Scheduler recovers panics per widget; one widget can never take down the app or other
  widgets.
- React per-card ErrorBoundary stays.

## Testing

- **Go** (stdlib `testing`, table-driven): CLI parsing + error classification; module
  fetch/parse against fixtures (reuse `tests/fixtures/`); repos + migrations against
  in-memory sqlite; manifest registration test (every widget type resolves in the
  registry).
- **Registry parity across the language boundary:** a Go test generates/asserts
  `widget-types.json`; a Vitest test asserts the render registry covers exactly that
  list. Replaces today's `tests/modules/*-registration.test.ts` pairing.
- **Vitest** (kept, shrunk): schema-form rendering from descriptor fixtures; widget
  component tests with mock data.

## Cutover plan

1. Scaffold Wails v3 on the `wails` branch; move frontend under `frontend/`.
2. Port core: db + migrations, cli, module registry + descriptor DSL, dashboard service,
   scheduler, frontend wiring (bindings, events, schema-form re-target).
3. Port modules easiest → hardest: system, bookmarks, pomodoro, github, jira, gws,
   ccusage, github-stats.
4. Parity check against the running Tauri app; then merge, update scripts
   (`npm start` equivalent → wails package + open), delete Tauri/Drizzle/Zod remnants.
5. Rewrite `CLAUDE.md` and the `create-module` skill for the Go world.

## Out of scope

- Data import from `dashboard.db` (explicitly dropped).
- New features, new modules, UI redesign — parity port only.
- Windows/Linux support (macOS only, as today).
