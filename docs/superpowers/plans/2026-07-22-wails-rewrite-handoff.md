# Wails Rewrite — Handoff (after Plan 1: Foundation)

**State:** Plan 1 complete at commit `4ae026a` on branch `worktree-wails`
(worktree: `.claude/worktrees/wails`). Final whole-branch review: Ready to merge —
but per the spec, **do not merge to main until Plan 3 cutover**. `main` is still the
daily-driver Tauri app; `dashboard.db` untouched (new app uses `pulse.db` in the same
app-data dir).

## Running the app

From the worktree root (`.claude/worktrees/wails`):

- **Dev:** `wails3 dev` — known quirk: first load can race the Vite server (blank
  window); reload the window (Cmd+R) once. Production builds don't have this.
- **Production-like:** `wails3 build && ./bin/pulse` — embedded assets, no race.
- Prereqs (already installed on this Mac): Go ≥1.24, `wails3` CLI pinned
  `v3.0.0-alpha2.114` (`go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-alpha2.114`),
  Node + npm (`cd frontend && npm install` after fresh clone), Xcode CLT.

## Outstanding user GUI pass (Plan 1 acceptance)

1. Configure a System widget: two number fields render from the server manifest;
   out-of-range (e.g. sample interval 20) → "Invalid configuration".
2. Bookmarks: add/remove persists across app restart; invalid URL shows Go's error.
3. Auto-refresh toggle + "refresh all": visually inert in Plan 1 (zero refreshable
   widgets — by design); just confirm no errors.

## Where things live

- Spec: `docs/superpowers/specs/2026-07-22-wails-go-rewrite-design.md`;
  Plan 1: `docs/superpowers/plans/2026-07-22-wails-rewrite-1-foundation.md`.
  **Both exist only on `main`** (committed there before the worktree branched).
- Progress ledger (task-by-task, incl. Minor roll-up + triage):
  main checkout `.superpowers/sdd/progress.md`, section "Wails Rewrite Plan 1"
  (git-ignored scratch — copy survives only on that machine).
- Go backend: `internal/{cli,db,module,dashboard,scheduler,apppath,modules/{system,bookmarks}}`,
  wired in `main.go`. All OS-neutral, Wails-free, `-race` clean —
  **developable/testable on a Linux server** (`go test ./internal/... ./cmd/...`);
  only `main.go` compile + GUI runs need macOS (no cross-compiled .app from Linux).
- Frontend: `frontend/` (Vite/React). `frontend/src/lib/backend.ts` is the ONLY file
  importing generated bindings (`frontend/bindings/`, gitignored — regenerate with
  `wails3 generate bindings -ts -i`) and `@wailsio/runtime`.
- Parked for Plan 2: `frontend/legacy-modules/{ccusage,github,github-stats,gws,jira,pomodoro}`
  (+ their tests in `__tests__/`), excluded from tsconfig/vitest/eslint.
- Registry parity: `cmd/gen-widget-types` writes `frontend/src/widget-types.gen.json`;
  Go test `internal/module/parity_test.go` + TS test `frontend/tests/modules/registry-parity.test.ts`
  both assert against it. Re-run the generator after adding a module.

## Contracts to preserve (frozen in Plan 1)

- Widget manifest served by Go: `{type, title, configFields, refreshable, integration?}`;
  configFields = schema-form's `Field` `{key, label, kind, options?, optionsKey?, def?}`
  (7 kinds; `def` not `default`).
- Event: `widget:cache-updated`, data = bare widget-id string; single global
  subscription in `app-root.tsx`.
- Cache row JSON: `{widgetId, payload, fetchedAt(ms), status ok|error, error, errorKind}`;
  errorKind ∈ not-found|auth|timeout|failed (cli.ErrorKind).
- Backend-only service methods get `//wails:ignore` (last doc-comment line, blank `//`
  before it for gofmt) so they don't leak into JS bindings.
- Numeric manifest defaults must be float64-safe (normalizeValue handles int literals).
- CLI spawning: `internal/cli` resolves binaries via `lookPathIn` against the curated
  PATH (exec.Command ignores cmd.Env for resolution — do not regress this).

## Plan 2 (next): remaining six modules

Port from `frontend/legacy-modules/` + old TS fetch logic (reference on `main`,
`src/modules/<name>/fetch.ts`): **github (3 widgets, N+1 enrichment via goroutines),
jira, gws (payload-model CLI → cli.RunJSON), ccusage, pomodoro (local repo +
engine — decide engine placement: TS engine is UI-state-heavy, consider keeping
frontend), github-stats**. Also:
- `internal/integration` health service (port `src/server/integration-service.ts`:
  TTL cache, in-flight dedup, enable/disable with widget-delete confirm) + un-stub
  `fetchIntegrations`/`toggleIntegration` in `frontend/src/lib/dashboard-data.ts`.
- Async field options: jira/gws modules implement `module.OptionsSource`;
  frontend already calls `Dashboard.FieldOptions(optionsKey)`.
- Bump `dashboard.CacheVersion` if any payload shape changes vs the TS versions.
- Each module: Go package under `internal/modules/`, register in `main.go` +
  `cmd/gen-widget-types`, move frontend module back from legacy-modules, re-add its
  tests, re-run generator.

## Plan 3 (last): cutover

Delete `src-tauri/`, `frontend/drizzle.config.ts`, tauri/drizzle/zod deps from
`frontend/package.json` (kept so far only for legacy-modules), `db:generate` script.
Root scripts equivalent of `npm start` (wails3 package + open). Rewrite CLAUDE.md,
README, and the `create-module` skill for the Go world (shell-scope/capabilities
gotchas no longer apply). Merge `worktree-wails` → main; delete old `dashboard.db`
manually whenever.

## Known follow-ups (accepted, non-blocking — from final review)

- Refresh button/timestamp can flash on non-refreshable widgets before the manifests
  query resolves.
- Theme pref is vestigial (SetTheme bound, never called; `index.html` hardcodes dark)
  — same as the old app.
- Test hardening: CacheWipe, SetPositions/SetTabOrder rollback paths,
  UpdateWidget unknown-type verbatim-store branch.
- gopsutil cpu.Percent keeps package-global delta state (one Monitor per process —
  add comment if refactoring).
- `.superpowers/sdd/task-*-report.md` files (worktree, gitignored) hold per-task
  implementation reports incl. the bindings layout notes (task-10) — useful while
  they last, not durable.
