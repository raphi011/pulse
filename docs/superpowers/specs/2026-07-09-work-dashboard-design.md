# Work Dashboard — Design

**Date:** 2026-07-09
**Status:** Approved for planning

A local, single-user Next.js dashboard to organize daily work. Modular and pluggable:
integrations are added over time as self-contained modules. Phase 1 delivers the modular
shell plus a GitHub module as proof the pattern generalizes.

## Goals

- A dashboard that feels instant and looks great (design via impeccable, Tailwind v4).
- Rearrange, hide/show, add/remove widgets.
- Integrations as drop-in modules; adding one is "a folder + one register call."
- Phase 1 scope: **shell + GitHub module**. Later modules (Jira, GWS/Chat/Calendar/Gmail,
  Datadog, Confluence, Bookmarks) reuse the same contract.

## Non-Goals

- Multi-user, auth, hosting, sync across machines.
- OAuth/token management where a local authenticated CLI already exists.
- Free-form resizable grid (explicitly rejected in favor of column masonry).

## Stack

- **Next.js (App Router) + React + TypeScript**
- **Tailwind v4** (CSS-native `@theme`), design driven by the impeccable skill
- **Drizzle ORM + better-sqlite3** — one `dashboard.db`
- **dnd-kit** — drag/reorder
- **TanStack Query** — client fetch/refresh state
- **Zod** — widget config schemas
- CLI access via Node `child_process` in Route Handlers (server-only)

## Architecture

### Integration mechanism
CLI-first, framework-agnostic. A module's `fetch()` returns typed data; *how* it gets that
data (shell out to a local CLI, or hit an API with a token) is the module's private business.
GitHub uses the already-installed, already-authenticated `gh` CLI. Future modules pick
whatever is easiest. The framework never knows which.

### Module = self-contained folder
Strict server/client split (Next.js requires `fetch` server-only, components client-only):

```
src/modules/github/
  manifest.ts    // id, widget types, Zod config schema, shared TS types — no runtime deps
  server.ts      // fetch() + actions(), shells to `gh`; marked "server-only"
  widgets/       // client React component bodies ("use client")
  index.ts       // registers widgets into the central registry
```

### Widget contract
```ts
interface WidgetDef<Data, Config> {
  type: string;                        // e.g. "github.my-prs"
  title: string;
  configSchema: ZodSchema<Config>;
  defaultConfig: Config;
  fetch(cfg: Config): Promise<Data>;   // server-only (CLI or API)
  actions?: WidgetAction[];            // e.g. mergePr — typed, server-only
  Component: FC<{ data: Data; config: Config; onAction }>; // client body only
}
```

A central **registry** maps `type → WidgetDef`. The shell knows only the contract, never a
specific integration. Adding a module = drop a folder + one register call.

## Storage

One SQLite DB, two logical groups of tables.

**Config (durable):**
- `widgets` — `id`, `type`, `column`, `order`, `hidden`, `config` (JSON), `refresh_interval`
- `bookmarks` — `title`, `url`, `icon`, `order` (the future Links widget is data-driven from here)
- `prefs` — `key`, `value` (theme, column count, etc.)

**Cache (transient, safe to wipe):**
- `widget_cache` — `widget_id`, `payload` (JSON), `fetched_at`, `status` (ok|error), `error`

Layout *is* the `widgets` rows (`column` + `order` + `hidden`). No separate layout blob —
drag-drop writes `column`/`order` back.

## Layout framework

- **Masonry, N columns** (count in `prefs`); each column is a dnd-kit sortable list. Drag
  within/between columns persists `column`/`order`.
- **Edit mode toggle:** normal = clean read-only cards; edit = drag handles, per-widget
  hide/remove, and "+ Add widget" picker listing registry types.
- **Widget shell** (shared chrome around every widget): title bar, "updated Nm ago", refresh
  button, loading/error/empty states, overflow menu (configure/hide/remove). Widgets render
  only their *body*; the shell is reused, so a new module inherits all of it free.
- **Hidden widgets** live in a drawer for re-adding.

A module author writes only: `manifest` + `fetch` + a body component. Chrome, drag, cache,
refresh, and persistence are all framework.

## Data flow (cache-first)

- Mount → `GET /api/widgets/:id/data` → returns cached row instantly (`payload` + `fetched_at`).
- Refresh (manual button or per-widget interval) → `GET /api/widgets/:id/data?refresh=1` →
  server runs `module.fetch()`, writes `widget_cache`, returns fresh payload. TanStack Query
  drives client state; SQLite is the durable cache, so reloads are instant.
- Action → `POST /api/widgets/:id/action` → runs the server action (e.g. merge) → auto-refresh
  that widget.

## GitHub module (phase 1)

All widgets via `gh`. Target repos/org/team live in each widget's `config` (edited via the
configure menu) — nothing hardcoded.

1. **My PRs** *(core)* — `gh search prs --author=@me --state=open --json ...`; shows CI status +
   review state; **merge action** (`gh pr merge`); click-through link.
2. **Team PRs** *(core)* — PRs needing your review / from teammates
   (`gh search prs --team-review-requested=@me`, or an org/author list from config).
3. **Failing Actions** *(core)* — `gh run list` across configured repos; surfaces red runs.
4. **Dependabot alerts** *(stretch, phase 1.5 if it doesn't land cleanly)* —
   `gh api /repos/{repo}/dependabot/alerts` for configured services.

## Error handling

CLIs can be missing, unauthenticated, or fail. The cache row carries `status`/`error`, and the
widget shell renders distinct states, detected centrally in the CLI-runner helper so every
module inherits them:

- **CLI missing** — "`gh` not found — install it"
- **Not authenticated** — "run `gh auth login`"
- **Command failed** — show stderr; keep last good cached data with a stale badge
- **Loading** / **Empty**

## Testing

- **Unit:** feed recorded `gh` JSON fixtures to each `fetch()`, assert typed output (CLI runner
  mocked). Registry and layout reducer (drag → `column`/`order`) pure-tested.
- **Integration:** API routes against a temp SQLite DB — cache hit/miss, refresh writes,
  action triggers refresh.
- **Component:** smoke tests for widget shell states (loading/error/empty/data).

## Future modules (not phase 1)

Jira (`jira-cli`), GWS/Google Chat/Calendar/Gmail (`gws`), Datadog (dashboards/health/metrics),
Confluence, Bookmarks/Links. Each is a new folder implementing the same contract.
