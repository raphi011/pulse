# Wails Rewrite Plan 2 — Remaining Six Modules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the six parked modules (ccusage, github, github-stats, jira, gws, pomodoro) from `frontend/legacy-modules/` TS to Go backends + revived React fronts, and port the integration health service — reaching widget parity with the old Tauri app.

**Architecture:** Each module becomes a Go package under `internal/modules/<name>/` implementing `module.Module` (fetch logic, manifests, CLI runners with injectable seams for tests), while its React side moves back from `frontend/legacy-modules/<name>/` to `frontend/src/modules/<name>/` with Zod manifests rewritten as plain TS types (server owns manifests). Widgets that mutate data (gws email/task actions, pomodoro session log) call new Wails-bound per-module services. A new `internal/integration` package ports the TS integration-service (TTL health cache, in-flight dedup, enable/disable with widget-delete confirm).

**Tech Stack:** Go 1.24, Wails v3 `v3.0.0-alpha2.114` (incl. `pkg/services/notifications`), `internal/cli` (Plan-1 runner), stdlib `testing`; React 19 + Vite + Vitest on the frontend.

## Global Constraints

- **Contracts frozen in Plan 1** (see `docs/superpowers/plans/2026-07-22-wails-rewrite-handoff.md`): manifest shape `{type, title, configFields, refreshable, integration?}`; `ConfigField` serializes `def` not `default`; event `widget:cache-updated` with bare widget-id string; cache row `{widgetId, payload, fetchedAt, status, error, errorKind}`; errorKind ∈ `not-found|auth|timeout|failed`.
- **Numeric manifest defaults must be float64 literals** (`20.0` not `20`) — normalizeValue guards, but be explicit.
- **Every payload slice field must be non-nil** (`[]T{}` / `make([]T, 0, …)`) — a Go `nil` slice marshals to JSON `null` and widgets do `d.items.length`.
- **Payload JSON keys are camelCase, matching the TS types exactly** (e.g. `costUsd`, `updatedAt`, `meetUrl`); optional TS fields (`errors?`, `meetUrl?`…) get `omitempty`.
- **Backend-only bound-service methods get `//wails:ignore`** (last doc-comment line, blank `//` before it).
- **`internal/` packages stay OS-neutral and Wails-free** (exception: `internal/modules/pomodoro/service.go` may import `wails/v3/pkg/services/notifications` — it's the notification seam); `go test -race ./internal/... ./cmd/...` must stay clean.
- **After changing any bound service surface**, regenerate bindings: `wails3 generate bindings -ts -i` (bindings are gitignored).
- **Widget-type parity:** after registering a module, update `internal/modules/all.go` (Task 1 creates it), run `go run ./cmd/gen-widget-types`, and commit `frontend/src/widget-types.gen.json` **in the same task that registers the frontend render side** so both parity tests stay green per commit.
- Commit messages: plain conventional style, no Jira prefix.
- Test commands: Go `go test ./internal/... ./cmd/...`; frontend `cd frontend && npm test`, `npm run lint`, `npx tsc --noEmit`.

**Widget types after this plan (17):** `bookmarks.links`, `ccusage.spend`, `github.prs`, `github.failingActions`, `github.dependabot`, `github-stats.summary`, `github-stats.heatmap`, `gws.gmail`, `gws.calendar`, `gws.chatDms`, `gws.chatChannels`, `gws.drive`, `gws.tasks`, `gws.nextMeeting`, `jira.jql`, `pomodoro.timer`, `system.stats`.

**Reference for all TS-source ports:** the legacy fetch logic lives in this worktree under `frontend/legacy-modules/<name>/*.ts` (identical to old main's `src/modules/<name>/`). When a port's behavior is ambiguous, the legacy TS file is the spec.

---

### Task 1: Shared plumbing — `DecodeConfig`, `internal/modules/all.go`, generator/parity retarget

**Files:**
- Create: `internal/module/config.go`
- Create: `internal/module/config_test.go`
- Create: `internal/modules/all.go`
- Modify: `cmd/gen-widget-types/main.go`
- Modify: `internal/module/parity_test.go`

**Interfaces:**
- Produces: `module.DecodeConfig[T any](config map[string]any) (T, error)` — every later module's `Fetch` uses it to get a typed config.
- Produces: `modules.ManifestModules() []module.Module` (package `modules` at `internal/modules/all.go`) — the single list gen-widget-types and the Go parity test consume; later tasks append one constructor per module here.

- [ ] **Step 1: Write the failing test for DecodeConfig**

`internal/module/config_test.go`:

```go
package module_test

import (
	"testing"

	"pulse/internal/module"
)

func TestDecodeConfigRoundTripsTypedStruct(t *testing.T) {
	type cfg struct {
		Query string   `json:"query"`
		Limit int      `json:"limit"`
		Tags  []string `json:"tags"`
	}
	got, err := module.DecodeConfig[cfg](map[string]any{
		"query": "is:unread", "limit": 15.0, "tags": []any{"a", "b"},
	})
	if err != nil {
		t.Fatalf("DecodeConfig: %v", err)
	}
	if got.Query != "is:unread" || got.Limit != 15 || len(got.Tags) != 2 {
		t.Fatalf("unexpected decode: %+v", got)
	}
}

func TestDecodeConfigNilMapYieldsZeroValue(t *testing.T) {
	type cfg struct {
		Limit int `json:"limit"`
	}
	got, err := module.DecodeConfig[cfg](nil)
	if err != nil {
		t.Fatalf("DecodeConfig(nil): %v", err)
	}
	if got.Limit != 0 {
		t.Fatalf("want zero value, got %+v", got)
	}
}
```

- [ ] **Step 2: Run it — expect FAIL (undefined: module.DecodeConfig)**

Run: `go test ./internal/module/ -run TestDecodeConfig -v`

- [ ] **Step 3: Implement `internal/module/config.go`**

```go
package module

import "encoding/json"

// DecodeConfig round-trips a validated config map into a typed struct.
// Modules call it at the top of Fetch to get their typed config; the map has
// already passed ValidateConfig, so failures here are programming errors.
func DecodeConfig[T any](config map[string]any) (T, error) {
	var out T
	raw, err := json.Marshal(config)
	if err != nil {
		return out, err
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return out, err
	}
	return out, nil
}
```

- [ ] **Step 4: Run again — expect PASS**

Run: `go test ./internal/module/ -run TestDecodeConfig -v`

- [ ] **Step 5: Create `internal/modules/all.go`**

```go
// Package modules aggregates every widget module for consumers that only
// need manifests: cmd/gen-widget-types and the registry parity tests. Fetch
// dependencies are nil/default here — do not use these instances to fetch.
package modules

import (
	"pulse/internal/module"
	"pulse/internal/modules/bookmarks"
	"pulse/internal/modules/system"
)

// ManifestModules returns one instance of every module, in registration
// order. Append new modules here as they are ported (Plan 2).
func ManifestModules() []module.Module {
	return []module.Module{
		system.New(),
		bookmarks.New(nil),
	}
}
```

- [ ] **Step 6: Retarget the generator and the Go parity test**

In `cmd/gen-widget-types/main.go`, replace the imports of `pulse/internal/modules/bookmarks` and `pulse/internal/modules/system` with `pulse/internal/modules`, and replace

```go
	reg, err := module.NewRegistry(system.New(), bookmarks.New(nil))
```

with

```go
	reg, err := module.NewRegistry(modules.ManifestModules()...)
```

In `internal/module/parity_test.go`, same change: import `pulse/internal/modules` (drop the bookmarks/system imports) and construct with

```go
	reg, err := module.NewRegistry(modules.ManifestModules()...)
```

- [ ] **Step 7: Verify everything still passes and the generator is idempotent**

Run: `go test ./internal/... ./cmd/... && go run ./cmd/gen-widget-types && git diff --exit-code frontend/src/widget-types.gen.json`
Expected: tests PASS, no diff in the generated file.

- [ ] **Step 8: Commit**

```bash
git add internal/module/config.go internal/module/config_test.go internal/modules/all.go cmd/gen-widget-types/main.go internal/module/parity_test.go
git commit -m "refactor: shared module list for generator/parity; add DecodeConfig helper"
```

---

### Task 2: ccusage Go module

**Files:**
- Create: `internal/modules/ccusage/module.go`
- Create: `internal/modules/ccusage/module_test.go`

**Interfaces:**
- Consumes: `cli.Run`, `cli.Error`, `module.Manifest`, `module.ConfigField`.
- Produces: `ccusage.New() *Module` (implements `module.Module`), `ccusage.SpendType = "ccusage.spend"`, payload `SpendData{CostUsd float64 "costUsd"; Date string "date"}`. Task 3 wires it; Task 17 adds `ccusage.Integration()`.

- [ ] **Step 1: Write the failing tests**

`internal/modules/ccusage/module_test.go`:

```go
package ccusage

import (
	"context"
	"errors"
	"testing"
	"time"

	"pulse/internal/cli"
)

func fake(stdout string, err error) *Module {
	return &Module{run: func(ctx context.Context, args []string) (string, error) {
		return stdout, err
	}}
}

func TestFetchParsesTotalsAndStampsToday(t *testing.T) {
	m := fake(`{"totals":{"totalCost":12.34}}`, nil)
	got, err := m.Fetch(context.Background(), SpendType, nil)
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	data := got.(SpendData)
	if data.CostUsd != 12.34 {
		t.Errorf("CostUsd = %v, want 12.34", data.CostUsd)
	}
	if want := time.Now().Format("2006-01-02"); data.Date != want {
		t.Errorf("Date = %q, want %q", data.Date, want)
	}
}

func TestFetchMissingTotalsIsZero(t *testing.T) {
	m := fake(`{}`, nil)
	got, err := m.Fetch(context.Background(), SpendType, nil)
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if got.(SpendData).CostUsd != 0 {
		t.Errorf("CostUsd = %v, want 0", got.(SpendData).CostUsd)
	}
}

func TestFetchNonJSONClassifiesFailed(t *testing.T) {
	m := fake("npx installed 12 packages\nnot json", nil)
	_, err := m.Fetch(context.Background(), SpendType, nil)
	var ce *cli.Error
	if !errors.As(err, &ce) || ce.Kind != cli.KindFailed {
		t.Fatalf("want cli.Error kind=failed, got %v", err)
	}
}

func TestFetchPassesThroughRunnerError(t *testing.T) {
	want := &cli.Error{Kind: cli.KindNotFound, Message: "ccusage not found — install it"}
	m := fake("", want)
	_, err := m.Fetch(context.Background(), SpendType, nil)
	if !errors.Is(err, want) {
		t.Fatalf("want runner error passthrough, got %v", err)
	}
}

func TestFetchQueriesTodayCompact(t *testing.T) {
	var gotArgs []string
	m := &Module{run: func(ctx context.Context, args []string) (string, error) {
		gotArgs = args
		return `{"totals":{"totalCost":0}}`, nil
	}}
	if _, err := m.Fetch(context.Background(), SpendType, nil); err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	compact := time.Now().Format("20060102")
	want := []string{"daily", "--json", "--since", compact, "--until", compact}
	if len(gotArgs) != len(want) {
		t.Fatalf("args = %v, want %v", gotArgs, want)
	}
	for i := range want {
		if gotArgs[i] != want[i] {
			t.Fatalf("args = %v, want %v", gotArgs, want)
		}
	}
}

func TestManifest(t *testing.T) {
	ms := New().Manifests()
	if len(ms) != 1 || ms[0].Type != SpendType {
		t.Fatalf("Manifests = %+v", ms)
	}
	m := ms[0]
	if !m.Refreshable || m.Integration != "ccusage" || m.Title != "Claude Usage" {
		t.Errorf("manifest fields wrong: %+v", m)
	}
	if len(m.ConfigFields) != 1 || m.ConfigFields[0].Key != "dailyLimitUsd" || m.ConfigFields[0].Default != 20.0 {
		t.Errorf("configFields wrong: %+v", m.ConfigFields)
	}
}
```

- [ ] **Step 2: Run — expect FAIL (package does not exist)**

Run: `go test ./internal/modules/ccusage/ -v`

- [ ] **Step 3: Implement `internal/modules/ccusage/module.go`**

```go
// Package ccusage ports frontend/legacy-modules/ccusage: today's Claude
// spend via the ccusage CLI (process-model: JSON on stdout, errors via exit
// code; no auth concept — it reads local ~/.claude logs).
package ccusage

import (
	"context"
	"encoding/json"
	"time"

	"pulse/internal/cli"
	"pulse/internal/module"
)

const SpendType = "ccusage.spend"

func f64(v float64) *float64 { return &v }

// runner is the injectable CLI seam: returns stdout.
type runner func(ctx context.Context, args []string) (string, error)

func runCcusage(ctx context.Context, args []string) (string, error) {
	stdout, _, err := cli.Run(ctx, "ccusage", args, cli.Options{})
	return stdout, err
}

type Module struct{ run runner }

func New() *Module { return &Module{run: runCcusage} }

// SpendData mirrors the TS CcusageSpendData payload. Date is the local
// YYYY-MM-DD the cost covers.
type SpendData struct {
	CostUsd float64 `json:"costUsd"`
	Date    string  `json:"date"`
}

func (Module) Manifests() []module.Manifest {
	return []module.Manifest{{
		Type: SpendType, Title: "Claude Usage", Refreshable: true, Integration: "ccusage",
		ConfigFields: []module.ConfigField{
			{Key: "dailyLimitUsd", Label: "Daily limit (USD)", Kind: module.FieldNumber, Default: 20.0, Min: f64(0)},
		},
	}}
}

func (m *Module) Fetch(ctx context.Context, widgetType string, config map[string]any) (any, error) {
	now := time.Now()
	compact := now.Format("20060102")
	stdout, err := m.run(ctx, []string{"daily", "--json", "--since", compact, "--until", compact})
	if err != nil {
		return nil, err
	}
	var body struct {
		Totals struct {
			TotalCost float64 `json:"totalCost"`
		} `json:"totals"`
	}
	if err := json.Unmarshal([]byte(stdout), &body); err != nil {
		// A non-JSON preamble (e.g. an npx install banner) classifies like the
		// other CLI modules do, not as a raw parse error.
		return nil, &cli.Error{Kind: cli.KindFailed, Message: "ccusage returned non-JSON output"}
	}
	return SpendData{CostUsd: body.Totals.TotalCost, Date: now.Format("2006-01-02")}, nil
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `go test ./internal/modules/ccusage/ -v`

- [ ] **Step 5: Commit**

```bash
git add internal/modules/ccusage/
git commit -m "feat: ccusage module in Go (spend fetch + manifest)"
```

---

### Task 3: ccusage wiring + frontend move

**Files:**
- Modify: `internal/modules/all.go`, `main.go`
- Move: `frontend/legacy-modules/ccusage/` → `frontend/src/modules/ccusage/` (rewrite `manifest.ts`, `render.ts`; delete `fetch.ts`, `integration.ts`, `ccusage.ts`)
- Move: `frontend/legacy-modules/__tests__/ccusage-widget.test.tsx` → `frontend/tests/modules/ccusage-widget.test.tsx`
- Delete: `frontend/legacy-modules/__tests__/ccusage-fetch.test.ts`, `frontend/legacy-modules/__tests__/ccusage-registration.test.ts`
- Modify: `frontend/src/modules/render.ts`, regenerate `frontend/src/widget-types.gen.json`

**Interfaces:**
- Consumes: `ccusage.New()` (Task 2); `registerRender(type, {...})` from `@/modules/render-registry`.
- Produces: widget type `ccusage.spend` live end-to-end; the per-module frontend move recipe every later frontend task repeats.

- [ ] **Step 1: Register the Go module**

In `internal/modules/all.go` add `"pulse/internal/modules/ccusage"` to imports and `ccusage.New(),` after `bookmarks.New(nil),` in `ManifestModules()`.

In `main.go` add the same import and change the registry construction to:

```go
	registry, err := module.NewRegistry(system.New(), bookmarks.New(bmRepo), ccusage.New())
```

- [ ] **Step 2: Regenerate the widget-type list**

Run: `go run ./cmd/gen-widget-types`
Expected: `frontend/src/widget-types.gen.json` now contains `"ccusage.spend"`.

- [ ] **Step 3: Move the frontend module back**

```bash
cd frontend
git mv legacy-modules/ccusage src/modules/ccusage
git mv legacy-modules/__tests__/ccusage-widget.test.tsx tests/modules/ccusage-widget.test.tsx
git rm legacy-modules/__tests__/ccusage-fetch.test.ts legacy-modules/__tests__/ccusage-registration.test.ts
git rm src/modules/ccusage/fetch.ts src/modules/ccusage/integration.ts src/modules/ccusage/ccusage.ts
```

- [ ] **Step 4: Rewrite `frontend/src/modules/ccusage/manifest.ts`** (Zod → plain types; server owns the schema)

```ts
export const CCUSAGE_SPEND_TYPE = "ccusage.spend";

/** Mirrors the Go manifest's config field (form is generated server-side). */
export interface CcusageSpendConfig {
  dailyLimitUsd: number;
}

/** Today's spend as returned by the Go module. `date` is the local YYYY-MM-DD it covers. */
export type CcusageSpendData = { costUsd: number; date: string };
```

- [ ] **Step 5: Rewrite `frontend/src/modules/ccusage/render.ts`** (type-string registration, per the system/bookmarks pattern)

```ts
import { FiDollarSign } from "react-icons/fi";
import { registerRender } from "@/modules/render-registry";
import { CCUSAGE_SPEND_TYPE } from "./manifest";
import { CcusageWidget } from "./widgets/ccusage-widget";

registerRender(CCUSAGE_SPEND_TYPE, {
  Component: CcusageWidget,
  icon: { Icon: FiDollarSign, className: "text-emerald-600 dark:text-emerald-400" },
});
```

- [ ] **Step 6: Register the render side and fix stale imports**

In `frontend/src/modules/render.ts` add `import "./ccusage/render";`.

Then check nothing still imports deleted symbols (`ccusageSpendManifest`, `ccusageSpendConfigSchema`, `fetchCcusage`, `runCcusage`):

Run: `cd frontend && grep -rn "ccusageSpendManifest\|ccusageSpendConfigSchema\|fetchCcusage\|runCcusage" src tests`
Expected: no matches (the widget + its test import only types and the component). Fix any hit by importing from `./manifest` types instead.

- [ ] **Step 7: Run both parity gates + suites**

Run: `go test ./internal/... ./cmd/... && cd frontend && npm test && npx tsc --noEmit && npm run lint`
Expected: all PASS (both parity tests now agree on 3 types).

- [ ] **Step 8: Smoke-check in the app (optional but cheap)**

Run: `wails3 build && ./bin/pulse` — add a "Claude Usage" widget; it should fetch (or show a classified error if `ccusage` isn't installed).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: revive ccusage frontend on the Go module; register widget type"
```

---

### Task 4: github Go — runner + PRs fetch

**Files:**
- Create: `internal/modules/github/gh.go`
- Create: `internal/modules/github/prs.go`
- Create: `internal/modules/github/prs_test.go`
- Move: `frontend/legacy-modules/fixtures/github/{search-prs.json,pr-view.json}` → `internal/modules/github/testdata/`

**Interfaces:**
- Consumes: `cli.Run`, `cli.Options`, `cli.Error`.
- Produces: `RunGh(ctx, args) (string, error)` (exported — Task 7's github-stats module shares it), unexported `runner` type + `ghJSON[T]` helper, `fetchPrs(ctx, run, prsConfig) (PrsData, error)`, types `PrItem`, `PrsData`, `rollupCi`. Task 5 adds the other two widgets and the `Module`.

- [ ] **Step 1: Move the fixtures**

```bash
mkdir -p internal/modules/github/testdata
git mv frontend/legacy-modules/fixtures/github/search-prs.json internal/modules/github/testdata/
git mv frontend/legacy-modules/fixtures/github/pr-view.json internal/modules/github/testdata/
```

- [ ] **Step 2: Write the failing tests**

`internal/modules/github/prs_test.go`:

```go
package github

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"pulse/internal/cli"
)

// fakeGh routes by argv prefix: "search prs …" → search fixture,
// "pr view …" → view fixture (or an error for a specific URL).
func fakeGh(t *testing.T, viewErrFor string) runner {
	t.Helper()
	search, err := os.ReadFile("testdata/search-prs.json")
	if err != nil {
		t.Fatal(err)
	}
	view, err := os.ReadFile("testdata/pr-view.json")
	if err != nil {
		t.Fatal(err)
	}
	return func(ctx context.Context, args []string) (string, error) {
		switch {
		case args[0] == "search":
			return string(search), nil
		case args[0] == "pr" && args[1] == "view":
			if viewErrFor != "" && args[2] == viewErrFor {
				return "", &cli.Error{Kind: cli.KindFailed, Message: "boom"}
			}
			return string(view), nil
		}
		t.Fatalf("unexpected gh args: %v", args)
		return "", nil
	}
}

func TestRollupCi(t *testing.T) {
	cases := []struct {
		name   string
		checks []ghCheck
		want   string
	}{
		{"no checks", nil, "none"},
		{"all pass", []ghCheck{{Conclusion: "SUCCESS"}}, "ok"},
		{"any fail wins", []ghCheck{{Conclusion: "SUCCESS"}, {Conclusion: "FAILURE"}}, "danger"},
		{"pending", []ghCheck{{Status: "IN_PROGRESS"}}, "warn"},
		{"empty signals count as pending", []ghCheck{{}}, "warn"},
		{"state used when no conclusion", []ghCheck{{State: "ERROR"}}, "danger"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := rollupCi(c.checks); got != c.want {
				t.Errorf("rollupCi = %q, want %q", got, c.want)
			}
		})
	}
}

func TestFetchPrsEnrichesAndSorts(t *testing.T) {
	got, err := fetchPrs(context.Background(), fakeGh(t, ""), prsConfig{Limit: 20})
	if err != nil {
		t.Fatalf("fetchPrs: %v", err)
	}
	if len(got.Prs) == 0 {
		t.Fatal("no PRs")
	}
	// Every PR is enriched from the view fixture (ci/review no longer "none"
	// when the fixture carries a rollup) and sorted newest-first.
	for i := 1; i < len(got.Prs); i++ {
		if got.Prs[i-1].UpdatedAt < got.Prs[i].UpdatedAt {
			t.Errorf("not sorted desc at %d", i)
		}
	}
	for _, pr := range got.Prs {
		if pr.Repo == "" || pr.URL == "" || pr.Author == "" {
			t.Errorf("unnormalized PR: %+v", pr)
		}
	}
}

func TestFetchPrsFailedEnrichKeepsBaseItem(t *testing.T) {
	// Find a URL from the search fixture to poison.
	base, err := fetchPrs(context.Background(), fakeGh(t, ""), prsConfig{Limit: 20})
	if err != nil {
		t.Fatal(err)
	}
	poison := base.Prs[0].URL
	got, err := fetchPrs(context.Background(), fakeGh(t, poison), prsConfig{Limit: 20})
	if err != nil {
		t.Fatalf("fetchPrs: %v", err)
	}
	for _, pr := range got.Prs {
		if pr.URL == poison && (pr.CI != "none" || pr.Review != "none") {
			t.Errorf("poisoned PR should keep base ci/review, got %+v", pr)
		}
	}
}

func TestFetchPrsAllAuthorsFailingSurfacesError(t *testing.T) {
	authErr := &cli.Error{Kind: cli.KindAuth, Message: "Not authenticated — run `gh auth login`"}
	run := func(ctx context.Context, args []string) (string, error) { return "", authErr }
	_, err := fetchPrs(context.Background(), run, prsConfig{Authors: []string{"a", "b"}, Limit: 5})
	if !errors.Is(err, authErr) {
		t.Fatalf("want auth error surfaced, got %v", err)
	}
}

func TestFetchPrsOneBadAuthorDoesNotSink(t *testing.T) {
	good := fakeGh(t, "")
	run := func(ctx context.Context, args []string) (string, error) {
		for _, a := range args {
			if a == "--author=bad" {
				return "", &cli.Error{Kind: cli.KindFailed, Message: "boom"}
			}
		}
		return good(ctx, args)
	}
	got, err := fetchPrs(context.Background(), run, prsConfig{Authors: []string{"good", "bad"}, Limit: 20})
	if err != nil {
		t.Fatalf("fetchPrs: %v", err)
	}
	if len(got.Prs) == 0 {
		t.Fatal("good author's PRs should survive")
	}
}

func TestFetchPrsDefaultsToMeAndCapsLimit(t *testing.T) {
	var sawAuthor string
	good := fakeGh(t, "")
	run := func(ctx context.Context, args []string) (string, error) {
		for _, a := range args {
			if strings.HasPrefix(a, "--author=") {
				sawAuthor = a
			}
		}
		return good(ctx, args)
	}
	got, err := fetchPrs(context.Background(), run, prsConfig{Limit: 1})
	if err != nil {
		t.Fatal(err)
	}
	if sawAuthor != "--author=@me" {
		t.Errorf("author = %q, want --author=@me", sawAuthor)
	}
	if len(got.Prs) > 1 {
		t.Errorf("limit not applied: %d PRs", len(got.Prs))
	}
}
```

- [ ] **Step 3: Run — expect FAIL (package does not exist)**

Run: `go test ./internal/modules/github/ -v`

- [ ] **Step 4: Implement `internal/modules/github/gh.go`**

```go
// Package github ports frontend/legacy-modules/github: PRs (with N+1
// CI/review enrichment), failing Actions runs, and Dependabot alerts via the
// gh CLI (process-model: stderr + non-zero exit, auth classified by regex).
package github

import (
	"context"
	"encoding/json"
	"regexp"

	"pulse/internal/cli"
)

var ghAuthPattern = regexp.MustCompile(`(?i)gh auth login|not logged in|authentication|HTTP 401|Bad credentials`)

// runner is the injectable gh seam: returns stdout.
type runner func(ctx context.Context, args []string) (string, error)

// RunGh runs gh with the shared auth classification. Exported because the
// githubstats module shares the gh CLI (and the "github" integration).
func RunGh(ctx context.Context, args []string) (string, error) {
	stdout, _, err := cli.Run(ctx, "gh", args, cli.Options{
		NotAuthPattern: ghAuthPattern,
		NotAuthMessage: "Not authenticated — run `gh auth login`",
	})
	return stdout, err
}

func ghJSON[T any](ctx context.Context, run runner, args []string) (T, error) {
	var out T
	stdout, err := run(ctx, args)
	if err != nil {
		return out, err
	}
	if err := json.Unmarshal([]byte(stdout), &out); err != nil {
		return out, &cli.Error{Kind: cli.KindFailed, Message: "gh returned unexpected output"}
	}
	return out, nil
}

func f64(v float64) *float64 { return &v }

func firstErr(errs []error) error {
	for _, err := range errs {
		if err != nil {
			return err
		}
	}
	return nil
}

// "owner/name" — interpolated into `gh api` paths, so reject anything with a
// path/query separator or whitespace (the Zod repoSchema's job, done
// fetch-side since the Go field DSL has no per-item pattern).
var repoRe = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)
```

- [ ] **Step 5: Implement `internal/modules/github/prs.go`**

```go
package github

import (
	"context"
	"sort"
	"strconv"
	"sync"
)

type ghCheck struct {
	Status     string `json:"status"`
	Conclusion string `json:"conclusion"`
	State      string `json:"state"`
}

type ghPrView struct {
	StatusCheckRollup []ghCheck `json:"statusCheckRollup"`
	ReviewDecision    string    `json:"reviewDecision"`
}

type ghSearchPr struct {
	Number     int    `json:"number"`
	Title      string `json:"title"`
	URL        string `json:"url"`
	Repository struct {
		NameWithOwner string `json:"nameWithOwner"`
	} `json:"repository"`
	Author struct {
		Login string `json:"login"`
	} `json:"author"`
	UpdatedAt string `json:"updatedAt"`
}

// PrItem mirrors the TS PrItem payload shape.
type PrItem struct {
	Repo      string `json:"repo"`
	Number    int    `json:"number"`
	Title     string `json:"title"`
	URL       string `json:"url"`
	Author    string `json:"author"`
	CI        string `json:"ci"`     // ok | warn | danger | none
	Review    string `json:"review"` // gh reviewDecision, or "none"
	UpdatedAt string `json:"updatedAt"`
}

type PrsData struct {
	Prs []PrItem `json:"prs"`
}

type prsConfig struct {
	Authors []string `json:"authors"`
	Limit   int      `json:"limit"`
}

var failSignals = map[string]bool{
	"FAILURE": true, "TIMED_OUT": true, "CANCELLED": true,
	"ERROR": true, "STARTUP_FAILURE": true, "ACTION_REQUIRED": true,
}
var pendingSignals = map[string]bool{
	"IN_PROGRESS": true, "QUEUED": true, "PENDING": true,
	"WAITING": true, "REQUESTED": true, "EXPECTED": true,
}

func rollupCi(checks []ghCheck) string {
	if len(checks) == 0 {
		return "none"
	}
	sawPending := false
	for _, c := range checks {
		signal := c.Conclusion
		if signal == "" {
			signal = c.State
		}
		if signal == "" {
			signal = c.Status
		}
		if failSignals[signal] {
			return "danger"
		}
		if pendingSignals[signal] || (c.Conclusion == "" && c.State == "") {
			sawPending = true
		}
	}
	if sawPending {
		return "warn"
	}
	return "ok"
}

func normalizeSearchPr(raw ghSearchPr) PrItem {
	return PrItem{
		Repo: raw.Repository.NameWithOwner, Number: raw.Number, Title: raw.Title,
		URL: raw.URL, Author: raw.Author.Login, CI: "none", Review: "none",
		UpdatedAt: raw.UpdatedAt,
	}
}

const searchJSONFields = "number,title,url,repository,author,updatedAt"

func enrichPr(ctx context.Context, run runner, pr PrItem) (PrItem, error) {
	view, err := ghJSON[ghPrView](ctx, run, []string{
		"pr", "view", pr.URL, "--json", "statusCheckRollup,reviewDecision",
	})
	if err != nil {
		return pr, err
	}
	pr.CI = rollupCi(view.StatusCheckRollup)
	if view.ReviewDecision != "" {
		pr.Review = view.ReviewDecision
	}
	return pr, nil
}

func searchAndEnrich(ctx context.Context, run runner, searchArgs []string) ([]PrItem, error) {
	raw, err := ghJSON[[]ghSearchPr](ctx, run, searchArgs)
	if err != nil {
		return nil, err
	}
	prs := make([]PrItem, len(raw))
	for i, r := range raw {
		prs[i] = normalizeSearchPr(r)
	}
	// N+1 enrichment, one goroutine per PR; a failed enrich keeps the base
	// item (allSettled semantics — one item's failure never sinks the widget).
	var wg sync.WaitGroup
	for i := range prs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if enriched, err := enrichPr(ctx, run, prs[i]); err == nil {
				prs[i] = enriched
			}
		}()
	}
	wg.Wait()
	return prs, nil
}

// fetchPrs: blank authors → your own open PRs. `gh search prs --author` is
// single-valued (last flag wins), so each author gets its own search; results
// merge, dedupe by URL, sort by recency, and cap to the limit.
func fetchPrs(ctx context.Context, run runner, cfg prsConfig) (PrsData, error) {
	authors := cfg.Authors
	if len(authors) == 0 {
		authors = []string{"@me"}
	}
	results := make([][]PrItem, len(authors))
	errs := make([]error, len(authors))
	var wg sync.WaitGroup
	for i, author := range authors {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results[i], errs[i] = searchAndEnrich(ctx, run, []string{
				"search", "prs", "--author=" + author, "--state=open",
				"--json", searchJSONFields, "--limit", strconv.Itoa(cfg.Limit),
			})
		}()
	}
	wg.Wait()

	// A single bad author shouldn't sink the widget, but a total failure
	// (e.g. auth) must surface rather than caching an empty "ok" result.
	merged := []PrItem{}
	failed := 0
	for i := range authors {
		if errs[i] != nil {
			failed++
			continue
		}
		merged = append(merged, results[i]...)
	}
	if failed == len(authors) {
		return PrsData{}, firstErr(errs)
	}

	seen := map[string]bool{}
	prs := []PrItem{}
	for _, pr := range merged {
		if !seen[pr.URL] {
			seen[pr.URL] = true
			prs = append(prs, pr)
		}
	}
	sort.SliceStable(prs, func(i, j int) bool { return prs[i].UpdatedAt > prs[j].UpdatedAt })
	if len(prs) > cfg.Limit {
		prs = prs[:cfg.Limit]
	}
	return PrsData{Prs: prs}, nil
}
```

- [ ] **Step 6: Run — expect PASS (also with -race)**

Run: `go test -race ./internal/modules/github/ -v`

- [ ] **Step 7: Commit**

```bash
git add internal/modules/github/ frontend/legacy-modules/fixtures
git commit -m "feat: github module in Go — gh runner + PR search/enrich"
```

---

### Task 5: github Go — runs + dependabot + Module

**Files:**
- Create: `internal/modules/github/runs.go`
- Create: `internal/modules/github/dependabot.go`
- Create: `internal/modules/github/module.go`
- Create: `internal/modules/github/runs_test.go`
- Create: `internal/modules/github/dependabot_test.go`
- Create: `internal/modules/github/module_test.go`

**Interfaces:**
- Consumes: `runner`, `ghJSON`, `firstErr`, `repoRe`, `f64` from Task 4.
- Produces: `github.New() *Module` implementing `module.Module`; type constants `PrsType = "github.prs"`, `FailingActionsType = "github.failingActions"`, `DependabotType = "github.dependabot"`; payloads `FailingActionsData{Runs []RunItem "runs"; Errors []string "errors,omitempty"}`, `DependabotData{Alerts []AlertItem "alerts"; Errors []string "errors,omitempty"}`.

- [ ] **Step 1: Write the failing tests**

`internal/modules/github/runs_test.go`:

```go
package github

import (
	"context"
	"errors"
	"testing"

	"pulse/internal/cli"
)

const runsFixture = `[
  {"displayTitle":"ci: fix build","workflowName":"CI","headBranch":"main",
   "event":"push","url":"https://github.com/o/r/actions/runs/1","createdAt":"2026-07-20T10:00:00Z"},
  {"displayTitle":"older run","workflowName":"CI","headBranch":"dev",
   "event":"pull_request","url":"https://github.com/o/r/actions/runs/2","createdAt":"2026-07-19T10:00:00Z"}
]`

func TestFetchFailingActionsEmptyReposShortCircuits(t *testing.T) {
	called := false
	run := func(ctx context.Context, args []string) (string, error) { called = true; return "[]", nil }
	got, err := fetchFailingActions(context.Background(), run, failingActionsConfig{Limit: 10})
	if err != nil || called {
		t.Fatalf("err=%v called=%v; want no CLI call", err, called)
	}
	if got.Runs == nil || len(got.Runs) != 0 {
		t.Fatalf("want empty non-nil runs, got %#v", got.Runs)
	}
}

func TestFetchFailingActionsMergesSortsAndNormalizes(t *testing.T) {
	run := func(ctx context.Context, args []string) (string, error) { return runsFixture, nil }
	got, err := fetchFailingActions(context.Background(), run,
		failingActionsConfig{Repos: []string{"o/r", "o/r2"}, Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Runs) != 4 {
		t.Fatalf("want 4 runs, got %d", len(got.Runs))
	}
	for i := 1; i < len(got.Runs); i++ {
		if got.Runs[i-1].CreatedAt < got.Runs[i].CreatedAt {
			t.Errorf("not sorted desc at %d", i)
		}
	}
	if got.Runs[0].Name != "ci: fix build" || got.Runs[0].Branch != "main" {
		t.Errorf("normalize wrong: %+v", got.Runs[0])
	}
}

func TestFetchFailingActionsPartialFailureListsRepo(t *testing.T) {
	run := func(ctx context.Context, args []string) (string, error) {
		for i, a := range args {
			if a == "-R" && args[i+1] == "o/bad" {
				return "", &cli.Error{Kind: cli.KindFailed, Message: "boom"}
			}
		}
		return runsFixture, nil
	}
	got, err := fetchFailingActions(context.Background(), run,
		failingActionsConfig{Repos: []string{"o/r", "o/bad"}, Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Errors) != 1 || got.Errors[0] != "o/bad" {
		t.Fatalf("Errors = %v, want [o/bad]", got.Errors)
	}
}

func TestFetchFailingActionsTotalFailureSurfaces(t *testing.T) {
	boom := &cli.Error{Kind: cli.KindAuth, Message: "no"}
	run := func(ctx context.Context, args []string) (string, error) { return "", boom }
	_, err := fetchFailingActions(context.Background(), run,
		failingActionsConfig{Repos: []string{"o/r"}, Limit: 10})
	if !errors.Is(err, boom) {
		t.Fatalf("want error surfaced, got %v", err)
	}
}

func TestFetchFailingActionsRejectsMalformedRepo(t *testing.T) {
	run := func(ctx context.Context, args []string) (string, error) { return runsFixture, nil }
	got, err := fetchFailingActions(context.Background(), run,
		failingActionsConfig{Repos: []string{"o/r", "not a repo"}, Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Errors) != 1 || got.Errors[0] != "not a repo" {
		t.Fatalf("Errors = %v, want the malformed repo listed", got.Errors)
	}
}
```

`internal/modules/github/dependabot_test.go`:

```go
package github

import (
	"context"
	"testing"
)

const alertsFixture = `[
  {"html_url":"https://github.com/o/r/security/dependabot/1",
   "security_advisory":{"summary":"Low issue","severity":"low"},
   "security_vulnerability":{"package":{"name":"leftpad","ecosystem":"npm"}}},
  {"html_url":"https://github.com/o/r/security/dependabot/2",
   "security_advisory":{"summary":"Critical issue","severity":"critical"},
   "security_vulnerability":{"package":{"name":"lodash","ecosystem":"npm"}}}
]`

func TestFetchDependabotFiltersAndSortsBySeverity(t *testing.T) {
	run := func(ctx context.Context, args []string) (string, error) { return alertsFixture, nil }

	all, err := fetchDependabot(context.Background(), run,
		dependabotConfig{Repos: []string{"o/r"}, Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(all.Alerts) != 2 || all.Alerts[0].Severity != "critical" {
		t.Fatalf("want 2 alerts sorted critical-first, got %+v", all.Alerts)
	}

	// REST severity filter is exact-match upstream, so the floor is client-side.
	high, err := fetchDependabot(context.Background(), run,
		dependabotConfig{Repos: []string{"o/r"}, Severity: "high", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(high.Alerts) != 1 || high.Alerts[0].Package != "lodash" {
		t.Fatalf("severity floor wrong: %+v", high.Alerts)
	}
}

func TestFetchDependabotEmptyReposShortCircuits(t *testing.T) {
	run := func(ctx context.Context, args []string) (string, error) {
		t.Fatal("should not call gh")
		return "", nil
	}
	got, err := fetchDependabot(context.Background(), run, dependabotConfig{Limit: 10})
	if err != nil || got.Alerts == nil || len(got.Alerts) != 0 {
		t.Fatalf("want empty non-nil alerts, got %#v err=%v", got.Alerts, err)
	}
}
```

`internal/modules/github/module_test.go`:

```go
package github

import (
	"context"
	"testing"
)

func TestManifestsListThreeTypes(t *testing.T) {
	ms := New().Manifests()
	want := map[string]bool{PrsType: true, FailingActionsType: true, DependabotType: true}
	if len(ms) != 3 {
		t.Fatalf("want 3 manifests, got %d", len(ms))
	}
	for _, m := range ms {
		if !want[m.Type] {
			t.Errorf("unexpected type %q", m.Type)
		}
		if !m.Refreshable || m.Integration != "github" {
			t.Errorf("%s: refreshable/integration wrong: %+v", m.Type, m)
		}
	}
}

func TestFetchDispatchesUnknownType(t *testing.T) {
	if _, err := New().Fetch(context.Background(), "github.nope", nil); err == nil {
		t.Fatal("want error for unknown type")
	}
}

func TestFetchDecodesConfig(t *testing.T) {
	m := &Module{run: func(ctx context.Context, args []string) (string, error) { return "[]", nil }}
	got, err := m.Fetch(context.Background(), FailingActionsType,
		map[string]any{"repos": []any{}, "limit": 10.0})
	if err != nil {
		t.Fatal(err)
	}
	if got.(FailingActionsData).Runs == nil {
		t.Fatal("runs must be non-nil")
	}
}
```

- [ ] **Step 2: Run — expect FAIL (undefined symbols)**

Run: `go test ./internal/modules/github/ -v`

- [ ] **Step 3: Implement `internal/modules/github/runs.go`**

```go
package github

import (
	"context"
	"sort"
	"strconv"
	"sync"

	"pulse/internal/cli"
)

type ghRun struct {
	DisplayTitle string `json:"displayTitle"`
	WorkflowName string `json:"workflowName"`
	HeadBranch   string `json:"headBranch"`
	Event        string `json:"event"`
	URL          string `json:"url"`
	CreatedAt    string `json:"createdAt"`
}

// RunItem mirrors the TS RunItem payload shape.
type RunItem struct {
	Repo      string `json:"repo"`
	Name      string `json:"name"`
	URL       string `json:"url"`
	Branch    string `json:"branch"`
	Event     string `json:"event"`
	CreatedAt string `json:"createdAt"`
}

type FailingActionsData struct {
	Runs   []RunItem `json:"runs"`
	Errors []string  `json:"errors,omitempty"`
}

type failingActionsConfig struct {
	Repos []string `json:"repos"`
	Limit int      `json:"limit"`
}

const runJSONFields = "displayTitle,workflowName,headBranch,event,url,createdAt"

func fetchFailingActions(ctx context.Context, run runner, cfg failingActionsConfig) (FailingActionsData, error) {
	if len(cfg.Repos) == 0 {
		return FailingActionsData{Runs: []RunItem{}}, nil
	}
	results := make([][]RunItem, len(cfg.Repos))
	errs := make([]error, len(cfg.Repos))
	var wg sync.WaitGroup
	for i, repo := range cfg.Repos {
		if !repoRe.MatchString(repo) {
			errs[i] = &cli.Error{Kind: cli.KindFailed, Message: "invalid repo: " + repo}
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			raw, err := ghJSON[[]ghRun](ctx, run, []string{
				"run", "list", "-R", repo, "--status=failure",
				"--json", runJSONFields, "--limit", strconv.Itoa(cfg.Limit),
			})
			if err != nil {
				errs[i] = err
				return
			}
			items := make([]RunItem, len(raw))
			for j, r := range raw {
				items[j] = RunItem{
					Repo: repo, Name: r.DisplayTitle, URL: r.URL,
					Branch: r.HeadBranch, Event: r.Event, CreatedAt: r.CreatedAt,
				}
			}
			results[i] = items
		}()
	}
	wg.Wait()

	failedRepos := []string{}
	runs := []RunItem{}
	for i, repo := range cfg.Repos {
		if errs[i] != nil {
			failedRepos = append(failedRepos, repo)
			continue
		}
		runs = append(runs, results[i]...)
	}
	if len(failedRepos) == len(cfg.Repos) {
		return FailingActionsData{}, firstErr(errs)
	}
	// Newest-first across repos before the widget slices, so an older run from
	// the first repo can't permanently mask a fresher failure from a later one.
	sort.SliceStable(runs, func(i, j int) bool { return runs[i].CreatedAt > runs[j].CreatedAt })
	if len(failedRepos) > 0 {
		return FailingActionsData{Runs: runs, Errors: failedRepos}, nil
	}
	return FailingActionsData{Runs: runs}, nil
}
```

- [ ] **Step 4: Implement `internal/modules/github/dependabot.go`**

```go
package github

import (
	"context"
	"fmt"
	"sort"
	"sync"

	"pulse/internal/cli"
)

type ghAlert struct {
	HTMLURL          string `json:"html_url"`
	SecurityAdvisory struct {
		Summary  string `json:"summary"`
		Severity string `json:"severity"`
	} `json:"security_advisory"`
	SecurityVulnerability struct {
		Package struct {
			Name string `json:"name"`
		} `json:"package"`
	} `json:"security_vulnerability"`
}

// AlertItem mirrors the TS AlertItem payload shape.
type AlertItem struct {
	Repo     string `json:"repo"`
	Package  string `json:"package"`
	Severity string `json:"severity"`
	Summary  string `json:"summary"`
	URL      string `json:"url"`
}

type DependabotData struct {
	Alerts []AlertItem `json:"alerts"`
	Errors []string    `json:"errors,omitempty"`
}

type dependabotConfig struct {
	Repos    []string `json:"repos"`
	Severity string   `json:"severity"`
	Limit    int      `json:"limit"`
}

// Ascending severity — index doubles as a rank for floor-filtering and sorting.
var severityOrder = []string{"low", "medium", "high", "critical"}

func severityRank(s string) int {
	for i, o := range severityOrder {
		if o == s {
			return i
		}
	}
	return -1
}

func fetchDependabot(ctx context.Context, run runner, cfg dependabotConfig) (DependabotData, error) {
	if len(cfg.Repos) == 0 {
		return DependabotData{Alerts: []AlertItem{}}, nil
	}
	results := make([][]AlertItem, len(cfg.Repos))
	errs := make([]error, len(cfg.Repos))
	var wg sync.WaitGroup
	for i, repo := range cfg.Repos {
		if !repoRe.MatchString(repo) {
			errs[i] = &cli.Error{Kind: cli.KindFailed, Message: "invalid repo: " + repo}
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			raw, err := ghJSON[[]ghAlert](ctx, run, []string{
				"api", fmt.Sprintf("/repos/%s/dependabot/alerts?state=open&per_page=50", repo),
			})
			if err != nil {
				errs[i] = err
				return
			}
			items := make([]AlertItem, len(raw))
			for j, a := range raw {
				items[j] = AlertItem{
					Repo: repo, Package: a.SecurityVulnerability.Package.Name,
					Severity: a.SecurityAdvisory.Severity, Summary: a.SecurityAdvisory.Summary,
					URL: a.HTMLURL,
				}
			}
			results[i] = items
		}()
	}
	wg.Wait()

	failedRepos := []string{}
	merged := []AlertItem{}
	for i, repo := range cfg.Repos {
		if errs[i] != nil {
			failedRepos = append(failedRepos, repo)
			continue
		}
		merged = append(merged, results[i]...)
	}
	if len(failedRepos) == len(cfg.Repos) {
		return DependabotData{}, firstErr(errs)
	}
	// REST `severity` is exact-match, not a floor (picking "high" would drop
	// "critical"), so treat it as a minimum client-side. Sort most-severe
	// first before the widget slices.
	min := 0
	if cfg.Severity != "" {
		min = severityRank(cfg.Severity)
	}
	alerts := []AlertItem{}
	for _, a := range merged {
		if severityRank(a.Severity) >= min {
			alerts = append(alerts, a)
		}
	}
	sort.SliceStable(alerts, func(i, j int) bool {
		return severityRank(alerts[i].Severity) > severityRank(alerts[j].Severity)
	})
	if len(failedRepos) > 0 {
		return DependabotData{Alerts: alerts, Errors: failedRepos}, nil
	}
	return DependabotData{Alerts: alerts}, nil
}
```

- [ ] **Step 5: Implement `internal/modules/github/module.go`**

```go
package github

import (
	"context"
	"fmt"

	"pulse/internal/module"
)

const (
	PrsType            = "github.prs"
	FailingActionsType = "github.failingActions"
	DependabotType     = "github.dependabot"
)

type Module struct{ run runner }

func New() *Module { return &Module{run: RunGh} }

func (Module) Manifests() []module.Manifest {
	return []module.Manifest{
		{
			Type: PrsType, Title: "Pull Requests", Refreshable: true, Integration: "github",
			ConfigFields: []module.ConfigField{
				{Key: "authors", Label: "GitHub usernames (blank = your PRs)", Kind: module.FieldStringList, Default: []string{}},
				{Key: "limit", Label: "Max PRs", Kind: module.FieldNumber, Default: 20.0, Min: f64(1), Max: f64(50)},
			},
		},
		{
			Type: FailingActionsType, Title: "Failing Actions", Refreshable: true, Integration: "github",
			ConfigFields: []module.ConfigField{
				{Key: "repos", Label: "Repos (owner/name)", Kind: module.FieldStringList, Default: []string{}},
				{Key: "limit", Label: "Max runs", Kind: module.FieldNumber, Default: 10.0, Min: f64(1), Max: f64(50)},
			},
		},
		{
			Type: DependabotType, Title: "Dependabot Alerts", Refreshable: true, Integration: "github",
			ConfigFields: []module.ConfigField{
				{Key: "repos", Label: "Repos (owner/name)", Kind: module.FieldStringList, Default: []string{}},
				{Key: "severity", Label: "Min severity", Kind: module.FieldEnum, Options: []string{"low", "medium", "high", "critical"}},
				{Key: "limit", Label: "Max alerts", Kind: module.FieldNumber, Default: 10.0, Min: f64(1), Max: f64(50)},
			},
		},
	}
}

func (m *Module) Fetch(ctx context.Context, widgetType string, config map[string]any) (any, error) {
	switch widgetType {
	case PrsType:
		cfg, err := module.DecodeConfig[prsConfig](config)
		if err != nil {
			return nil, err
		}
		return fetchPrs(ctx, m.run, cfg)
	case FailingActionsType:
		cfg, err := module.DecodeConfig[failingActionsConfig](config)
		if err != nil {
			return nil, err
		}
		return fetchFailingActions(ctx, m.run, cfg)
	case DependabotType:
		cfg, err := module.DecodeConfig[dependabotConfig](config)
		if err != nil {
			return nil, err
		}
		return fetchDependabot(ctx, m.run, cfg)
	}
	return nil, fmt.Errorf("github: unknown widget type %s", widgetType)
}
```

- [ ] **Step 6: Run — expect PASS**

Run: `go test -race ./internal/modules/github/ -v`

- [ ] **Step 7: Commit**

```bash
git add internal/modules/github/
git commit -m "feat: github module in Go — failing actions, dependabot, module dispatch"
```

---

### Task 6: github wiring + frontend move

**Files:**
- Modify: `internal/modules/all.go`, `main.go`
- Move: `frontend/legacy-modules/github/` → `frontend/src/modules/github/` (rewrite `manifest.ts`, `render.ts`; delete `fetch.ts`, `integration.ts`, `gh.ts`, `prs.ts`, `runs.ts`, `dependabot.ts`)
- Move: `frontend/legacy-modules/__tests__/github-widgets.test.tsx` → `frontend/tests/modules/github-widgets.test.tsx`
- Delete: `frontend/legacy-modules/__tests__/{github-gh,github-prs,github-runs,github-dependabot,github-registration}.test.ts`
- Modify: `frontend/src/modules/render.ts`, regenerate `frontend/src/widget-types.gen.json`

**Interfaces:**
- Consumes: `github.New()` (Task 5).
- Produces: three live github widget types; TS types `PrItem`, `RunItem`, `AlertItem`, `PrsData`, `FailingActionsData`, `DependabotData`, `CiStatus`, `Severity` in `@/modules/github/manifest` (widgets and tests import them).

- [ ] **Step 1: Register the Go module**

`internal/modules/all.go`: add import `"pulse/internal/modules/github"`, append `github.New(),` to `ManifestModules()`.
`main.go`: add the same import; registry becomes:

```go
	registry, err := module.NewRegistry(system.New(), bookmarks.New(bmRepo), ccusage.New(), github.New())
```

Run: `go run ./cmd/gen-widget-types` (adds the three `github.*` types).

- [ ] **Step 2: Move files**

```bash
cd frontend
git mv legacy-modules/github src/modules/github
git mv legacy-modules/__tests__/github-widgets.test.tsx tests/modules/github-widgets.test.tsx
git rm legacy-modules/__tests__/github-gh.test.ts legacy-modules/__tests__/github-prs.test.ts \
  legacy-modules/__tests__/github-runs.test.ts legacy-modules/__tests__/github-dependabot.test.ts \
  legacy-modules/__tests__/github-registration.test.ts
git rm src/modules/github/fetch.ts src/modules/github/integration.ts src/modules/github/gh.ts \
  src/modules/github/prs.ts src/modules/github/runs.ts src/modules/github/dependabot.ts
```

- [ ] **Step 3: Rewrite `frontend/src/modules/github/manifest.ts`**

```ts
export const PRS_TYPE = "github.prs";
export const FAILING_ACTIONS_TYPE = "github.failingActions";
export const DEPENDABOT_TYPE = "github.dependabot";

// Config shapes mirror the Go manifests (forms are generated server-side).
export interface PrsConfig {
  authors: string[];
  limit: number;
}
export interface FailingActionsConfig {
  repos: string[];
  limit: number;
}
export interface DependabotConfig {
  repos: string[];
  severity?: Severity;
  limit: number;
}

// --- Shared data shapes (payloads produced by internal/modules/github) ---
export type CiStatus = "ok" | "warn" | "danger" | "none";
export type Severity = "low" | "medium" | "high" | "critical";

export type PrItem = {
  repo: string; number: number; title: string; url: string;
  author: string; ci: CiStatus; review: string; updatedAt: string;
};
export type RunItem = {
  repo: string; name: string; url: string; branch: string; event: string; createdAt: string;
};
export type AlertItem = {
  repo: string; package: string; severity: Severity; summary: string; url: string;
};

export type PrsData = { prs: PrItem[] };
export type FailingActionsData = { runs: RunItem[]; errors?: string[] };
export type DependabotData = { alerts: AlertItem[]; errors?: string[] };
```

- [ ] **Step 4: Rewrite `frontend/src/modules/github/render.ts`**

```ts
import { SiGithub, SiGithubactions, SiDependabot } from "react-icons/si";
import { registerRender } from "@/modules/render-registry";
import { PRS_TYPE, FAILING_ACTIONS_TYPE, DEPENDABOT_TYPE } from "./manifest";
import type { PrsData, FailingActionsData, DependabotData } from "./manifest";
import { PrListWidget } from "./widgets/pr-list-widget";
import { FailingActionsWidget } from "./widgets/failing-actions-widget";
import { DependabotWidget } from "./widgets/dependabot-widget";

registerRender<PrsData, unknown>(PRS_TYPE, {
  Component: PrListWidget,
  count: (d) => d.prs.length,
  icon: { Icon: SiGithub, className: "text-[#181717] dark:text-white" },
});
registerRender<FailingActionsData, unknown>(FAILING_ACTIONS_TYPE, {
  Component: FailingActionsWidget,
  count: (d) => d.runs.length,
  icon: { Icon: SiGithubactions, className: "text-[#2088FF]" },
});
registerRender<DependabotData, unknown>(DEPENDABOT_TYPE, {
  Component: DependabotWidget,
  count: (d) => d.alerts.length,
  icon: { Icon: SiDependabot, className: "text-[#025E8C]" },
});
```

(If `registerRender`'s generics don't infer cleanly from the widget components, match how `src/modules/system/render.ts` and `src/modules/bookmarks/render.ts` call it — those two are the canonical pattern.)

- [ ] **Step 5: Register render side + fix stale imports**

Add `import "./github/render";` to `frontend/src/modules/render.ts`.

Run: `cd frontend && grep -rn "prsManifest\|failingActionsManifest\|dependabotManifest\|prsConfigSchema\|@/modules/github/gh\|@/modules/github/prs" src tests`
Expected: no matches; fix any by importing types from `@/modules/github/manifest`.

- [ ] **Step 6: Run everything**

Run: `go test ./internal/... ./cmd/... && cd frontend && npm test && npx tsc --noEmit && npm run lint`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: revive github frontend on the Go module (3 widgets)"
```

---

### Task 7: github-stats Go module

**Files:**
- Create: `internal/modules/githubstats/stats.go`
- Create: `internal/modules/githubstats/module.go`
- Create: `internal/modules/githubstats/stats_test.go`
- Create: `internal/modules/githubstats/module_test.go`

**Interfaces:**
- Consumes: `github.RunGh` (Task 4) as its default runner.
- Produces: `githubstats.New() *Module`; `SummaryType = "github-stats.summary"`, `HeatmapType = "github-stats.heatmap"`; payloads `StatsData{Commits,Prs,Reviews,Issues,Total int; Trend []TrendPoint}` (JSON `commits,prs,reviews,issues,total,trend`) and `HeatmapData{Total int "total"; Weeks []HeatmapWeek "weeks"}` with `HeatmapDay{Date string "date"; Count int "count"; Level int "level"}`.

- [ ] **Step 1: Write the failing tests**

`internal/modules/githubstats/stats_test.go`:

```go
package githubstats

import (
	"context"
	"testing"
	"time"
)

func mustParse(t *testing.T, s string) time.Time {
	t.Helper()
	ts, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t.Fatal(err)
	}
	return ts
}

func TestWindowForPresets(t *testing.T) {
	now := mustParse(t, "2026-07-22T10:00:00Z")
	from, to := windowFor("7d", now)
	if to != "2026-07-22T10:00:00Z" || from != "2026-07-15T10:00:00Z" {
		t.Errorf("7d window = %s..%s", from, to)
	}
	from, _ = windowFor("year", now)
	if from != "2026-01-01T00:00:00Z" {
		t.Errorf("year from = %s, want Jan 1 UTC", from)
	}
	from, _ = windowFor("30d", now)
	if from != "2026-06-22T10:00:00Z" {
		t.Errorf("30d from = %s", from)
	}
}

func TestYearWindowTrailing12Months(t *testing.T) {
	now := mustParse(t, "2026-07-22T10:00:00Z")
	from, to := yearWindow(now)
	if from != "2025-07-22T10:00:00Z" || to != "2026-07-22T10:00:00Z" {
		t.Errorf("yearWindow = %s..%s", from, to)
	}
}

func sampleRaw() rawContributions {
	var raw rawContributions
	raw.TotalCommitContributions = 10
	raw.TotalPullRequestContributions = 3
	raw.TotalPullRequestReviewContributions = 2
	raw.TotalIssueContributions = 1
	raw.ContributionCalendar.TotalContributions = 16
	raw.ContributionCalendar.Weeks = []rawWeek{
		{ContributionDays: []rawContributionDay{
			{Date: "2026-07-20", ContributionCount: 0},
			{Date: "2026-07-21", ContributionCount: 1},
			{Date: "2026-07-22", ContributionCount: 2},
		}},
		{ContributionDays: []rawContributionDay{
			{Date: "2026-07-23", ContributionCount: 3},
			{Date: "2026-07-24", ContributionCount: 385},
		}},
	}
	return raw
}

func TestToStatsDataFlattensTrend(t *testing.T) {
	got := toStatsData(sampleRaw())
	if got.Commits != 10 || got.Prs != 3 || got.Reviews != 2 || got.Issues != 1 || got.Total != 16 {
		t.Errorf("totals wrong: %+v", got)
	}
	if len(got.Trend) != 5 || got.Trend[4].Count != 385 || got.Trend[0].Date != "2026-07-20" {
		t.Errorf("trend wrong: %+v", got.Trend)
	}
}

func TestToHeatmapDataRankBasedLevels(t *testing.T) {
	got := toHeatmapData(sampleRaw())
	if got.Total != 16 || len(got.Weeks) != 2 {
		t.Fatalf("shape wrong: %+v", got)
	}
	days := append(got.Weeks[0].Days, got.Weeks[1].Days...)
	// positives sorted: [1 2 3 385]; quartile thresholds t1=2, t2=3, t3=385.
	wantLevels := []int{0, 1, 1, 2, 3}
	for i, d := range days {
		if d.Level != wantLevels[i] {
			t.Errorf("day %s level = %d, want %d", d.Date, d.Level, wantLevels[i])
		}
	}
}

func TestFetchContributionsSurfacesGraphQLErrors(t *testing.T) {
	run := func(ctx context.Context, args []string) (string, error) {
		return `{"errors":[{"message":"rate limited"}]}`, nil
	}
	if _, err := fetchContributions(context.Background(), run, "a", "b"); err == nil {
		t.Fatal("want error from GraphQL errors[]")
	}
}

func TestFetchContributionsParsesViewer(t *testing.T) {
	run := func(ctx context.Context, args []string) (string, error) {
		return `{"data":{"viewer":{"contributionsCollection":{
			"totalCommitContributions":5,
			"contributionCalendar":{"totalContributions":5,"weeks":[]}}}}}`, nil
	}
	got, err := fetchContributions(context.Background(), run, "a", "b")
	if err != nil {
		t.Fatal(err)
	}
	if got.TotalCommitContributions != 5 {
		t.Errorf("parse wrong: %+v", got)
	}
}
```

`internal/modules/githubstats/module_test.go`:

```go
package githubstats

import "testing"

func TestManifests(t *testing.T) {
	ms := New().Manifests()
	if len(ms) != 2 || ms[0].Type != SummaryType || ms[1].Type != HeatmapType {
		t.Fatalf("Manifests = %+v", ms)
	}
	if ms[0].Integration != "github" || !ms[0].Refreshable {
		t.Errorf("summary manifest wrong: %+v", ms[0])
	}
	tf := ms[0].ConfigFields[0]
	if tf.Key != "timeframe" || len(tf.Options) != 4 || tf.Default != "30d" {
		t.Errorf("timeframe field wrong: %+v", tf)
	}
	if len(ms[1].ConfigFields) != 0 {
		t.Errorf("heatmap should have no config fields: %+v", ms[1].ConfigFields)
	}
}
```

- [ ] **Step 2: Run — expect FAIL**

Run: `go test ./internal/modules/githubstats/ -v`

- [ ] **Step 3: Implement `internal/modules/githubstats/stats.go`**

```go
// Package githubstats ports frontend/legacy-modules/github-stats:
// contribution summary + heatmap via the gh GraphQL API. It shares the gh
// runner (and the "github" integration) with internal/modules/github.
package githubstats

import (
	"context"
	"encoding/json"
	"time"

	"pulse/internal/cli"
)

// runner is the injectable gh seam (github.RunGh in production).
type runner func(ctx context.Context, args []string) (string, error)

type TrendPoint struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

type StatsData struct {
	Commits int          `json:"commits"`
	Prs     int          `json:"prs"`
	Reviews int          `json:"reviews"`
	Issues  int          `json:"issues"`
	Total   int          `json:"total"`
	Trend   []TrendPoint `json:"trend"`
}

type HeatmapDay struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
	Level int    `json:"level"` // 0..4
}
type HeatmapWeek struct {
	Days []HeatmapDay `json:"days"`
}
type HeatmapData struct {
	Total int           `json:"total"`
	Weeks []HeatmapWeek `json:"weeks"`
}

type rawContributionDay struct {
	Date              string `json:"date"`
	ContributionCount int    `json:"contributionCount"`
	ContributionLevel string `json:"contributionLevel"`
}
type rawWeek struct {
	ContributionDays []rawContributionDay `json:"contributionDays"`
}
type rawContributions struct {
	TotalCommitContributions            int `json:"totalCommitContributions"`
	TotalPullRequestContributions       int `json:"totalPullRequestContributions"`
	TotalPullRequestReviewContributions int `json:"totalPullRequestReviewContributions"`
	TotalIssueContributions             int `json:"totalIssueContributions"`
	ContributionCalendar                struct {
		TotalContributions int       `json:"totalContributions"`
		Weeks              []rawWeek `json:"weeks"`
	} `json:"contributionCalendar"`
}

// windowFor: `to` is always `now`; "year" means Jan 1 of now's UTC year.
func windowFor(timeframe string, now time.Time) (from, to string) {
	nowUTC := now.UTC()
	to = nowUTC.Format(time.RFC3339)
	if timeframe == "year" {
		return time.Date(nowUTC.Year(), 1, 1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339), to
	}
	days := map[string]int{"7d": 7, "30d": 30, "90d": 90}[timeframe]
	return nowUTC.AddDate(0, 0, -days).Format(time.RFC3339), to
}

// yearWindow: trailing 12 months (~53 weeks) for the classic heatmap.
func yearWindow(now time.Time) (from, to string) {
	nowUTC := now.UTC()
	return nowUTC.AddDate(-1, 0, 0).Format(time.RFC3339), nowUTC.Format(time.RFC3339)
}

const contribQuery = `query($from: DateTime!, $to: DateTime!) {
  viewer {
    contributionsCollection(from: $from, to: $to) {
      totalCommitContributions
      totalPullRequestContributions
      totalPullRequestReviewContributions
      totalIssueContributions
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays { date contributionCount contributionLevel }
        }
      }
    }
  }
}`

func toStatsData(raw rawContributions) StatsData {
	trend := []TrendPoint{}
	for _, w := range raw.ContributionCalendar.Weeks {
		for _, d := range w.ContributionDays {
			trend = append(trend, TrendPoint{Date: d.Date, Count: d.ContributionCount})
		}
	}
	return StatsData{
		Commits: raw.TotalCommitContributions,
		Prs:     raw.TotalPullRequestContributions,
		Reviews: raw.TotalPullRequestReviewContributions,
		Issues:  raw.TotalIssueContributions,
		Total:   raw.ContributionCalendar.TotalContributions,
		Trend:   trend,
	}
}

// quantile: nearest-rank value at fraction q (0..1) of an ascending-sorted
// slice.
func quantile(sorted []int, q float64) int {
	if len(sorted) == 0 {
		return 0
	}
	idx := int(q * float64(len(sorted)))
	if idx > len(sorted)-1 {
		idx = len(sorted) - 1
	}
	return sorted[idx]
}

// toHeatmapData levels each day from its own count via quartiles of the
// active (positive-count) days rather than GitHub's contributionLevel —
// GitHub's levels are quartiles of the max, so one 385-count day collapses
// normal days into the faintest bucket. Rank-based quartiles are
// outlier-proof. Zero-count days are level 0.
func toHeatmapData(raw rawContributions) HeatmapData {
	positives := []int{}
	for _, w := range raw.ContributionCalendar.Weeks {
		for _, d := range w.ContributionDays {
			if d.ContributionCount > 0 {
				positives = append(positives, d.ContributionCount)
			}
		}
	}
	sortInts(positives)
	t1, t2, t3 := quantile(positives, 0.25), quantile(positives, 0.5), quantile(positives, 0.75)
	levelFor := func(count int) int {
		switch {
		case count <= 0:
			return 0
		case count <= t1:
			return 1
		case count <= t2:
			return 2
		case count <= t3:
			return 3
		default:
			return 4
		}
	}
	weeks := make([]HeatmapWeek, len(raw.ContributionCalendar.Weeks))
	for i, w := range raw.ContributionCalendar.Weeks {
		days := make([]HeatmapDay, len(w.ContributionDays))
		for j, d := range w.ContributionDays {
			days[j] = HeatmapDay{Date: d.Date, Count: d.ContributionCount, Level: levelFor(d.ContributionCount)}
		}
		weeks[i] = HeatmapWeek{Days: days}
	}
	return HeatmapData{Total: raw.ContributionCalendar.TotalContributions, Weeks: weeks}
}

func sortInts(s []int) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j] < s[j-1]; j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
}

type graphqlResponse struct {
	Data *struct {
		Viewer *struct {
			ContributionsCollection *rawContributions `json:"contributionsCollection"`
		} `json:"viewer"`
	} `json:"data"`
	Errors []struct {
		Message string `json:"message"`
	} `json:"errors"`
}

// fetchContributions runs the contributions query for a window; GraphQL
// `errors[]` (the HTTP-200 case) surface as failed.
func fetchContributions(ctx context.Context, run runner, from, to string) (rawContributions, error) {
	stdout, err := run(ctx, []string{
		"api", "graphql",
		"-f", "query=" + contribQuery,
		"-f", "from=" + from,
		"-f", "to=" + to,
	})
	if err != nil {
		return rawContributions{}, err
	}
	var body graphqlResponse
	if err := json.Unmarshal([]byte(stdout), &body); err != nil {
		return rawContributions{}, &cli.Error{Kind: cli.KindFailed, Message: "GitHub returned non-JSON output"}
	}
	if len(body.Errors) > 0 {
		return rawContributions{}, &cli.Error{Kind: cli.KindFailed, Message: body.Errors[0].Message}
	}
	if body.Data == nil || body.Data.Viewer == nil || body.Data.Viewer.ContributionsCollection == nil {
		return rawContributions{}, &cli.Error{Kind: cli.KindFailed, Message: "No contributions data in response"}
	}
	return *body.Data.Viewer.ContributionsCollection, nil
}
```

Note: `sortInts` is a tiny insertion sort to avoid importing `sort` for one call — if you prefer, use `sort.Ints(positives)` and drop the helper; either is fine, pick one and keep the test green.

- [ ] **Step 4: Implement `internal/modules/githubstats/module.go`**

```go
package githubstats

import (
	"context"
	"fmt"
	"time"

	"pulse/internal/module"
	"pulse/internal/modules/github"
)

const (
	SummaryType = "github-stats.summary"
	HeatmapType = "github-stats.heatmap"
)

type Module struct{ run runner }

func New() *Module { return &Module{run: github.RunGh} }

func (Module) Manifests() []module.Manifest {
	return []module.Manifest{
		{
			Type: SummaryType, Title: "GitHub Stats", Refreshable: true, Integration: "github",
			ConfigFields: []module.ConfigField{
				{Key: "timeframe", Label: "Timeframe", Kind: module.FieldEnum,
					Options: []string{"7d", "30d", "90d", "year"}, Default: "30d"},
			},
		},
		{
			Type: HeatmapType, Title: "Contribution Heatmap", Refreshable: true, Integration: "github",
			ConfigFields: []module.ConfigField{},
		},
	}
}

type summaryConfig struct {
	Timeframe string `json:"timeframe"`
}

func (m *Module) Fetch(ctx context.Context, widgetType string, config map[string]any) (any, error) {
	switch widgetType {
	case SummaryType:
		cfg, err := module.DecodeConfig[summaryConfig](config)
		if err != nil {
			return nil, err
		}
		from, to := windowFor(cfg.Timeframe, time.Now())
		raw, err := fetchContributions(ctx, m.run, from, to)
		if err != nil {
			return nil, err
		}
		return toStatsData(raw), nil
	case HeatmapType:
		from, to := yearWindow(time.Now())
		raw, err := fetchContributions(ctx, m.run, from, to)
		if err != nil {
			return nil, err
		}
		return toHeatmapData(raw), nil
	}
	return nil, fmt.Errorf("githubstats: unknown widget type %s", widgetType)
}
```

- [ ] **Step 5: Run — expect PASS**

Run: `go test -race ./internal/modules/githubstats/ -v`

- [ ] **Step 6: Commit**

```bash
git add internal/modules/githubstats/
git commit -m "feat: github-stats module in Go (summary + heatmap)"
```

---

### Task 8: github-stats wiring + frontend move

**Files:**
- Modify: `internal/modules/all.go`, `main.go`
- Move: `frontend/legacy-modules/github-stats/` → `frontend/src/modules/github-stats/` (rewrite `manifest.ts`, `render.ts`; delete `fetch.ts`, `stats.ts`)
- Move: `frontend/legacy-modules/__tests__/{github-stats-summary-widget,github-stats-heatmap-widget}.test.tsx` → `frontend/tests/modules/`
- Delete: `frontend/legacy-modules/__tests__/{github-stats-fetch,github-stats-manifest,github-stats-normalize,github-stats-registration,github-stats-window}.test.ts`
- Modify: `frontend/src/modules/render.ts`, regenerate `frontend/src/widget-types.gen.json`

**Interfaces:**
- Consumes: `githubstats.New()` (Task 7).
- Produces: TS types `Timeframe`, `TrendPoint`, `StatsData`, `HeatmapDay`, `HeatmapWeek`, `HeatmapData`, `SummaryConfig`, `HeatmapConfig` in `@/modules/github-stats/manifest`.

- [ ] **Step 1: Register the Go module**

`internal/modules/all.go`: import `"pulse/internal/modules/githubstats"`, append `githubstats.New(),`.
`main.go`: same import; registry becomes:

```go
	registry, err := module.NewRegistry(
		system.New(), bookmarks.New(bmRepo), ccusage.New(), github.New(), githubstats.New(),
	)
```

Run: `go run ./cmd/gen-widget-types`

- [ ] **Step 2: Move files**

```bash
cd frontend
git mv legacy-modules/github-stats src/modules/github-stats
git mv legacy-modules/__tests__/github-stats-summary-widget.test.tsx tests/modules/
git mv legacy-modules/__tests__/github-stats-heatmap-widget.test.tsx tests/modules/
git rm legacy-modules/__tests__/github-stats-fetch.test.ts legacy-modules/__tests__/github-stats-manifest.test.ts \
  legacy-modules/__tests__/github-stats-normalize.test.ts legacy-modules/__tests__/github-stats-registration.test.ts \
  legacy-modules/__tests__/github-stats-window.test.ts
git rm src/modules/github-stats/fetch.ts src/modules/github-stats/stats.ts
```

- [ ] **Step 3: Rewrite `frontend/src/modules/github-stats/manifest.ts`**

```ts
export const SUMMARY_TYPE = "github-stats.summary";
export const HEATMAP_TYPE = "github-stats.heatmap";

export type Timeframe = "7d" | "30d" | "90d" | "year";

// Config shapes mirror the Go manifests (forms are generated server-side).
export interface SummaryConfig {
  timeframe: Timeframe;
}
export type HeatmapConfig = Record<string, never>;

// --- Data shapes (payloads produced by internal/modules/githubstats) ---
export type TrendPoint = { date: string; count: number };
export type StatsData = {
  commits: number;
  prs: number;
  reviews: number;
  issues: number;
  total: number;
  trend: TrendPoint[];
};

export type HeatmapDay = { date: string; count: number; level: 0 | 1 | 2 | 3 | 4 };
export type HeatmapWeek = { days: HeatmapDay[] };
export type HeatmapData = { total: number; weeks: HeatmapWeek[] };
```

- [ ] **Step 4: Rewrite `frontend/src/modules/github-stats/render.ts`**

```ts
import { SiGithub } from "react-icons/si";
import { registerRender } from "@/modules/render-registry";
import { SUMMARY_TYPE, HEATMAP_TYPE } from "./manifest";
import type { StatsData, HeatmapData } from "./manifest";
import { SummaryWidget } from "./widgets/summary-widget";
import { HeatmapWidget } from "./widgets/heatmap-widget";

registerRender<StatsData, unknown>(SUMMARY_TYPE, {
  Component: SummaryWidget,
  count: (d) => d.total,
  icon: { Icon: SiGithub, className: "text-[#181717] dark:text-white" },
});
registerRender<HeatmapData, unknown>(HEATMAP_TYPE, {
  Component: HeatmapWidget,
  count: (d) => d.total,
  icon: { Icon: SiGithub, className: "text-[#181717] dark:text-white" },
});
```

- [ ] **Step 5: Register render side + fix stale imports**

Add `import "./github-stats/render";` to `frontend/src/modules/render.ts`.

Run: `cd frontend && grep -rn "summaryManifest\|heatmapManifest\|summaryConfigSchema\|github-stats/stats" src tests`
Expected: no matches (widget tests import only types + components); fix any hits.

- [ ] **Step 6: Run everything**

Run: `go test ./internal/... ./cmd/... && cd frontend && npm test && npx tsc --noEmit && npm run lint`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: revive github-stats frontend on the Go module (2 widgets)"
```

---

### Task 9: jira Go module

**Files:**
- Create: `internal/modules/jira/jira.go` (runner + server-URL cache)
- Create: `internal/modules/jira/jql.go`
- Create: `internal/modules/jira/module.go`
- Create: `internal/modules/jira/jql_test.go`
- Create: `internal/modules/jira/jira_test.go`
- Move: `frontend/legacy-modules/fixtures/jira/jql.json` → `internal/modules/jira/testdata/jql.json`

**Interfaces:**
- Consumes: `cli.Run`, `cli.Error`, `module.DecodeConfig`.
- Produces: `jira.New() *Module`; `JqlType = "jira.jql"`; payload `JqlData{Issues []Issue "issues"}` with `Issue{Key,Summary,Status string; Assignee *string; URL string}` (JSON `key,summary,status,assignee,url`; assignee null when unassigned).

- [ ] **Step 1: Move the fixture**

```bash
mkdir -p internal/modules/jira/testdata
git mv frontend/legacy-modules/fixtures/jira/jql.json internal/modules/jira/testdata/jql.json
```

- [ ] **Step 2: Write the failing tests**

`internal/modules/jira/jql_test.go`:

```go
package jira

import (
	"context"
	"os"
	"testing"

	"pulse/internal/cli"
)

func TestStripTrailingOrderBy(t *testing.T) {
	cases := []struct{ name, in, want string }{
		{"plain", "project = X ORDER BY updated DESC", "project = X"},
		{"case-insensitive multiline", "project = X\norder by\ncreated", "project = X"},
		{"no clause untouched", "assignee = currentUser()", "assignee = currentUser()"},
		{"quoted literal survives", `summary ~ "sort order by date"`, `summary ~ "sort order by date"`},
		{"quoted then real clause", `summary ~ "order by x" ORDER BY updated`, `summary ~ "order by x"`},
		{"escaped quote in literal", `summary ~ "a \" order by b" ORDER BY updated`, `summary ~ "a \" order by b"`},
		{"single quotes", `summary ~ 'order by x' ORDER BY updated`, `summary ~ 'order by x'`},
		{"non-ascii before clause", `summary ~ "über" ORDER BY updated`, `summary ~ "über"`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := stripTrailingOrderBy(c.in); got != c.want {
				t.Errorf("got %q, want %q", got, c.want)
			}
		})
	}
}

func testModule(t *testing.T, stdout string, runErr error) *Module {
	t.Helper()
	return &Module{
		run:        func(ctx context.Context, args []string) (string, error) { return stdout, runErr },
		readConfig: func() ([]byte, error) { return []byte("server: https://x.atlassian.net/\n"), nil },
	}
}

func TestFetchJqlNormalizesIssues(t *testing.T) {
	fixture, err := os.ReadFile("testdata/jql.json")
	if err != nil {
		t.Fatal(err)
	}
	m := testModule(t, string(fixture), nil)
	got, err := m.fetchJql(context.Background(), jqlConfig{Jql: "project = X", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Issues) == 0 {
		t.Fatal("no issues parsed")
	}
	first := got.Issues[0]
	if first.Key == "" || first.URL != "https://x.atlassian.net/browse/"+first.Key {
		t.Errorf("normalize wrong: %+v", first)
	}
}

func TestFetchJqlNoResultFoundIsEmpty(t *testing.T) {
	m := testModule(t, "", &cli.Error{Kind: cli.KindFailed, Message: "✗ No result found for given query"})
	got, err := m.fetchJql(context.Background(), jqlConfig{Jql: "project = X", Limit: 10})
	if err != nil {
		t.Fatalf("want empty result, got err %v", err)
	}
	if got.Issues == nil || len(got.Issues) != 0 {
		t.Fatalf("want empty non-nil issues, got %#v", got.Issues)
	}
}

func TestFetchJqlAppendsRawAndPagination(t *testing.T) {
	var gotArgs []string
	m := &Module{
		run: func(ctx context.Context, args []string) (string, error) {
			gotArgs = args
			return "[]", nil
		},
		readConfig: func() ([]byte, error) { return []byte("server: https://x.atlassian.net"), nil },
	}
	if _, err := m.fetchJql(context.Background(), jqlConfig{Jql: "project = X", Limit: 25}); err != nil {
		t.Fatal(err)
	}
	want := []string{"issue", "list", "-q", "project = X", "--order-by", "updated", "--paginate", "0:25", "--raw"}
	if len(gotArgs) != len(want) {
		t.Fatalf("args = %v", gotArgs)
	}
	for i := range want {
		if gotArgs[i] != want[i] {
			t.Fatalf("args = %v, want %v", gotArgs, want)
		}
	}
}
```

`internal/modules/jira/jira_test.go`:

```go
package jira

import (
	"errors"
	"testing"
	"time"
)

func TestServerURLParsesAndCaches(t *testing.T) {
	reads := 0
	m := &Module{readConfig: func() ([]byte, error) {
		reads++
		return []byte("login: me@x.com\nserver: \"https://x.atlassian.net/\"\n"), nil
	}}
	got, err := m.serverURL()
	if err != nil {
		t.Fatal(err)
	}
	if got != "https://x.atlassian.net" {
		t.Errorf("serverURL = %q (quotes/trailing slash must be stripped)", got)
	}
	if _, err := m.serverURL(); err != nil {
		t.Fatal(err)
	}
	if reads != 1 {
		t.Errorf("config read %d times, want cached after first", reads)
	}
}

func TestServerURLTTLExpiry(t *testing.T) {
	reads := 0
	m := &Module{readConfig: func() ([]byte, error) {
		reads++
		return []byte("server: https://x.atlassian.net"), nil
	}}
	if _, err := m.serverURL(); err != nil {
		t.Fatal(err)
	}
	m.cachedAt = time.Now().Add(-6 * time.Minute)
	if _, err := m.serverURL(); err != nil {
		t.Fatal(err)
	}
	if reads != 2 {
		t.Errorf("expired cache should re-read, reads = %d", reads)
	}
}

func TestServerURLMissingKeyErrors(t *testing.T) {
	m := &Module{readConfig: func() ([]byte, error) { return []byte("login: me\n"), nil }}
	if _, err := m.serverURL(); err == nil {
		t.Fatal("want error when server: missing")
	}
}

func TestServerURLReadErrorPropagates(t *testing.T) {
	boom := errors.New("no config")
	m := &Module{readConfig: func() ([]byte, error) { return nil, boom }}
	if _, err := m.serverURL(); !errors.Is(err, boom) {
		t.Fatalf("want read error, got %v", err)
	}
}
```

- [ ] **Step 3: Run — expect FAIL**

Run: `go test ./internal/modules/jira/ -v`

- [ ] **Step 4: Implement `internal/modules/jira/jira.go`**

```go
// Package jira ports frontend/legacy-modules/jira: a single JQL-query widget
// via jira-cli (process-model CLI; auth classified by regex; browse URLs
// built from the server: key in jira-cli's own config file).
package jira

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"pulse/internal/cli"
)

var authPattern = regexp.MustCompile(`(?i)needs a Jira API token|unauthorized|401|invalid credentials`)

// runner is the injectable jira-cli seam: returns stdout.
type runner func(ctx context.Context, args []string) (string, error)

func runJira(ctx context.Context, args []string) (string, error) {
	stdout, _, err := cli.Run(ctx, "jira", args, cli.Options{
		NotAuthPattern: authPattern,
		NotAuthMessage: "Not authenticated — run `jira init`",
	})
	return stdout, err
}

func jiraJSON[T any](ctx context.Context, run runner, args []string) (T, error) {
	var out T
	stdout, err := run(ctx, append(args, "--raw"))
	if err != nil {
		return out, err
	}
	if err := json.Unmarshal([]byte(stdout), &out); err != nil {
		return out, &cli.Error{Kind: cli.KindFailed, Message: "jira returned unexpected output"}
	}
	return out, nil
}

type Module struct {
	run        runner
	readConfig func() ([]byte, error)

	mu           sync.Mutex
	cachedServer string
	cachedAt     time.Time
}

func New() *Module { return &Module{run: runJira, readConfig: readJiraConfig} }

func readJiraConfig() ([]byte, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	return os.ReadFile(filepath.Join(home, ".config", ".jira", ".config.yml"))
}

const serverTTL = 5 * time.Minute

var serverRe = regexp.MustCompile(`(?m)^server:\s*(\S+)`)

// serverURL is the Jira base URL from jira-cli's config (`server:`). Cached
// with a TTL rather than for the process lifetime: a `jira init` to a
// different server self-heals within minutes instead of requiring a restart.
func (m *Module) serverURL() (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cachedServer != "" && time.Since(m.cachedAt) < serverTTL {
		return m.cachedServer, nil
	}
	text, err := m.readConfig()
	if err != nil {
		return "", err
	}
	match := serverRe.FindSubmatch(text)
	if match == nil {
		return "", errors.New("could not find `server:` in jira-cli config — run `jira init`")
	}
	server := strings.TrimSuffix(strings.Trim(string(match[1]), `"'`), "/")
	m.cachedServer = server
	m.cachedAt = time.Now()
	return server, nil
}
```

- [ ] **Step 5: Implement `internal/modules/jira/jql.go`**

Careful with the ORDER BY stripper: the mask must preserve **rune** indices (quoted runes may be multibyte, the NUL sentinel is 1 byte), so convert the regex's byte index on the masked string back to a rune index before cutting the original.

```go
package jira

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"

	"pulse/internal/cli"
)

// Issue mirrors the TS JiraIssue payload shape.
type Issue struct {
	Key      string  `json:"key"`
	Summary  string  `json:"summary"`
	Status   string  `json:"status"`
	Assignee *string `json:"assignee"` // null when unassigned
	URL      string  `json:"url"`      // <server>/browse/<KEY>
}

type JqlData struct {
	Issues []Issue `json:"issues"`
}

type jqlConfig struct {
	Jql   string `json:"jql"`
	Limit int    `json:"limit"`
}

type rawIssue struct {
	Key    string `json:"key"`
	Fields struct {
		Summary string `json:"summary"`
		Status  *struct {
			Name string `json:"name"`
		} `json:"status"`
		Assignee *struct {
			DisplayName string `json:"displayName"`
		} `json:"assignee"`
	} `json:"fields"`
}

var orderByRe = regexp.MustCompile(`(?is)\s+order\s+by\s+.+$`)

// stripTrailingOrderBy strips a trailing ORDER BY clause — jira-cli appends
// its own, so a trailing one in the user's JQL is a syntax error. Quoted
// string literals are blanked to a non-whitespace NUL sentinel (preserving
// rune indices, and non-whitespace so the clause's leading \s+ can't span a
// blanked literal) before locating the clause; the original is cut at the
// found index.
func stripTrailingOrderBy(jql string) string {
	runes := []rune(jql)
	masked := make([]rune, 0, len(runes))
	var quote rune
	for i := 0; i < len(runes); i++ {
		ch := runes[i]
		switch {
		case quote != 0:
			if ch == '\\' && i+1 < len(runes) {
				masked = append(masked, 0, 0) // blank the backslash and the escaped char
				i++
				continue
			}
			masked = append(masked, 0)
			if ch == quote {
				quote = 0
			}
		case ch == '"' || ch == '\'':
			masked = append(masked, 0)
			quote = ch
		default:
			masked = append(masked, ch)
		}
	}
	maskedStr := string(masked)
	loc := orderByRe.FindStringIndex(maskedStr)
	if loc == nil {
		return strings.TrimSpace(jql)
	}
	runeIdx := utf8.RuneCountInString(maskedStr[:loc[0]])
	return strings.TrimSpace(string(runes[:runeIdx]))
}

func normalizeIssue(raw rawIssue, serverURL string) Issue {
	issue := Issue{
		Key: raw.Key, Summary: raw.Fields.Summary, Status: "Unknown",
		URL: serverURL + "/browse/" + raw.Key,
	}
	if raw.Fields.Status != nil && raw.Fields.Status.Name != "" {
		issue.Status = raw.Fields.Status.Name
	}
	if raw.Fields.Assignee != nil {
		if name := strings.TrimSpace(raw.Fields.Assignee.DisplayName); name != "" {
			issue.Assignee = &name
		}
	}
	return issue
}

var noResultRe = regexp.MustCompile(`(?i)no result found`)

func (m *Module) fetchJql(ctx context.Context, cfg jqlConfig) (JqlData, error) {
	jql := stripTrailingOrderBy(cfg.Jql)
	raw, err := jiraJSON[[]rawIssue](ctx, m.run, []string{
		"issue", "list", "-q", jql, "--order-by", "updated", "--paginate", fmt.Sprintf("0:%d", cfg.Limit),
	})
	if err != nil {
		// jira-cli exits non-zero with this message when a query matches nothing.
		var ce *cli.Error
		if errors.As(err, &ce) && noResultRe.MatchString(ce.Message) {
			return JqlData{Issues: []Issue{}}, nil
		}
		return JqlData{}, err
	}
	server, err := m.serverURL()
	if err != nil {
		return JqlData{}, err
	}
	issues := make([]Issue, 0, len(raw))
	for _, r := range raw {
		issues = append(issues, normalizeIssue(r, server))
	}
	return JqlData{Issues: issues}, nil
}
```

- [ ] **Step 6: Implement `internal/modules/jira/module.go`**

```go
package jira

import (
	"context"
	"fmt"

	"pulse/internal/module"
)

const JqlType = "jira.jql"

func f64(v float64) *float64 { return &v }

// Pointer receiver required: Module embeds a sync.Mutex, so a value receiver
// would copy the lock (go vet copylocks).
func (m *Module) Manifests() []module.Manifest {
	return []module.Manifest{{
		Type: JqlType, Title: "Jira Query", Refreshable: true, Integration: "jira",
		ConfigFields: []module.ConfigField{
			{Key: "jql", Label: "JQL", Kind: module.FieldString,
				Default: "assignee = currentUser() AND resolution = EMPTY"},
			{Key: "limit", Label: "Max issues", Kind: module.FieldNumber, Default: 10.0, Min: f64(1), Max: f64(100)},
		},
	}}
}

func (m *Module) Fetch(ctx context.Context, widgetType string, config map[string]any) (any, error) {
	if widgetType != JqlType {
		return nil, fmt.Errorf("jira: unknown widget type %s", widgetType)
	}
	cfg, err := module.DecodeConfig[jqlConfig](config)
	if err != nil {
		return nil, err
	}
	return m.fetchJql(ctx, cfg)
}
```

- [ ] **Step 7: Run — expect PASS**

Run: `go test -race ./internal/modules/jira/ -v`

- [ ] **Step 8: Commit**

```bash
git add internal/modules/jira/ frontend/legacy-modules/fixtures
git commit -m "feat: jira module in Go (jql fetch, order-by strip, server-url cache)"
```

---

### Task 10: jira wiring + frontend move

**Files:**
- Modify: `internal/modules/all.go`, `main.go`
- Move: `frontend/legacy-modules/jira/` → `frontend/src/modules/jira/` (rewrite `manifest.ts`, `render.ts`; delete `fetch.ts`, `integration.ts`, `jira.ts`, `jql.ts`)
- Move: `frontend/legacy-modules/__tests__/jira-widget.test.tsx` → `frontend/tests/modules/jira-widget.test.tsx`
- Delete: `frontend/legacy-modules/__tests__/{jira-jql,jira-server-url,jira-auth-pattern,jira-registration}.test.ts`
- Modify: `frontend/src/modules/render.ts`, regenerate `frontend/src/widget-types.gen.json`

**Interfaces:**
- Consumes: `jira.New()` (Task 9).
- Produces: TS types `JiraIssue`, `JqlData`, `JqlConfig` in `@/modules/jira/manifest`.

- [ ] **Step 1: Register the Go module**

`internal/modules/all.go`: import `"pulse/internal/modules/jira"`, append `jira.New(),`.
`main.go`: same import; registry becomes:

```go
	registry, err := module.NewRegistry(
		system.New(), bookmarks.New(bmRepo), ccusage.New(), github.New(), githubstats.New(), jira.New(),
	)
```

Run: `go run ./cmd/gen-widget-types`

- [ ] **Step 2: Move files**

```bash
cd frontend
git mv legacy-modules/jira src/modules/jira
git mv legacy-modules/__tests__/jira-widget.test.tsx tests/modules/jira-widget.test.tsx
git rm legacy-modules/__tests__/jira-jql.test.ts legacy-modules/__tests__/jira-server-url.test.ts \
  legacy-modules/__tests__/jira-auth-pattern.test.ts legacy-modules/__tests__/jira-registration.test.ts
git rm src/modules/jira/fetch.ts src/modules/jira/integration.ts src/modules/jira/jira.ts src/modules/jira/jql.ts
```

- [ ] **Step 3: Rewrite `frontend/src/modules/jira/manifest.ts`**

```ts
export const JQL_TYPE = "jira.jql";

// Config shape mirrors the Go manifest (form is generated server-side).
export interface JqlConfig {
  jql: string;
  limit: number;
}

export type JiraIssue = {
  key: string;              // e.g. "CORE-123"
  summary: string;
  status: string;           // status display name
  assignee: string | null;  // displayName, null if unassigned
  url: string;              // <server>/browse/<KEY>
};
export type JqlData = { issues: JiraIssue[] };
```

- [ ] **Step 4: Rewrite `frontend/src/modules/jira/render.ts`**

```ts
import { SiJira } from "react-icons/si";
import { registerRender } from "@/modules/render-registry";
import { JQL_TYPE } from "./manifest";
import type { JqlData } from "./manifest";
import { JqlWidget } from "./widgets/jql-widget";

registerRender<JqlData, unknown>(JQL_TYPE, {
  Component: JqlWidget,
  count: (d) => d.issues.length,
  icon: { Icon: SiJira, className: "text-[#0052CC]" },
});
```

- [ ] **Step 5: Register render side + fix stale imports**

Add `import "./jira/render";` to `frontend/src/modules/render.ts`.

Run: `cd frontend && grep -rn "jqlManifest\|jqlConfigSchema\|@/modules/jira/jql\|@/modules/jira/jira" src tests`
Expected: no matches; fix any hits.

- [ ] **Step 6: Run everything**

Run: `go test ./internal/... ./cmd/... && cd frontend && npm test && npx tsc --noEmit && npm run lint`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: revive jira frontend on the Go module"
```

---

### Task 11: gws Go — runner + gmail + calendar

**Files:**
- Create: `internal/modules/gws/gws.go` (runner seam + params helper)
- Create: `internal/modules/gws/gmail.go`
- Create: `internal/modules/gws/calendar.go`
- Create: `internal/modules/gws/gmail_test.go`
- Create: `internal/modules/gws/calendar_test.go`

**Interfaces:**
- Consumes: `cli.RunJSONInto`, `cli.APIError`, `cli.Options`.
- Produces: `jsonRunner` type + `runGwsJSON` (payload-model CLI: errors inside the JSON body, 401/403 → auth) + `jsonArg`; `fetchGmail`, `fetchCalendar`, `fetchNextMeeting`, `listEvents`; payload types `EmailItem`, `GmailData`, `CalendarEventItem`, `CalendarData`, `MeetingItem`, `NextMeetingData`; raw type `gEvent` + `isMeetingEvent` (Task 12/13 reuse the runner; Task 13's module dispatches to these).

- [ ] **Step 1: Write the failing tests**

`internal/modules/gws/gmail_test.go`:

```go
package gws

import (
	"context"
	"encoding/json"
	"testing"

	"pulse/internal/cli"
)

// fakeRun decodes canned JSON into out, routed by a key derived from args.
// Route key: first three args joined ("gmail users messages" list vs get is
// disambiguated by the 4th arg).
func fakeRun(t *testing.T, responses map[string]string) jsonRunner {
	t.Helper()
	return func(ctx context.Context, args []string, out any) error {
		key := args[0] + " " + args[1] + " " + args[2] + " " + args[3]
		resp, ok := responses[key]
		if !ok {
			t.Fatalf("unexpected gws args: %v", args)
		}
		return json.Unmarshal([]byte(resp), out)
	}
}

const gmailList = `{"messages":[{"id":"m1","threadId":"t1"},{"id":"m2","threadId":"t2"}]}`
const gmailMsg1 = `{"id":"m1","labelIds":["UNREAD","INBOX"],"internalDate":"1753113600000",
  "payload":{"headers":[{"name":"Subject","value":"Hello"},{"name":"From","value":"\"Jane Doe\" <jane@x.com>"}]}}`

func TestParseFrom(t *testing.T) {
	cases := []struct{ in, want string }{
		{`"Jane Doe" <jane@x.com>`, "Jane Doe"},
		{`Jane Doe <jane@x.com>`, "Jane Doe"},
		{`jane@x.com`, "jane@x.com"},
		{`<jane@x.com>`, "<jane@x.com>"},
	}
	for _, c := range cases {
		if got := parseFrom(c.in); got != c.want {
			t.Errorf("parseFrom(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestFetchGmailEnrichesEachMessage(t *testing.T) {
	run := fakeRun(t, map[string]string{
		"gmail users messages list": gmailList,
		"gmail users messages get":  gmailMsg1,
	})
	got, err := fetchGmail(context.Background(), run, gmailConfig{Query: "is:unread", Limit: 15})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Emails) != 2 {
		t.Fatalf("want 2 emails, got %d", len(got.Emails))
	}
	e := got.Emails[0]
	if e.Subject != "Hello" || e.From != "Jane Doe" || !e.Unread {
		t.Errorf("normalize wrong: %+v", e)
	}
	if e.URL != "https://mail.google.com/mail/u/0/#all/m1" {
		t.Errorf("url = %q (must use #all/, not #inbox/)", e.URL)
	}
	if e.Date == "" {
		t.Error("internalDate ms must convert to an ISO date")
	}
}

func TestFetchGmailPartialFailureListsIDs(t *testing.T) {
	calls := 0
	run := func(ctx context.Context, args []string, out any) error {
		if args[3] == "list" {
			return json.Unmarshal([]byte(gmailList), out)
		}
		calls++
		if calls == 1 {
			return &cli.Error{Kind: cli.KindFailed, Message: "boom"}
		}
		return json.Unmarshal([]byte(gmailMsg1), out)
	}
	got, err := fetchGmail(context.Background(), run, gmailConfig{Query: "q", Limit: 15})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Emails) != 1 || len(got.Errors) != 1 {
		t.Fatalf("want 1 email + 1 error, got %d/%d", len(got.Emails), len(got.Errors))
	}
}

func TestFetchGmailEmptyListYieldsEmptyNonNil(t *testing.T) {
	run := fakeRun(t, map[string]string{"gmail users messages list": `{}`})
	got, err := fetchGmail(context.Background(), run, gmailConfig{Query: "q", Limit: 15})
	if err != nil {
		t.Fatal(err)
	}
	if got.Emails == nil || len(got.Emails) != 0 {
		t.Fatalf("want empty non-nil emails, got %#v", got.Emails)
	}
}
```

`internal/modules/gws/calendar_test.go`:

```go
package gws

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

const eventsResp = `{"items":[
  {"id":"e1","status":"confirmed","summary":"Standup","htmlLink":"https://cal/e1",
   "hangoutLink":"https://meet/x",
   "start":{"dateTime":"2026-07-22T09:00:00+02:00"},"end":{"dateTime":"2026-07-22T09:15:00+02:00"},
   "attendees":[{"self":true,"responseStatus":"accepted"},{"responseStatus":"accepted"}]},
  {"id":"e2","status":"cancelled","summary":"Gone","start":{"dateTime":"2026-07-22T10:00:00+02:00"},
   "end":{"dateTime":"2026-07-22T11:00:00+02:00"}},
  {"id":"e3","summary":"Holiday","htmlLink":"https://cal/e3",
   "start":{"date":"2026-07-22"},"end":{"date":"2026-07-23"}}
]}`

func TestFetchCalendarFiltersCancelledAndFlagsAllDay(t *testing.T) {
	run := func(ctx context.Context, args []string, out any) error {
		return json.Unmarshal([]byte(eventsResp), out)
	}
	got, err := fetchCalendar(context.Background(), run, calendarConfig{CalendarID: "primary", Limit: 15})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Events) != 2 {
		t.Fatalf("cancelled event must drop; got %d events", len(got.Events))
	}
	if got.Events[0].AllDay || !got.Events[1].AllDay {
		t.Errorf("allDay flags wrong: %+v", got.Events)
	}
	if got.Events[0].MeetURL != "https://meet/x" {
		t.Errorf("meetUrl missing: %+v", got.Events[0])
	}
}

func TestIsMeetingEvent(t *testing.T) {
	timed := func() gEvent {
		var e gEvent
		e.Start = &gTime{DateTime: "2026-07-22T09:00:00Z"}
		e.End = &gTime{DateTime: "2026-07-22T10:00:00Z"}
		return e
	}
	allDay := timed()
	allDay.Start = &gTime{Date: "2026-07-22"}
	if isMeetingEvent(allDay, true) {
		t.Error("all-day events are never meetings")
	}

	declined := timed()
	declined.Attendees = []gAttendee{{Self: true, ResponseStatus: "declined"}}
	if isMeetingEvent(declined, true) {
		t.Error("declined events are not meetings")
	}

	solo := timed()
	if isMeetingEvent(solo, false) {
		t.Error("solo event without meet link excluded by default")
	}
	if !isMeetingEvent(solo, true) {
		t.Error("includeSoloEvents keeps solo events")
	}

	soloWithMeet := timed()
	soloWithMeet.HangoutLink = "https://meet/x"
	if !isMeetingEvent(soloWithMeet, false) {
		t.Error("a meet link makes a solo event a meeting")
	}
}

func TestFetchNextMeetingPagesAndFilters(t *testing.T) {
	pages := 0
	run := func(ctx context.Context, args []string, out any) error {
		pages++
		if pages == 1 {
			// params JSON is one arg; assert pageToken only appears on page 2+.
			if strings.Contains(args[len(args)-1], "pageToken") {
				t.Error("first page must not carry a pageToken")
			}
			return json.Unmarshal([]byte(`{"items":[],"nextPageToken":"p2"}`), out)
		}
		if !strings.Contains(args[len(args)-1], `"pageToken":"p2"`) {
			t.Error("second page must carry the token")
		}
		return json.Unmarshal([]byte(eventsResp), out)
	}
	got, err := fetchNextMeeting(context.Background(), run, nextMeetingConfig{CalendarID: "primary"})
	if err != nil {
		t.Fatal(err)
	}
	if pages != 2 {
		t.Fatalf("want 2 pages, got %d", pages)
	}
	// e1 is a real meeting; e2 cancelled; e3 all-day.
	if len(got.Meetings) != 1 || got.Meetings[0].ID != "e1" {
		t.Fatalf("meetings = %+v", got.Meetings)
	}
}

func TestDayWindowIsLocalMidnightToMidnight(t *testing.T) {
	now := time.Date(2026, 7, 22, 15, 30, 0, 0, time.Local)
	minStr, maxStr := dayWindow(now)
	min, err := time.Parse(time.RFC3339, minStr)
	if err != nil {
		t.Fatal(err)
	}
	max, err := time.Parse(time.RFC3339, maxStr)
	if err != nil {
		t.Fatal(err)
	}
	if max.Sub(min) != 24*time.Hour { // fixed non-DST date, so exactly 24h
		t.Errorf("window = %v..%v, want 24h", min, max)
	}
	local := min.In(time.Local)
	if local.Hour() != 0 || local.Minute() != 0 {
		t.Errorf("window start %v is not local midnight", local)
	}
}
```

- [ ] **Step 2: Run — expect FAIL**

Run: `go test ./internal/modules/gws/ -v`

- [ ] **Step 3: Implement `internal/modules/gws/gws.go`**

```go
// Package gws ports frontend/legacy-modules/gws: Gmail, Calendar, Chat,
// Drive, Tasks and Next-meeting widgets via the gws CLI. gws is a
// payload-model CLI: it prints Google API errors as {"error":{code,message}}
// on stdout, sometimes with exit 0 — the body is authoritative, not the exit
// status (cli.RunJSONInto handles the mapping; 401/403 → auth).
package gws

import (
	"context"
	"encoding/json"

	"pulse/internal/cli"
)

// jsonRunner is the injectable gws seam: runs a gws command and decodes its
// JSON body into out.
type jsonRunner func(ctx context.Context, args []string, out any) error

func extractGwsError(body map[string]any) *cli.APIError {
	e, ok := body["error"].(map[string]any)
	if !ok {
		return nil
	}
	apiErr := &cli.APIError{}
	if c, ok := e["code"].(float64); ok {
		apiErr.Code = int(c)
	}
	if m, ok := e["message"].(string); ok {
		apiErr.Message = m
	}
	return apiErr
}

func runGwsJSON(ctx context.Context, args []string, out any) error {
	return cli.RunJSONInto(ctx, "gws", args, extractGwsError, cli.Options{
		NotAuthMessage: "Not authenticated — run `gws auth login`",
	}, out)
}

// jsonArg marshals a --params/--json argument value (matches the TS
// JSON.stringify call sites).
func jsonArg(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}
```

- [ ] **Step 4: Implement `internal/modules/gws/gmail.go`**

```go
package gws

import (
	"context"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

// EmailItem mirrors the TS EmailItem payload shape.
type EmailItem struct {
	ID      string `json:"id"`
	Subject string `json:"subject"`
	From    string `json:"from"`
	Date    string `json:"date"` // ISO timestamp ("" if unknown)
	Unread  bool   `json:"unread"`
	URL     string `json:"url"` // Gmail deep link
}

// GmailData.Errors: ids of messages whose per-item fetch failed.
type GmailData struct {
	Emails []EmailItem `json:"emails"`
	Errors []string    `json:"errors,omitempty"`
}

type gmailConfig struct {
	Query string `json:"query"`
	Limit int    `json:"limit"`
}

type gmailHeader struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}
type gmailMsg struct {
	ID           string   `json:"id"`
	LabelIDs     []string `json:"labelIds"`
	InternalDate string   `json:"internalDate"` // epoch millis, as a string
	Payload      *struct {
		Headers []gmailHeader `json:"headers"`
	} `json:"payload"`
}

func header(msg gmailMsg, name string) string {
	if msg.Payload == nil {
		return ""
	}
	for _, h := range msg.Payload.Headers {
		if strings.EqualFold(h.Name, name) {
			return h.Value
		}
	}
	return ""
}

var fromRe = regexp.MustCompile(`^\s*"?([^"<]*?)"?\s*<[^>]+>\s*$`)

// parseFrom: `"Jane Doe" <jane@x.com>` → "Jane Doe"; a bare address stays as-is.
func parseFrom(raw string) string {
	if m := fromRe.FindStringSubmatch(raw); m != nil {
		if name := strings.TrimSpace(m[1]); name != "" {
			return name
		}
	}
	return strings.TrimSpace(raw)
}

func normalizeMessage(msg gmailMsg) EmailItem {
	date := ""
	if msg.InternalDate != "" {
		if ms, err := strconv.ParseInt(msg.InternalDate, 10, 64); err == nil {
			date = time.UnixMilli(ms).UTC().Format("2006-01-02T15:04:05.000Z")
		}
	}
	subject := header(msg, "Subject")
	if subject == "" {
		subject = "(no subject)"
	}
	return EmailItem{
		ID:      msg.ID,
		Subject: subject,
		From:    parseFrom(header(msg, "From")),
		Date:    date,
		Unread:  slices.Contains(msg.LabelIDs, "UNREAD"),
		// `#all/` opens the message regardless of which folder/label it lives
		// in; `#inbox/` 404s for queries that surface mail outside the inbox.
		URL: "https://mail.google.com/mail/u/0/#all/" + msg.ID,
	}
}

func fetchGmail(ctx context.Context, run jsonRunner, cfg gmailConfig) (GmailData, error) {
	var list struct {
		Messages []struct {
			ID string `json:"id"`
		} `json:"messages"`
	}
	if err := run(ctx, []string{
		"gmail", "users", "messages", "list",
		"--params", jsonArg(map[string]any{"userId": "me", "q": cfg.Query, "maxResults": cfg.Limit}),
	}, &list); err != nil {
		return GmailData{}, err
	}

	// list returns IDs only — fetch each message's headers concurrently.
	// `format=metadata` returns all headers; the `metadataHeaders` filter is
	// intentionally omitted (gws drops the headers entirely when it's passed).
	// One failure shouldn't sink the whole widget.
	msgs := make([]gmailMsg, len(list.Messages))
	errs := make([]error, len(list.Messages))
	var wg sync.WaitGroup
	for i, m := range list.Messages {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs[i] = run(ctx, []string{
				"gmail", "users", "messages", "get",
				"--params", jsonArg(map[string]any{"userId": "me", "id": m.ID, "format": "metadata"}),
			}, &msgs[i])
		}()
	}
	wg.Wait()

	emails := []EmailItem{}
	failedIDs := []string{}
	for i, m := range list.Messages {
		if errs[i] != nil {
			failedIDs = append(failedIDs, m.ID)
			continue
		}
		emails = append(emails, normalizeMessage(msgs[i]))
	}
	if len(failedIDs) > 0 {
		return GmailData{Emails: emails, Errors: failedIDs}, nil
	}
	return GmailData{Emails: emails}, nil
}
```

- [ ] **Step 5: Implement `internal/modules/gws/calendar.go`**

```go
package gws

import (
	"context"
	"time"
)

type gTime struct {
	DateTime string `json:"dateTime"`
	Date     string `json:"date"`
}
type gAttendee struct {
	Self           bool   `json:"self"`
	ResponseStatus string `json:"responseStatus"`
}
type gEvent struct {
	ID          string      `json:"id"`
	Status      string      `json:"status"`
	Summary     string      `json:"summary"`
	HTMLLink    string      `json:"htmlLink"`
	Location    string      `json:"location"`
	HangoutLink string      `json:"hangoutLink"`
	Start       *gTime      `json:"start"`
	End         *gTime      `json:"end"`
	Attendees   []gAttendee `json:"attendees"`
}
type eventsResp struct {
	Items         []gEvent `json:"items"`
	NextPageToken string   `json:"nextPageToken"`
}

// CalendarEventItem mirrors the TS CalendarEventItem payload shape.
type CalendarEventItem struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Start    string `json:"start"` // ISO datetime, or YYYY-MM-DD for all-day
	End      string `json:"end"`
	AllDay   bool   `json:"allDay"`
	Location string `json:"location,omitempty"`
	MeetURL  string `json:"meetUrl,omitempty"`
	URL      string `json:"url"` // htmlLink
}
type CalendarData struct {
	Events []CalendarEventItem `json:"events"`
}

// MeetingItem mirrors the TS MeetingItem payload shape (timed events only).
type MeetingItem struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Start   string `json:"start"`
	End     string `json:"end"`
	MeetURL string `json:"meetUrl,omitempty"`
	URL     string `json:"url"`
}

// NextMeetingData: all in-progress or not-yet-started qualifying meetings
// today, sorted by start (API order).
type NextMeetingData struct {
	Meetings []MeetingItem `json:"meetings"`
}

type calendarConfig struct {
	CalendarID string `json:"calendarId"`
	Limit      int    `json:"limit"`
}
type nextMeetingConfig struct {
	CalendarID        string `json:"calendarId"`
	IncludeSoloEvents bool   `json:"includeSoloEvents"`
}

func startStr(t *gTime) string {
	if t == nil {
		return ""
	}
	if t.DateTime != "" {
		return t.DateTime
	}
	return t.Date
}

func normalizeEvent(e gEvent) CalendarEventItem {
	title := e.Summary
	if title == "" {
		title = "(no title)"
	}
	return CalendarEventItem{
		ID: e.ID, Title: title,
		Start:  startStr(e.Start),
		End:    startStr(e.End),
		AllDay: e.Start == nil || e.Start.DateTime == "", // all-day events carry `date`, not `dateTime`
		Location: e.Location, MeetURL: e.HangoutLink, URL: e.HTMLLink,
	}
}

// dayWindow: [local midnight, next local midnight) as absolute RFC3339 instants.
func dayWindow(now time.Time) (timeMin, timeMax string) {
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	end := start.AddDate(0, 0, 1)
	return start.UTC().Format(time.RFC3339), end.UTC().Format(time.RFC3339)
}

func fetchCalendar(ctx context.Context, run jsonRunner, cfg calendarConfig) (CalendarData, error) {
	timeMin, timeMax := dayWindow(time.Now())
	var resp eventsResp
	if err := run(ctx, []string{
		"calendar", "events", "list",
		"--params", jsonArg(map[string]any{
			"calendarId":   cfg.CalendarID,
			"timeMin":      timeMin,
			"timeMax":      timeMax,
			"singleEvents": true, // expand recurring events into instances
			"orderBy":      "startTime",
			"maxResults":   cfg.Limit,
		}),
	}, &resp); err != nil {
		return CalendarData{}, err
	}
	events := []CalendarEventItem{}
	for _, e := range resp.Items {
		if e.Status == "cancelled" {
			continue
		}
		events = append(events, normalizeEvent(e))
	}
	return CalendarData{Events: events}, nil
}

// listEvents pages through Calendar events for a window. `maxResults` caps
// *raw* events per page (all-day, declined, and solo events all count), so on
// a busy day the real next meeting can sit past the first page — follow
// nextPageToken, bounded against a misbehaving token.
func listEvents(ctx context.Context, run jsonRunner, params map[string]any) ([]gEvent, error) {
	items := []gEvent{}
	pageToken := ""
	for page := 0; page < 20; page++ {
		p := map[string]any{}
		for k, v := range params {
			p[k] = v
		}
		if pageToken != "" {
			p["pageToken"] = pageToken
		}
		var resp eventsResp
		if err := run(ctx, []string{"calendar", "events", "list", "--params", jsonArg(p)}, &resp); err != nil {
			return nil, err
		}
		items = append(items, resp.Items...)
		if resp.NextPageToken == "" {
			break
		}
		pageToken = resp.NextPageToken
	}
	return items, nil
}

// isMeetingEvent: a "real meeting" is timed, not cancelled, not declined by
// me, and not a solo event (no other attendees and no Meet link) unless
// includeSoloEvents.
func isMeetingEvent(e gEvent, includeSoloEvents bool) bool {
	if e.Status == "cancelled" {
		return false
	}
	if e.Start == nil || e.Start.DateTime == "" {
		return false // all-day events carry `date`, not `dateTime`
	}
	for _, a := range e.Attendees {
		if a.Self && a.ResponseStatus == "declined" {
			return false
		}
	}
	if !includeSoloEvents {
		others := 0
		for _, a := range e.Attendees {
			if !a.Self {
				others++
			}
		}
		if others == 0 && e.HangoutLink == "" {
			return false
		}
	}
	return true
}

func normalizeMeeting(e gEvent) MeetingItem {
	title := e.Summary
	if title == "" {
		title = "(no title)"
	}
	start, end := "", ""
	if e.Start != nil {
		start = e.Start.DateTime
	}
	if e.End != nil {
		end = e.End.DateTime
	}
	return MeetingItem{ID: e.ID, Title: title, Start: start, End: end, MeetURL: e.HangoutLink, URL: e.HTMLLink}
}

func fetchNextMeeting(ctx context.Context, run jsonRunner, cfg nextMeetingConfig) (NextMeetingData, error) {
	now := time.Now()
	_, timeMax := dayWindow(now)
	events, err := listEvents(ctx, run, map[string]any{
		"calendarId":   cfg.CalendarID,
		"timeMin":      now.UTC().Format(time.RFC3339), // in-progress events end after now, so they're included
		"timeMax":      timeMax,
		"singleEvents": true,
		"orderBy":      "startTime",
		"maxResults":   250,
	})
	if err != nil {
		return NextMeetingData{}, err
	}
	meetings := []MeetingItem{}
	for _, e := range events {
		if isMeetingEvent(e, cfg.IncludeSoloEvents) {
			meetings = append(meetings, normalizeMeeting(e))
		}
	}
	return NextMeetingData{Meetings: meetings}, nil
}
```

- [ ] **Step 6: Run — expect PASS**

Run: `go test -race ./internal/modules/gws/ -v`

- [ ] **Step 7: Commit**

```bash
git add internal/modules/gws/
git commit -m "feat: gws module in Go — runner, gmail, calendar/next-meeting"
```

---

### Task 12: gws Go — chat + drive + tasks

**Files:**
- Create: `internal/modules/gws/chat.go`
- Create: `internal/modules/gws/drive.go`
- Create: `internal/modules/gws/tasks.go`
- Create: `internal/modules/gws/chat_test.go`
- Create: `internal/modules/gws/drive_test.go`
- Create: `internal/modules/gws/tasks_test.go`
- Move: `frontend/legacy-modules/fixtures/gws/chat/` → `internal/modules/gws/testdata/chat/`

**Interfaces:**
- Consumes: `jsonRunner`, `jsonArg` (Task 11).
- Produces: `fetchChatDms`, `fetchChatChannels`, `fetchDrive`, `fetchTasks`, `setTaskCompleted`; payload types `ChatDm`, `ChatDmsData`, `ChatChannel`, `ChatChannelsData`, `DriveFileItem`, `DriveData`, `TaskItem`, `TasksData`.

- [ ] **Step 1: Move fixtures**

```bash
mkdir -p internal/modules/gws/testdata
git mv frontend/legacy-modules/fixtures/gws/chat internal/modules/gws/testdata/chat
```

- [ ] **Step 2: Write the failing tests**

`internal/modules/gws/chat_test.go` (route by argv like the TS tests did; fixtures: `dm-spaces.json`, `space-read-state.json`, `messages-latest.json`, `people-get.json`, `space-get.json`):

```go
package gws

import (
	"context"
	"encoding/json"
	"os"
	"testing"
)

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile("testdata/chat/" + name)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestIsUnread(t *testing.T) {
	cases := []struct {
		name, active, read string
		want               bool
	}{
		{"no messages yet", "", "2026-07-20T10:00:00Z", false},
		{"never read", "2026-07-20T10:00:00Z", "", true},
		{"newer message", "2026-07-20T10:00:00Z", "2026-07-19T10:00:00Z", true},
		{"already read", "2026-07-19T10:00:00Z", "2026-07-20T10:00:00Z", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := isUnread(c.active, c.read); got != c.want {
				t.Errorf("isUnread(%q,%q) = %v, want %v", c.active, c.read, got, c.want)
			}
		})
	}
}

func TestCallerUserIDAndPeopleResource(t *testing.T) {
	if got := callerUserID("users/12345/spaces/AAAA/spaceReadState"); got != "users/12345" {
		t.Errorf("callerUserID = %q", got)
	}
	if got := callerUserID("bogus"); got != "" {
		t.Errorf("callerUserID(bogus) = %q, want empty", got)
	}
	if got := peopleResourceName("users/12345"); got != "people/12345" {
		t.Errorf("peopleResourceName = %q", got)
	}
	if got := peopleResourceName(""); got != "" {
		t.Errorf("peopleResourceName(empty) = %q, want empty", got)
	}
}

// chatRunner serves the fixture set: spaces list → dm-spaces, read state →
// space-read-state, messages list → messages-latest, people batch → people-get.
func chatRunner(t *testing.T) jsonRunner {
	t.Helper()
	return func(ctx context.Context, args []string, out any) error {
		switch {
		case args[0] == "chat" && args[1] == "spaces" && args[2] == "list":
			return json.Unmarshal(fixture(t, "dm-spaces.json"), out)
		case args[0] == "chat" && args[1] == "users":
			return json.Unmarshal(fixture(t, "space-read-state.json"), out)
		case args[0] == "chat" && args[1] == "spaces" && args[2] == "messages":
			return json.Unmarshal(fixture(t, "messages-latest.json"), out)
		case args[0] == "chat" && args[1] == "spaces" && args[2] == "get":
			return json.Unmarshal(fixture(t, "space-get.json"), out)
		case args[0] == "people":
			return json.Unmarshal(fixture(t, "people-get.json"), out)
		}
		t.Fatalf("unexpected gws args: %v", args)
		return nil
	}
}

func TestFetchChatDmsEndToEndAgainstFixtures(t *testing.T) {
	got, err := fetchChatDms(context.Background(), chatRunner(t), chatDmsConfig{Limit: 15})
	if err != nil {
		t.Fatal(err)
	}
	if got.Dms == nil {
		t.Fatal("dms must be non-nil")
	}
	for _, dm := range got.Dms {
		if dm.SpaceID == "" || dm.Partner == "" {
			t.Errorf("unnormalized dm: %+v", dm)
		}
	}
}

func TestFetchChatChannelsStaleIDGoesToErrors(t *testing.T) {
	good := chatRunner(t)
	// Fail every call whose --params mentions the stale space id.
	run := func(ctx context.Context, args []string, out any) error {
		for _, a := range args {
			if strings.Contains(a, "spaces/stale") {
				return &cli.Error{Kind: cli.KindFailed, Message: "boom"}
			}
		}
		return good(ctx, args, out)
	}
	got, err := fetchChatChannels(context.Background(), run, chatChannelsConfig{SpaceIDs: []string{"spaces/AAAA", "spaces/stale"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Errors) != 1 || got.Errors[0] != "spaces/stale" {
		t.Fatalf("Errors = %v, want [spaces/stale]", got.Errors)
	}
	if len(got.Channels) != 1 {
		t.Fatalf("want the good channel to survive, got %+v", got.Channels)
	}
}
```

(Add `"strings"` and `"pulse/internal/cli"` to the test file's import block.)

> Note for the implementer: the exact `--params` JSON strings in the routing test must match what `jsonArg` produces — Go's `json.Marshal` sorts map keys alphabetically. If an assertion misses, print the args and align the literal, don't change the production code.

`internal/modules/gws/drive_test.go`:

```go
package gws

import (
	"context"
	"encoding/json"
	"testing"
)

func TestCategorize(t *testing.T) {
	cases := map[string]string{
		"application/vnd.google-apps.document":     "docs",
		"application/vnd.google-apps.spreadsheet":  "sheets",
		"application/vnd.google-apps.presentation": "slides",
		"application/pdf":                          "other",
		"":                                         "other",
	}
	for mime, want := range cases {
		if got := categorize(mime); got != want {
			t.Errorf("categorize(%q) = %q, want %q", mime, got, want)
		}
	}
}

func TestFetchDriveReturnsAllStarredUnfiltered(t *testing.T) {
	resp := `{"files":[
	  {"id":"f1","name":"Doc","mimeType":"application/vnd.google-apps.document",
	   "modifiedTime":"2026-07-20T10:00:00Z","webViewLink":"https://docs/f1","iconLink":"https://icon/1"},
	  {"id":"f2","mimeType":"application/pdf"}
	]}`
	run := func(ctx context.Context, args []string, out any) error {
		return json.Unmarshal([]byte(resp), out)
	}
	got, err := fetchDrive(context.Background(), run, driveConfig{Limit: 25})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Files) != 2 {
		t.Fatalf("want 2 files (widget filters, fetch doesn't), got %d", len(got.Files))
	}
	if got.Files[0].Category != "docs" || got.Files[1].Name != "(untitled)" || got.Files[1].Category != "other" {
		t.Errorf("normalize wrong: %+v", got.Files)
	}
}
```

`internal/modules/gws/tasks_test.go`:

```go
package gws

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestFetchTasksNormalizesAndPreservesOrder(t *testing.T) {
	resp := `{"items":[
	  {"id":"t2","title":"Second","status":"needsAction","webViewLink":"https://tasks/t2"},
	  {"id":"t1","title":"First","status":"completed","completed":"2026-07-20T10:00:00Z","due":"2026-07-21"}
	]}`
	var sawParams string
	run := func(ctx context.Context, args []string, out any) error {
		sawParams = args[len(args)-1]
		return json.Unmarshal([]byte(resp), out)
	}
	got, err := fetchTasks(context.Background(), run,
		tasksConfig{Tasklist: "@default", ShowCompleted: true, CompletedMaxAge: "All time", Limit: 25})
	if err != nil {
		t.Fatal(err)
	}
	// API returns manual (`position`) order — preserve it.
	if len(got.Tasks) != 2 || got.Tasks[0].ID != "t2" {
		t.Fatalf("order not preserved: %+v", got.Tasks)
	}
	if !got.Tasks[1].Completed || got.Tasks[1].CompletedAt != "2026-07-20T10:00:00Z" {
		t.Errorf("completed normalize wrong: %+v", got.Tasks[1])
	}
	// showCompleted drives showHidden too (completed tasks are hidden by default).
	if !strings.Contains(sawParams, `"showCompleted":true`) || !strings.Contains(sawParams, `"showHidden":true`) {
		t.Errorf("params = %s", sawParams)
	}
}

func TestSetTaskCompletedPatchSemantics(t *testing.T) {
	var bodies []string
	run := func(ctx context.Context, args []string, out any) error {
		bodies = append(bodies, args[len(args)-1])
		return nil
	}
	if err := setTaskCompleted(context.Background(), run, "@default", "t1", true); err != nil {
		t.Fatal(err)
	}
	if err := setTaskCompleted(context.Background(), run, "@default", "t1", false); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(bodies[0], `"status":"completed"`) {
		t.Errorf("complete body = %s", bodies[0])
	}
	// Un-completing must send completed:null so the timestamp clears under patch semantics.
	if !strings.Contains(bodies[1], `"completed":null`) || !strings.Contains(bodies[1], `"needsAction"`) {
		t.Errorf("uncomplete body = %s", bodies[1])
	}
}
```

- [ ] **Step 3: Run — expect FAIL**

Run: `go test ./internal/modules/gws/ -v`

- [ ] **Step 4: Implement `internal/modules/gws/chat.go`**

```go
package gws

import (
	"context"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// --- Raw gws Chat/People API shapes (only the fields we read) ---
type chatSpace struct {
	Name           string `json:"name"`
	DisplayName    string `json:"displayName"`
	SpaceType      string `json:"spaceType"`
	SpaceURI       string `json:"spaceUri"`
	LastActiveTime string `json:"lastActiveTime"`
}
type spacesResp struct {
	Spaces        []chatSpace `json:"spaces"`
	NextPageToken string      `json:"nextPageToken"`
}
type readState struct {
	Name         string `json:"name"`
	LastReadTime string `json:"lastReadTime"`
}
type chatUser struct {
	Name string `json:"name"` // NOTE: Chat's sender/member has NO displayName
	Type string `json:"type"`
}
type chatMessage struct {
	Name       string    `json:"name"`
	Text       string    `json:"text"`
	CreateTime string    `json:"createTime"`
	Sender     *chatUser `json:"sender"`
}
type messagesResp struct {
	Messages []chatMessage `json:"messages"`
}
type person struct {
	Names []struct {
		DisplayName string `json:"displayName"`
	} `json:"names"`
	Photos []struct {
		URL     string `json:"url"`
		Default bool   `json:"default"`
	} `json:"photos"`
}
type batchGetResp struct {
	Responses []struct {
		RequestedResourceName string  `json:"requestedResourceName"`
		Person                *person `json:"person"`
	} `json:"responses"`
}

// ChatDm mirrors the TS ChatDm payload shape.
type ChatDm struct {
	SpaceID   string `json:"spaceId"`
	Partner   string `json:"partner"`   // People-API-resolved name (fallback "Direct message")
	AvatarURL string `json:"avatarUrl"` // "" when missing or a default silhouette
	Snippet   string `json:"snippet"`
	Time      string `json:"time"`
	URL       string `json:"url"`
}
type ChatDmsData struct {
	Dms    []ChatDm `json:"dms"`
	Errors []string `json:"errors,omitempty"`
}

// ChatChannel mirrors the TS ChatChannel payload shape.
type ChatChannel struct {
	SpaceID string `json:"spaceId"`
	Name    string `json:"name"`
	Snippet string `json:"snippet"`
	Time    string `json:"time"`
	Unread  bool   `json:"unread"`
	URL     string `json:"url"`
}
type ChatChannelsData struct {
	Channels []ChatChannel `json:"channels"`
	Errors   []string      `json:"errors,omitempty"`
}

type chatDmsConfig struct {
	Limit int `json:"limit"`
}
type chatChannelsConfig struct {
	SpaceIDs []string `json:"spaceIds"`
}

// isUnread: a space is unread when its last message is newer than the
// caller's last read time.
func isUnread(lastActiveTime, lastReadTime string) bool {
	if lastActiveTime == "" {
		return false // no messages yet
	}
	if lastReadTime == "" {
		return true // never read
	}
	active, errA := time.Parse(time.RFC3339Nano, lastActiveTime)
	read, errR := time.Parse(time.RFC3339Nano, lastReadTime)
	if errA != nil || errR != nil {
		return false
	}
	return active.After(read)
}

var callerRe = regexp.MustCompile(`^(users/[^/]+)/`)

// "users/12345/spaces/AAAA/spaceReadState" → "users/12345" (or "").
func callerUserID(readStateName string) string {
	m := callerRe.FindStringSubmatch(readStateName)
	if m == nil {
		return ""
	}
	return m[1]
}

// Chat sender id "users/12345" → People API resource "people/12345" (or "").
func peopleResourceName(userName string) string {
	if id, ok := strings.CutPrefix(userName, "users/"); ok && id != "" {
		return "people/" + id
	}
	return ""
}

type partner struct {
	name, photo string
}

func personToPartner(p *person) partner {
	out := partner{}
	if p == nil {
		return out
	}
	if len(p.Names) > 0 {
		out.name = p.Names[0].DisplayName
	}
	// Skip Google's generic silhouette (`default: true`) so the widget falls
	// back to initials.
	for _, photo := range p.Photos {
		if photo.URL != "" && !photo.Default {
			out.photo = photo.URL
			break
		}
	}
	return out
}

// resolvePartners resolves many Chat sender ids to display names + avatars in
// ONE People getBatchGet call instead of one people.get per DM. A whole-call
// failure or a missing person falls back to the zero partner, so normalizeDm
// degrades to "Direct message".
func resolvePartners(ctx context.Context, run jsonRunner, senderNames []string) map[string]partner {
	out := map[string]partner{}
	type pair struct{ sender, resource string }
	pairs := []pair{}
	seen := map[string]bool{}
	resources := []string{}
	for _, sender := range senderNames {
		resource := peopleResourceName(sender)
		if sender == "" || resource == "" {
			continue
		}
		pairs = append(pairs, pair{sender, resource})
		if !seen[resource] {
			seen[resource] = true
			resources = append(resources, resource)
		}
	}
	if len(resources) == 0 {
		return out
	}
	byResource := map[string]partner{}
	var resp batchGetResp
	if err := run(ctx, []string{
		"people", "people", "getBatchGet",
		"--params", jsonArg(map[string]any{"resourceNames": resources, "personFields": "names,photos"}),
	}, &resp); err == nil {
		for _, r := range resp.Responses {
			if r.RequestedResourceName != "" {
				byResource[r.RequestedResourceName] = personToPartner(r.Person)
			}
		}
	}
	for _, p := range pairs {
		out[p.sender] = byResource[p.resource]
	}
	return out
}

func normalizeDm(space chatSpace, msg chatMessage, p partner) ChatDm {
	name := strings.TrimSpace(p.name)
	if name == "" {
		name = "Direct message"
	}
	t := msg.CreateTime
	if t == "" {
		t = space.LastActiveTime
	}
	return ChatDm{
		SpaceID: space.Name, Partner: name, AvatarURL: p.photo,
		Snippet: strings.TrimSpace(msg.Text), Time: t, URL: space.SpaceURI,
	}
}

func normalizeChannel(spaceID string, space chatSpace, rs readState, msg *chatMessage) ChatChannel {
	name := strings.TrimSpace(space.DisplayName)
	if name == "" {
		name = spaceID
	}
	out := ChatChannel{
		SpaceID: spaceID, Name: name,
		Unread: isUnread(space.LastActiveTime, rs.LastReadTime),
		URL:    space.SpaceURI, Time: space.LastActiveTime,
	}
	if msg != nil {
		out.Snippet = strings.TrimSpace(msg.Text)
		if msg.CreateTime != "" {
			out.Time = msg.CreateTime
		}
	}
	return out
}

func fetchChatDms(ctx context.Context, run jsonRunner, cfg chatDmsConfig) (ChatDmsData, error) {
	var list spacesResp
	if err := run(ctx, []string{
		"chat", "spaces", "list",
		"--params", jsonArg(map[string]any{"filter": `spaceType = "DIRECT_MESSAGE"`, "pageSize": 1000}),
	}, &list); err != nil {
		return ChatDmsData{}, err
	}
	dmSpaces := []chatSpace{}
	for _, s := range list.Spaces {
		if s.LastActiveTime != "" {
			dmSpaces = append(dmSpaces, s)
		}
	}
	sort.SliceStable(dmSpaces, func(i, j int) bool {
		return dmSpaces[i].LastActiveTime > dmSpaces[j].LastActiveTime
	})
	if len(dmSpaces) > cfg.Limit {
		dmSpaces = dmSpaces[:cfg.Limit]
	}

	// Read state per candidate (light). One failure shouldn't sink the widget.
	type stated struct {
		space chatSpace
		rs    readState
		ok    bool
	}
	states := make([]stated, len(dmSpaces))
	var wg sync.WaitGroup
	for i, space := range dmSpaces {
		wg.Add(1)
		go func() {
			defer wg.Done()
			var rs readState
			err := run(ctx, []string{
				"chat", "users", "spaces", "getSpaceReadState",
				"--params", jsonArg(map[string]any{"name": "users/me/" + space.Name + "/spaceReadState"}),
			}, &rs)
			states[i] = stated{space: space, rs: rs, ok: err == nil}
		}()
	}
	wg.Wait()

	type unreadDm struct {
		space chatSpace
		me    string
	}
	unread := []unreadDm{}
	for _, s := range states {
		if s.ok && isUnread(s.space.LastActiveTime, s.rs.LastReadTime) {
			unread = append(unread, unreadDm{space: s.space, me: callerUserID(s.rs.Name)})
		}
	}

	// For each unread DM: fetch the latest message (snippet/time/partner id).
	// Partner-name resolution is deferred and batched below — one People call
	// for all DMs instead of one per DM (N+1 → 1).
	type enrichedDm struct {
		space chatSpace
		msg   chatMessage
		skip  bool
	}
	enrichedSlots := make([]enrichedDm, len(unread))
	msgErrs := make([]error, len(unread))
	for i, u := range unread {
		wg.Add(1)
		go func() {
			defer wg.Done()
			var resp messagesResp
			err := run(ctx, []string{
				"chat", "spaces", "messages", "list",
				"--params", jsonArg(map[string]any{"parent": u.space.Name, "orderBy": "createTime desc", "pageSize": 1}),
			}, &resp)
			if err != nil {
				msgErrs[i] = err
				return
			}
			if len(resp.Messages) == 0 {
				enrichedSlots[i] = enrichedDm{skip: true}
				return
			}
			msg := resp.Messages[0]
			// Self-sent — best-effort (skipped if read-state name lacked a user id).
			if u.me != "" && msg.Sender != nil && msg.Sender.Name == u.me {
				enrichedSlots[i] = enrichedDm{skip: true}
				return
			}
			enrichedSlots[i] = enrichedDm{space: u.space, msg: msg}
		}()
	}
	wg.Wait()

	enriched := []enrichedDm{}
	errors := []string{}
	for i := range unread {
		if msgErrs[i] != nil {
			// Couldn't load this DM's latest message — surface, don't drop silently.
			errors = append(errors, unread[i].space.Name)
			continue
		}
		if !enrichedSlots[i].skip {
			enriched = append(enriched, enrichedSlots[i])
		}
	}

	senders := make([]string, 0, len(enriched))
	for _, e := range enriched {
		if e.msg.Sender != nil {
			senders = append(senders, e.msg.Sender.Name)
		} else {
			senders = append(senders, "")
		}
	}
	partners := resolvePartners(ctx, run, senders)
	dms := []ChatDm{}
	for i, e := range enriched {
		dms = append(dms, normalizeDm(e.space, e.msg, partners[senders[i]]))
	}

	if len(errors) > 0 {
		return ChatDmsData{Dms: dms, Errors: errors}, nil
	}
	return ChatDmsData{Dms: dms}, nil
}

func fetchChatChannels(ctx context.Context, run jsonRunner, cfg chatChannelsConfig) (ChatChannelsData, error) {
	type result struct {
		channel ChatChannel
		err     error
	}
	results := make([]result, len(cfg.SpaceIDs))
	var wg sync.WaitGroup
	for i, spaceID := range cfg.SpaceIDs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			// Any one of these failing (e.g. a stale/404 id) drops just this space.
			var space chatSpace
			var rs readState
			var msgs messagesResp
			calls := []func() error{
				func() error {
					return run(ctx, []string{"chat", "spaces", "get", "--params", jsonArg(map[string]any{"name": spaceID})}, &space)
				},
				func() error {
					return run(ctx, []string{
						"chat", "users", "spaces", "getSpaceReadState",
						"--params", jsonArg(map[string]any{"name": "users/me/" + spaceID + "/spaceReadState"}),
					}, &rs)
				},
				func() error {
					return run(ctx, []string{
						"chat", "spaces", "messages", "list",
						"--params", jsonArg(map[string]any{"parent": spaceID, "orderBy": "createTime desc", "pageSize": 1}),
					}, &msgs)
				},
			}
			var innerWg sync.WaitGroup
			errs := make([]error, len(calls))
			for j, call := range calls {
				innerWg.Add(1)
				go func() {
					defer innerWg.Done()
					errs[j] = call()
				}()
			}
			innerWg.Wait()
			if err := firstNonNil(errs); err != nil {
				results[i] = result{err: err}
				return
			}
			var msg *chatMessage
			if len(msgs.Messages) > 0 {
				msg = &msgs.Messages[0]
			}
			results[i] = result{channel: normalizeChannel(spaceID, space, rs, msg)}
		}()
	}
	wg.Wait()

	channels := []ChatChannel{}
	errors := []string{}
	for i, r := range results {
		if r.err != nil {
			// A stale/404 space id: surface which one, don't drop silently.
			errors = append(errors, cfg.SpaceIDs[i])
			continue
		}
		channels = append(channels, r.channel)
	}
	if len(errors) > 0 {
		return ChatChannelsData{Channels: channels, Errors: errors}, nil
	}
	return ChatChannelsData{Channels: channels}, nil
}

func firstNonNil(errs []error) error {
	for _, err := range errs {
		if err != nil {
			return err
		}
	}
	return nil
}
```

- [ ] **Step 5: Implement `internal/modules/gws/drive.go`**

```go
package gws

import "context"

type rawFile struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	MimeType     string `json:"mimeType"`
	ModifiedTime string `json:"modifiedTime"`
	WebViewLink  string `json:"webViewLink"`
	IconLink     string `json:"iconLink"`
}

// DriveFileItem mirrors the TS DriveFileItem payload shape.
type DriveFileItem struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Category     string `json:"category"` // docs | sheets | slides | other
	ModifiedTime string `json:"modifiedTime"`
	URL          string `json:"url"`
	IconLink     string `json:"iconLink"`
}

// DriveData carries ALL starred files (unfiltered); the widget filters by
// category toggles.
type DriveData struct {
	Files []DriveFileItem `json:"files"`
}

type driveConfig struct {
	ShowDocs   bool `json:"showDocs"`
	ShowSheets bool `json:"showSheets"`
	ShowSlides bool `json:"showSlides"`
	ShowOther  bool `json:"showOther"`
	Limit      int  `json:"limit"`
}

// categorize maps a Drive mimeType to one of the four config buckets;
// unknown types → "other".
func categorize(mimeType string) string {
	switch mimeType {
	case "application/vnd.google-apps.document":
		return "docs"
	case "application/vnd.google-apps.spreadsheet":
		return "sheets"
	case "application/vnd.google-apps.presentation":
		return "slides"
	default:
		return "other"
	}
}

func normalizeFile(raw rawFile) DriveFileItem {
	name := raw.Name
	if name == "" {
		name = "(untitled)"
	}
	return DriveFileItem{
		ID: raw.ID, Name: name, Category: categorize(raw.MimeType),
		ModifiedTime: raw.ModifiedTime, URL: raw.WebViewLink, IconLink: raw.IconLink,
	}
}

func fetchDrive(ctx context.Context, run jsonRunner, cfg driveConfig) (DriveData, error) {
	var resp struct {
		Files []rawFile `json:"files"`
	}
	if err := run(ctx, []string{
		"drive", "files", "list",
		"--params", jsonArg(map[string]any{
			"q":        "starred=true",
			"orderBy":  "modifiedTime desc",
			"pageSize": cfg.Limit,
			"fields":   "files(id,name,mimeType,modifiedTime,webViewLink,iconLink)",
		}),
	}, &resp); err != nil {
		return DriveData{}, err
	}
	files := make([]DriveFileItem, 0, len(resp.Files))
	for _, f := range resp.Files {
		files = append(files, normalizeFile(f))
	}
	return DriveData{Files: files}, nil
}
```

- [ ] **Step 6: Implement `internal/modules/gws/tasks.go`**

```go
package gws

import "context"

type gTask struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Notes       string `json:"notes"`
	Status      string `json:"status"` // "needsAction" | "completed"
	Due         string `json:"due"`
	Completed   string `json:"completed"` // RFC3339, present only on completed tasks
	WebViewLink string `json:"webViewLink"`
}

// TaskItem mirrors the TS TaskItem payload shape.
type TaskItem struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Notes       string `json:"notes,omitempty"`
	Due         string `json:"due"`
	Completed   bool   `json:"completed"`
	CompletedAt string `json:"completedAt,omitempty"`
	URL         string `json:"url"`
}
type TasksData struct {
	Tasks []TaskItem `json:"tasks"`
}

type tasksConfig struct {
	Tasklist        string `json:"tasklist"`
	ShowCompleted   bool   `json:"showCompleted"`
	CompletedMaxAge string `json:"completedMaxAge"`
	Limit           int    `json:"limit"`
}

func normalizeTask(t gTask) TaskItem {
	title := t.Title
	if title == "" {
		title = "(no title)"
	}
	return TaskItem{
		ID: t.ID, Title: title, Notes: t.Notes, Due: t.Due,
		Completed: t.Status == "completed", CompletedAt: t.Completed, URL: t.WebViewLink,
	}
}

func fetchTasks(ctx context.Context, run jsonRunner, cfg tasksConfig) (TasksData, error) {
	var resp struct {
		Items []gTask `json:"items"`
	}
	if err := run(ctx, []string{
		"tasks", "tasks", "list",
		"--params", jsonArg(map[string]any{
			"tasklist":      cfg.Tasklist,
			"maxResults":    cfg.Limit,
			"showCompleted": cfg.ShowCompleted,
			"showHidden":    cfg.ShowCompleted, // completed tasks are hidden by default
		}),
	}, &resp); err != nil {
		return TasksData{}, err
	}
	// The API returns items in manual (`position`) order — preserve it.
	tasks := make([]TaskItem, 0, len(resp.Items))
	for _, t := range resp.Items {
		tasks = append(tasks, normalizeTask(t))
	}
	return TasksData{Tasks: tasks}, nil
}

// setTaskCompleted flips a task's completion via `gws tasks tasks patch`.
// Un-completing sends completed:null so the timestamp clears under patch
// semantics.
func setTaskCompleted(ctx context.Context, run jsonRunner, tasklist, taskID string, completed bool) error {
	var body map[string]any
	if completed {
		body = map[string]any{"status": "completed"}
	} else {
		body = map[string]any{"status": "needsAction", "completed": nil}
	}
	var out map[string]any
	return run(ctx, []string{
		"tasks", "tasks", "patch",
		"--params", jsonArg(map[string]any{"tasklist": tasklist, "task": taskID}),
		"--json", jsonArg(body),
	}, &out)
}
```

- [ ] **Step 7: Run — expect PASS**

Run: `go test -race ./internal/modules/gws/ -v`

- [ ] **Step 8: Commit**

```bash
git add internal/modules/gws/ frontend/legacy-modules/fixtures
git commit -m "feat: gws module in Go — chat DMs/channels, drive, tasks"
```

---

### Task 13: gws Go — options, Module, mutation Service, wiring

**Files:**
- Create: `internal/modules/gws/options.go`
- Create: `internal/modules/gws/module.go`
- Create: `internal/modules/gws/service.go`
- Create: `internal/modules/gws/options_test.go`
- Create: `internal/modules/gws/module_test.go`
- Modify: `internal/modules/all.go`, `main.go`

**Interfaces:**
- Consumes: everything from Tasks 11–12.
- Produces: `gws.New() *Module` (implements `module.Module` **and** `module.OptionsSource` with keys `gws.taskLists`, `gws.calendars`, `gws.chatSpaces`); type constants `GmailType…NextMeetingType`; `gws.NewService() *Service` bound methods `ArchiveEmail(id)`, `MarkEmailRead(id)`, `TrashEmail(id)`, `SetTaskCompleted(tasklist, taskID, completed)` — Task 14's widgets call these via bindings.

- [ ] **Step 1: Write the failing tests**

`internal/modules/gws/options_test.go`:

```go
package gws

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestFieldOptionsKeysRegistered(t *testing.T) {
	opts := New().FieldOptions()
	for _, key := range []string{TaskListsKey, CalendarsKey, ChatSpacesKey} {
		if _, ok := opts[key]; !ok {
			t.Errorf("missing options provider for %q", key)
		}
	}
}

func TestCalendarOptionsLabelPrimary(t *testing.T) {
	run := func(ctx context.Context, args []string, out any) error {
		return json.Unmarshal([]byte(`{"items":[
			{"id":"primary-id","summary":"Me","primary":true},
			{"id":"team-id","summary":"Team"}]}`), out)
	}
	got, err := fetchCalendarOptions(context.Background(), run)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Label != "Me (primary)" || got[1].Label != "Team" {
		t.Fatalf("options = %+v", got)
	}
}

func TestChatSpaceOptionsPageAndLabelDMs(t *testing.T) {
	pages := 0
	run := func(ctx context.Context, args []string, out any) error {
		pages++
		if pages == 1 {
			return json.Unmarshal([]byte(`{"spaces":[
				{"name":"spaces/A","displayName":"Eng"}],"nextPageToken":"p2"}`), out)
		}
		if !strings.Contains(args[len(args)-1], `"pageToken":"p2"`) {
			t.Error("second page must carry the token")
		}
		return json.Unmarshal([]byte(`{"spaces":[
			{"name":"spaces/B","spaceType":"DIRECT_MESSAGE"}]}`), out)
	}
	got, err := fetchChatSpaceOptions(context.Background(), run)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Label != "Eng" || got[1].Label != "Direct message" {
		t.Fatalf("options = %+v", got)
	}
}

func TestTaskListOptions(t *testing.T) {
	run := func(ctx context.Context, args []string, out any) error {
		return json.Unmarshal([]byte(`{"items":[{"id":"l1","title":"Inbox"},{"id":"l2"}]}`), out)
	}
	got, err := fetchTaskListOptions(context.Background(), run)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Label != "Inbox" || got[1].Label != "l2" {
		t.Fatalf("options = %+v", got)
	}
}
```

`internal/modules/gws/module_test.go`:

```go
package gws

import (
	"context"
	"testing"
)

func TestManifestsSevenTypesWithOptionsKeys(t *testing.T) {
	ms := New().Manifests()
	if len(ms) != 7 {
		t.Fatalf("want 7 manifests, got %d", len(ms))
	}
	byType := map[string][]int{}
	for i, m := range ms {
		byType[m.Type] = append(byType[m.Type], i)
		if m.Integration != "gws" || !m.Refreshable {
			t.Errorf("%s: integration/refreshable wrong", m.Type)
		}
	}
	for _, ty := range []string{GmailType, CalendarType, ChatDmsType, ChatChannelsType, DriveType, TasksType, NextMeetingType} {
		if len(byType[ty]) != 1 {
			t.Errorf("type %q registered %d times", ty, len(byType[ty]))
		}
	}
	// Spot-check optionsKey plumbing.
	for _, m := range ms {
		for _, f := range m.ConfigFields {
			if f.Key == "calendarId" && f.OptionsKey != CalendarsKey {
				t.Errorf("%s.calendarId optionsKey = %q", m.Type, f.OptionsKey)
			}
			if f.Key == "tasklist" && f.OptionsKey != TaskListsKey {
				t.Errorf("tasklist optionsKey = %q", f.OptionsKey)
			}
			if f.Key == "spaceIds" && f.OptionsKey != ChatSpacesKey {
				t.Errorf("spaceIds optionsKey = %q", f.OptionsKey)
			}
		}
	}
}

func TestFetchDispatch(t *testing.T) {
	m := New()
	m.run = func(ctx context.Context, args []string, out any) error { return nil }
	if _, err := m.Fetch(context.Background(), "gws.nope", nil); err == nil {
		t.Fatal("want error for unknown type")
	}
	got, err := m.Fetch(context.Background(), DriveType,
		map[string]any{"showDocs": true, "showSheets": true, "showSlides": true, "showOther": true, "limit": 25.0})
	if err != nil {
		t.Fatal(err)
	}
	if got.(DriveData).Files == nil {
		t.Fatal("files must be non-nil")
	}
}
```

- [ ] **Step 2: Run — expect FAIL**

Run: `go test ./internal/modules/gws/ -v`

- [ ] **Step 3: Implement `internal/modules/gws/options.go`**

```go
package gws

import (
	"context"

	"pulse/internal/module"
)

// Field-options provider keys (mirrors the TS option-keys.ts values — the
// frontend resolves them via Dashboard.FieldOptions).
const (
	TaskListsKey  = "gws.taskLists"
	CalendarsKey  = "gws.calendars"
	ChatSpacesKey = "gws.chatSpaces"
)

func fetchTaskListOptions(ctx context.Context, run jsonRunner) ([]module.FieldOption, error) {
	var resp struct {
		Items []struct {
			ID    string `json:"id"`
			Title string `json:"title"`
		} `json:"items"`
	}
	if err := run(ctx, []string{"tasks", "tasklists", "list"}, &resp); err != nil {
		return nil, err
	}
	out := []module.FieldOption{}
	for _, t := range resp.Items {
		label := t.Title
		if label == "" {
			label = t.ID
		}
		out = append(out, module.FieldOption{Value: t.ID, Label: label})
	}
	return out, nil
}

func fetchCalendarOptions(ctx context.Context, run jsonRunner) ([]module.FieldOption, error) {
	var resp struct {
		Items []struct {
			ID      string `json:"id"`
			Summary string `json:"summary"`
			Primary bool   `json:"primary"`
		} `json:"items"`
	}
	if err := run(ctx, []string{"calendar", "calendarList", "list"}, &resp); err != nil {
		return nil, err
	}
	out := []module.FieldOption{}
	for _, c := range resp.Items {
		label := c.Summary
		if label == "" {
			label = c.ID
		}
		if c.Primary {
			label += " (primary)"
		}
		out = append(out, module.FieldOption{Value: c.ID, Label: label})
	}
	return out, nil
}

// fetchChatSpaceOptions pages through all chat spaces so the options list
// isn't silently capped at the API's page size; page count is bounded
// against a misbehaving nextPageToken.
func fetchChatSpaceOptions(ctx context.Context, run jsonRunner) ([]module.FieldOption, error) {
	all := []chatSpace{}
	pageToken := ""
	for page := 0; page < 20; page++ {
		params := map[string]any{"pageSize": 1000}
		if pageToken != "" {
			params["pageToken"] = pageToken
		}
		var resp spacesResp
		if err := run(ctx, []string{"chat", "spaces", "list", "--params", jsonArg(params)}, &resp); err != nil {
			return nil, err
		}
		all = append(all, resp.Spaces...)
		if resp.NextPageToken == "" {
			break
		}
		pageToken = resp.NextPageToken
	}
	out := []module.FieldOption{}
	for _, s := range all {
		// DMs carry no displayName — label them clearly instead of surfacing
		// the raw "spaces/…" id.
		label := s.DisplayName
		if label == "" {
			if s.SpaceType == "DIRECT_MESSAGE" {
				label = "Direct message"
			} else {
				label = s.Name
			}
		}
		out = append(out, module.FieldOption{Value: s.Name, Label: label})
	}
	return out, nil
}

// FieldOptions implements module.OptionsSource.
func (m *Module) FieldOptions() map[string]module.OptionsProvider {
	return map[string]module.OptionsProvider{
		TaskListsKey: func(ctx context.Context) ([]module.FieldOption, error) {
			return fetchTaskListOptions(ctx, m.run)
		},
		CalendarsKey: func(ctx context.Context) ([]module.FieldOption, error) {
			return fetchCalendarOptions(ctx, m.run)
		},
		ChatSpacesKey: func(ctx context.Context) ([]module.FieldOption, error) {
			return fetchChatSpaceOptions(ctx, m.run)
		},
	}
}
```

- [ ] **Step 4: Implement `internal/modules/gws/module.go`**

```go
package gws

import (
	"context"
	"fmt"

	"pulse/internal/module"
)

const (
	GmailType        = "gws.gmail"
	CalendarType     = "gws.calendar"
	ChatDmsType      = "gws.chatDms"
	ChatChannelsType = "gws.chatChannels"
	DriveType        = "gws.drive"
	TasksType        = "gws.tasks"
	NextMeetingType  = "gws.nextMeeting"
)

func f64(v float64) *float64 { return &v }

type Module struct{ run jsonRunner }

func New() *Module { return &Module{run: runGwsJSON} }

func (Module) Manifests() []module.Manifest {
	return []module.Manifest{
		{
			Type: GmailType, Title: "Gmail", Refreshable: true, Integration: "gws",
			ConfigFields: []module.ConfigField{
				{Key: "query", Label: "Gmail search query", Kind: module.FieldString, Default: "is:unread in:inbox"},
				{Key: "limit", Label: "Max emails", Kind: module.FieldNumber, Default: 15.0, Min: f64(1), Max: f64(50)},
			},
		},
		{
			Type: CalendarType, Title: "Calendar", Refreshable: true, Integration: "gws",
			ConfigFields: []module.ConfigField{
				{Key: "calendarId", Label: "Calendar", Kind: module.FieldAsyncEnum, OptionsKey: CalendarsKey, Default: "primary"},
				{Key: "limit", Label: "Max events", Kind: module.FieldNumber, Default: 15.0, Min: f64(1), Max: f64(50)},
			},
		},
		{
			Type: ChatDmsType, Title: "Unread DMs", Refreshable: true, Integration: "gws",
			ConfigFields: []module.ConfigField{
				{Key: "limit", Label: "Max recent DMs to scan", Kind: module.FieldNumber, Default: 15.0, Min: f64(1), Max: f64(50)},
			},
		},
		{
			Type: ChatChannelsType, Title: "Chat Channels", Refreshable: true, Integration: "gws",
			ConfigFields: []module.ConfigField{
				{Key: "spaceIds", Label: "Spaces", Kind: module.FieldAsyncMultiEnum, OptionsKey: ChatSpacesKey, Default: []string{}},
			},
		},
		{
			Type: DriveType, Title: "Starred files", Refreshable: true, Integration: "gws",
			ConfigFields: []module.ConfigField{
				{Key: "showDocs", Label: "Show Docs", Kind: module.FieldBoolean, Default: true},
				{Key: "showSheets", Label: "Show Sheets", Kind: module.FieldBoolean, Default: true},
				{Key: "showSlides", Label: "Show Slides", Kind: module.FieldBoolean, Default: true},
				{Key: "showOther", Label: "Show other files", Kind: module.FieldBoolean, Default: true},
				{Key: "limit", Label: "Max files", Kind: module.FieldNumber, Default: 25.0, Min: f64(1), Max: f64(100)},
			},
		},
		{
			Type: TasksType, Title: "Tasks", Refreshable: true, Integration: "gws",
			ConfigFields: []module.ConfigField{
				{Key: "tasklist", Label: "Task list", Kind: module.FieldAsyncEnum, OptionsKey: TaskListsKey, Default: "@default"},
				{Key: "showCompleted", Label: "Show completed tasks", Kind: module.FieldBoolean, Default: false},
				{Key: "completedMaxAge", Label: "Show completed up to (only when completed shown)", Kind: module.FieldEnum,
					Options: []string{"Today", "Last 7 days", "Last 30 days", "All time"}, Default: "All time"},
				{Key: "limit", Label: "Max tasks", Kind: module.FieldNumber, Default: 25.0, Min: f64(1), Max: f64(100)},
			},
		},
		{
			Type: NextMeetingType, Title: "Next meeting", Refreshable: true, Integration: "gws",
			ConfigFields: []module.ConfigField{
				{Key: "calendarId", Label: "Calendar", Kind: module.FieldAsyncEnum, OptionsKey: CalendarsKey, Default: "primary"},
				{Key: "includeSoloEvents", Label: "Count solo events (no other attendees, no Meet link)", Kind: module.FieldBoolean, Default: false},
			},
		},
	}
}

func (m *Module) Fetch(ctx context.Context, widgetType string, config map[string]any) (any, error) {
	switch widgetType {
	case GmailType:
		cfg, err := module.DecodeConfig[gmailConfig](config)
		if err != nil {
			return nil, err
		}
		return fetchGmail(ctx, m.run, cfg)
	case CalendarType:
		cfg, err := module.DecodeConfig[calendarConfig](config)
		if err != nil {
			return nil, err
		}
		return fetchCalendar(ctx, m.run, cfg)
	case ChatDmsType:
		cfg, err := module.DecodeConfig[chatDmsConfig](config)
		if err != nil {
			return nil, err
		}
		return fetchChatDms(ctx, m.run, cfg)
	case ChatChannelsType:
		cfg, err := module.DecodeConfig[chatChannelsConfig](config)
		if err != nil {
			return nil, err
		}
		return fetchChatChannels(ctx, m.run, cfg)
	case DriveType:
		cfg, err := module.DecodeConfig[driveConfig](config)
		if err != nil {
			return nil, err
		}
		return fetchDrive(ctx, m.run, cfg)
	case TasksType:
		cfg, err := module.DecodeConfig[tasksConfig](config)
		if err != nil {
			return nil, err
		}
		return fetchTasks(ctx, m.run, cfg)
	case NextMeetingType:
		cfg, err := module.DecodeConfig[nextMeetingConfig](config)
		if err != nil {
			return nil, err
		}
		return fetchNextMeeting(ctx, m.run, cfg)
	}
	return nil, fmt.Errorf("gws: unknown widget type %s", widgetType)
}
```

- [ ] **Step 5: Implement `internal/modules/gws/service.go`**

```go
package gws

import "context"

// Service is the Wails-bound face of gws mutations: widgets call these
// directly (no fetch pipeline) and then refresh(). Context is
// context.Background() since Wails-bound methods receive no context from JS.
type Service struct{ run jsonRunner }

func NewService() *Service { return &Service{run: runGwsJSON} }

// ArchiveEmail removes the INBOX label (message stays searchable, leaves the
// inbox).
func (s *Service) ArchiveEmail(id string) error {
	var out map[string]any
	return s.run(context.Background(), []string{
		"gmail", "users", "messages", "modify",
		"--params", jsonArg(map[string]any{"userId": "me", "id": id}),
		"--json", jsonArg(map[string]any{"removeLabelIds": []string{"INBOX"}}),
	}, &out)
}

// MarkEmailRead removes the UNREAD label.
func (s *Service) MarkEmailRead(id string) error {
	var out map[string]any
	return s.run(context.Background(), []string{
		"gmail", "users", "messages", "modify",
		"--params", jsonArg(map[string]any{"userId": "me", "id": id}),
		"--json", jsonArg(map[string]any{"removeLabelIds": []string{"UNREAD"}}),
	}, &out)
}

// TrashEmail moves a message to Trash (reversible in Gmail for 30 days).
func (s *Service) TrashEmail(id string) error {
	var out map[string]any
	return s.run(context.Background(), []string{
		"gmail", "users", "messages", "trash",
		"--params", jsonArg(map[string]any{"userId": "me", "id": id}),
	}, &out)
}

// SetTaskCompleted flips a task's completion state.
func (s *Service) SetTaskCompleted(tasklist, taskID string, completed bool) error {
	return setTaskCompleted(context.Background(), s.run, tasklist, taskID, completed)
}
```

- [ ] **Step 6: Wire into the app (`main.go` only — NOT `all.go`)**

`main.go`: import gws; registry gains `gws.New()`; the `Services` list gains:

```go
			application.NewService(gws.NewService()),
```

Then regenerate bindings for Task 14: `wails3 generate bindings -ts -i` (emits the Gws service bindings).

Do NOT touch `internal/modules/all.go` or run `gen-widget-types` in this task: the parity tests compare `ManifestModules()` against the committed JSON, and the frontend render side doesn't exist until Task 14 — deferring the `all.go` append + generator run to Task 14 Step 1 keeps both parity tests green at every commit.

- [ ] **Step 7: Run — expect PASS**

Run: `go test -race ./internal/modules/gws/ && go test ./internal/... ./cmd/...`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add internal/modules/gws/ main.go
git commit -m "feat: gws module — options providers, manifest dispatch, mutation service"
```

---

### Task 14: gws wiring completion + frontend move

**Files:**
- Modify: `internal/modules/all.go` (append `gws.New()`), regenerate `frontend/src/widget-types.gen.json`
- Modify: `frontend/src/lib/backend.ts` (export `Gws` bindings)
- Move: `frontend/legacy-modules/gws/` → `frontend/src/modules/gws/` (rewrite `manifest.ts`, `render.ts`; delete `fetch.ts`, `integration.ts`, `gws.ts`, `gmail.ts`, `calendar.ts`, `chat.ts`, `drive.ts`, `tasks.ts`, `options.ts`, `option-keys.ts`)
- Modify: `frontend/src/modules/gws/widgets/gmail-widget.tsx`, `frontend/src/modules/gws/widgets/tasks-widget.tsx` (mutations → `Gws` service)
- Move: `frontend/legacy-modules/__tests__/{gws-gmail-widget,gws-tasks-widget,gws-next-meeting-widget}.test.tsx` → `frontend/tests/modules/`
- Create: `frontend/tests/modules/gws-manifest.test.ts` (pure display helpers)
- Delete: `frontend/legacy-modules/__tests__/{gws-calendar,gws-chat,gws-drive,gws-gmail,gws-tasks,gws-next-meeting,gws-options,gws-options-schema,gws-registration}.test.ts`
- Modify: `frontend/src/modules/render.ts`

**Interfaces:**
- Consumes: `gws.NewService()` bindings (`Gws.ArchiveEmail` etc.), `gws.New()` manifests.
- Produces: TS `manifest.ts` keeping the type constants, all payload/config types, and the four pure display helpers (`deriveEventEmphasis`, `filterDriveFiles`, `filterTasksByAge` + `sortTasks`, `deriveMeetingState`) that widgets still call client-side.

- [ ] **Step 1: Finish Go wiring + regen**

`internal/modules/all.go`: import `"pulse/internal/modules/gws"`, append `gws.New(),`.
Run: `go run ./cmd/gen-widget-types` — JSON gains the seven `gws.*` types.

- [ ] **Step 2: Export the Gws bindings**

In `frontend/src/lib/backend.ts` add:

```ts
import * as Gws from "../../bindings/pulse/internal/modules/gws/service";
```

and add `Gws` to the `export { Dashboard, Bookmarks, System };` line → `export { Dashboard, Bookmarks, System, Gws };`

- [ ] **Step 3: Move files**

```bash
cd frontend
git mv legacy-modules/gws src/modules/gws
git mv legacy-modules/__tests__/gws-gmail-widget.test.tsx tests/modules/
git mv legacy-modules/__tests__/gws-tasks-widget.test.tsx tests/modules/
git mv legacy-modules/__tests__/gws-next-meeting-widget.test.tsx tests/modules/
git rm legacy-modules/__tests__/gws-calendar.test.ts legacy-modules/__tests__/gws-chat.test.ts \
  legacy-modules/__tests__/gws-drive.test.ts legacy-modules/__tests__/gws-gmail.test.ts \
  legacy-modules/__tests__/gws-tasks.test.ts legacy-modules/__tests__/gws-next-meeting.test.ts \
  legacy-modules/__tests__/gws-options.test.ts legacy-modules/__tests__/gws-options-schema.test.ts \
  legacy-modules/__tests__/gws-registration.test.ts
git rm src/modules/gws/fetch.ts src/modules/gws/integration.ts src/modules/gws/gws.ts \
  src/modules/gws/gmail.ts src/modules/gws/calendar.ts src/modules/gws/chat.ts \
  src/modules/gws/drive.ts src/modules/gws/tasks.ts src/modules/gws/options.ts src/modules/gws/option-keys.ts
```

> Before deleting `gws-tasks.test.ts` / `gws-next-meeting.test.ts`, skim them: any cases exercising the **pure helpers** (`filterTasksByAge`, `sortTasks`, `deriveMeetingState`, `deriveEventEmphasis`, `filterDriveFiles`) get folded into the new `gws-manifest.test.ts` (Step 6); cases exercising fetch/normalize logic are already re-covered by the Go tests and die here.

- [ ] **Step 4: Rewrite `frontend/src/modules/gws/manifest.ts`**

Keep the file's existing **type constants, data-shape types, and the pure helper functions with their current doc comments**, delete everything Zod. The result (complete file):

```ts
export const GMAIL_TYPE = "gws.gmail";
export const CALENDAR_TYPE = "gws.calendar";
export const CHAT_DMS_TYPE = "gws.chatDms";
export const CHAT_CHANNELS_TYPE = "gws.chatChannels";
export const DRIVE_TYPE = "gws.drive";
export const TASKS_TYPE = "gws.tasks";
export const NEXT_MEETING_TYPE = "gws.nextMeeting";

// Config shapes mirror the Go manifests (forms are generated server-side).
export interface GmailConfig { query: string; limit: number }
export interface CalendarConfig { calendarId: string; limit: number }
export interface ChatDmsConfig { limit: number }
export interface ChatChannelsConfig { spaceIds: string[] }
export interface DriveConfig {
  showDocs: boolean; showSheets: boolean; showSlides: boolean; showOther: boolean; limit: number;
}
export type CompletedMaxAge = "Today" | "Last 7 days" | "Last 30 days" | "All time";
export interface TasksConfig {
  tasklist: string; showCompleted: boolean; completedMaxAge: CompletedMaxAge; limit: number;
}
export interface NextMeetingConfig { calendarId: string; includeSoloEvents: boolean }

// --- Data shapes (payloads produced by internal/modules/gws) ---
export type EmailItem = {
  id: string;
  subject: string;
  from: string;
  date: string;
  unread: boolean;
  url: string;
};
export type GmailData = { emails: EmailItem[]; errors?: string[] };

export type CalendarEventItem = {
  id: string;
  title: string;
  start: string; // ISO datetime, or YYYY-MM-DD for all-day
  end: string;
  allDay: boolean;
  location?: string;
  meetUrl?: string;
  url: string;
};
export type CalendarData = { events: CalendarEventItem[] };

export type ChatDm = {
  spaceId: string; partner: string; avatarUrl: string; snippet: string; time: string; url: string;
};
export type ChatDmsData = { dms: ChatDm[]; errors?: string[] };

export type ChatChannel = {
  spaceId: string; name: string; snippet: string; time: string; unread: boolean; url: string;
};
export type ChatChannelsData = { channels: ChatChannel[]; errors?: string[] };

export type DriveCategory = "docs" | "sheets" | "slides" | "other";
export type DriveFileItem = {
  id: string; name: string; category: DriveCategory; modifiedTime: string; url: string; iconLink: string;
};
export type DriveData = { files: DriveFileItem[] }; // ALL starred (unfiltered); the widget filters.

export type TaskItem = {
  id: string; title: string; notes?: string; due: string;
  completed: boolean; completedAt?: string; url: string;
};
export type TasksData = { tasks: TaskItem[] };

export type MeetingItem = {
  id: string; title: string; start: string; end: string; meetUrl?: string; url: string;
};
export type NextMeetingData = { meetings: MeetingItem[] };
```

…then **re-append verbatim from the pre-rewrite file** these pure helpers (they are display logic the widgets call): `deriveEventEmphasis`, `filterDriveFiles`, `filterTasksByAge` (+ its private `ageCutoff`), `sortTasks`, `deriveMeetingState` — including their doc comments. They only reference types kept above.

- [ ] **Step 5: Rewrite `frontend/src/modules/gws/render.ts`**

```ts
import {
  SiGmail, SiGooglecalendar, SiGooglechat, SiGoogledrive, SiGoogletasks,
} from "react-icons/si";
import { registerRender } from "@/modules/render-registry";
import {
  GMAIL_TYPE, CALENDAR_TYPE, CHAT_DMS_TYPE, CHAT_CHANNELS_TYPE, DRIVE_TYPE, TASKS_TYPE,
  NEXT_MEETING_TYPE, filterDriveFiles,
} from "./manifest";
import type {
  GmailData, CalendarData, ChatDmsData, ChatChannelsData, DriveData, DriveConfig, TasksData, NextMeetingData,
} from "./manifest";
import { GmailWidget } from "./widgets/gmail-widget";
import { CalendarWidget } from "./widgets/calendar-widget";
import { ChatDmsWidget } from "./widgets/chat-dms-widget";
import { ChatChannelsWidget } from "./widgets/chat-channels-widget";
import { DriveWidget } from "./widgets/drive-widget";
import { TasksWidget } from "./widgets/tasks-widget";
import { NextMeetingWidget } from "./widgets/next-meeting-widget";

registerRender<GmailData, unknown>(GMAIL_TYPE, {
  Component: GmailWidget,
  count: (d) => d.emails.length,
  icon: { Icon: SiGmail, className: "text-[#EA4335]" },
});
registerRender<CalendarData, unknown>(CALENDAR_TYPE, {
  Component: CalendarWidget,
  count: (d) => d.events.length,
  icon: { Icon: SiGooglecalendar, className: "text-[#4285F4]" },
});
registerRender<ChatDmsData, unknown>(CHAT_DMS_TYPE, {
  Component: ChatDmsWidget,
  count: (d) => d.dms.length,
  icon: { Icon: SiGooglechat, className: "text-[#34A853]" },
});
registerRender<ChatChannelsData, unknown>(CHAT_CHANNELS_TYPE, {
  Component: ChatChannelsWidget,
  count: (d) => d.channels.length,
  icon: { Icon: SiGooglechat, className: "text-[#34A853]" },
});
registerRender<DriveData, DriveConfig>(DRIVE_TYPE, {
  Component: DriveWidget,
  count: (d, c) => filterDriveFiles(d.files, c).length,
  icon: { Icon: SiGoogledrive, className: "text-[#4285F4]" },
});
registerRender<TasksData, unknown>(TASKS_TYPE, {
  Component: TasksWidget,
  count: (d) => d.tasks.length,
  icon: { Icon: SiGoogletasks, className: "text-[#4285F4]" },
});
registerRender<NextMeetingData, unknown>(NEXT_MEETING_TYPE, {
  Component: NextMeetingWidget,
  count: (d) => d.meetings.length,
  icon: { Icon: SiGooglecalendar, className: "text-[#4285F4]" },
});
```

- [ ] **Step 6: Re-target widget mutations + pure-helper tests**

In `frontend/src/modules/gws/widgets/gmail-widget.tsx` replace

```ts
import { archiveEmail, markEmailRead, trashEmail } from "../gmail";
```

with

```ts
import { Gws } from "@/lib/backend";

const archiveEmail = (id: string) => Gws.ArchiveEmail(id);
const markEmailRead = (id: string) => Gws.MarkEmailRead(id);
const trashEmail = (id: string) => Gws.TrashEmail(id);
```

In `frontend/src/modules/gws/widgets/tasks-widget.tsx` replace

```ts
import { setTaskCompleted } from "../tasks";
```

with

```ts
import { Gws } from "@/lib/backend";

const setTaskCompleted = (tasklist: string, taskId: string, completed: boolean) =>
  Gws.SetTaskCompleted(tasklist, taskId, completed);
```

(The moved widget tests mock these — check how `gws-gmail-widget.test.tsx` and `gws-tasks-widget.test.tsx` currently mock `../gmail`/`../tasks`, and re-point the `vi.mock` to `@/lib/backend` with a `Gws` object exposing the four methods.)

Create `frontend/tests/modules/gws-manifest.test.ts` with the pure-helper cases folded from the deleted tests, e.g.:

```ts
import { describe, it, expect } from "vitest";
import {
  deriveEventEmphasis, deriveMeetingState, filterDriveFiles, filterTasksByAge, sortTasks,
} from "@/modules/gws/manifest";
import type { CalendarEventItem, DriveFileItem, MeetingItem, TaskItem, DriveConfig } from "@/modules/gws/manifest";

const now = new Date("2026-07-22T12:00:00Z");

describe("deriveEventEmphasis", () => {
  const ev = (id: string, start: string, end: string, allDay = false): CalendarEventItem =>
    ({ id, title: id, start, end, allDay, url: "" });
  it("dims past timed events and highlights the in-progress one", () => {
    const events = [
      ev("past", "2026-07-22T09:00:00Z", "2026-07-22T10:00:00Z"),
      ev("current", "2026-07-22T11:30:00Z", "2026-07-22T12:30:00Z"),
      ev("next", "2026-07-22T14:00:00Z", "2026-07-22T15:00:00Z"),
      ev("holiday", "2026-07-22", "2026-07-23", true),
    ];
    const { pastIds, highlightId } = deriveEventEmphasis(events, now);
    expect([...pastIds]).toEqual(["past"]);
    expect(highlightId).toBe("current");
  });
  it("falls back to the next upcoming event", () => {
    const events = [ev("next", "2026-07-22T14:00:00Z", "2026-07-22T15:00:00Z")];
    expect(deriveEventEmphasis(events, now).highlightId).toBe("next");
  });
});

describe("deriveMeetingState", () => {
  const m = (id: string, start: string, end: string): MeetingItem => ({ id, title: id, start, end, url: "" });
  it("finds current and next", () => {
    const meetings = [
      m("cur", "2026-07-22T11:30:00Z", "2026-07-22T12:30:00Z"),
      m("nxt", "2026-07-22T14:00:00Z", "2026-07-22T15:00:00Z"),
    ];
    const { current, next } = deriveMeetingState(meetings, now);
    expect(current?.id).toBe("cur");
    expect(next?.id).toBe("nxt");
  });
});

describe("filterDriveFiles", () => {
  const f = (id: string, category: DriveFileItem["category"]): DriveFileItem =>
    ({ id, name: id, category, modifiedTime: "", url: "", iconLink: "" });
  it("drops categories whose toggle is off", () => {
    const config: DriveConfig = { showDocs: true, showSheets: false, showSlides: true, showOther: false, limit: 25 };
    const got = filterDriveFiles([f("a", "docs"), f("b", "sheets"), f("c", "other")], config);
    expect(got.map((x) => x.id)).toEqual(["a"]);
  });
});

describe("filterTasksByAge / sortTasks", () => {
  const task = (id: string, completed: boolean, completedAt?: string): TaskItem =>
    ({ id, title: id, due: "", completed, completedAt, url: "" });
  it("keeps incomplete always, drops old completed, fail-open without timestamp", () => {
    const tasks = [
      task("open", false),
      task("old", true, "2026-07-01T00:00:00Z"),
      task("fresh", true, "2026-07-22T09:00:00Z"),
      task("no-ts", true),
    ];
    const got = filterTasksByAge(tasks, "Last 7 days", now);
    expect(got.map((t) => t.id)).toEqual(["open", "fresh", "no-ts"]);
  });
  it("sorts completed last, stable", () => {
    const got = sortTasks([task("done", true, "x"), task("a", false), task("b", false)]);
    expect(got.map((t) => t.id)).toEqual(["a", "b", "done"]);
  });
});
```

- [ ] **Step 7: Register render side + fix stale imports**

Add `import "./gws/render";` to `frontend/src/modules/render.ts`.

Run: `cd frontend && grep -rn "gmailManifest\|calendarManifest\|chatDmsManifest\|chatChannelsManifest\|driveManifest\|tasksManifest\|nextMeetingManifest\|gws/options\|gws/option-keys\|gws/gws\|from \"\.\./gmail\"\|from \"\.\./tasks\"\|from \"\.\./chat\"\|from \"\.\./calendar\"\|from \"\.\./drive\"" src tests`
Expected: no matches; fix any hits (widgets importing `isMeetingEvent`-style fetch helpers must not exist — if one does, that helper is display logic and belongs in `manifest.ts`; move it there from the legacy file rather than reaching into deleted modules).

- [ ] **Step 8: Run everything**

Run: `go test ./internal/... ./cmd/... && cd frontend && npm test && npx tsc --noEmit && npm run lint`
Expected: all PASS (parity now at 14 types).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: revive gws frontend on the Go module (7 widgets, bound mutations)"
```

---

### Task 15: pomodoro Go — repo + notify service + module

**Decision (from handoff):** the pomodoro **engine stays in TS** — it is view-state-heavy (500ms tick loop, `useSyncExternalStore` snapshots, pause/resume UI) and must drive the card every frame; Go takes the two things the webview can't own: the session log (`pomodoro_sessions` table) and native notifications (Wails v3 `pkg/services/notifications` replaces `@tauri-apps/plugin-notification`).

**Files:**
- Create: `internal/modules/pomodoro/module.go`
- Create: `internal/modules/pomodoro/repo.go`
- Create: `internal/modules/pomodoro/service.go`
- Create: `internal/modules/pomodoro/repo_test.go`
- Create: `internal/modules/pomodoro/service_test.go`
- Modify: `main.go`

**Interfaces:**
- Consumes: `pomodoro_sessions` table (already in `internal/db/migrations/0001_init.sql`); `notifications.New()` / `NotificationOptions{ID, Title, Body}` from `github.com/wailsapp/wails/v3/pkg/services/notifications`; `db.Open`/`db.Migrate` in tests (mirror `internal/modules/bookmarks/repo_test.go`'s setup).
- Produces: `pomodoro.New() *Module` (`TimerType = "pomodoro.timer"`, `Refreshable: false`, fetch no-op); `pomodoro.NewService(repo, notifier) *Service` with bound `AddSession(finishedAt int64) error`, `CountToday() (int, error)`, `Notify(title, body string) bool`.

- [ ] **Step 1: Write the failing tests**

`internal/modules/pomodoro/repo_test.go` (open a real temp-file DB exactly the way `internal/modules/bookmarks/repo_test.go` does — copy its `db.Open`+`db.Migrate` setup helper):

```go
package pomodoro

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"pulse/internal/db"
)

func testRepo(t *testing.T) *Repo {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	if err := db.Migrate(d); err != nil {
		t.Fatal(err)
	}
	return &Repo{DB: d}
}

func TestCountTodayCountsSinceLocalMidnight(t *testing.T) {
	r := testRepo(t)
	ctx := context.Background()
	now := time.Now()
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())

	if err := r.AddSession(ctx, midnight.Add(time.Hour).UnixMilli()); err != nil {
		t.Fatal(err)
	}
	if err := r.AddSession(ctx, midnight.Add(2*time.Hour).UnixMilli()); err != nil {
		t.Fatal(err)
	}
	if err := r.AddSession(ctx, midnight.Add(-time.Hour).UnixMilli()); err != nil { // yesterday
		t.Fatal(err)
	}

	got, err := r.CountToday(ctx, now)
	if err != nil {
		t.Fatal(err)
	}
	if got != 2 {
		t.Errorf("CountToday = %d, want 2 (yesterday's session excluded)", got)
	}
}
```

`internal/modules/pomodoro/service_test.go`:

```go
package pomodoro

import (
	"errors"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/services/notifications"
)

type fakeNotifier struct {
	authorized  bool
	requestOK   bool
	requestErr  error
	sendErr     error
	sent        []notifications.NotificationOptions
	requested   int
}

func (f *fakeNotifier) CheckNotificationAuthorization() (bool, error) { return f.authorized, nil }
func (f *fakeNotifier) RequestNotificationAuthorization() (bool, error) {
	f.requested++
	return f.requestOK, f.requestErr
}
func (f *fakeNotifier) SendNotification(o notifications.NotificationOptions) error {
	f.sent = append(f.sent, o)
	return f.sendErr
}

func TestNotifySendsWhenAuthorized(t *testing.T) {
	n := &fakeNotifier{authorized: true}
	s := NewService(nil, n)
	if !s.Notify("Pomodoro done", "take a break") {
		t.Fatal("want true")
	}
	if len(n.sent) != 1 || n.sent[0].Title != "Pomodoro done" || n.sent[0].ID == "" {
		t.Errorf("sent = %+v", n.sent)
	}
}

func TestNotifyLazilyRequestsPermission(t *testing.T) {
	n := &fakeNotifier{authorized: false, requestOK: true}
	s := NewService(nil, n)
	if !s.Notify("t", "b") {
		t.Fatal("want true after granted request")
	}
	if n.requested != 1 {
		t.Errorf("requested %d times", n.requested)
	}
}

func TestNotifyDeniedOrFailingReturnsFalse(t *testing.T) {
	denied := &fakeNotifier{authorized: false, requestOK: false}
	if NewService(nil, denied).Notify("t", "b") {
		t.Error("denied must return false")
	}
	reqErr := &fakeNotifier{authorized: false, requestErr: errors.New("boom")}
	if NewService(nil, reqErr).Notify("t", "b") {
		t.Error("request error must return false")
	}
	sendErr := &fakeNotifier{authorized: true, sendErr: errors.New("boom")}
	if NewService(nil, sendErr).Notify("t", "b") {
		t.Error("send error must return false")
	}
}

func TestModuleManifest(t *testing.T) {
	ms := New().Manifests()
	if len(ms) != 1 || ms[0].Type != TimerType || ms[0].Refreshable {
		t.Fatalf("Manifests = %+v", ms)
	}
	if len(ms[0].ConfigFields) != 4 {
		t.Errorf("want 4 number fields, got %+v", ms[0].ConfigFields)
	}
}
```

- [ ] **Step 2: Run — expect FAIL**

Run: `go test ./internal/modules/pomodoro/ -v`

- [ ] **Step 3: Implement `internal/modules/pomodoro/repo.go`**

```go
// Package pomodoro backs the pomodoro.timer widget: the countdown engine
// stays in the frontend (view-state), Go owns the session log and native
// notifications.
package pomodoro

import (
	"context"
	"database/sql"
	"time"
)

// Repo is the pomodoro_sessions repository (module-owned table).
type Repo struct{ DB *sql.DB }

// AddSession records one completed work block. finishedAt is epoch millis.
func (r *Repo) AddSession(ctx context.Context, finishedAt int64) error {
	_, err := r.DB.ExecContext(ctx,
		`INSERT INTO pomodoro_sessions (finished_at) VALUES (?)`, finishedAt)
	return err
}

// CountToday counts completed work blocks since local midnight of the day
// containing now.
func (r *Repo) CountToday(ctx context.Context, now time.Time) (int, error) {
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).UnixMilli()
	var n int
	err := r.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM pomodoro_sessions WHERE finished_at >= ?`, dayStart).Scan(&n)
	return n, err
}
```

- [ ] **Step 4: Implement `internal/modules/pomodoro/service.go`**

```go
package pomodoro

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"
)

// notifier is the seam over the Wails notifications service; tests fake it.
type notifier interface {
	CheckNotificationAuthorization() (bool, error)
	RequestNotificationAuthorization() (bool, error)
	SendNotification(options notifications.NotificationOptions) error
}

// Service is the Wails-bound face of the pomodoro module: session-log CRUD
// for the frontend engine, plus native notifications.
type Service struct {
	repo   *Repo
	notify notifier
}

func NewService(r *Repo, n notifier) *Service { return &Service{repo: r, notify: n} }

// AddSession records one completed work block (finishedAt: epoch millis).
func (s *Service) AddSession(finishedAt int64) error {
	return s.repo.AddSession(context.Background(), finishedAt)
}

// CountToday returns completed work blocks since local midnight.
func (s *Service) CountToday() (int, error) {
	return s.repo.CountToday(context.Background(), time.Now())
}

// Notify fires a native notification for a phase ending, lazily requesting
// permission on first use. Returns false (never errors) when permission is
// denied or delivery fails — the widget shows an in-card hint but keeps
// timing.
func (s *Service) Notify(title, body string) bool {
	granted, err := s.notify.CheckNotificationAuthorization()
	if err != nil {
		return false
	}
	if !granted {
		granted, err = s.notify.RequestNotificationAuthorization()
		if err != nil || !granted {
			return false
		}
	}
	return s.notify.SendNotification(notifications.NotificationOptions{
		ID: uuid.NewString(), Title: title, Body: body,
	}) == nil
}
```

- [ ] **Step 5: Implement `internal/modules/pomodoro/module.go`**

```go
package pomodoro

import (
	"context"

	"pulse/internal/module"
)

const TimerType = "pomodoro.timer"

func f64(v float64) *float64 { return &v }

type Module struct{}

func New() *Module { return &Module{} }

func (Module) Manifests() []module.Manifest {
	return []module.Manifest{{
		Type: TimerType, Title: "Pomodoro", Refreshable: false,
		ConfigFields: []module.ConfigField{
			{Key: "workMinutes", Label: "Work (minutes)", Kind: module.FieldNumber, Default: 25.0, Min: f64(1), Max: f64(180)},
			{Key: "shortBreakMinutes", Label: "Short break (minutes)", Kind: module.FieldNumber, Default: 5.0, Min: f64(1), Max: f64(60)},
			{Key: "longBreakMinutes", Label: "Long break (minutes)", Kind: module.FieldNumber, Default: 15.0, Min: f64(1), Max: f64(60)},
			{Key: "pomodorosPerLongBreak", Label: "Pomodoros per long break", Kind: module.FieldNumber, Default: 4.0, Min: f64(1), Max: f64(12)},
		},
	}}
}

// Live widget: state lives in the frontend engine; the cache pipeline
// carries no data.
func (Module) Fetch(ctx context.Context, widgetType string, config map[string]any) (any, error) {
	return struct{}{}, nil
}
```

- [ ] **Step 6: Run — expect PASS**

Run: `go test -race ./internal/modules/pomodoro/ -v`

- [ ] **Step 7: Wire the services in `main.go`** (registry entry waits for Task 16, mirroring the gws split)

Add imports `"pulse/internal/modules/pomodoro"` and `"github.com/wailsapp/wails/v3/pkg/services/notifications"`. Before `application.New`:

```go
	notifier := notifications.New()
	pomoRepo := &pomodoro.Repo{DB: d}
```

In the registry construction add `pomodoro.New()`. In the `Services` list add:

```go
			application.NewService(notifier),
			application.NewService(pomodoro.NewService(pomoRepo, notifier)),
```

(The notifications service is registered as a Wails service so its `ServiceStartup` lifecycle hook runs — required for the darwin delegate setup — even though the frontend only talks to our wrapper.)

**Same green-parity rule as Task 13:** `main.go` registry may gain `pomodoro.New()` now, but do NOT touch `internal/modules/all.go` or run the generator until Task 16.

Run: `go build ./... && go test ./internal/... ./cmd/...`
Expected: builds, all PASS.

- [ ] **Step 8: Commit**

```bash
git add internal/modules/pomodoro/ main.go
git commit -m "feat: pomodoro module in Go — session log + native notifications service"
```

---

### Task 16: pomodoro wiring completion + frontend move

**Files:**
- Modify: `internal/modules/all.go` (append `pomodoro.New()`), regenerate `frontend/src/widget-types.gen.json`
- Modify: `frontend/src/lib/backend.ts` (export `Pomodoro` bindings)
- Move: `frontend/legacy-modules/pomodoro/` → `frontend/src/modules/pomodoro/` (rewrite `manifest.ts`, `render.ts`, `repo.ts`, `notify.ts`, `use-pomodoro.ts`; keep `engine.ts` as-is)
- Move: `frontend/legacy-modules/__tests__/{pomodoro-engine.test.ts,pomodoro-widget.test.tsx}` → `frontend/tests/modules/`
- Delete: `frontend/legacy-modules/__tests__/{pomodoro-notify,pomodoro-repo,pomodoro-registration}.test.ts`
- Modify: `frontend/src/modules/render.ts`

**Interfaces:**
- Consumes: `Pomodoro.AddSession/CountToday/Notify` bindings (Task 15).
- Produces: TS `manifest.ts` with `POMODORO_TYPE`, `PomodoroConfig`, `pomodoroDefaultConfig`, `isValidPomodoroConfig` (replaces the Zod safeParse guard); `engine.ts` unchanged.

- [ ] **Step 1: Finish Go wiring + regen bindings**

`internal/modules/all.go`: import `"pulse/internal/modules/pomodoro"`, append `pomodoro.New(),`.
Run: `go run ./cmd/gen-widget-types && wails3 generate bindings -ts -i`

- [ ] **Step 2: Export the Pomodoro bindings**

`frontend/src/lib/backend.ts`:

```ts
import * as Pomodoro from "../../bindings/pulse/internal/modules/pomodoro/service";
```

and extend the export line: `export { Dashboard, Bookmarks, System, Gws, Pomodoro };`

- [ ] **Step 3: Move files**

```bash
cd frontend
git mv legacy-modules/pomodoro src/modules/pomodoro
git mv legacy-modules/__tests__/pomodoro-engine.test.ts tests/modules/
git mv legacy-modules/__tests__/pomodoro-widget.test.tsx tests/modules/
git rm legacy-modules/__tests__/pomodoro-notify.test.ts legacy-modules/__tests__/pomodoro-repo.test.ts \
  legacy-modules/__tests__/pomodoro-registration.test.ts
git rm src/modules/pomodoro/fetch.ts
```

- [ ] **Step 4: Rewrite `frontend/src/modules/pomodoro/manifest.ts`**

```ts
export const POMODORO_TYPE = "pomodoro.timer";

/** All fields render as number inputs in the server-generated config form. */
export interface PomodoroConfig {
  workMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  pomodorosPerLongBreak: number;
}
export const pomodoroDefaultConfig: PomodoroConfig = {
  workMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  pomodorosPerLongBreak: 4,
};

/**
 * Guard against a stale/invalid config reaching the engine (mirrors the
 * bounds the Go manifest enforces) — same pattern as
 * system/manifest.ts#isValidSystemStatsConfig.
 */
export function isValidPomodoroConfig(config: unknown): config is PomodoroConfig {
  if (typeof config !== "object" || config === null) return false;
  const c = config as Record<string, unknown>;
  const inRange = (v: unknown, min: number, max: number) =>
    typeof v === "number" && v >= min && v <= max;
  return (
    inRange(c.workMinutes, 1, 180) &&
    inRange(c.shortBreakMinutes, 1, 60) &&
    inRange(c.longBreakMinutes, 1, 60) &&
    inRange(c.pomodorosPerLongBreak, 1, 12)
  );
}

/**
 * Live widget: the cache pipeline carries no data — the card renders from the
 * engine singleton (src/modules/pomodoro/engine.ts).
 */
export type PomodoroData = Record<string, never>;
```

- [ ] **Step 5: Rewrite `repo.ts`, `notify.ts`, `use-pomodoro.ts`**

`frontend/src/modules/pomodoro/repo.ts`:

```ts
import { Pomodoro } from "@/lib/backend";

/** Record one completed work block. `finishedAt` is Date.now() ms. */
export function addSession(finishedAt: number): Promise<void> {
  return Pomodoro.AddSession(finishedAt);
}

/** Completed work blocks since local midnight (midnight computed in Go). */
export function countSessionsToday(): Promise<number> {
  return Pomodoro.CountToday();
}
```

`frontend/src/modules/pomodoro/notify.ts`:

```ts
import { Pomodoro } from "@/lib/backend";

/**
 * Fire a native notification for a phase ending (the Go side lazily requests
 * permission on first use). Resolves false (never rejects) when permission is
 * denied or delivery fails — the engine shows an in-card hint but keeps
 * timing.
 */
export async function notifyPhaseEnd(title: string, body: string): Promise<boolean> {
  try {
    return await Pomodoro.Notify(title, body);
  } catch {
    return false;
  }
}
```

`frontend/src/modules/pomodoro/use-pomodoro.ts`:

```ts
import { useEffect, useSyncExternalStore } from "react";
import { pomodoroEngine, type PomodoroSnapshot } from "./engine";
import { isValidPomodoroConfig, pomodoroDefaultConfig, type PomodoroConfig } from "./manifest";

/** Subscribe this component to the engine and keep it tuned to the widget config. */
export function usePomodoro(config: PomodoroConfig): PomodoroSnapshot {
  useEffect(() => {
    // Same guard as use-system-stats: after a breaking schema change the shell
    // can hand the body stale invalid config — it must never reach the engine
    // (NaN minutes would make durations NaN and the deadline math nonsense).
    pomodoroEngine.configure(isValidPomodoroConfig(config) ? config : pomodoroDefaultConfig);
  }, [config]);
  return useSyncExternalStore(pomodoroEngine.subscribe, pomodoroEngine.getSnapshot);
}
```

`engine.ts` needs **no changes** — it imports `{ pomodoroDefaultConfig, type PomodoroConfig }` from `./manifest` (kept), `notifyPhaseEnd` from `./notify`, and `addSession`/`countSessionsToday` from `./repo` (same signatures). The moved `pomodoro-engine.test.ts` mocks `@/modules/pomodoro/notify` and `@/modules/pomodoro/repo`, so it keeps passing untouched.

- [ ] **Step 6: Rewrite `frontend/src/modules/pomodoro/render.ts`**

```ts
import { FiClock } from "react-icons/fi";
import { registerRender } from "@/modules/render-registry";
import { POMODORO_TYPE } from "./manifest";
import { PomodoroWidget } from "./widgets/pomodoro-widget";

registerRender(POMODORO_TYPE, {
  Component: PomodoroWidget,
  icon: { Icon: FiClock, className: "text-slate-500 dark:text-slate-400" },
});
```

- [ ] **Step 7: Register + verify**

Add `import "./pomodoro/render";` to `frontend/src/modules/render.ts`.

Run: `cd frontend && grep -rn "pomodoroManifest\|pomodoroConfigSchema\|@tauri-apps/plugin-notification" src tests`
Expected: no matches.

Run: `go test ./internal/... ./cmd/... && cd frontend && npm test && npx tsc --noEmit && npm run lint`
Expected: all PASS — `widget-types.gen.json` now lists all 17 types.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: revive pomodoro frontend — TS engine on Go session log + native notifications"
```

---

### Task 17: integration health service (Go)

**Files:**
- Create: `internal/integration/integration.go` (types + probe classification)
- Create: `internal/integration/service.go`
- Create: `internal/integration/service_test.go`
- Create: `internal/db/integration.go` (`RemoveWidgetsAndSetPref`)
- Create: `internal/db/integration_test.go`
- Modify: `internal/modules/github/module.go`, `internal/modules/jira/module.go`, `internal/modules/gws/module.go`, `internal/modules/ccusage/module.go` — each gains an `Integration()` descriptor constructor
- Modify: `main.go`

**Interfaces:**
- Consumes: `db.Store`, `module.Registry` (manifest `Integration` field → widget counts), `cli.Error` (not-found classification).
- Produces: bound service `integration.Service` with `Statuses(force bool) ([]Status, error)`, `Enable(id string) error`, `Disable(id string, deleteWidgets bool) (DisableResult, error)`; `Status` JSON mirrors the TS `IntegrationStatus` contract `{id, name, tool, health{installed, authed, detail?}, enabled, override, widgetCount}` where `authed` is `true|false|"n/a"` and `override` is `boolean|null`; `github.Integration() integration.Integration` etc. Task 18 un-stubs the frontend on this.

- [ ] **Step 1: Write the failing tests**

`internal/db/integration_test.go`:

```go
package db_test

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"

	"pulse/internal/db"
)

func openStore(t *testing.T) *db.Store {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	if err := db.Migrate(d); err != nil {
		t.Fatal(err)
	}
	return db.NewStore(d)
}

func TestRemoveWidgetsAndSetPrefAtomic(t *testing.T) {
	s := openStore(t)
	ctx := context.Background()
	for _, id := range []string{"w1", "w2", "w3"} {
		if err := s.AddWidget(ctx, db.Widget{ID: id, Type: "github.prs", TabID: "default", Config: json.RawMessage(`{}`)}); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.RemoveWidgetsAndSetPref(ctx, []string{"w1", "w2"}, "integration.github.enabled", "false"); err != nil {
		t.Fatal(err)
	}
	widgets, err := s.Widgets(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(widgets) != 1 || widgets[0].ID != "w3" {
		t.Fatalf("widgets = %+v", widgets)
	}
	v, err := s.Pref(ctx, "integration.github.enabled", "")
	if err != nil {
		t.Fatal(err)
	}
	if v != "false" {
		t.Errorf("pref = %q, want false", v)
	}
}

func TestRemoveWidgetsAndSetPrefNoWidgets(t *testing.T) {
	s := openStore(t)
	if err := s.RemoveWidgetsAndSetPref(context.Background(), nil, "integration.x.enabled", "false"); err != nil {
		t.Fatal(err)
	}
	v, _ := s.Pref(context.Background(), "integration.x.enabled", "")
	if v != "false" {
		t.Errorf("pref = %q", v)
	}
}
```

`internal/integration/service_test.go`:

```go
package integration

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"

	"pulse/internal/cli"
	"pulse/internal/db"
	"pulse/internal/module"
)

type manifestOnly struct{ manifests []module.Manifest }

func (m manifestOnly) Manifests() []module.Manifest { return m.manifests }
func (manifestOnly) Fetch(ctx context.Context, widgetType string, config map[string]any) (any, error) {
	return nil, nil
}

func testService(t *testing.T, integrations ...Integration) (*Service, *db.Store) {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	if err := db.Migrate(d); err != nil {
		t.Fatal(err)
	}
	store := db.NewStore(d)
	reg, err := module.NewRegistry(manifestOnly{manifests: []module.Manifest{
		{Type: "github.prs", Integration: "github", Refreshable: true},
		{Type: "system.stats"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	return NewService(store, reg, integrations), store
}

func TestProbeClassification(t *testing.T) {
	ok := probeHealth(context.Background(), Integration{Probe: func(ctx context.Context) error { return nil }})
	if !ok.Installed || ok.Authed != true {
		t.Errorf("healthy = %+v", ok)
	}
	notFound := probeHealth(context.Background(), Integration{Probe: func(ctx context.Context) error {
		return &cli.Error{Kind: cli.KindNotFound, Message: "gh not found — install it"}
	}})
	if notFound.Installed || notFound.Authed != false || notFound.Detail == "" {
		t.Errorf("not-found = %+v", notFound)
	}
	authFail := probeHealth(context.Background(), Integration{Probe: func(ctx context.Context) error {
		return errors.New("401")
	}})
	if !authFail.Installed || authFail.Authed != false {
		t.Errorf("auth-fail = %+v", authFail)
	}
	noAuth := probeHealth(context.Background(), Integration{NoAuth: true, Probe: func(ctx context.Context) error { return nil }})
	if noAuth.Authed != "n/a" {
		t.Errorf("noAuth healthy = %+v", noAuth)
	}
	noAuthFail := probeHealth(context.Background(), Integration{NoAuth: true, Probe: func(ctx context.Context) error {
		return errors.New("boom")
	}})
	if !noAuthFail.Installed || noAuthFail.Authed != "n/a" || noAuthFail.Detail == "" {
		t.Errorf("noAuth fail = %+v", noAuthFail)
	}
}

func TestStatusesCachesWithTTLAndForce(t *testing.T) {
	var probes atomic.Int32
	svc, _ := testService(t, Integration{
		ID: "github", Name: "GitHub", Tool: &Tool{Bin: "gh"},
		Probe: func(ctx context.Context) error { probes.Add(1); return nil },
	})
	if _, err := svc.Statuses(false); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Statuses(false); err != nil {
		t.Fatal(err)
	}
	if got := probes.Load(); got != 1 {
		t.Errorf("probes = %d, want 1 (TTL cache)", got)
	}
	if _, err := svc.Statuses(true); err != nil {
		t.Fatal(err)
	}
	if got := probes.Load(); got != 2 {
		t.Errorf("probes = %d, want 2 after force", got)
	}
}

func TestStatusesDedupsConcurrentProbes(t *testing.T) {
	var probes atomic.Int32
	gate := make(chan struct{})
	svc, _ := testService(t, Integration{
		ID: "github", Name: "GitHub", Tool: &Tool{Bin: "gh"},
		Probe: func(ctx context.Context) error { probes.Add(1); <-gate; return nil },
	})
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := svc.Statuses(true); err != nil {
				t.Error(err)
			}
		}()
	}
	// Let both goroutines reach healthFor before releasing the probe.
	for probes.Load() == 0 {
	}
	close(gate)
	wg.Wait()
	if got := probes.Load(); got != 1 {
		t.Errorf("probes = %d, want 1 (in-flight dedup)", got)
	}
}

func TestResolveEnabled(t *testing.T) {
	tr, fa := true, false
	cases := []struct {
		hasTool, installed bool
		override           *bool
		want               bool
	}{
		{true, true, nil, true},
		{true, false, nil, false},   // tool missing → auto-disabled
		{false, false, nil, true},   // no tool concept → enabled
		{true, false, &tr, true},    // override wins
		{true, true, &fa, false},
	}
	for i, c := range cases {
		if got := resolveEnabled(c.hasTool, c.installed, c.override); got != c.want {
			t.Errorf("case %d: got %v", i, got)
		}
	}
}

func TestDisableConfirmFlowAndWidgetCount(t *testing.T) {
	svc, store := testService(t, Integration{
		ID: "github", Name: "GitHub", Tool: &Tool{Bin: "gh"},
		Probe: func(ctx context.Context) error { return nil },
	})
	ctx := context.Background()
	if err := store.AddWidget(ctx, db.Widget{ID: "w1", Type: "github.prs", TabID: "default", Config: json.RawMessage(`{}`)}); err != nil {
		t.Fatal(err)
	}

	statuses, err := svc.Statuses(false)
	if err != nil {
		t.Fatal(err)
	}
	if statuses[0].WidgetCount != 1 {
		t.Errorf("widgetCount = %d", statuses[0].WidgetCount)
	}

	res, err := svc.Disable("github", false)
	if err != nil {
		t.Fatal(err)
	}
	if res.ConfirmRequired != 1 || res.Deleted != 0 {
		t.Fatalf("res = %+v, want confirm required", res)
	}
	if widgets, _ := store.Widgets(ctx); len(widgets) != 1 {
		t.Fatal("widgets must survive an unconfirmed disable")
	}

	res, err = svc.Disable("github", true)
	if err != nil {
		t.Fatal(err)
	}
	if res.Deleted != 1 {
		t.Fatalf("res = %+v", res)
	}
	if widgets, _ := store.Widgets(ctx); len(widgets) != 0 {
		t.Fatal("widgets must be deleted on confirmed disable")
	}

	statuses, err = svc.Statuses(false)
	if err != nil {
		t.Fatal(err)
	}
	if statuses[0].Enabled || statuses[0].Override == nil || *statuses[0].Override != false {
		t.Errorf("post-disable status = %+v", statuses[0])
	}

	if err := svc.Enable("github"); err != nil {
		t.Fatal(err)
	}
	statuses, _ = svc.Statuses(false)
	if !statuses[0].Enabled {
		t.Errorf("post-enable status = %+v", statuses[0])
	}
}
```

- [ ] **Step 2: Run — expect FAIL**

Run: `go test ./internal/integration/ ./internal/db/ -v -run 'Integration|Probe|Statuses|ResolveEnabled|Disable|RemoveWidgets'`

- [ ] **Step 3: Implement `internal/db/integration.go`**

```go
package db

import (
	"context"
	"strings"
)

// RemoveWidgetsAndSetPref deletes the given widgets (their cache rows cascade
// via FK) and upserts a pref in one transaction — disabling an integration
// must be atomic.
func (s *Store) RemoveWidgetsAndSetPref(ctx context.Context, ids []string, key, value string) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if len(ids) > 0 {
		placeholders := strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")
		args := make([]any, len(ids))
		for i, id := range ids {
			args[i] = id
		}
		if _, err := tx.ExecContext(ctx,
			`DELETE FROM widgets WHERE id IN (`+placeholders+`)`, args...); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO prefs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		key, value); err != nil {
		return err
	}
	return tx.Commit()
}
```

- [ ] **Step 4: Implement `internal/integration/integration.go`**

```go
// Package integration ports src/server/integration-service.ts: per-CLI
// health probes with a TTL cache and in-flight dedup, and enable/disable
// with a widget-delete confirm step.
package integration

import (
	"context"
	"errors"

	"pulse/internal/cli"
)

// Tool describes the CLI an integration depends on.
type Tool struct {
	Bin         string `json:"bin"`
	InstallHint string `json:"installHint"`
	AuthHint    string `json:"authHint"`
}

// Integration is one registered integration; Probe is a lightweight
// authenticated CLI call (or a version check for NoAuth tools).
type Integration struct {
	ID     string
	Name   string
	Tool   *Tool
	NoAuth bool
	Probe  func(ctx context.Context) error
}

// Health mirrors the TS IntegrationHealth contract. Authed is true, false,
// or the string "n/a" (tools with no auth concept).
type Health struct {
	Installed bool   `json:"installed"`
	Authed    any    `json:"authed"`
	Detail    string `json:"detail,omitempty"`
}

// Status mirrors the TS IntegrationStatus contract.
type Status struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Tool        *Tool  `json:"tool"`
	Health      Health `json:"health"`
	Enabled     bool   `json:"enabled"`
	Override    *bool  `json:"override"`
	WidgetCount int    `json:"widgetCount"`
}

// probeHealth runs the probe and classifies. A not-found cli.Error means the
// tool isn't installed; any other failure means installed but auth
// unconfirmed (for NoAuth tools that isn't an auth problem, so Authed stays
// "n/a" with the failure in Detail).
func probeHealth(ctx context.Context, integ Integration) Health {
	authedOK := any(true)
	if integ.NoAuth {
		authedOK = "n/a"
	}
	err := integ.Probe(ctx)
	if err == nil {
		return Health{Installed: true, Authed: authedOK}
	}
	var ce *cli.Error
	if errors.As(err, &ce) && ce.Kind == cli.KindNotFound {
		return Health{Installed: false, Authed: false, Detail: err.Error()}
	}
	authed := any(false)
	if integ.NoAuth {
		authed = "n/a"
	}
	return Health{Installed: true, Authed: authed, Detail: err.Error()}
}

// resolveEnabled: an explicit override wins; otherwise enabled unless the
// tool exists but isn't installed.
func resolveEnabled(hasTool, installed bool, override *bool) bool {
	if override != nil {
		return *override
	}
	return !hasTool || installed
}
```

- [ ] **Step 5: Implement `internal/integration/service.go`**

```go
package integration

import (
	"context"
	"sync"
	"time"

	"pulse/internal/db"
	"pulse/internal/module"
)

const healthTTL = 30 * time.Second

type cachedHealth struct {
	at     time.Time
	health Health
}

type flight struct {
	done   chan struct{}
	health Health
}

// Service is the Wails-bound integrations service. All bound methods use
// context.Background() — Wails invokes them directly.
type Service struct {
	store        *db.Store
	registry     *module.Registry
	integrations []Integration

	mu       sync.Mutex
	cache    map[string]cachedHealth
	inflight map[string]*flight
}

func NewService(store *db.Store, reg *module.Registry, integrations []Integration) *Service {
	return &Service{
		store: store, registry: reg, integrations: integrations,
		cache: map[string]cachedHealth{}, inflight: map[string]*flight{},
	}
}

// healthFor probes with a TTL cache; concurrent probes of the same
// integration share one in-flight CLI call (a second caller waits on the
// first's result instead of spawning a second probe).
func (s *Service) healthFor(ctx context.Context, integ Integration, force bool) Health {
	s.mu.Lock()
	if !force {
		if c, ok := s.cache[integ.ID]; ok && time.Since(c.at) < healthTTL {
			s.mu.Unlock()
			return c.health
		}
	}
	if f, ok := s.inflight[integ.ID]; ok {
		s.mu.Unlock()
		<-f.done
		return f.health
	}
	f := &flight{done: make(chan struct{})}
	s.inflight[integ.ID] = f
	s.mu.Unlock()

	f.health = probeHealth(ctx, integ)

	s.mu.Lock()
	s.cache[integ.ID] = cachedHealth{at: time.Now(), health: f.health}
	delete(s.inflight, integ.ID)
	s.mu.Unlock()
	close(f.done)
	return f.health
}

func (s *Service) prefKey(id string) string { return "integration." + id + ".enabled" }

func (s *Service) override(ctx context.Context, id string) (*bool, error) {
	v, err := s.store.Pref(ctx, s.prefKey(id), "")
	if err != nil {
		return nil, err
	}
	switch v {
	case "true":
		t := true
		return &t, nil
	case "false":
		f := false
		return &f, nil
	}
	return nil, nil
}

func (s *Service) typesFor(id string) map[string]bool {
	types := map[string]bool{}
	for _, m := range s.registry.Manifests() {
		if m.Integration == id {
			types[m.Type] = true
		}
	}
	return types
}

// Statuses resolves every integration: health (cached/deduped, probed
// concurrently so a hung CLI doesn't block the others), enable override,
// and how many widgets it owns.
func (s *Service) Statuses(force bool) ([]Status, error) {
	ctx := context.Background()
	widgets, err := s.store.Widgets(ctx)
	if err != nil {
		return nil, err
	}

	statuses := make([]Status, len(s.integrations))
	errs := make([]error, len(s.integrations))
	var wg sync.WaitGroup
	for i, integ := range s.integrations {
		wg.Add(1)
		go func() {
			defer wg.Done()
			health := s.healthFor(ctx, integ, force)
			override, err := s.override(ctx, integ.ID)
			if err != nil {
				errs[i] = err
				return
			}
			types := s.typesFor(integ.ID)
			count := 0
			for _, w := range widgets {
				if types[w.Type] {
					count++
				}
			}
			statuses[i] = Status{
				ID: integ.ID, Name: integ.Name, Tool: integ.Tool,
				Health:   health,
				Override: override,
				Enabled:  resolveEnabled(integ.Tool != nil, health.Installed, override),
				WidgetCount: count,
			}
		}()
	}
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			return nil, err
		}
	}
	return statuses, nil
}

// Enable stores a true override.
func (s *Service) Enable(id string) error {
	return s.store.SetPref(context.Background(), s.prefKey(id), "true")
}

// DisableResult: ConfirmRequired > 0 means nothing was changed and the
// caller must retry with deleteWidgets=true after user confirmation.
type DisableResult struct {
	ConfirmRequired int `json:"confirmRequired"`
	Deleted         int `json:"deleted"`
}

// Disable turns an integration off. Its widgets are deleted (cache rows
// cascade); if any exist and deleteWidgets is false, the call reports
// ConfirmRequired instead of changing anything.
func (s *Service) Disable(id string, deleteWidgets bool) (DisableResult, error) {
	ctx := context.Background()
	widgets, err := s.store.Widgets(ctx)
	if err != nil {
		return DisableResult{}, err
	}
	types := s.typesFor(id)
	victims := []string{}
	for _, w := range widgets {
		if types[w.Type] {
			victims = append(victims, w.ID)
		}
	}
	if len(victims) > 0 && !deleteWidgets {
		return DisableResult{ConfirmRequired: len(victims)}, nil
	}
	if err := s.store.RemoveWidgetsAndSetPref(ctx, victims, s.prefKey(id), "false"); err != nil {
		return DisableResult{}, err
	}
	return DisableResult{Deleted: len(victims)}, nil
}
```

- [ ] **Step 6: Add per-module `Integration()` descriptors**

Append to `internal/modules/github/module.go`:

```go
// Integration describes the github CLI for the integrations panel; the
// probe is a cheap authenticated call.
func Integration() integration.Integration {
	return integration.Integration{
		ID: "github", Name: "GitHub",
		Tool: &integration.Tool{
			Bin:         "gh",
			InstallHint: "Install the GitHub CLI — https://cli.github.com (`brew install gh`).",
			AuthHint:    "Run `gh auth login` to authenticate.",
		},
		Probe: func(ctx context.Context) error {
			_, err := RunGh(ctx, []string{"auth", "status"})
			return err
		},
	}
}
```

(add `"pulse/internal/integration"` to the imports). Same pattern for the others:

`internal/modules/jira/module.go`:

```go
func Integration() integration.Integration {
	return integration.Integration{
		ID: "jira", Name: "Jira",
		Tool: &integration.Tool{
			Bin:         "jira",
			InstallHint: "Install jira-cli — https://github.com/ankitpokhrel/jira-cli (`brew install ankitpokhrel/jira-cli/jira-cli`).",
			AuthHint:    "Run `jira init` and set the `JIRA_API_TOKEN` environment variable.",
		},
		Probe: func(ctx context.Context) error {
			_, err := runJira(ctx, []string{"me"})
			return err
		},
	}
}
```

`internal/modules/gws/module.go`:

```go
func Integration() integration.Integration {
	return integration.Integration{
		ID: "gws", Name: "Google Workspace",
		Tool: &integration.Tool{
			Bin:         "gws",
			InstallHint: "Install the `gws` CLI and configure OAuth credentials.",
			AuthHint:    "Run `gws auth login` to authenticate.",
		},
		// getProfile is a cheap authenticated Gmail call — 401 when unauthenticated.
		Probe: func(ctx context.Context) error {
			var out map[string]any
			return runGwsJSON(ctx, []string{
				"gmail", "users", "getProfile", "--params", jsonArg(map[string]any{"userId": "me"}),
			}, &out)
		},
	}
}
```

`internal/modules/ccusage/module.go`:

```go
// ccusage reads local ~/.claude logs — no auth concept, so NoAuth reports
// authed: "n/a".
func Integration() integration.Integration {
	return integration.Integration{
		ID: "ccusage", Name: "Claude Usage (ccusage)",
		Tool: &integration.Tool{
			Bin:         "ccusage",
			InstallHint: "Install ccusage — `npm i -g ccusage`.",
			AuthHint:    "No authentication needed — ccusage reads local ~/.claude logs.",
		},
		NoAuth: true,
		Probe: func(ctx context.Context) error {
			_, err := runCcusage(ctx, []string{"--version"})
			return err
		},
	}
}
```

- [ ] **Step 7: Wire in `main.go`**

Import `"pulse/internal/integration"`. After the registry is built:

```go
	integrations := integration.NewService(store, registry, []integration.Integration{
		github.Integration(), jira.Integration(), gws.Integration(), ccusage.Integration(),
	})
```

Add to the `Services` list:

```go
			application.NewService(integrations),
```

- [ ] **Step 8: Run — expect PASS**

Run: `go test -race ./internal/... ./cmd/... && go build ./...`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add internal/integration/ internal/db/integration.go internal/db/integration_test.go \
  internal/modules/github/module.go internal/modules/jira/module.go \
  internal/modules/gws/module.go internal/modules/ccusage/module.go main.go
git commit -m "feat: integration health service in Go (TTL cache, dedup, disable-with-confirm)"
```

---

### Task 18: integrations frontend un-stub

**Files:**
- Modify: `frontend/src/lib/backend.ts` (export `Integrations` bindings)
- Modify: `frontend/src/lib/dashboard-data.ts` (un-stub `fetchIntegrations` / `toggleIntegration`)
- Delete (if now unreferenced): `frontend/src/modules/integration-registry.ts`, `frontend/src/modules/integrations.ts`
- Keep: `frontend/src/modules/integration-contracts.ts` (client-facing types)

**Interfaces:**
- Consumes: `Integrations.Statuses(force)`, `Integrations.Enable(id)`, `Integrations.Disable(id, deleteWidgets)` (Task 17).
- Produces: working integrations panel + add-widget drawer grouping; `toggleIntegration` keeps its existing signature `(id, enabled, deleteWidgets?) → {statuses, confirmRequired?}` so `integrations-panel.tsx` needs no changes.

- [ ] **Step 1: Regenerate bindings**

Run: `wails3 generate bindings -ts -i`
Expected: `frontend/bindings/pulse/internal/integration/` appears with `service.ts` + `models.ts`.

- [ ] **Step 2: Export the bindings**

`frontend/src/lib/backend.ts`:

```ts
import * as Integrations from "../../bindings/pulse/internal/integration/service";
```

extend the export line: `export { Dashboard, Bookmarks, System, Gws, Pomodoro, Integrations };`

- [ ] **Step 3: Un-stub `frontend/src/lib/dashboard-data.ts`**

Replace the two Plan-1 stubs (currently returning `[]` / throwing) with:

```ts
export async function fetchIntegrations(recheck = false): Promise<IntegrationStatus[]> {
  // The generated Status type matches IntegrationStatus structurally except
  // `authed: any` (Go serializes true | false | "n/a") — cast once here.
  return ((await Integrations.Statuses(recheck)) ?? []) as unknown as IntegrationStatus[];
}

/** Returns { statuses } on success, plus { confirmRequired } when disabling would delete widgets. */
export async function toggleIntegration(
  id: string, enabled: boolean, deleteWidgets = false,
): Promise<{ statuses: IntegrationStatus[]; confirmRequired?: number }> {
  if (enabled) {
    await Integrations.Enable(id);
  } else {
    const res = await Integrations.Disable(id, deleteWidgets);
    if (res.confirmRequired > 0) {
      return { statuses: await fetchIntegrations(true), confirmRequired: res.confirmRequired };
    }
  }
  return { statuses: await fetchIntegrations(true) };
}
```

Add `Integrations` to the existing `@/lib/backend` import in this file.

- [ ] **Step 4: Delete the dead TS integration registry (widget counts & health live in Go now)**

Run: `cd frontend && grep -rn "integration-registry\|modules/integrations" src tests`
For every remaining import, the fix is deletion of the import (registration is server-side). Then:

```bash
git rm src/modules/integration-registry.ts src/modules/integrations.ts
```

(If `src/modules/integrations.ts` is imported for side effects anywhere — e.g. `app-root.tsx` — remove that import line too. `integration-contracts.ts` STAYS.)

- [ ] **Step 5: Verify the panel flow against the running app**

Run: `go test ./internal/... ./cmd/... && cd frontend && npm test && npx tsc --noEmit && npm run lint`
Expected: all PASS (`integrations-panel.test.tsx` mocks `@/lib/dashboard-data`, so it exercises the confirm flow unchanged).

Then `wails3 build && ./bin/pulse`: the integrations panel should list GitHub/Jira/Google Workspace/Claude Usage with live health; disabling one with widgets prompts for confirmation.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: integrations panel on the Go health service"
```

---

### Task 19: final sweep — legacy cleanup, full verification, docs

**Files:**
- Delete: whatever remains of `frontend/legacy-modules/` (should be empty by now)
- Modify: `docs/superpowers/plans/2026-07-22-wails-rewrite-handoff.md` (state update), `CLAUDE.md` (one-line status note)

- [ ] **Step 1: Confirm legacy-modules is empty and remove it**

Run: `find frontend/legacy-modules -type f`
Expected: no files. If anything remains, it was missed by a task — resolve it (port or consciously delete), don't blind-delete. Then:

```bash
git rm -r frontend/legacy-modules
```

Also remove the now-pointless excludes: in `frontend/tsconfig.json` drop `"legacy-modules"` from `exclude`; in `frontend/vitest.config.ts` drop `"**/legacy-modules/**"` from `test.exclude` and its comment block.

- [ ] **Step 2: Full verification**

```bash
go vet ./... && gofmt -l . && go test -race ./internal/... ./cmd/...
cd frontend && npm test && npx tsc --noEmit && npm run lint && cd ..
go run ./cmd/gen-widget-types && git diff --exit-code frontend/src/widget-types.gen.json
wails3 build
```

Expected: gofmt lists nothing, all suites PASS, generator idempotent, build succeeds. Run `./bin/pulse` and spot-check: add one widget of each new module; confirm classified error states for any CLI you're not logged into; gws async dropdowns (calendar, task list, spaces) populate; pomodoro runs a short timer and logs a session (`sqlite3 ~/Library/Application\ Support/com.pulse.dashboard/pulse.db 'select count(*) from pomodoro_sessions'`).

- [ ] **Step 3: Update docs**

In `docs/superpowers/plans/2026-07-22-wails-rewrite-handoff.md`: mark Plan 2 done (all 17 widget types live, integration service ported), correct the stale "do not merge to main" note (Plan 1 already merged), and point Plan 3 at what actually remains (`src-tauri/` deletion, root scripts, CLAUDE.md/create-module rewrite, dependency prune of zod/drizzle/tauri packages from `frontend/package.json`).

In `CLAUDE.md`'s italic header note, update "Backend logic lives in Go under `internal/`" status to reflect that all eight modules are ported (Plan 3 cutover still pending).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: drop legacy-modules; plan 2 verification sweep + doc updates"
```

- [ ] **Step 5: User GUI acceptance pass (hand back to the user)**

Ask the user to run `wails3 build && ./bin/pulse` and check: each new widget renders with cached data after a refresh; gws email hover-actions (archive/mark-read/trash) and task toggling work and refresh; pomodoro notification fires with the window hidden (grant permission on first fire); integrations panel enable/disable round-trips.

---

## Self-review notes (already applied)

- **Payload parity risk called out per module:** every Go payload struct lists explicit camelCase JSON tags and non-nil slice initialization; `errors`/`meetUrl`/`location`/`notes`/`completedAt` carry `omitempty` to match TS optionality. No `CACHE_VERSION` bump is needed — shapes are byte-compatible with the TS fetchers, and the Plan-1 `pulse.db` holds no cache rows for these types yet.
- **Parity-test greenness:** wiring tasks that add Go modules without their frontend (13/15) deliberately touch only `main.go`; `internal/modules/all.go` + `gen-widget-types` + render registration land together in the paired frontend task (14/16), so both parity tests pass at every commit.
- **jira ORDER-BY stripper:** byte-vs-rune index subtlety documented in the task with a regression test (`non-ascii before clause`).
- **`gh search prs` `--limit`:** passed per author, then re-capped after merge — same as TS.
- **Spec coverage check:** spec §Contracts (Module iface, descriptor DSL, per-module services) → Tasks 2–16; §Data flow N+1 goroutines → Tasks 4, 11, 12; §CLI runner two error models → gh/jira (process) Tasks 4/9, gws (payload) Task 11; §Testing (fixtures, registry parity) → every module task + Task 1; integration service (handoff Plan-2 scope) → Tasks 17–18; async field options → Task 13; pomodoro engine placement decision → Task 15 preamble. Out of scope (unchanged): data import, new features, Plan-3 cutover deletions.






