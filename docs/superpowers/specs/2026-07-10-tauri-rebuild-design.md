# Tauri Rebuild — Design

**Date:** 2026-07-10
**Status:** Approved (pending spec review)

## Motivation

The work-dashboard is a local, single-user app that today runs as a Next.js
server you must remember to start. Rebuilding on **Tauri** targets four wins the
user explicitly selected:

1. A real distributable app (double-clickable `.app`, no `npm run dev`, no localhost).
2. Native OS integration (tray, menu, global shortcut, launch-on-login).
3. Smaller/faster footprint (drop the Next.js server + Node runtime).
4. Fewer moving parts (one app, one mental model).

Goals 3 and 4 rule out the "easy" port (bundling Node.js as a Tauri **sidecar**):
a sidecar re-adds a ~50 MB Node runtime and a second process, defeating both.

## Feasibility (verified 2026-07-10)

A throwaway hello-world Tauri app was built and run on the corporate laptop
(Kandji MDM, Gatekeeper enabled). Results:

| Test | Result |
|------|--------|
| Install Rust toolchain (rustup, user-space) | Not blocked by Kandji |
| Compile + bundle `.app`/`.dmg` | Works (~49s first build) |
| Run unsigned binary directly | Not blocked |
| Run **quarantined** unsigned `.app` | Launched (Gatekeeper translocated it) |
| "damaged" dialog | Artifact of a faked quarantine attr on an unsigned app; `xattr -cr` fixes |

**Conclusion:** Tauri is viable. Kandji does not hard-block unsigned execution.
Because this is a **locally built** personal app, the artifact never receives a
`com.apple.quarantine` bit, so the "unidentified developer"/"damaged" friction
never appears in the real workflow. Escape hatches if a downloaded build is ever
blocked: build locally (no quarantine), `xattr -cr`, run the raw binary,
`tauri dev`, System Settings → Privacy & Security → Open Anyway, or (proper)
Developer ID sign + notarize.

**Caveat:** all local-build options run *unsigned* code. If Kandji ever tightened
to a signed-code-only policy, only signing/notarization would work. Not the
current state.

## Architecture

Chosen approach: **pure TypeScript in the webview + thin Tauri plugins.** All
non-UI logic (module fetch/parse, cache, config, Drizzle queries) runs in the
webview alongside React. Two OS-touching edges call off-the-shelf Rust plugins.
The Rust core stays declarative config.

```
┌─────────────────────────────────────────────┐
│  Webview (WKWebView) — Vite + React SPA       │
│  React components (unchanged)                 │
│  TanStack Query (cache-first, unchanged)      │
│  Module registries (fetch + render, both here)│
│  widget-service / cache-repo / config-repo    │
│  module fetch() + parse (unchanged)           │
│  cli.ts       → shell plugin                   │
│  db/client.ts → Drizzle sqlite-proxy → sql plugin
└───────────────┬───────────────────────────────┘
                │ Tauri IPC (plugins only)
┌───────────────▼───────────────────────────────┐
│  Rust core (near-empty, declarative)           │
│  • window, tray, menu, launch-on-login         │
│  • tauri-plugin-shell (allowlist gh/jira/gws)  │
│  • tauri-plugin-sql (sqlite + migrations)      │
│  • capabilities/allowlist config               │
└────────────────────────────────────────────────┘
```

**Central shift:** the `server-only` boundary disappears. The Next.js server +
6 API routes + RSC initial load are deleted; `widget-service` and friends become
ordinary async TS the React app imports and calls directly, still wrapped by
TanStack Query.

### Rejected alternatives

- **Node sidecar** — keeps 100% of server code but re-adds Node runtime + second
  process. Violates footprint/simplicity goals.
- **Rust backend** — port `cli.ts` + DB to Rust commands. Adds a second language
  and an `invoke` serialization boundary for no real gain in a local single-user
  app (the security benefit of Rust-side execution needs untrusted webview
  content, which does not exist here). CLIs handle their own auth; no secrets in
  the app.

## Layer-by-layer: what stays, what changes

| Current (Next.js) | Tauri version | Effort |
|---|---|---|
| React components, dnd-kit, Tailwind, TanStack Query | Unchanged (copied) | none |
| `src/modules/**` fetch/parse, N+1 enrichment, Zod, manifests | Unchanged (plain async TS) | none |
| `widget-service`, `cache-repo`, `config-repo` | Unchanged logic, minus `import "server-only"`; **become async** (see below) | trivial→medium |
| `src/app/api/**` (6 routes) | Deleted (no HTTP layer) | delete |
| `use-widget-data.ts` `fetch('/api/...')` | Calls `getWidgetData(id, refresh)` directly, still in TanStack Query | small |
| `src/app/page.tsx` (RSC, `force-dynamic`) | Plain SPA entry (`main.tsx` + `index.html`) mounting `<Dashboard>` | small |
| `db/client.ts` (better-sqlite3) | Drizzle sqlite-proxy → `tauri-plugin-sql` + ~20-line row adapter | medium |
| `cli.ts` (`node:child_process execFile`) | `@tauri-apps/plugin-shell` `Command` + same error classification | medium |
| `drizzle-kit generate/migrate` | `drizzle-kit generate` (kept) → SQL registered with plugin migration runner | small |
| Next.js build / `next dev` | Vite + `@tauri-apps/cli` (`tauri dev` / `tauri build`) | config |
| — | **New:** `src-tauri/` (Rust config, capabilities/allowlist, window, tray/menu) | new, small |

The only two real ports are `db/client.ts` and `cli.ts` — single small files with
tight interfaces; their surrounding logic (Drizzle queries above the driver;
error classification above the spawn) is intact.

**Threading note:** widget fetch now runs in the webview JS context, not an
isolated Node process. For this workload (a few CLI calls / 30s, already async
and off the render path) it is fine; a slow CLI call cannot be on the render
critical path because it is interval- or user-triggered and awaited.

## Module registry split — kept and renamed

The split (data-fetch definition vs. render definition) is a genuinely good
boundary, not merely a Next.js artifact, so it is **kept**. The only Next-specific
element was `import "server-only"` (dropped). Both halves now run in the webview,
imported by one startup module.

**Rename** (chosen: `fetch` / `render`):

| Old | New |
|---|---|
| `ServerWidget` | `FetchWidget` |
| `ClientWidget` | `RenderWidget` |
| `src/modules/server-registry.ts` | `src/modules/fetch-registry.ts` |
| `src/modules/client-registry.ts` | `src/modules/render-registry.ts` |
| `registerServerWidget` | `registerFetchWidget` |
| `getServerWidget` | `getFetchWidget` |
| `listServerTypes` | `listFetchTypes` |
| `__clearServerRegistry` | `__clearFetchRegistry` |
| `registerClientWidget` | `registerRenderWidget` |
| `getClientWidget` | `getRenderWidget` |
| `listClientWidgets` | `listRenderWidgets` |
| `__clearClientRegistry` | `__clearRenderRegistry` |
| `src/modules/server.ts` (bootstrap) | `src/modules/fetch.ts` |
| `src/modules/client.ts` (bootstrap) | `src/modules/render.ts` |
| per-module `<name>/server.ts` | `<name>/fetch.ts` |
| per-module `<name>/client.ts` | `<name>/render.ts` |

A single bootstrap (`src/modules/index.ts`) imports both `./fetch` and `./render`
into the webview at app start. The `create-module` skill, `CLAUDE.md`, and
`CONTEXT.md` are updated to the new vocabulary; the per-module registration tests
import the renamed registries.

## Data flow & caching

Cache-first behavior is preserved and simplified (HTTP hop removed):

```
UI → useWidgetData → getWidgetData(id, refresh)   [direct TS call]
        wrapped in TanStack Query   │
                                    ├→ cache-repo → Drizzle → sql plugin
                                    └→ FetchWidget.fetch() → shell plugin
```

- `widget-service` still checks `cache-repo` first (instant), re-runs `fetch()`
  only on `refresh`. TanStack Query still owns the in-memory cache, auto-refresh
  interval, and keep-stale-on-error behavior.
- `use-widget-data.ts` changes exactly one thing: `fetchData()` calls
  `getWidgetData()` directly instead of `fetch('/api/...')`.
- `widgets` and `widget_cache` schemas unchanged.
- `CliError` kinds still flow up; the shell plugin exposes exit code + stderr, so
  classification ports directly.

## DB location, migrations, async ripple

**Location.** `dashboard.db` moves from cwd to Tauri's app-data dir
(`~/Library/Application Support/<bundle-id>/dashboard.db`, resolved by the sql
plugin from `sqlite:dashboard.db`). Persists across app updates. `schema.ts`
(tables `widgets`, `bookmarks`, `prefs`, `widget_cache`) is unchanged.

**Migrations (clean).** Keep `drizzle-kit generate` producing SQL in `./drizzle/`.
Register those SQL files with `tauri-plugin-sql`'s built-in migration runner
(Rust, via `include_str!`), which tracks applied versions and runs on load.
Adding a migration = `drizzle-kit generate` + append one line to the Rust
`migrations` vec. First run creates the file + tables; the "seed a `core.status`
widget if empty" logic from `page.tsx` moves into app startup.

**Async ripple (the main real cost).** `better-sqlite3` is synchronous
(`.get()`, `.run()`); anything behind an IPC boundary to Rust — the sql plugin,
or any Tauri DB path — is **async**. Therefore:

- `cache-repo.get/set` and every `config-repo` function become `async`; callers
  must `await`.
- `widget-service` is already async (add awaits). Most other call sites are
  already in async contexts (TanStack Query `queryFn`, action handlers). The RSC
  synchronous `getWidgets()` in `page.tsx` disappears when that becomes an async
  SPA loader.
- Blast radius is bounded and mechanical (two repo files + their callers),
  caught exhaustively by the type-checker. No shortcut exists — moving SQLite out
  of the JS process makes it async by nature.

## Drizzle over the sql plugin (verified clean)

`drizzle-orm/sqlite-proxy` is an official first-class driver: `drizzle()` takes an
async callback `(sql, params, method) => { rows }`. In production the callback
routes to `tauri-plugin-sql`'s `select`/`execute`. `schema.ts` and all query code
stay. **One adapter needed:** the proxy expects rows as arrays-in-column-order
(`{ rows: string[][] }`) but the sql plugin returns array-of-objects, so a
~20-line reshape adapter sits in the callback. Well-trodden, documented — not an
architectural hack.

Sources: [Drizzle Proxy driver](https://orm.drizzle.team/docs/connect-drizzle-proxy),
[Drizzle SQLite drivers](https://orm.drizzle.team/docs/get-started-sqlite).

## `src-tauri` config

**Plugins:** `tauri-plugin-sql` (SQLite + migrations), `tauri-plugin-shell`
(spawn CLIs), `tauri-plugin-autostart` (launch-on-login).

**Shell allowlist.** Capabilities file allowlists `gh`, `jira`, `gws` with
permissive args (`args: true`) — per-arg validators buy little for a personal app
and fight the modules' dynamic args (e.g. jira JQL). `cli.ts` swaps
`execFile(bin, args)` for `Command.create(bin, args, { env }).execute()`; the
returned `{ code, stdout, stderr }` feeds the identical classification logic.

**macOS PATH trap (important).** A Finder-launched `.app` does **not** inherit the
shell PATH — it gets a minimal `/usr/bin:/bin:/usr/sbin:/sbin`, so
`/opt/homebrew/bin/{gh,gws}` would fail `not-found` (even though `tauri dev`
works, inheriting the terminal PATH). Tauri has **no official fix** — its shell
docs do not address this; it is a known cross-framework (also Electron) problem.

Chosen mitigation (Electron-community pattern, not Tauri-blessed): at startup,
probe the login-shell PATH once (`$SHELL -lc 'echo $PATH'`), cache it, and inject
it as `env.PATH` on every `Command`. Chosen over absolute-pathing the entry
binary because `gh` shells out to `git` (and `jira`/`gws` may invoke sub-tools),
so the whole process subtree needs a real PATH. Tauri v2 `Command.create(bin,
args, { env })` supports the `env` option. Cost: one ~50–100ms login-shell spawn
at boot.

Source: [Tauri v2 shell plugin docs](https://v2.tauri.app/plugin/shell/) (confirms
no PATH guidance).

**Window/tray.** One main window (size/title). Optional tray (show/hide + quit)
and a global shortcut to summon — declarative in `tauri.conf.json` + a few lines
of Rust `setup`.

## Testing

Vitest + Testing Library stays. The sqlite-proxy indirection makes DB tests
cleaner: swap the *transport* by environment.

- **Production** callback → `tauri-plugin-sql`.
- **Tests** callback → in-memory **better-sqlite3** (kept as a *test-only*
  devDependency). Repo tests run against real SQL, real migrations, no Tauri, fast.
  `__resetDbForTests` becomes "new in-memory proxy."
- **`cli.ts`**: `vi.mock('@tauri-apps/plugin-shell')` returning canned
  `{ code, stdout, stderr }`; unit-test each classification branch.
  `@tauri-apps/api/mocks` (`mockIPC`) available if the real plugin call path is
  wanted.
- Unchanged: all module fetch/parse tests; per-module registration tests (import
  renamed registries).

## Decisions recap

1. Pure TypeScript in the webview + thin Tauri plugins; Rust stays declarative.
2. Reuse everything except two ported edge files; delete the API layer + RSC.
3. Keep the fetch/render split, renamed (`FetchWidget`/`RenderWidget`,
   `fetch-registry`/`render-registry`, per-module `fetch.ts`/`render.ts`).
4. Cache-first via TanStack Query survives; HTTP hop removed.
5. Drizzle kept via sqlite-proxy → sql plugin (+ row adapter); migrations via
   `drizzle-kit generate` → plugin runner; async DB ripple is the main real cost.
6. `src-tauri`: sql + shell + autostart plugins, tray/window; shell allowlist for
   `gh`/`jira`/`gws`; login-shell PATH probe for the macOS PATH trap.
7. Testing: proxy transport swap to in-memory better-sqlite3 (test-only dep) +
   mocked shell plugin.

## Out of scope

- Code signing / notarization (local builds only; revisit if distributing).
- Windows/Linux bundles (macOS only for now).
- Renaming `fetch`/`render` further or restructuring modules beyond the rename.
- Any widget/module behavior changes — this is a platform migration, not a
  feature change.
