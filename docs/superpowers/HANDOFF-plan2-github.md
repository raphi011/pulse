# Handoff — Plan 2: GitHub Module

**Date:** 2026-07-09
**Prev phase:** Plan 1 (framework shell) — DONE, merged to `main`.
**This phase:** Build the first real integration (GitHub) on top of the framework, via the `gh` CLI.

---

## Current state (what exists on `main`)

A working, pluggable dashboard shell. Verified: lint clean, `tsc --noEmit` clean, 33 tests pass, production build OK, live HTTP 200 rendering the built-in `core.status` widget with a working data API.

Run it: `npm run dev` → http://localhost:3000. Tests: `npm test`. Migrations: `npm run db:migrate`.

Read these before starting:
- Spec: `docs/superpowers/specs/2026-07-09-work-dashboard-design.md` (see "GitHub module (phase 1)").
- Plan 1: `docs/superpowers/plans/2026-07-09-work-dashboard-framework-shell.md` (the module pattern, in full).
- `CLAUDE.md` (conventions), `AGENTS.md` (Next 16 warning — this is Next 16, NOT 15).

## Environment facts (verified this session)

- **Next.js 16.2.10 + React 19.2**, Tailwind **v4**, TypeScript. Turbopack is the default for `dev` and `build`. Route-handler dynamic `params` is a **Promise** — `await params`.
- Drizzle ORM 0.45 + better-sqlite3 12. Zod **v4**.
- **`gh` CLI is installed and authenticated** (`/opt/homebrew/bin/gh`). This is the integration path for Plan 2.
- `gws` is installed; **`jira-cli` is NOT installed** (relevant to later phases, not this one).
- Node v24, npm 11. Shell is fish (avoid `cd` inside compound bash commands; use absolute paths).

## Conventions

- **No Jira prefix** on commits/branches — personal project. Conventional style (`feat:`, `fix:`, `chore:`).
- Branch-first off `main`; commit only when asked; frequent small commits during a plan.
- TDD per the framework: unit-test `fetch()` against recorded fixtures; integration-test routes against a temp DB (`tests/helpers/db.ts` → `useTempDb()`).

---

## The module pattern (how to add GitHub)

A module is a folder `src/modules/<name>/` with a strict server/client split. Copy the shape of `src/modules/core/`:

```
src/modules/github/
  manifest.ts    # widget type ids, Zod config schema, defaultConfig, shared Data/Config types. NO runtime deps.
  server.ts      # import "server-only"; fetch() (+ actions); calls registerServerWidget(...) at import time
  widgets/*.tsx  # "use client" body components (WidgetBodyProps<Data, Config>)
  client.ts      # calls registerClientWidget({ type, title, Component }) at import time
```

Then wire the barrels (the ONLY place the shell learns a module exists):
- `src/modules/server.ts` → add `import "./github/server";`
- `src/modules/client.ts` → add `import "./github/client";`

Contracts: `src/modules/contracts.ts` (`ServerWidget`, `ClientWidget`, `WidgetBodyProps`, `WidgetAction`).
Registries: `src/modules/server-registry.ts` (server-only), `src/modules/client-registry.ts`.

**Data flow (already built, reuse as-is):** widget mounts → `GET /api/widgets/:id/data` returns the cached row instantly → refresh (manual button or `refreshInterval`) hits `?refresh=1` → server runs `module.fetch(config)` → writes `widget_cache` → returns fresh. `getWidgetData` (`src/server/widget-service.ts`) already keeps the last-good payload on error and the UI shows a "stale" badge. **You get chrome, drag, cache, refresh, and error/loading/empty states for free** — a widget only implements `manifest` + `fetch` + a body component.

Storage: config in `widgets`/`prefs`/`bookmarks`, transient cache in `widget_cache` (`src/db/schema.ts`). Repos: `src/server/config-repo.ts`, `cache-repo.ts`.

---

## What Plan 2 must BUILD (framework gaps to fill first)

These do not exist yet and are prerequisites for GitHub:

1. **CLI runner helper** — `src/server/cli.ts` (server-only). One place to spawn a CLI (`gh`), capture stdout/stderr/exit code, and **classify errors** so every future CLI module inherits it. Classify at least: CLI-not-found (ENOENT → "gh not found — install it"), not-authenticated (detect `gh auth` failure → "run `gh auth login`"), and generic command-failure (surface stderr). `fetch()` throws a typed error; `widget-service` already catches it and keeps last-good. Unit-test the classifier with fake exec results. Prefer `execFile`/`spawn` with arg arrays (no shell string interpolation of user config).

2. **Action endpoint** — `POST /api/widgets/[id]/action` (deferred from Plan 1). Body `{ actionId, params }`. Resolve the widget → its `ServerWidget.actions` → run the matching action → auto-refresh that widget (re-run the cache path). `WidgetBodyProps.runAction(actionId, params)` is already threaded through `WidgetCard` (currently a no-op `async () => {}` — wire it to POST this endpoint). Integration-test it.

3. **Per-widget config UI** — GitHub widgets need repos/org/team in `config`; nothing hardcoded. Add a "Configure" affordance in the widget shell overflow menu that edits `widget.config` (validated by the module's `configSchema`) and PATCHes it. `configSchema` exists on every `ServerWidget` but is currently **unused** — this is where it earns its place (validate config on write in `addWidget`/a new config PATCH). A `PATCH /api/widgets/[id]` already exists for `hidden`; extend it (or add a sibling) to accept `config`.

## GitHub widgets to build (from the spec)

All via `gh`, repos/org/team from each widget's `config`:
1. **My PRs** *(core)* — `gh search prs --author=@me --state=open --json ...`; show CI status + review state; **merge action** (`gh pr merge`); link out.
2. **Team PRs** *(core)* — `gh search prs --team-review-requested=@me` (or an org/author list from config).
3. **Failing Actions** *(core)* — `gh run list` across configured repos; surface red runs.
4. **Dependabot alerts** *(stretch)* — `gh api /repos/{repo}/dependabot/alerts` for configured services.

Testing: record real `gh ... --json` output as fixtures under `tests/fixtures/github/`; feed them to each `fetch()` with the CLI runner mocked; assert typed output. Don't hit the network in tests.

---

## Known scaffold / deferrals carried from Plan 1 (intentional, not bugs)

Documented from the Plan 1 final review — address as they become relevant:
- `configSchema` on `ServerWidget` is defined but not yet used for validation → **Plan 2 item 3** activates it.
- `WidgetShell` has an `"empty"` state that `WidgetCard` produces only when `payload == null`; per-widget "no results" empties (e.g. "no open PRs") should map to it.
- Semantic tokens `--color-ok` / `--color-warn` / `--color-danger` exist; GitHub status (CI green/red, review states) should use them — `--color-ok`/`--color-warn` are currently unused by design.
- `listServerTypes` (server-registry) is currently unused; harmless.
- dnd-kit: dropping onto a fully **empty** column isn't wired (no empty-column droppable). Add droppable `col:N` targets if it becomes annoying — `reorderWidgets` already handles the `col:N` overId.

## First steps for the next session

1. Brainstorm/confirm any open GitHub-module questions (e.g. how "team" is defined for Team PRs — org, team slug, or author list), then write `docs/superpowers/plans/<date>-work-dashboard-github-module.md` via the writing-plans skill.
2. Build the CLI runner + error classifier first (it unblocks everything and every future CLI module reuses it).
3. Then the action endpoint + config UI, then the widgets one at a time.
4. Keep the framework contracts unchanged where possible; if GitHub reveals a needed contract change (e.g. actions needing `config`), make it deliberately and update `core` + tests to match.
