# Work Dashboard

Local, single-user, pluggable Wails v3 desktop dashboard — Go backend
(`internal/`), Vite + React webview (`frontend/`). Personal project.

## Conventions

- **No Jira prefix on commits/branches.** Personal project — plain conventional
  messages (e.g. `feat: add github module`).
- Feature-flag-style toggles default to disabled.
- Match existing patterns; keep changes surgical.

## Stack

- Wails v3 (`v3.0.0-alpha2.114`) + Go ≥ 1.25; Vite 8 + React 19 + TypeScript
- Tailwind v4 (CSS-native `@theme` in `src/globals.css`; class-based dark mode)
- SQLite via `internal/db` (stdlib `database/sql`; migrations in
  `internal/db/migrations/*.sql`, run on startup)
- dnd-kit (drag/reorder), TanStack Query (cache-first fetch), Vitest + Testing
  Library

## Commands

- `wails3 dev` (or `task dev`) — dev mode; `task start` — package release
  `.app` + open it (daily use)
- `go test -race ./internal/... ./cmd/...` — backend tests
- `cd frontend && npm test` / `npm run lint` / `npx tsc --noEmit` — frontend gates
- `wails3 generate bindings -ts -i` — regenerate TS bindings (gitignored) after
  changing any bound service surface
- `go run ./cmd/gen-widget-types` — regenerate `frontend/src/widget-types.gen.json`
  after adding/removing a widget type

## Architecture

Integrations are **modules**: a Go package `internal/modules/<name>/` implementing
`module.Module` (`Manifests() []module.Manifest` + `Fetch(ctx, widgetType,
config)`), plus a frontend render side `frontend/src/modules/<name>/`
(`manifest.ts` = plain TS types mirroring the Go payloads, `render.ts` =
`registerRender(TYPE, { Component, icon, ... })`, `widgets/*.tsx`).

The server owns manifests and config validation; config forms are generated from
`module.ConfigField` (kinds: string, number, boolean, stringList, enum,
asyncEnum, asyncMultiEnum — `ConfigField` serializes `def`, not `default`).
The two async kinds are dynamic dropdowns: their options come from the
module's `OptionsProvider` at runtime, wired via `OptionsSource`/`OptionsKey`
(see `gws`) rather than a static `Options` list. `module.DecodeConfig[T]` turns
the validated map into a typed struct at the top of `Fetch`.

Wiring a module (all in the same commit — two parity tests enforce it):
1. `internal/modules/all.go` → append to `ManifestModules()`
2. `main.go` → append to the registry (and `application.NewService(...)` if the
   module has a bound mutation service)
3. `go run ./cmd/gen-widget-types` → commit the regenerated
   `frontend/src/widget-types.gen.json`
4. `frontend/src/modules/render.ts` → add the `import "./<name>/render";`

Data flow is **cache-first**: widgets read cached payloads instantly; refresh
re-runs the Go `Fetch` and re-caches (event `widget:cache-updated`, bare
widget-id string). Cache rows: `{widgetId, payload, fetchedAt, status, error,
errorKind}`, errorKind ∈ `not-found|auth|timeout|failed`.

Widgets that mutate data call Wails-bound per-module services through
`frontend/src/lib/backend.ts` (e.g. gws email/task actions, pomodoro session
log) — never CLIs or the DB directly. Local user data lives in a module-owned
table via a module `repo.go` (see `bookmarks`, `pomodoro`).

**Reference modules:** `ccusage` (smallest: one widget, CLI fetch), `github`
(multi-widget, N+1 enrichment, process-model CLI), `gws` (payload-model CLI,
options providers, mutation service).

## Gotchas (code-verified)

- **Numeric manifest defaults are float64 literals** (`20.0` not `20`).
- **Every payload slice field must be non-nil** (`[]T{}`) — a nil slice marshals
  to JSON `null` and widgets do `d.items.length`.
- **Payload JSON keys are camelCase matching the TS types exactly**; optional TS
  fields (`errors?`, `meetUrl?`) get `omitempty`.
- Two CLI error models (`internal/cli`): process-model (stderr + non-zero exit,
  auth classified by regex via `cli.Options.NotAuthPattern` — `gh`, `jira`) and
  payload-model (errors as JSON on stdout, maybe exit 0 — `gws`, via
  `cli.RunJSONInto` + an error extractor).
- CLI seams are injectable `runner` funcs — module tests fake the CLI, never
  shell out.
- **Backend-only bound-service methods get `//wails:ignore`** (last doc-comment
  line, blank `//` before it).
- `internal/` stays OS-neutral and Wails-free — sole exception:
  `internal/modules/pomodoro/service.go` (notifications seam).
- Vite must bind IPv4 (`server.host: "127.0.0.1"` in `vite.config.ts`) — the
  Wails dev-server asset proxy dials `tcp4`.
- Stored config is validated against the manifest on every read; additive schema
  changes backfill via field defaults, breaking ones surface as an in-card
  error. Widget bodies are wrapped in a per-card ErrorBoundary.
- DB file: `~/Library/Application Support/com.pulse.dashboard/pulse.db`. The
  old Tauri-era `dashboard.db` in the same dir is unused.

## Design & docs

- UI work: use the **impeccable** skill; styling: **tailwind** (v4) skill.
- New module: use the **create-module** skill (`.claude/skills/create-module/`).
- Specs: `docs/superpowers/specs/`; plans: `docs/superpowers/plans/`.
