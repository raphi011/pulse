# App review — 2026-07-13

Full-codebase review (~6.7k LOC) at commit `a0b554a`. Four parallel review passes: core/data layer, integration modules, React UI, tests/config. All high/medium findings verified against actual code (snippets read, `gh` CLI flag semantics confirmed against installed CLI, Zod JSON-schema output confirmed against installed zod).

**Overall: solid.** Architecture clean (manifest/fetch/render split holds everywhere, no server leakage into webview), test suite genuinely good (400 tests, real sqlite through real migrations, recorded CLI fixtures), lint + tsc clean, migrations match schema exactly, drag/reorder math correct, no XSS sinks, no shell interpolation. Nothing architectural below.

Suggested fix order: S1+S2 (one sitting), then F1, F2, F5, then the error-path UX cluster F6/F7/F9.

## Security

- [x] **S1 (HIGH)** — CSP disabled: `src-tauri/tauri.conf.json:25` `"csp": null`. Webview renders remote strings (PR titles, mail subjects, chat messages); React auto-escaping is the only defense layer. Fix: strict CSP (`default-src 'self'` etc.) — app is a fully local SPA, nearly free.
- [ ] **S2 (MEDIUM)** — Shell scope wide open: `src-tauri/capabilities/default.json:19-31`, all 4 CLIs (`gh`/`jira`/`gws`/`ccusage`) with `"args": true` in both allow-execute and allow-spawn. Combined with S1, any injection = arbitrary `gh repo delete` / `gws` mail exfil with cached creds. Direct config→argv paths verified safe (argv arrays via `Command.create`, flag-value positions, repo regex `manifest.ts:10`), but scope is the escalation amplifier. Fix: enumerated per-arg validator lists/regexes covering only the subcommands modules use.
- [ ] **S3 (LOW)** — `sql:allow-load` (`capabilities/default.json:12`) lets webview open arbitrary sqlite connection strings: plugin resolves via `app_config_dir().join(path)` and `Path::join` with an absolute path escapes the app dir. App only ever loads one DB; scope it or preload on the Rust side.

## Functional bugs

- [x] **F1 (HIGH)** — Multi-author PR search silently drops all but last author: `src/modules/github/prs.ts:57-59` emits repeated `--author=`; `gh search prs --author` is a single-valued pflag flag (`string`, not `strings`) → last wins. Config schema is plural `stringList`. Fix: one search per author, merge results (or raw query with multiple `author:` qualifiers).
- [x] **F2 (MEDIUM)** — Dependabot "Min severity" hides *more* severe alerts: `src/modules/github/dependabot.ts:22,26` — REST `severity` param is exact-match, not a floor. Picking "high" filters out critical. Fix: send `severity=high,critical` etc., or filter client-side.
- [ ] **F3 (MEDIUM)** — Next-meeting can miss the real next meeting: `src/modules/gws/calendar.ts:84-99` — `maxResults: 20` applies to raw events pre-filter (all-day/declined/solo count against it), no `nextPageToken` follow-up → busy day shows "no more meetings today".
- [x] **F4 (MEDIUM)** — Multi-repo runs/dependabot unsorted before slice: `src/modules/github/runs.ts:32`, `dependabot.ts:34` concat in repo order; widgets `slice(0, limit)` → repo A's 10 old items permanently mask repo B's. Fix: sort merged results by `createdAt`/severity before caching.
- [x] **F5 (MEDIUM)** — `runJsonCli` eats auth classification: `src/server/cli.ts:157-167` — non-zero exit + unparseable stdout rethrows generic `"returned non-JSON output"` (`failed`) instead of the original `CliError` (e.g. `auth`); non-zero exit + valid JSON without embedded error is returned as *success* and cached `status: "ok"`. Fix: on parse failure rethrow original CliError; only treat parsed bodies as authoritative.
- [x] **F6 (MEDIUM)** — Query-level error renders as empty state: `src/components/widget-card.tsx:29-32` — `errored` only inspects the row's status; `useQuery` rejection → `data` undefined → "Nothing here yet." instead of error state. Only signal is a 6s toast that re-fires on every remount (`use-widget-data.ts:56-58`).
- [x] **F7 (MEDIUM)** — Configure dialog sticks on "Saving…": `src/components/configure-dialog.tsx:48` — post-save `fetchWidgetData` is outside the try/catch; a rejection leaves the button disabled forever and skips `onSaved` even though the DB was updated.
- [ ] **F8 (MEDIUM)** — Bookmarks Enter-key double-add: `src/modules/bookmarks/widgets/bookmarks-widget.tsx:176` — Enter calls `add()` which lacks an `if (saving) return` guard (only the Save button is disabled) → duplicate rows.
- [x] **F9 (MEDIUM)** — Blank app forever on load failure: `src/app-root.tsx:27-29` (and 42-44) — `fetchLayout()` / `fetchIntegrations()` rejections unhandled; component renders `null` with no error UI or retry. Relevant: concurrent Claude sessions can lock the DB.

## Robustness / polish (LOW)

- [ ] **R1** — Integration health checks serial + no in-flight dedup: `src/server/integration-service.ts:47-63` — `toggleIntegration` forces `force=true` recheck of all integrations sequentially (up to ~40s if CLIs hang); concurrent panel loads double-spawn health CLIs; `widgetCountForIntegration` re-runs `getWidgets()` per integration (N+1). Fix: `Promise.all`, memoize in-flight promise, fetch widgets once.
- [ ] **R2** — Orphaned `widget_cache` rows: `config-repo.ts:66-68`, `tabs-repo.ts:25-31`, `integration-service.ts:76-80` delete widgets but never cache rows; no FK/cascade. Stale remote payloads persist until CACHE_VERSION bump.
- [ ] **R3** — `refresh()` races: `src/components/use-widget-data.ts:22-31` — (a) in-flight cache-read can resolve after `setQueryData` and overwrite fresh row with stale; (b) overlapping refreshes (interval + manual + refreshAll nonce) — first to finish stops the spinner while second still runs. Related: `widget-service.ts:38-48` has no in-flight dedup, last-write-wins caching.
- [ ] **R4** — Resize handle missing `onPointerCancel`/`onLostPointerCapture`: `src/components/resize-handle.tsx:23-48` — cancelled drag orphans live-preview inline grid styles; stale `state.current` makes next stray pointerup commit spans from old origin.
- [ ] **R5** — `HeaderControls` render outside per-card ErrorBoundary: `src/components/widget-card.tsx:53-56` vs 75-79 — they receive the same untrusted cached payload; a throw unmounts the whole dashboard (no app-level boundary). Latent today.
- [ ] **R6** — Jira ORDER BY-strip regex corrupts quoted JQL: `src/modules/jira/jql.ts:27` — matches inside string literals (`summary ~ "sort order by date"` → broken query).
- [ ] **R7** — Gmail deep link hardcodes `#inbox/`: `src/modules/gws/gmail.ts:30` — broken for non-inbox queries; use `#all/${id}`.
- [ ] **R8** — ccusage bare `JSON.parse(stdout)`: `src/modules/ccusage/fetch.ts:18` — non-JSON preamble (npx banner) surfaces raw SyntaxError instead of classified CliError; inconsistent with reference modules.
- [ ] **R9** — `db.batch` transport never ensures `Database.load()` ran: `src/db/client.ts:48-57` — masked today by app-root gating on `ensureCacheVersion()`; any future batch-first path fails "pool not loaded". Also `"sqlite:dashboard.db"` string duplicated between `client.ts:26` and `db_batch.rs:16`.
- [ ] **R10** — Dashboard mutations lack failure handling/rollback: `src/components/dashboard.tsx:144-151` — `onRemove`/`onMoveWidgetToTab` optimistic with no revert; fire-and-forget `persistPositions`/`reorderTabs`; two rapid drags can commit out of order.
- [ ] **R11** — Misc UI: `ago(fetchedAt)` never ticks (`widget-shell.tsx:14-19,105`); number input snaps to schema default on clear (`schema-form.tsx:268-269`); all `updateWidget` failures labeled "Invalid configuration" (`configure-dialog.tsx:43-46`); 1-column flash on dashboard mount — width measured in `useEffect`, use `useLayoutEffect` (`dashboard.tsx:119-129`).
- [ ] **R12** — Misc modules: chat space listing single-page, options list omits spaces past 100 and shows raw ids for DMs (`gws/chat.ts:60-62`, `gws/options.ts:23-26`); pomodoro day-rollover gaps — failed `loadCount()` disables reconciliation for the session, idle-overnight shows yesterday's count, midnight-spanning block misnumbers notification (`pomodoro/engine.ts:143-152,184-185`); `probeHealth` never returns `authed: "n/a"` so ccusage fakes "authenticated" (`integration-health.ts:9-19`); Jira `cachedServer` cached for process lifetime — server switch needs restart (`jira/jira.ts:19-30`); gmail/chat enrichment drops failed items silently with no `errors` array (github reference pattern surfaces partial failures).
- [ ] **R13** — `extractError` called on unguarded body: `cli.ts:170` + `gws/gws.ts:6` — `JSON.parse("null")` → TypeError instead of "unexpected output". Also `cache-version.ts:12-17` wipe+write not batched (benign on crash); `db_batch.rs:55-57` binds all JSON numbers as f64 (lossy > 2^53, worth `is_i64()` branch); `tabs-repo.ts` `deleteTab` has no last-tab guard at data layer.

## Tests / config

- [ ] **T1 (MEDIUM)** — No `eslint-plugin-react-hooks` (nor `eslint-plugin-react`): rules-of-hooks violations and stale deps pass lint silently. Biggest lint gap for a hook-heavy React 19 app.
- [ ] **T2 (MEDIUM)** — Zero tests for `dashboard.tsx` component wiring (287 lines — drag handler wiring, mutation dispatch); `dashboard-logic.ts` helpers are well tested but a mis-wired `onDragEnd` would pass the suite.
- [ ] **T3 (MEDIUM)** — No render/interaction test for bookmarks widget (only widget that mutates data via repo imports; repo + server layers are tested, add/delete UI flow is not).
- [ ] **T4 (LOW)** — gws presentational widgets (calendar/gmail/drive/chat-dms/chat-channels/tasks) have no render tests; data layer is fixture-tested so exposure is JSX-mapping only.
- [ ] **T5 (LOW)** — `tests/smoke.test.ts` asserts `1+1===2` (placebo); no coverage tooling (`@vitest/coverage-v8`); `tsconfig.json` include sweeps `.claude/worktrees/` into tsc (vitest/eslint exclude it, tsc doesn't); mixed dependency pinning (lockfile present, low impact).

## Verified good (no action)

- Migrations `drizzle/0000-0003` ↔ `src/db/schema.ts` exact match; registered in order in `lib.rs:11-14`; tests run identical SQL via drizzle migrator — no test/app DB drift.
- No shell interpolation anywhere: all CLI calls are argv arrays via `Command.create`; user strings never occupy arg-splitting or leading-positional positions; repo names regex-constrained pre-interpolation.
- `runCli` timeout/spawn/close race handling correct incl. late-spawn kill (`cli.ts:109-124`); `env: { PATH }` merges (doesn't clear) inherited env.
- `db_batch.rs` transaction semantics sound (one held connection, rollback on drop); JS guard rejects non-`run` statements.
- Drag/reorder math (`applyReorder`/`applyReorderTabs`/`classifyDrag`) correct incl. cross-tab and hidden-widget renumbering; `cellWidth` 16px gap matches `.wd-grid` gap.
- No `dangerouslySetInnerHTML`/`innerHTML` — no XSS sink; widget bodies contained by ErrorBoundary with `resetKey={fetchedAt}`.
- Timezone/date handling correct across modules (`dayWindow`, `windowFor`, pomodoro deadline math); N+1 enrichment uses `Promise.allSettled` throughout.
- Test run at `a0b554a`: 77 files / 400 tests pass; lint clean; `tsc --noEmit` clean.
