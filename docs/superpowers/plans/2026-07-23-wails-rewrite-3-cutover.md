# Wails Rewrite Plan 3 — Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the dead Tauri stack (code, config, dependencies) and rewrite the docs + create-module skill for the Go world, leaving a repo that contains no Tauri remnants and describes itself accurately.

**Architecture:** Pure deletion + documentation. No Go or TS behavior changes. The only functional edits are `frontend/package.json` (dependency prune), `frontend/vite.config.ts` (already-edited IPv4 host fix, uncommitted), and a new `start` task in `Taskfile.yml`.

**Tech Stack:** Wails v3 `v3.0.0-alpha2.114` (Taskfile-based build), Vite 8 + React 19 frontend, Go backend.

## Global Constraints

- **No behavior changes** to Go or TS source. This plan deletes, prunes, and documents.
- **User data untouched:** never delete `~/Library/Application Support/**` or any `dashboard.db`.
- Test gates (run per task where stated): `go test -race ./internal/... ./cmd/...`; `cd frontend && npm test && npx tsc --noEmit && npm run lint`.
- Commit messages: plain conventional style, no Jira prefix.
- Work happens in a worktree on a new branch (e.g. `worktree-cutover`) off `main`.
- Docs tasks (3 and 4): every factual claim (path, command, symbol name) must be verified against the code with grep/ls before committing — a doc that lies is worse than no doc.

---

### Task 1: Delete the Tauri stack and prune frontend dependencies

**Files:**
- Commit as-is: `frontend/vite.config.ts` (working tree already has the `server.host` fix)
- Restore: `build/darwin/Assets.car` (binary churn from a local `wails3 package` run — not a real change)
- Delete: `src-tauri/` (entire directory), `frontend/drizzle.config.ts`, `frontend/drizzle/` (legacy TS migrations; Go migrations live in `internal/db/migrations/`)
- Modify: `frontend/package.json`, `frontend/package-lock.json` (via `npm install`)

**Interfaces:**
- Produces: a frontend dependency tree with no `@tauri-apps/*`, `zod`, `drizzle-*`, or `better-sqlite3`. Tasks 2–4 document the resulting state.

- [ ] **Step 1: Commit the pending vite fix, restore the binary artifact**

```bash
git checkout -- build/darwin/Assets.car
git add frontend/vite.config.ts
git commit -m "fix: bind vite dev server to 127.0.0.1 for the wails asset proxy"
```

- [ ] **Step 2: Verify nothing imports the doomed packages**

Run: `grep -rn "@tauri-apps\|drizzle\|better-sqlite3\|from \"zod\"\|from 'zod'" frontend/src frontend/tests internal cmd main.go 2>/dev/null | grep -v node_modules`
Expected: no output. (If there is a hit, STOP and report BLOCKED — the spec's claim that nothing uses them is wrong.)

- [ ] **Step 3: Delete the Tauri and Drizzle remnants**

```bash
git rm -r -q src-tauri frontend/drizzle frontend/drizzle.config.ts
```

- [ ] **Step 4: Prune `frontend/package.json`**

Remove these lines from `dependencies`: `@tauri-apps/api`, `@tauri-apps/plugin-autostart`, `@tauri-apps/plugin-fs`, `@tauri-apps/plugin-notification`, `@tauri-apps/plugin-os`, `@tauri-apps/plugin-shell`, `@tauri-apps/plugin-sql`, `drizzle-orm`, `zod`.
Remove from `devDependencies`: `@tauri-apps/cli`, `@types/better-sqlite3`, `better-sqlite3`, `drizzle-kit`.
Remove from `scripts`: `"db:generate": "drizzle-kit generate"`.
Leave everything else exactly as-is (including `@wailsio/runtime`, `recharts`, the `dev:vite`/`build:*` scripts).

- [ ] **Step 5: Regenerate the lockfile and run the full gates**

Run: `cd frontend && npm install && npm test && npx tsc --noEmit && npm run lint && cd .. && go test -race ./internal/... ./cmd/...`
Expected: install succeeds; 38 test files / 185 tests pass; tsc and lint clean; all Go packages ok.

- [ ] **Step 6: Confirm no tracked Tauri remnants**

Run: `git ls-files | grep -i "tauri\|drizzle"`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: delete Tauri stack and prune dead frontend deps (zod, drizzle, tauri plugins)"
```

---

### Task 2: `start` task + README rewrite

**Files:**
- Modify: `Taskfile.yml` (add `start` task after the existing `dev` task)
- Rewrite: `README.md`

**Interfaces:**
- Produces: `task start` (package + open the `.app`) — the daily-use entry point Tasks 3–4 reference.

- [ ] **Step 1: Add the `start` task to `Taskfile.yml`**

Insert after the `dev:` task block:

```yaml
  start:
    summary: Packages a release .app and opens it (daily-use entry point)
    cmds:
      - task: package
      - open {{.BIN_DIR}}/{{.APP_NAME}}.app
```

- [ ] **Step 2: Verify it works**

Run: `task start`
Expected: build + package succeed, `bin/pulse.app` opens. Quit the app afterwards.

- [ ] **Step 3: Rewrite `README.md`**

Replace the whole file with:

```markdown
# Work Dashboard

Local, single-user, pluggable work dashboard. Wails v3 (Go backend) + Vite/React
webview. Personal project.

## Prerequisites

macOS. To build and run the app you need:

- **Go** ≥ 1.25 — the backend (`internal/`).
- **Wails v3 CLI** — `go install github.com/wailsapp/wails/v3/cmd/wails3@latest`
  (the repo pins `v3.0.0-alpha2.114` in `go.mod`).
- **Task** — `brew install go-task` (Wails drives the build through `Taskfile.yml`).
- **Node.js** 20+ and **npm** — the Vite + React frontend.
- **Xcode Command Line Tools** — `xcode-select --install`.

Then `cd frontend && npm install`.

Optional, only if you enable the matching module (each is a CLI the app shells
out to):

- [`gh`](https://cli.github.com) — GitHub / GitHub-stats modules (`gh auth login`).
- [`jira`](https://github.com/ankitpokhrel/jira-cli) — Jira module.
- `gws` — Google Workspace module.
- [`ccusage`](https://github.com/ryoppippi/ccusage) — Claude-spend module.

## Run

- `task start` — package the release `.app` and open it (one command to run the real app)

## Develop

- `wails3 dev` (or `task dev`) — dev mode with hot reload
- `go test -race ./internal/... ./cmd/...` — backend tests
- `cd frontend && npm test` — frontend tests
- `wails3 generate bindings -ts -i` — regenerate the (gitignored) TS bindings
  after changing any bound service

The app stores its data in `~/Library/Application Support/com.pulse.dashboard/`.
```

- [ ] **Step 4: Verify every claim**

Run: `grep -n "alpha2.114" go.mod && ls build/darwin/Taskfile.yml && grep -n "com.pulse.dashboard" -r internal/ main.go | head -3`
Expected: version matches; app-data dir string matches what the code uses. Fix the README if either differs.

- [ ] **Step 5: Commit**

```bash
git add Taskfile.yml README.md
git commit -m "docs: wails-native start task; rewrite README for the Go stack"
```

---

### Task 3: Rewrite `CLAUDE.md` for the Go world

**Files:**
- Rewrite: `CLAUDE.md`

- [ ] **Step 1: Replace `CLAUDE.md` with the Go-world version**

```markdown
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
`module.ConfigField` (kinds: string, number, boolean, stringList, enum —
`ConfigField` serializes `def`, not `default`). `module.DecodeConfig[T]` turns
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
- DB file: `~/Library/Application Support/com.pulse.dashboard/dashboard.db`.

## Design & docs

- UI work: use the **impeccable** skill; styling: **tailwind** (v4) skill.
- New module: use the **create-module** skill (`.claude/skills/create-module/`).
- Specs: `docs/superpowers/specs/`; plans: `docs/superpowers/plans/`.
```

- [ ] **Step 2: Verify every factual claim against the code**

Run each; fix the doc on any mismatch:
- `grep -n "wails3 dev\|package" Taskfile.yml | head -5`
- `grep -n "def\b" internal/module/manifest.go | head -3` (ConfigField serializes `def`)
- `grep -rn "widget:cache-updated" internal/ | head -2`
- `grep -rn "not-found\|KindNotFound" internal/cli/*.go | head -3`
- `grep -rn "wails:ignore" internal/ | head -3`
- `grep -rn "wailsapp/wails" internal/ --include="*.go" -l` (expect only `pomodoro/service.go` + its test)
- `grep -n "com.pulse.dashboard" -r internal/ main.go | head -2`
- `ls internal/db/migrations/`

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: rewrite CLAUDE.md for the Go/Wails architecture"
```

---

### Task 4: Rewrite the `create-module` skill for the Go recipe

**Files:**
- Rewrite: `.claude/skills/create-module/SKILL.md`

- [ ] **Step 1: Replace `SKILL.md` with the Go-world recipe**

Keep the existing frontmatter block (`name:`/`description:` — update the
description wording to say Go module under `internal/modules/`, not
`src/modules/`), then replace the body with:

```markdown
# Create a Module (Go backend + React front)

A module = a Go package `internal/modules/<name>/` (manifests + fetch) and a
frontend folder `frontend/src/modules/<name>/` (types + render registration +
widgets). Reference modules: `ccusage` (minimal), `github` (multi-widget,
process-model CLI), `gws` (payload-model CLI, options, mutation service),
`bookmarks`/`pomodoro` (local data + repo + bound service).

## 1. Go package — `internal/modules/<name>/module.go`

- `const <Widget>Type = "<name>.<widget>"` per widget.
- Payload structs: JSON tags camelCase, **matching the TS types you'll write in
  step 4 exactly**; optional fields get `omitempty`; **slice fields must never
  be nil** (`[]T{}`) — nil marshals to JSON `null`.
- `Manifests() []module.Manifest`: `{Type, Title, Refreshable, Integration,
  ConfigFields}`. Field kinds: `FieldString/FieldNumber/FieldBoolean/
  FieldStringList/FieldEnum`. **Numeric defaults are float64 literals**
  (`20.0`), `Min`/`Max` are `*float64` (use a local `f64` helper).
- `Fetch(ctx, widgetType, config)`: switch on type; decode config with
  `module.DecodeConfig[cfgStruct](config)`; return the payload struct.
- CLI-backed fetch: define an injectable seam
  `type runner func(ctx context.Context, args []string) (string, error)` that
  production code fills with `cli.Run` (process-model: stderr + exit code +
  `cli.Options.NotAuthPattern` auth regex — like `gh`/`jira`) or
  `cli.RunJSONInto` + error extractor (payload-model: errors as JSON on stdout —
  like `gws`). Errors are `*cli.Error` with Kind ∈
  `not-found|auth|timeout|failed`.
- Fan-out (multiple repos/authors/items): goroutine per item writing to
  pre-sized `results[i]`/`errs[i]` slots + `sync.WaitGroup`; partial failure
  keeps good results (surface failed items in an `Errors []string
  "errors,omitempty"` field); total failure returns the first error. Must pass
  `go test -race`.

## 2. Go tests — `module_test.go`

Fake the runner (`&Module{run: func(...)...}`) — never shell out. Cover: happy
path (fixture JSON in `testdata/`), empty→non-nil slices, error passthrough,
partial-failure resilience, manifest shape (type/title/refreshable/integration/
config fields incl. float64 defaults), unknown-type dispatch error. TDD: write
tests first, watch them fail, implement.

## 3. Wire the Go side (same commit as step 5's render registration)

1. `internal/modules/all.go` → append `<name>.New()` to `ManifestModules()`.
2. `main.go` → append to `module.NewRegistry(...)`; if the module mutates data,
   also `application.NewService(<name>.NewService())`.
3. `go run ./cmd/gen-widget-types` → commit the regenerated
   `frontend/src/widget-types.gen.json`.
4. If a service was added: `wails3 generate bindings -ts -i` (bindings are
   gitignored — regenerate, don't commit).

## 4. Frontend — `frontend/src/modules/<name>/`

- `manifest.ts`: `export const <NAME>_TYPE = "<name>.<widget>";` + plain TS
  interfaces mirroring the Go payload/config JSON exactly. No Zod — the server
  owns validation.
- `widgets/<widget>-widget.tsx`: component gets
  `{ data, config, refresh }` (`WidgetBodyProps<Data, Config>`). Mutating
  widgets import service wrappers from `@/lib/backend` and call `refresh()`
  after.
- `render.ts`: `registerRender(<NAME>_TYPE, { Component, icon: { Icon,
  className } })` — no explicit generics, let inference work.
- `frontend/src/modules/render.ts` → add `import "./<name>/render";`.

## 5. Frontend tests — `frontend/tests/modules/`

Widget test with fixture data (render states: data/empty/error); mock
`@/lib/backend` for mutations. The two parity tests (Go
`internal/module/parity_test.go`, frontend `registry-parity.test.ts`) fail
automatically if any wiring step above was skipped.

## 6. Gates before commit

`go test -race ./internal/... ./cmd/...` and
`cd frontend && npm test && npx tsc --noEmit && npm run lint` — all green, one
commit containing Go wiring + gen file + render registration together.
```

- [ ] **Step 2: Verify the recipe's claims**

Run: `ls internal/modules/ccusage internal/modules/github frontend/src/modules/ccusage && grep -n "registerRender" frontend/src/modules/ccusage/render.ts && grep -rn "WidgetBodyProps" frontend/src/lib frontend/src/modules | head -3`
Expected: paths and symbols exist as documented. Fix any mismatch.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/create-module/SKILL.md
git commit -m "docs: rewrite create-module skill for the Go module recipe"
```

---

### Task 5: Final verification + handoff doc close-out

**Files:**
- Modify: `docs/superpowers/plans/2026-07-22-wails-rewrite-handoff.md` (mark Plan 3 done)

- [ ] **Step 1: Full gates on the branch**

Run: `go test -race ./internal/... ./cmd/... && cd frontend && npm test && npx tsc --noEmit && npm run lint && cd ..`
Expected: all green.

- [ ] **Step 2: Package + launch**

Run: `task start`
Expected: `bin/pulse.app` builds and opens. Quit it afterwards.

- [ ] **Step 3: Sweep for stragglers**

Run: `git ls-files | grep -i "tauri\|drizzle"; grep -rn "tauri" README.md CLAUDE.md .claude/skills/create-module/SKILL.md | grep -vi "ported from\|rewrite\|migration"`
Expected: no tracked files; no non-historical doc references.

- [ ] **Step 4: Close out the handoff doc**

In `docs/superpowers/plans/2026-07-22-wails-rewrite-handoff.md`, retitle the
"## Plan 3 (last): cutover" section to "## Plan 3 (done): cutover" and replace
its body with a short completion note: Tauri stack deleted, deps pruned, docs +
create-module skill rewritten (this plan's file name), old `dashboard.db` left
for the user to delete manually.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-07-22-wails-rewrite-handoff.md
git commit -m "docs: close out Plan 3 in the rewrite handoff"
```
