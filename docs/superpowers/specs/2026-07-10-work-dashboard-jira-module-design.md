# Design — Jira Module (Plan 3)

**Date:** 2026-07-10
**Depends on:** Plan 1 (framework shell) + Plan 2 (GitHub module) — both merged to `main`.
**Prev designs:** `2026-07-09-work-dashboard-design.md` (overall product; Jira listed under "Future modules"),
`2026-07-09-work-dashboard-github-module-design.md` (the CLI-module precedent this mirrors).

The second real integration, via the authenticated `jira` CLI (ankitpokhrel/jira-cli). It proves the
module pattern generalizes to a second CLI and reuses the framework built for GitHub with **no framework
changes** — the Jira module is purely additive apart from the two module barrels.

---

## Goals

- Ship **one** Jira widget — **Custom JQL** — a generic list backed by a raw JQL string, configurable per
  card. Covers "my issues", "in review", "reported by me", "watching", etc. without bespoke widgets.
- Prove `runCli` (`src/server/cli.ts`) is genuinely reusable by a second CLI (its auth regex is
  caller-supplied, built for exactly this).

## Non-Goals (deliberately deferred)

- **Issue transitions / any write action.** The action endpoint (`POST /api/widgets/[id]/action`) is still
  deferred (Plan 2 non-goal); this widget is **read-only + link-out**, same as GitHub's My PRs.
- **Sprint / board widgets** and any second widget type. Custom JQL subsumes them for now (YAGNI).
- **Schema-form "textarea for long strings".** JQL in a single-line text input is slightly cramped but
  acceptable; a multiline field kind is a possible future nice-to-have, not in scope.
- Any change to the cache-first data flow, drag/reorder, refresh, config UI, or title-rename — all reused
  as-is.

---

## ⚠️ Corrections after live verification (2026-07-10)

The data-shape assumptions below (written pre-auth) were **wrong**. Verified against an authenticated
`jira` CLI (v1.7.0, Jira Cloud), `jira issue list --raw` is a **reduced projection**, not the Jira
search API response. The module was corrected accordingly — see
`docs/superpowers/plans/2026-07-10-work-dashboard-jira-module-fixes.md` (commits `726f73a`, `a087705`).
Where the sections below disagree, **these corrections win**:

- **Response is a bare JSON array** of issues, not `{ issues: [...] }`.
- **No `self`/`id`** on issues → the browse URL is built from jira-cli's own config `server:`
  (`~/.config/.jira/.config.yml`, or `JIRA_CONFIG_FILE`) as `${server}/browse/${KEY}`, via a cached
  `jiraServerUrl()` helper in `jira.ts`.
- **No `statusCategory`** — status is only `{ name }`. So the pill is **neutral** (status *name* in one
  muted color); the `statusCategory` field/type was dropped entirely.
- **jira-cli appends its own `ORDER BY`**, so any `ORDER BY` inside the JQL is a syntax error. `fetchJql`
  **strips a trailing `ORDER BY …`** from the user's JQL and sorts via `--order-by updated` (newest-updated
  first). The default JQL no longer contains `ORDER BY`.
- **No matches → non-zero exit** with stderr `No result found for given query…` (no JSON). `fetchJql`
  catches that `CliError` (`/no result found/i`) and returns `{ issues: [] }` so the empty state renders.
- **Unassigned → `{ displayName: "" }`** (empty string) → normalized to `null`.

Corrected normalized shape: `JiraIssue = { key; summary; status: string; assignee: string | null; url }`
(no `statusCategory`). All six points were verified live end-to-end (real issues render, empty state,
`ORDER BY` stripped, browse links open).

---

## Decisions (resolved during brainstorming)

- **Data path:** `jira` CLI (already installed at `~/.local/bin/jira`, v1.7.0). Mirrors the `gh`
  CLI-first pattern — reuses `runCli` + error classification, no token handling in the app.
- **Scope:** a single **Custom JQL** widget (`jira.jql`). No My-Issues / Sprint / Reported widgets.
- **Output parsing:** **raw JSON** (`jira issue list --raw`), the analog of `gh … --json`. Not
  `--plain`/`--csv` (lossy: no URL, truncation, column-order fragility).
- **Per-card title:** reuse the **existing** per-widget title override (`widgets.title`, the Configure
  dialog's Title field, `WidgetCard`'s `widget.title ?? def.title`). No framework change needed.
- **Row content:** `KEY` · summary · status pill · assignee. Click-through to the browse URL.

---

## Architecture

### Module — `src/modules/jira/` (mirror `src/modules/github/`)

```
manifest.ts            # type id "jira.jql", Zod config schema + defaultConfig, shared Data types.
                       #   Client-safe, no runtime deps (imported by both server and client sides).
jira.ts                # server-only: runJira(args) wraps runCli("jira", args, { notAuthenticatedPattern });
                       #   jiraJson<T>(args) appends "--raw" and JSON.parse's stdout.
server.ts              # import "server-only"; fetchJql(config); registerServerWidget(...) at import time.
widgets/jql-widget.tsx # "use client" body component (WidgetBodyProps<JqlData, JqlConfig>).
client.ts              # registerClientWidget({ type, title, configSchema, defaultConfig, Component }) at import.
```

Barrels (the only edited files — the sole place the shell learns the module exists):
- `src/modules/server.ts` → add `import "./jira/server";`
- `src/modules/client.ts` → add `import "./jira/client";`

**Reused unchanged:** `runCli`/`CliError` (`src/server/cli.ts`), the cache-first data flow
(`widget-service.ts`, `/api/widgets/[id]/data`), refresh (manual/interval/post-config-save), the
config-editing UI + `schema-form`, the title-rename override, and every `WidgetShell` state.

### `jira.ts` — CLI wrapper (server-only)

```ts
runJira(args: string[]) => runCli("jira", args, {
  notAuthenticatedPattern: /needs a Jira API token|unauthorized|401/i,
});
jiraJson<T>(args: string[]) => JSON.parse((await runJira([...args, "--raw"])).stdout) as T;
```

The `notAuthenticatedPattern` matches jira-cli's unconfigured message ("The tool needs a Jira API
token…"), classified by `runCli` as `kind:"auth"` with a human message "Not authenticated — run
`jira init`".

### Widget `jira.jql` — config & data

- **Config** (`JqlConfig = { jql: string; limit: number }`):
  ```ts
  const jqlConfigSchema = z.object({
    jql: z.string().min(1).describe("JQL"),
    limit: z.number().int().min(1).max(100).default(10),
  });
  const jqlDefaultConfig: JqlConfig = {
    jql: "assignee = currentUser() AND resolution = EMPTY ORDER BY updated DESC",
    limit: 10,
  };
  ```
  `schema-form` renders `jql` → text input, `limit` → number input (both already-supported kinds). The
  default JQL is universally valid so a freshly-added card shows data immediately. Per-card title via the
  existing rename (blank → the definition default "Jira Query").

- **fetch:** `jiraJson(["issue", "list", "-q", cfg.jql, "--paginate", `0:${cfg.limit}`])` → read `.issues[]`.

- **Normalized shape:**
  ```ts
  type JiraIssue = {
    key: string;                                  // e.g. "CORE-123"
    summary: string;
    status: string;                               // status name
    statusCategory: "todo" | "inprogress" | "done";
    assignee: string | null;                      // displayName, null if unassigned
    url: string;                                  // <origin>/browse/<KEY>
  };
  type JqlData = { issues: JiraIssue[] };
  ```
  - `statusCategory` from Jira's `fields.status.statusCategory.key` (`new`→`todo`,
    `indeterminate`→`inprogress`, `done`→`done`).
  - `url` derived from the issue's `self` (`https://site.atlassian.net/rest/api/2/issue/12345`) → take
    the origin, append `/browse/<key>`. Avoids reading jira-cli's own config file.
  - Exact `fields` availability (assignee, statusCategory) is **validated against a recorded fixture**
    during implementation; the shape above is the target, finalized against real output (TDD).

- **Row rendering:** `KEY` · summary · a status pill · assignee initials; the row links to `url`. Status
  pill color from `statusCategory` mapped to the existing semantic tokens: `done → --color-ok`,
  `inprogress → --color-warn`, `todo → muted`.

### Data flow (unchanged, reused)

Widget mounts → `GET /api/widgets/:id/data` returns the cached row instantly → refresh (manual, interval,
or post-config-save) hits `?refresh=1` → server runs `fetchJql(config)` → writes `widget_cache` → returns
fresh. `getWidgetData` keeps the last-good payload on error and the UI shows a "stale" badge.

## Error handling

- **CLI failures** propagate as `CliError.message` through `fetchJql()`; `widget-service` catches, keeps
  last-good, returns `status:"error"`. UI shows the friendly message (no cache yet) or a **stale** badge
  over last-good data — both already wired in `WidgetCard`.
- **Auth not configured** → `notAuthenticatedPattern` → "Not authenticated — run `jira init`".
- **Invalid JQL** → jira-cli exits non-zero with an explanatory stderr → `kind:"failed"`, stderr surfaced
  in the error state so the user sees why.
- **Empty results** → the existing `WidgetShell` `"empty"` state with copy "No matching issues".

## Testing (TDD)

No network in tests. Record real `jira issue list -q "<jql>" --raw` output as
`tests/fixtures/jira/jql.json` (once `jira init` is done); until then a representative hand-built Jira
search-API JSON fixture of the same shape is acceptable, replaced by real output before asserting final
fields.

1. **`fetchJql()`** — mock `runJira`/`runCli` to return the fixture; assert the normalized `JqlData`
   shape: key/summary/status, `statusCategory` mapping, `url` derivation, `assignee` null-handling, and
   the empty-issues case.
2. **jira auth classification** (optional, small) — add a case to the existing `cli.ts` classifier test
   asserting the jira `notAuthenticatedPattern` yields `kind:"auth"`.

`cli.ts`, the config PATCH, and `schema-form` introspection are already covered by Plan 2 tests and need
no new coverage.

## Verification (definition of done)

- `npm run lint`, `tsc --noEmit`, `npm test` all clean; `npm run build` succeeds.
- Prereq: `jira init` has been run so the CLI is authenticated.
- Live: add a Jira Query widget → it shows issues for the default JQL (or the correct auth/error/empty
  state); edit the JQL + title via the ⋯ Configure menu → the card re-fetches and persists across reload;
  refresh re-runs `fetchJql()`; clicking a row opens the issue in the browser.

## Files touched

- **New:** `src/modules/jira/{manifest,jira,server,client}.ts`;
  `src/modules/jira/widgets/jql-widget.tsx`; `tests/fixtures/jira/jql.json`;
  `tests/modules/jira-jql.test.ts` (+ optional `cli.ts` test case).
- **Edited:** `src/modules/server.ts` and `src/modules/client.ts` (barrels only).
