# Tauri Rebuild — Plan 1: fetch/render Registry Rename

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the module system's two-registry split from `server`/`client` vocabulary to `fetch`/`render`, with zero behavior change and the full test suite green throughout.

**Architecture:** The dashboard's modules register into two registries — one describing how a widget *fetches* data (currently "server"), one describing how it *renders* (currently "client"). This is a pure find-and-replace refactor across ~30 files: rename two registry files, ten symbols, the two bootstrap files, and each module's two files (`core`, `github`, `jira`, `gws`, `bookmarks`), then fix every import path. No logic changes. The existing test suite is the safety net — it must pass before and after.

**Tech Stack:** TypeScript, Next.js (App Router), Vitest. Refactor performed with `git mv` + `sed`.

**Why this rename:** it is the first step of the larger Tauri rebuild (see `docs/superpowers/specs/2026-07-10-tauri-rebuild-design.md`). The names `server`/`client` become inaccurate once both halves run in the webview; `fetch`/`render` describe what each half actually does. Doing it now, as an isolated green diff, keeps later Tauri diffs clean.

---

## Symbol rename map (applies everywhere — `src/` and `tests/`)

| Old | New |
|---|---|
| `ServerWidget` | `FetchWidget` |
| `ClientWidget` | `RenderWidget` |
| `registerServerWidget` | `registerFetchWidget` |
| `getServerWidget` | `getFetchWidget` |
| `listServerTypes` | `listFetchTypes` |
| `__clearServerRegistry` | `__clearFetchRegistry` |
| `registerClientWidget` | `registerRenderWidget` |
| `getClientWidget` | `getRenderWidget` |
| `listClientWidgets` | `listRenderWidgets` |
| `__clearClientRegistry` | `__clearRenderRegistry` |

## File rename map

| Old | New |
|---|---|
| `src/modules/server-registry.ts` | `src/modules/fetch-registry.ts` |
| `src/modules/client-registry.ts` | `src/modules/render-registry.ts` |
| `src/modules/server.ts` (bootstrap) | `src/modules/fetch.ts` |
| `src/modules/client.ts` (bootstrap) | `src/modules/render.ts` |
| `src/modules/core/server.ts` | `src/modules/core/fetch.ts` |
| `src/modules/core/client.ts` | `src/modules/core/render.ts` |
| `src/modules/github/server.ts` | `src/modules/github/fetch.ts` |
| `src/modules/github/client.ts` | `src/modules/github/render.ts` |
| `src/modules/jira/server.ts` | `src/modules/jira/fetch.ts` |
| `src/modules/jira/client.ts` | `src/modules/jira/render.ts` |
| `src/modules/gws/server.ts` | `src/modules/gws/fetch.ts` |
| `src/modules/gws/client.ts` | `src/modules/gws/render.ts` |
| `src/modules/bookmarks/server.ts` | `src/modules/bookmarks/fetch.ts` |
| `src/modules/bookmarks/client.ts` | `src/modules/bookmarks/render.ts` |

## Import-path rename map (applies everywhere)

Apply **longest-first** so `@/modules/server-registry` is rewritten before `@/modules/server`.

| Old path | New path |
|---|---|
| `@/modules/server-registry` | `@/modules/fetch-registry` |
| `@/modules/client-registry` | `@/modules/render-registry` |
| `@/modules/server` | `@/modules/fetch` |
| `@/modules/client` | `@/modules/render` |
| `./core/server` | `./core/fetch` |
| `./core/client` | `./core/render` |
| `./github/server` | `./github/fetch` |
| `./github/client` | `./github/render` |
| `./jira/server` | `./jira/fetch` |
| `./jira/client` | `./jira/render` |
| `./gws/server` | `./gws/fetch` |
| `./gws/client` | `./gws/render` |
| `./bookmarks/server` | `./bookmarks/fetch` |
| `./bookmarks/client` | `./bookmarks/render` |

> Note: `import "server-only";` stays untouched — it is a package name, not our module path, and remains correct while we are still on Next.js. It is removed later, in Plan 3 (Tauri cutover).

---

## Task 1: Establish the green baseline

**Files:** none (verification only)

- [ ] **Step 1: Run the full suite to confirm it is green before touching anything**

Run: `npm test`
Expected: PASS (all tests). Record the passing test count — it must be identical after the rename.

- [ ] **Step 2: Confirm a clean working tree**

Run: `git status --short`
Expected: no output (clean). If dirty, stop and resolve before continuing.

---

## Task 2: Rename registry files, bootstrap files, and per-module files

**Files:** all files in the two rename maps above, plus every importer.

This task is atomic: the tree will not compile until all steps complete. Do all steps, then verify.

- [ ] **Step 1: `git mv` the two registry files**

```bash
git mv src/modules/server-registry.ts src/modules/fetch-registry.ts
git mv src/modules/client-registry.ts src/modules/render-registry.ts
```

- [ ] **Step 2: `git mv` the two bootstrap files**

```bash
git mv src/modules/server.ts src/modules/fetch.ts
git mv src/modules/client.ts src/modules/render.ts
```

- [ ] **Step 3: `git mv` each module's two files**

```bash
for m in core github jira gws bookmarks; do
  git mv "src/modules/$m/server.ts" "src/modules/$m/fetch.ts"
  git mv "src/modules/$m/client.ts" "src/modules/$m/render.ts"
done
```

- [ ] **Step 4: Apply the symbol rename across `src/` and `tests/`**

macOS `sed` (this repo runs on darwin). Order does not matter for symbols — each token is distinct.

```bash
FILES=$(rg -l -g '*.ts' -g '*.tsx' 'ServerWidget|ClientWidget|registerServerWidget|getServerWidget|listServerTypes|__clearServerRegistry|registerClientWidget|getClientWidget|listClientWidgets|__clearClientRegistry' src tests)
for f in $FILES; do
  sed -i '' \
    -e 's/ServerWidget/FetchWidget/g' \
    -e 's/ClientWidget/RenderWidget/g' \
    -e 's/registerServerWidget/registerFetchWidget/g' \
    -e 's/getServerWidget/getFetchWidget/g' \
    -e 's/listServerTypes/listFetchTypes/g' \
    -e 's/__clearServerRegistry/__clearFetchRegistry/g' \
    -e 's/registerClientWidget/registerRenderWidget/g' \
    -e 's/getClientWidget/getRenderWidget/g' \
    -e 's/listClientWidgets/listRenderWidgets/g' \
    -e 's/__clearClientRegistry/__clearRenderRegistry/g' \
    "$f"
done
```

> `sed` order within a single invocation is safe here: `registerClientWidget` is matched by its own rule before the bare `ClientWidget` rule could touch it, because each `-e` runs left-to-right on the line but the specific `register…`/`get…`/`list…`/`__clear…` tokens are rewritten to `…Fetch…`/`…Render…` forms whose remainder no longer matches `ServerWidget`/`ClientWidget`. Verify in Step 7 regardless.

- [ ] **Step 5: Apply the import-path rename across `src/` and `tests/`, longest-first**

```bash
FILES=$(rg -l -g '*.ts' -g '*.tsx' '@/modules/server|@/modules/client|\./(core|github|jira|gws|bookmarks)/(server|client)' src tests)
for f in $FILES; do
  sed -i '' \
    -e 's#@/modules/server-registry#@/modules/fetch-registry#g' \
    -e 's#@/modules/client-registry#@/modules/render-registry#g' \
    -e 's#@/modules/server#@/modules/fetch#g' \
    -e 's#@/modules/client#@/modules/render#g' \
    -e 's#\./core/server#./core/fetch#g' \
    -e 's#\./core/client#./core/render#g' \
    -e 's#\./github/server#./github/fetch#g' \
    -e 's#\./github/client#./github/render#g' \
    -e 's#\./jira/server#./jira/fetch#g' \
    -e 's#\./jira/client#./jira/render#g' \
    -e 's#\./gws/server#./gws/fetch#g' \
    -e 's#\./gws/client#./gws/render#g' \
    -e 's#\./bookmarks/server#./bookmarks/fetch#g' \
    -e 's#\./bookmarks/client#./bookmarks/render#g' \
    "$f"
done
```

> The `-e` rules run left-to-right per line, so `@/modules/server-registry` → `@/modules/fetch-registry` fires before the bare `@/modules/server` rule, which then cannot match. Same for `client`.

- [ ] **Step 6: Sanity-check no stale references remain**

Run:
```bash
rg -n 'server-registry|client-registry|@/modules/server\b|@/modules/client\b|/(server|client)"' src tests
```
Expected: **no output**. Any hit is a missed reference — fix it by hand (it will be an unusual quoting the `sed` globs missed). Note `import "server-only"` will NOT match these patterns and is intentionally left alone.

- [ ] **Step 7: Typecheck + full suite**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: PASS, with the **same test count** recorded in Task 1 Step 1.

- [ ] **Step 8: Lint + build**

Run: `npm run lint`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: rename module server/client split to fetch/render"
```

---

## Task 3: Update docs and the create-module skill to the new vocabulary

**Files:**
- Modify: `CLAUDE.md` (project root)
- Modify: `CONTEXT.md`
- Modify: `.claude/skills/create-module/` (all files referencing `server.ts`/`client.ts`/`ServerWidget`/`ClientWidget`/registries)

- [ ] **Step 1: Find every doc/skill reference to the old vocabulary**

Run:
```bash
rg -n 'server\.ts|client\.ts|ServerWidget|ClientWidget|server-registry|client-registry|server-only registry|client registry' CLAUDE.md CONTEXT.md .claude/skills/create-module
```
Expected: a list of hits to update. Read each hit in context before editing.

- [ ] **Step 2: Update `CLAUDE.md`**

In the Architecture section, rewrite the module-split description. Replace:
> - `server.ts` — `fetch()` + actions; registers into the **server-only** registry (CLI-first, but API is fine)
> - `widgets/*.tsx` + `client.ts` — React body; registers into the **client** registry

with:
> - `fetch.ts` — `fetch()` + actions; registers into the **fetch** registry (CLI-first, but API is fine)
> - `widgets/*.tsx` + `render.ts` — React body; registers into the **render** registry

And in the "Add a module" line, replace `src/modules/server.ts` and `src/modules/client.ts` with `src/modules/fetch.ts` and `src/modules/render.ts`.

- [ ] **Step 3: Update `CONTEXT.md` glossary**

For every glossary entry using `server`/`client`/`ServerWidget`/`ClientWidget`/`server-registry`/`client-registry`, apply the symbol and file rename maps above. Keep the surrounding wording; change only the terms.

- [ ] **Step 4: Update the create-module skill**

In `.claude/skills/create-module/`, apply the file rename map (`server.ts`→`fetch.ts`, `client.ts`→`render.ts`), the symbol rename map, the import-path rename map, and the registry-registration function names (`registerServerWidget`→`registerFetchWidget`, `registerClientWidget`→`registerRenderWidget`). If the skill contains a scaffolding template that writes `server.ts`/`client.ts`, rename those template targets too.

- [ ] **Step 5: Verify no old vocabulary remains in docs/skill**

Run:
```bash
rg -n 'server\.ts|client\.ts|ServerWidget|ClientWidget|server-registry|client-registry' CLAUDE.md CONTEXT.md .claude/skills/create-module
```
Expected: **no output** (excluding any legitimate mention of the historical rename, if you chose to add one — avoid adding one).

- [ ] **Step 6: Re-run the suite (docs-only change, but confirm nothing imports a skill fixture)**

Run: `npm test`
Expected: PASS, same test count.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "docs: update module vocabulary to fetch/render"
```

---

## Self-review checklist (performed while writing; re-verify during execution)

- **Spec coverage:** This plan implements exactly the "Module registry split — kept and renamed" section of the spec, including the full symbol/file rename tables. The `import "server-only"` deferral is called out and matches the spec (removal happens in Plan 3).
- **Placeholder scan:** No TBDs. Every step has an exact command or exact edit. Doc edits (Task 3) quote the before/after text.
- **Type consistency:** Symbol map is closed and applied uniformly; Step 6/Step 5 greps prove no old symbol survives. `npx tsc --noEmit` (Task 2 Step 7) proves the rename is type-consistent.

## Out of scope (later plans)

- Making repos async / sqlite-proxy seam / transaction→batch — **Plan 2**.
- Removing `import "server-only"`, deleting API routes + RSC, Tauri scaffolding, shell/sql plugins, PATH probe, tray/autostart — **Plan 3**.
