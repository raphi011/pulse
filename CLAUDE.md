# Work Dashboard

Local, single-user, pluggable Tauri desktop dashboard (Vite + React) for organizing daily work. Personal project.

## Conventions

- **No Jira prefix on commits/branches.** This is a personal project, not day-job work — the global `[CORE-12345]` rule does not apply here. Use plain conventional-style messages (e.g. `feat: add github module`).
- Feature-flag-style toggles default to disabled.
- Match existing patterns; keep changes surgical.

## Stack

- Tauri v2 + Vite 6 + React 19 + TypeScript (SPA rendered in the webview, no server)
- Tailwind v4 (CSS-native `@theme` in `src/globals.css`; class-based dark mode)
- Drizzle ORM (`dashboard.db`; `tauri-plugin-sql` transport in-app, `better-sqlite3` test-only)
- dnd-kit (drag/reorder), TanStack Query (cache-first fetch)
- Zod (widget config), Vitest + Testing Library (tests)

## Commands

- `npm run dev` — `tauri dev` (Rust + webview); `npm run dev:vite` — Vite only, no Rust
- `npm start` — release build (`.app` only) + open it (how the app is run for daily use)
- `npm test` / `npm run test:watch` — tests
- `npm run build` — `tauri build` (release `.app`/`.dmg`); `npm run build:vite` — Vite build only; `npm run lint`
- `npm run db:generate` — Drizzle migration files (migrations run in-app via the SQL plugin, not a CLI step)

## Architecture

Integrations are self-contained **modules** under `src/modules/<name>/`, split into:
- `manifest.ts` — shared types, Zod config schema, defaults, and one `WidgetManifest` per widget (`type/title/configSchema/defaultConfig/refreshable?/integration?`) via `defineManifest` (no runtime deps)
- `fetch.ts` — `registerFetch(manifest, { fetch })`; CLI-first, but API is fine
- `widgets/*.tsx` + `render.ts` — `registerRender(manifest, { Component, icon?, count?, HeaderControls?, formEditable? })`
- `repo.ts` (only for local-data modules, e.g. bookmarks) — module-owned table + CRUD functions

The shell knows only the widget contract, never a specific integration. Add a module = drop a folder + add its import to `src/modules/fetch.ts` and `src/modules/render.ts`.

Data flow is **cache-first**: widgets read cached rows from `widget_cache` instantly; refresh (manual or interval) re-runs `fetch()` and re-caches. Layout *is* the `widgets` table (`column`/`order`/`hidden`).

**Authoring a module:** vocabulary is pinned in `CONTEXT.md` (glossary); use the **`create-module`** skill (`.claude/skills/create-module/`) to scaffold one.

**No server, no API routes, no RSC.** The app is a Vite SPA: the webview runs *all* non-UI TS (module fetch/parse, Zod validation, Drizzle, repos, services) in-process. React reads/writes through `src/lib/dashboard-data.ts` directly (still wrapped by TanStack Query) — no `fetch()`-to-an-endpoint indirection.

**Gotchas / patterns (code-verified):**
- Config forms auto-generate from the Zod schema; only these field kinds render (`src/components/schema-form.tsx`): `string`, `number`, `boolean`, `stringList` (`z.array(z.string())`), `enum`. `.describe()` sets the label. Other shapes throw.
- CLI-backed modules wrap `runCli` (`src/server/cli.ts`, spawns via `tauri-plugin-shell`'s `Command`, with a Homebrew-inclusive `PATH` prepended so a Finder-launched `.app` still finds `gh`/`jira`/`gws`). Two error models: process-model CLIs (stderr + non-zero exit, e.g. `gh`/`jira`) use `runCli` + an auth regex; payload-model CLIs (errors as JSON on stdout, maybe exit 0, e.g. `gws`) use `runJsonCli` + an error extractor. Errors classify as `not-found`/`auth`/`timeout`/`failed`.
- N+1 enrichment (list → per-item detail) uses `Promise.allSettled` so one failure doesn't sink the widget (`github/prs.ts`).
- Reference modules: `github` (3 widgets, N+1 enrichment) and `jira` (single widget, custom-query config) — both fully wired; copy their shape.
- Registration test per module asserts both registries resolve each widget type (`tests/modules/*-registration.test.ts`).
- Widget bodies get `{ data, config, refresh }`. There is no action/RPC API: widgets that mutate module data import the module's repo functions directly (no server boundary) and call `refresh()` after — see `bookmarks`. Local user data lives in a module-owned table, never in widget config.
- `refreshable: false` in the manifest hides the refresh button + fetchedAt and skips auto-refresh; `HeaderControls` render *next to* the refresh button, never instead of it.
- Stored config is validated against the manifest schema on every read (`widget-service.ts`); Zod `.default()`s backfill additive schema changes, breaking ones surface as an in-card "Invalid config" error without overwriting the stored config.
- Payload shape changed? Bump `CACHE_VERSION` (`src/server/cache-version.ts`) — the cache is wiped on startup mismatch. Widget bodies are wrapped in a per-card ErrorBoundary.
- DB access goes through `getDb()` (`src/db/client.ts`), which uses Drizzle's `sqlite-proxy` async driver. The transport swaps by environment: `tauri-plugin-sql` in the app, `better-sqlite3` in tests (Node). **All repo functions (`cache-repo`, `config-repo`) are async** — `await` them. Multi-statement atomic writes use `db.batch([...])`, not `db.transaction()`; in-app this goes through the custom `db_batch` Rust command (`src-tauri/src/db_batch.rs`), which runs every statement inside one held `sqlx` transaction (separate BEGIN/COMMIT IPC calls would race across pooled connections). Migrations live in `src-tauri` (`include_str!` of the generated `drizzle/*.sql` files, run by the SQL plugin's migration runner on startup). The DB file lives in the macOS app-data dir: `~/Library/Application Support/com.pulse.dashboard/dashboard.db`.

## Design & docs

- UI work: use the **impeccable** skill; styling: **tailwind** (v4) skill.
- Spec: `docs/superpowers/specs/2026-07-09-work-dashboard-design.md`
- Plans: `docs/superpowers/plans/` (Plan 1 = framework shell; GitHub module = Plan 2)
