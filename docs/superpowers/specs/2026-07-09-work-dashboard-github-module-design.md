# Design — GitHub Module (Plan 2)

**Date:** 2026-07-09
**Depends on:** Plan 1 (framework shell) — merged to `main`.
**Prev design:** `2026-07-09-work-dashboard-design.md` (overall product; see "GitHub module (phase 1)").

The first real integration on top of the pluggable shell, via the authenticated `gh` CLI.
Proves the module pattern generalizes and fills the framework gaps a CLI integration needs.

---

## Goals

- Build a reusable **CLI runner** with error classification that every future CLI module inherits.
- Ship four GitHub widgets — **My PRs**, **Team PRs**, **Failing Actions**, **Dependabot alerts** — all
  driven by per-widget `config` (repos / authors / severity), nothing hardcoded.
- Add **per-widget config editing** UI, activating the so-far-unused `configSchema` for validation.

## Non-Goals (deliberately deferred)

- **Action endpoint** (`POST /api/widgets/[id]/action`), `runAction` wiring, and the **merge action**.
  With merge deferred there is no action consumer in this plan, so building the endpoint now would be
  speculative. The contract already reserves `ServerWidget.actions?` and `WidgetBodyProps.runAction`
  (currently a no-op); the endpoint lands in the phase that adds merge.
- Any change to the cache-first data flow, drag/reorder, or refresh — reused as-is.

---

## Decisions (resolved during brainstorming)

- **Team PRs source:** a **configured author list** (`authors: string[]` of GitHub handles), one
  `gh search prs --author=<handle>` per author. Not review-requested / not org+team slug.
- **Scope:** all **3 core widgets + Dependabot**.
- **Config UI:** a card-header **⋯ overflow menu** with a **schema-driven form** (fields derived from
  the Zod `configSchema`).
- **Merge action:** **skipped** for now — My PRs is read-only + link-out.
- **Form field derivation:** **introspect the Zod schema** directly (no per-module field descriptors),
  constrained to the handful of field kinds actually used.

---

## Architecture

### 1. CLI runner — `src/server/cli.ts` (server-only)

One place to spawn a CLI and classify failures. Uses `execFile` with an **arg array** (no shell string
interpolation of user config).

```ts
runCli(bin: string, args: string[], opts?: { notAuthenticatedPattern?: RegExp })
  : Promise<{ stdout: string; stderr: string; code: number }>
```

On failure throws a typed `CliError` carrying a **human-readable `message`** (which `widget-service`
already surfaces and pairs with last-good caching) plus a `kind`:

- `ENOENT` → `kind: "not-found"`, message: ``"gh not found — install it"`` (bin name interpolated).
- non-zero exit **and** stderr matches `opts.notAuthenticatedPattern` → `kind: "auth"`,
  message: ``"Not authenticated — run `gh auth login`"``.
- any other non-zero exit → `kind: "failed"`, message: trimmed `stderr` (fallback to a generic line if empty).

The runner is **not gh-coupled**: the auth regex is supplied by the caller. Reusable by future CLI
modules (jira-cli, gws, …).

### 2. GitHub module — `src/modules/github/`

Standard module shape (mirror `src/modules/core/`):

```
manifest.ts    # 4 widget type ids, Zod config schemas + defaults, shared Data types. Client-safe, no runtime deps.
gh.ts          # server-only: runGh(args) wraps runCli(...) with gh's auth pattern; ghJson<T>(args) parses --json output.
server.ts      # import "server-only"; 4 fetch() fns; registerServerWidget(...) at import time.
widgets/*.tsx  # 4 "use client" body components (WidgetBodyProps<Data, Config>).
client.ts      # 4 registerClientWidget(...) at import time.
```

Barrels (the only place the shell learns the module exists):
- `src/modules/server.ts` → `import "./github/server";`
- `src/modules/client.ts` → `import "./github/client";`

**Widgets, config, and `gh` invocation:**

| Widget | type id | config | `gh` path |
|---|---|---|---|
| My PRs | `github.myPrs` | `{ limit: number }` (author `@me` implicit) | `gh search prs --author=@me --state=open --json … --limit N` |
| Team PRs | `github.teamPrs` | `{ authors: string[]; limit: number }` | `gh search prs --author=<handle> --state=open --json …` per author, merged |
| Failing Actions | `github.failingActions` | `{ repos: string[]; limit: number }` | `gh run list -R <repo> --status=failure --json … --limit N` per repo |
| Dependabot | `github.dependabot` | `{ repos: string[]; severity?: "low"\|"medium"\|"high"\|"critical" }` | `gh api /repos/<repo>/dependabot/alerts?state=open` per repo |

The exact `--json` field set — particularly **CI status rollup** and **review state** on PRs — is
**validated against real `gh` output during implementation** and captured as fixtures. If
`gh search prs --json` does not expose CI/review, `fetch()` enriches per-PR (e.g. `gh pr view --json
statusCheckRollup,reviewDecision`). Recording real output before asserting is the source of truth (TDD).

**Normalized Data shapes** (illustrative; finalized against fixtures):

```ts
type PrItem   = { repo: string; number: number; title: string; url: string; author: string;
                  ci: "ok" | "warn" | "danger" | "none"; review: string; updatedAt: string };
type RunItem  = { repo: string; name: string; url: string; branch: string; event: string; createdAt: string };
type AlertItem = { repo: string; package: string; severity: "low"|"medium"|"high"|"critical";
                   summary: string; url: string };

type MyPrsData = { prs: PrItem[] };
type TeamPrsData = { prs: PrItem[] };
type FailingActionsData = { runs: RunItem[] };
type DependabotData = { alerts: AlertItem[] };
```

CI/review/severity render with the existing semantic tokens `--color-ok` / `--color-warn` /
`--color-danger`.

### 3. Config editing UI + one contract change

- **Card overflow menu** — new `src/components/card-menu.tsx`, a `⋯` button in the `WidgetShell`
  header (revealed on hover, like the refresh control). Items: **Configure**, **Remove**. No "Hide":
  there is no un-hide surface today, so it would strand widgets in a hidden state.
  Remove reuses the existing `DELETE` + `onRemove` path; the edit-mode drag handle is unchanged.

- **Schema-driven form** — new `src/components/schema-form.tsx`. Given a Zod **object** schema it renders
  one control per field, unwrapping `ZodDefault` / `ZodOptional` to find the base type:
  - `ZodString` → text input
  - `ZodNumber` → number input
  - `ZodBoolean` → checkbox
  - `ZodArray(ZodString)` → simple list editor (add/remove string rows)
  - `ZodEnum` → select
  - anything else → **throws** (keeps the supported surface small and explicit)

  Field label = the schema's `.describe()` if present, else a humanized key. The form seeds from the
  widget's current `config` and edits a local copy.

- **Contract change** — extend `ClientWidget` with client-safe `configSchema` and `defaultConfig`
  (both already defined in each module's `manifest.ts`, which carries no server-only import, so it is
  safe for client use). The overflow menu / form reads them via `getClientWidget(type)`. `core` is
  updated to supply these, and its registration test updated to match. This is the deliberate,
  minimal contract change the Plan 1 handoff anticipated.

- **Save path** — extend the existing `PATCH /api/widgets/[id]` to accept `{ config }`:
  1. Resolve widget → its `ServerWidget.configSchema`.
  2. `configSchema.parse(body.config)` → **400** on failure (this activates `configSchema`, previously
     unused).
  3. `setConfig(id, parsedConfig)` — new function in `config-repo.ts`.

  `addWidget` also validates its incoming config against the type's schema on write. After a successful
  save the dashboard updates the widget in local state and triggers a `?refresh=1` fetch so `fetch()`
  re-runs with the new config and re-caches.

### Data flow (unchanged, reused)

Widget mounts → `GET /api/widgets/:id/data` returns cached row instantly → refresh (manual, interval, or
post-config-save) hits `?refresh=1` → server runs `module.fetch(config)` → writes `widget_cache` →
returns fresh. `getWidgetData` keeps the last-good payload on error and the UI shows a "stale" badge.

## Error handling

- **CLI failures** propagate as `CliError.message` through `fetch()`; `widget-service` catches, keeps
  last-good, and returns `status:"error"`. UI shows the friendly message in the error state (no cache
  yet) or a **stale** badge over last-good data (cache exists) — both already wired in `WidgetCard`.
- **Auth not set up** → the `"Not authenticated — run `gh auth login`"` message surfaces the same way.
- **Empty results** (no open PRs, no failing runs, no alerts) → map to the existing `WidgetShell`
  `"empty"` state with per-widget copy ("No open PRs", "No failing runs", "No open alerts").
- **Partial failure** in multi-target widgets (Team PRs per author, Failing Actions / Dependabot per
  repo): one target's failure should not blank the whole widget — collect successes, and surface a
  non-fatal note if some targets errored. (Exact presentation finalized in the plan; default is to
  throw only when *all* targets fail, otherwise return partial results.)

## Testing (TDD)

No network in tests. Record real `gh … --json` output as fixtures under `tests/fixtures/github/` and feed
them to `fetch()` with the CLI runner mocked.

1. **`cli.ts` classifier** — mock `node:child_process` `execFile`; assert ENOENT → `not-found`,
   auth-pattern stderr → `auth`, other non-zero → `failed` (message = stderr), success → `{stdout,…}`.
2. **Each `fetch()`** — mock `runGh`/`runCli` to return a recorded fixture; assert the normalized Data
   shape (incl. CI/review/severity mapping and empty/partial cases).
3. **Config PATCH** — integration against a temp DB (`tests/helpers/db.ts` → `useTempDb()`): valid
   config persists and round-trips; invalid config → 400 and no write.
4. **`schema-form` introspection** — pure unit test: a sample schema yields the expected field
   descriptors (kind + label + default); unsupported kind throws.

## Verification (definition of done)

- `npm run lint`, `tsc --noEmit`, `npm test` all clean; `npm run build` succeeds.
- Live: add each GitHub widget, configure it via the ⋯ menu, see real data (or the correct
  error/empty state); config persists across reload; refresh re-runs `fetch()`.

## Files touched

- **New:** `src/server/cli.ts`; `src/modules/github/{manifest,gh,server,client}.ts`;
  `src/modules/github/widgets/{my-prs,team-prs,failing-actions,dependabot}-widget.tsx`;
  `src/components/{card-menu,schema-form}.tsx`; `tests/fixtures/github/*`; matching test files.
- **Edited:** `src/modules/contracts.ts` (`ClientWidget` gains `configSchema`+`defaultConfig`);
  `src/modules/core/client.ts` (+ test); `src/modules/client.ts`, `src/modules/server.ts` (barrels);
  `src/app/api/widgets/[id]/route.ts` (PATCH accepts `config`); `src/server/config-repo.ts`
  (`setConfig`, validate in `addWidget`); `src/components/widget-shell.tsx` +
  `src/components/widget-card.tsx` (host the ⋯ menu); `src/components/dashboard.tsx` (config-save state
  update + refresh).
