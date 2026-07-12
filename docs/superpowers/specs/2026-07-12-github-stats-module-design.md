# GitHub Stats module — design

**Date:** 2026-07-12
**Status:** Approved (brainstorm) — ready for planning
**Module:** `src/modules/github-stats/`

## Purpose

A personal GitHub activity-analytics module: "what did I ship." Distinct from the
existing `github` module (which surfaces actionable queues — open PRs, failing
actions, Dependabot alerts). This module answers "how much did I do over a
timeframe," scoped to the authenticated user only.

## Scope decisions

- **Whose stats:** the authenticated user only (`viewer`). No author/user config.
  Because we query `viewer`, the user's own **private contributions are included**.
- **Contents:** KPI tiles, an activity trend chart, and the classic contribution
  heatmap. (Delta-vs-last-period and top-repos were considered and cut — YAGNI.)
- **Packaging:** two widgets sharing a query-builder helper but with independent
  fetches (their date ranges differ, so they cache separately):
  - **GitHub Stats** — KPI tiles + trend sparkline, configurable timeframe.
  - **Contribution Heatmap** — the classic calendar, always trailing 12 months.
- **Heatmap:** classic look only. No streak/longest-streak numbers.

## Data source

Backbone: GraphQL `viewer.contributionsCollection(from, to)` via `gh api graphql`,
reusing the existing `runGh` wrapper (`src/modules/github/gh.ts`) — no new CLI
plumbing, same auth-error handling.

`contributionsCollection` returns, for a user + window, in a single call:

- `totalCommitContributions`
- `totalPullRequestContributions` (PRs **opened** in window)
- `totalPullRequestReviewContributions`
- `totalIssueContributions`
- `contributionCalendar { totalContributions, weeks { contributionDays { date, contributionCount, color } } }`

**Tile note:** the API exposes PRs *opened*, not *merged* separately. Tiles are
therefore **commits · PRs opened · reviews · issues** — four numbers from one
call. "Merged" is intentionally out of scope (would need an extra `gh search`
call per widget).

### Two windows

| Widget | Query window | Fields used |
|---|---|---|
| GitHub Stats | preset: `7d` / `30d` / `90d` / `year` | the four `total*Contributions` → tiles; `contributionCalendar` days → trend |
| Contribution Heatmap | fixed trailing 12 months | `contributionCalendar` → the grid |

The GitHub API caps a single `contributionsCollection` query at 1 year, which
both windows respect.

## Module structure

Standard manifest/fetch/render split, mirroring `github`:

- `manifest.ts` — two `WidgetManifest`s (`github-stats.summary`, `github-stats.heatmap`),
  Zod config schemas + defaults, shared data types (`StatsData`, `HeatmapData`),
  via `defineManifest`.
- `stats.ts` — shared query-builder + normalizers (pure, no CLI): builds the
  GraphQL document + variables for a given `{ from, to }`, and maps the raw
  response to `StatsData` / `HeatmapData`. Window computation takes an injected
  `now` (no `Date.now()` in the pure path) for deterministic tests.
- `fetch.ts` — `registerFetch` for each widget; each computes its window (from a
  real `now` at call time), calls the `stats.ts` builder, runs it through
  `runGh(["api", "graphql", ...])`, and normalizes. A small error extractor reads
  the GraphQL `errors[]` array (payload-model style — errors can arrive as JSON on
  stdout) and surfaces them as a widget error instead of crashing.
- `widgets/summary-widget.tsx` + `widgets/heatmap-widget.tsx`.
- `render.ts` — `registerRender` for both, with GitHub icon.

### Config schemas

```ts
// summary widget
z.object({
  timeframe: z.enum(["7d", "30d", "90d", "year"]).default("30d").describe("Timeframe"),
})

// heatmap widget
z.object({})  // no config — always trailing 12 months
```

The `enum` field renders as a dropdown via the auto-generated schema-form
(`enum` is a supported field kind).

## Widget A — "GitHub Stats" (summary)

- Size-adaptive, following the system-widget adaptive-layout spec
  (`docs/superpowers/specs/2026-07-12-system-widget-adaptive-layout-design.md`):
  KPI tiles in a responsive grid on top; a compact recharts bar/area sparkline of
  daily contribution counts below.
- Tiles: commits · PRs opened · reviews · issues — big tabular-nums numbers with
  small labels.
- Trend: `contributionCalendar` days within the window → per-day series. recharts,
  styled to match `system-stats-widget` (`--chart-*` vars, gradient fill).
- `count` badge = total contributions in window.
- `refreshable: true` (default); interval refresh applies.

## Widget B — "Contribution Heatmap"

- The classic GitHub calendar: 53-week × 7-day CSS grid of cells.
- 5-level intensity scale bucketed from per-day `contributionCount` (GitHub's
  buckets); light/dark aware via CSS vars. Pure CSS grid — no recharts.
- Month labels along the top; per-cell tooltip (e.g. `3 contributions on Jul 4`).
- No config, always trailing 12 months.
- `count` badge = total contributions in the year.
- `refreshable: true`.

## Error handling

Same model as `github`. `runGh` classifies `not-found` / `auth` / `timeout` /
`failed`; auth surfaces "Not authenticated — run `gh auth login`". Additionally,
GraphQL can return HTTP 200 with an `errors[]` array on stdout — a small extractor
detects that and surfaces the message as a widget error. Widget bodies remain
wrapped in the shell's per-card ErrorBoundary.

## Testing

- **Registration test** (`tests/modules/github-stats-registration.test.ts`):
  both widget types resolve in both the fetch and render registries.
- **Normalizer tests** (`stats.ts`): raw GraphQL fixture →
  - `StatsData`: four totals + per-day trend series;
  - `HeatmapData`: week/day grid + correct intensity bucketing.
- **Window computation**: given an injected `now`, `7d`/`30d`/`90d`/`year` produce
  the expected `{ from, to }` ISO ranges (deterministic — no wall-clock in the
  pure path).

## Wiring

- Add module imports to `src/modules/fetch.ts` and `src/modules/render.ts`.
- Bump `CACHE_VERSION` (`src/server/cache-version.ts`) — new payload shapes.

## Out of scope (explicitly cut)

- Delta-vs-previous-period indicators.
- Top-repos breakdown / review-load ratio.
- PRs *merged* count (needs a second search call).
- Streak / longest-streak numbers on the heatmap.
- Any non-`viewer` (teammate / org / repo-scoped) stats.
