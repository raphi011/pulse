# Cutover & Polish — Design

Two sequential phases finishing the Wails v3 (Go) rewrite after Plan 2 (all eight
modules ported, merged at `5bdae91`): **Phase A** removes the dead Tauri stack and
rewrites the docs for the Go world; **Phase B** polishes the result (known
follow-ups, systematic UI sweep, code-quality pass). Each phase is its own
implementation plan and merge.

## Phase A — Cutover (Plan A)

Mechanical; scope was pinned in `docs/superpowers/plans/2026-07-22-wails-rewrite-handoff.md` ("Plan 3").

- **Delete `src-tauri/`** and any remaining Tauri-era scripts. There is no root
  `package.json` (Wails uses `Taskfile.yml`); daily-use entry points live as
  Taskfile tasks instead: dev → `wails3 dev`, start → `wails3 package` + `open`
  the built `.app`. Add a `start` task to `Taskfile.yml` if absent.
- **Prune `frontend/package.json`:** remove `zod`, `drizzle-orm`, `drizzle-kit`,
  `better-sqlite3`, `@types/better-sqlite3`, every `@tauri-apps/*` dependency and
  the `@tauri-apps/cli` devDependency, and the `db:generate` script. Drop
  `frontend/drizzle.config.ts`. (Verified: nothing under `frontend/src` imports
  any of these anymore; there are no orphaned `src/db`/`src/server` dirs.)
- **Rewrite docs for the Go world:** `CLAUDE.md` (stack, commands, architecture,
  gotchas — Go manifest/fetch/dispatch in `internal/modules/<name>/`, frontend
  render registration, bindings regeneration, parity gates), `README`, and the
  `.claude/skills/create-module/` skill (drop Tauri shell-scope/capability
  instructions; document the Go module recipe end-to-end incl. the wiring/parity
  steps every Plan-2 task followed).
- **Fold in** the currently-uncommitted `frontend/vite.config.ts` `server.host:
  "127.0.0.1"` fix (Wails proxy dials tcp4; Vite otherwise may bind `::1` only).
- **User data untouched:** the old Tauri `dashboard.db` is deleted manually by the
  user whenever, not by this plan.
- **Gates:** `go test -race ./internal/... ./cmd/...`; `cd frontend && npm test
  && npx tsc --noEmit && npm run lint`; `wails3 package` builds and the `.app`
  launches. `npm install` after the prune leaves a working lockfile.

## Phase B — Polish (Plan B)

Audit-then-fix. Fixes are batched; every batch keeps both suites green and is
review-gated (SDD per-task review + final whole-branch review before merge).

### 1. Audits (produce a findings backlog first)

- **UI sweep audit:** every widget (17 types) plus shell surfaces (add-widget
  dialog, config forms, integrations panel, tab bar) across loading / empty /
  error / data states and dark mode. Output: prioritized findings list.
- **Code-quality audit:** `internal/` + `frontend/src` — dead code, duplication,
  naming, simplification, structure. Restructuring is allowed where clearly
  better, but **file-move / internal-API restructure proposals are flagged
  separately in the audit and need user sign-off before execution**; small
  in-place cleanups don't.
- **Known follow-ups** (accepted list from the Plan-2 final review) are seeded
  into the backlog directly: refresh button/timestamp flash on non-refreshable
  widgets before the manifests query resolves; vestigial theme pref (`SetTheme`
  bound but never called, `index.html` hardcodes dark); test hardening
  (`CacheWipe`, `SetPositions`/`SetTabOrder` rollback paths, `UpdateWidget`
  unknown-type verbatim-store branch); gopsutil `cpu.Percent` package-global
  delta-state comment. Also from Plan-2 reviews: hand-rolled `sortInts` in
  githubstats, shadowed `min` builtin in github/dependabot, busy-spin loop in an
  integration test, untested follower-of-aborted-claim path, missing frontend
  test for the integrations disable-confirm flow.

### 2. Fix batches

- **Code-quality + test-hardening batches:** run continuously via
  subagent-driven development; no user checkpoint between batches.
- **UI fix batches:** land in rounds. After each round the user eyeballs
  `wails3 dev` (hot reload) and gives feedback; the next round incorporates it.
  No mock-runtime work — live app is the verification surface.

### Out of scope

- New features or widgets; behavior changes beyond the named follow-ups.
- Deleting the user's `dashboard.db` or any app data.
- CI / release automation.

## Success criteria

- Phase A: repo contains no Tauri code, config, or dependency; docs describe the
  Go architecture accurately; fresh `npm install` + all gates green; packaged
  app launches.
- Phase B: findings backlog fully dispositioned (fixed or explicitly declined),
  known-follow-ups list closed, suites green, final review clean.
