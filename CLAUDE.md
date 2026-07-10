# Work Dashboard

Local, single-user, pluggable Next.js dashboard for organizing daily work. Personal project.

## Conventions

- **No Jira prefix on commits/branches.** This is a personal project, not day-job work — the global `[CORE-12345]` rule does not apply here. Use plain conventional-style messages (e.g. `feat: add github module`).
- Feature-flag-style toggles default to disabled.
- Match existing patterns; keep changes surgical.

## Stack

- Next.js (App Router) + React + TypeScript
- Tailwind v4 (CSS-native `@theme` in `src/app/globals.css`; class-based dark mode)
- Drizzle ORM + better-sqlite3 (`dashboard.db`)
- dnd-kit (drag/reorder), TanStack Query (cache-first fetch)
- Zod (widget config), Vitest + Testing Library (tests)

## Commands

- `npm run dev` — dev server
- `npm test` / `npm run test:watch` — tests
- `npm run build` / `npm run lint`
- `npm run db:generate` / `npm run db:migrate` — Drizzle migrations

## Architecture

Integrations are self-contained **modules** under `src/modules/<name>/`, split into:
- `manifest.ts` — shared types, Zod config schema, defaults (no runtime deps)
- `server.ts` — `fetch()` + actions; registers into the **server-only** registry (CLI-first, but API is fine)
- `widgets/*.tsx` + `client.ts` — React body; registers into the **client** registry

The shell knows only the widget contract, never a specific integration. Add a module = drop a folder + add its import to `src/modules/server.ts` and `src/modules/client.ts`.

Data flow is **cache-first**: widgets read cached rows from `widget_cache` instantly; refresh (manual or interval) re-runs `fetch()` and re-caches. Layout *is* the `widgets` table (`column`/`order`/`hidden`).

**Authoring a module:** vocabulary is pinned in `CONTEXT.md` (glossary); use the **`create-module`** skill (`.claude/skills/create-module/`) to scaffold one.

**Gotchas / patterns (code-verified):**
- Config forms auto-generate from the Zod schema; only these field kinds render (`src/components/schema-form.tsx`): `string`, `number`, `boolean`, `stringList` (`z.array(z.string())`), `enum`. `.describe()` sets the label. Other shapes throw.
- CLI-backed modules wrap `runCli` (`src/server/cli.ts`, spawns via `execFile` — no shell). Two error models: process-model CLIs (stderr + non-zero exit, e.g. `gh`/`jira`) use `runCli` + an auth regex; payload-model CLIs (errors as JSON on stdout, maybe exit 0, e.g. `gws`) use `runJsonCli` + an error extractor. Errors classify as `not-found`/`auth`/`timeout`/`failed`.
- N+1 enrichment (list → per-item detail) uses `Promise.allSettled` so one failure doesn't sink the widget (`github/prs.ts`).
- Reference modules: `github` (3 widgets, N+1 enrichment) and `jira` (single widget, custom-query config) — both fully wired; copy their shape.
- Registration test per module asserts both registries resolve each widget type (`tests/modules/*-registration.test.ts`).

## Design & docs

- UI work: use the **impeccable** skill; styling: **tailwind** (v4) skill.
- Spec: `docs/superpowers/specs/2026-07-09-work-dashboard-design.md`
- Plans: `docs/superpowers/plans/` (Plan 1 = framework shell; GitHub module = Plan 2)
