---
name: create-module
description: Use when adding a new integration to the work-dashboard (a new data source or widget — e.g. GitHub, Jira, Google Workspace, system stats), scaffolding a module under internal/modules/ (Go backend) and frontend/src/modules/ (React frontend), or registering a new widget type. Covers the module structure, payload types, fetch implementation, render registration, CLI-backed and data-mutation patterns, testing, and wiring steps.
---

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
