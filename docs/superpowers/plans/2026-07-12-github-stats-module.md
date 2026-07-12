# GitHub Stats Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `github-stats` module with two widgets — "GitHub Stats" (KPI tiles + activity trend) and "Contribution Heatmap" (classic year calendar) — driven by the authenticated user's GitHub `contributionsCollection`.

**Architecture:** Standard manifest/fetch/render module split under `src/modules/github-stats/`. One GraphQL query (`viewer.contributionsCollection`) via the existing `gh` CLI wrapper backs both widgets; they differ only in date window (preset vs. trailing 12 months) and therefore fetch/cache independently. Pure window/normalizer helpers live in `stats.ts` for deterministic testing; the widgets are cache-first React bodies reading the `data` prop.

**Tech Stack:** TypeScript, Zod (config), React 19, recharts (trend chart), Tailwind v4 (CSS-var-driven heatmap colors), Vitest + Testing Library, `gh api graphql`.

## Global Constraints

- No Jira prefix on commits — plain conventional style (e.g. `feat: add github-stats module`).
- Scope is the authenticated user only (`viewer`); no author/user/repo config.
- Feature toggles default disabled — N/A here (widgets are added on demand, not flags).
- Match existing module patterns (reference: `src/modules/github/`); keep changes surgical.
- All repo/cache/config functions are async — `await` them (not exercised here; widgets are fetch-only).
- Tiles show **PRs opened** (not merged) — four metrics from one call: commits · PRs · reviews · issues.

---

### Task 1: Manifest — types, config schemas, widget manifests

**Files:**
- Create: `src/modules/github-stats/manifest.ts`
- Test: `tests/modules/github-stats-manifest.test.ts`

**Interfaces:**
- Consumes: `defineManifest` from `@/modules/contracts`.
- Produces:
  - Type ids `SUMMARY_TYPE = "github-stats.summary"`, `HEATMAP_TYPE = "github-stats.heatmap"`.
  - `Timeframe = "7d" | "30d" | "90d" | "year"`.
  - `SummaryConfig = { timeframe: Timeframe }`, `summaryDefaultConfig`, `summaryConfigSchema`.
  - `HeatmapConfig = {}`, `heatmapDefaultConfig`, `heatmapConfigSchema`.
  - Data types `TrendPoint`, `StatsData`, `HeatmapDay`, `HeatmapWeek`, `HeatmapData`.
  - `summaryManifest`, `heatmapManifest`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/github-stats-manifest.test.ts
import { describe, it, expect } from "vitest";
import {
  summaryConfigSchema, summaryDefaultConfig,
  heatmapConfigSchema, heatmapDefaultConfig,
  summaryManifest, heatmapManifest,
  SUMMARY_TYPE, HEATMAP_TYPE,
} from "@/modules/github-stats/manifest";

describe("github-stats manifest", () => {
  it("parses the summary default config", () => {
    expect(summaryConfigSchema.parse(summaryDefaultConfig)).toEqual({ timeframe: "30d" });
  });

  it("backfills timeframe from an empty object via the default", () => {
    expect(summaryConfigSchema.parse({})).toEqual({ timeframe: "30d" });
  });

  it("rejects an unknown timeframe", () => {
    expect(() => summaryConfigSchema.parse({ timeframe: "5y" })).toThrow();
  });

  it("parses the empty heatmap config", () => {
    expect(heatmapConfigSchema.parse(heatmapDefaultConfig)).toEqual({});
  });

  it("exposes matching manifest types", () => {
    expect(summaryManifest.type).toBe(SUMMARY_TYPE);
    expect(heatmapManifest.type).toBe(HEATMAP_TYPE);
    expect(summaryManifest.integration).toBe("github");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- github-stats-manifest`
Expected: FAIL — cannot resolve `@/modules/github-stats/manifest`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/modules/github-stats/manifest.ts
import { z } from "zod";
import { defineManifest } from "@/modules/contracts";

export const SUMMARY_TYPE = "github-stats.summary";
export const HEATMAP_TYPE = "github-stats.heatmap";

export type Timeframe = "7d" | "30d" | "90d" | "year";

// --- Config schemas (.describe() drives form labels) ---
export const summaryConfigSchema = z.object({
  timeframe: z.enum(["7d", "30d", "90d", "year"]).default("30d").describe("Timeframe"),
});
export type SummaryConfig = z.infer<typeof summaryConfigSchema>;
export const summaryDefaultConfig: SummaryConfig = { timeframe: "30d" };

export const heatmapConfigSchema = z.object({});
export type HeatmapConfig = z.infer<typeof heatmapConfigSchema>;
export const heatmapDefaultConfig: HeatmapConfig = {};

// --- Data shapes ---
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

export const summaryManifest = defineManifest({
  type: SUMMARY_TYPE, title: "GitHub Stats",
  configSchema: summaryConfigSchema, defaultConfig: summaryDefaultConfig,
  integration: "github",
});
export const heatmapManifest = defineManifest({
  type: HEATMAP_TYPE, title: "Contribution Heatmap",
  configSchema: heatmapConfigSchema, defaultConfig: heatmapDefaultConfig,
  integration: "github",
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- github-stats-manifest`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/github-stats/manifest.ts tests/modules/github-stats-manifest.test.ts
git commit -m "feat: github-stats manifest, config schemas, data types"
```

---

### Task 2: Window computation + GraphQL query (pure)

**Files:**
- Create: `src/modules/github-stats/stats.ts`
- Test: `tests/modules/github-stats-window.test.ts`

**Interfaces:**
- Consumes: `Timeframe` from `./manifest`.
- Produces:
  - `windowFor(timeframe: Timeframe, now: Date): { from: string; to: string }`.
  - `yearWindow(now: Date): { from: string; to: string }`.
  - `CONTRIB_QUERY: string` (GraphQL document).
  - `RawContributionDay`, `RawWeek`, `RawContributions` types.

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/github-stats-window.test.ts
import { describe, it, expect } from "vitest";
import { windowFor, yearWindow, CONTRIB_QUERY } from "@/modules/github-stats/stats";

const NOW = new Date("2026-07-12T10:00:00.000Z");
const DAY_MS = 86_400_000;

describe("windowFor", () => {
  it("7d subtracts 7 days from now, to = now", () => {
    expect(windowFor("7d", NOW)).toEqual({
      from: "2026-07-05T10:00:00.000Z",
      to: "2026-07-12T10:00:00.000Z",
    });
  });

  it("30d subtracts 30 days", () => {
    expect(windowFor("30d", NOW).from).toBe("2026-06-12T10:00:00.000Z");
  });

  it("90d spans exactly 90 days", () => {
    const { from, to } = windowFor("90d", NOW);
    expect(Date.parse(to) - Date.parse(from)).toBe(90 * DAY_MS);
  });

  it("year starts at Jan 1 of now's UTC year", () => {
    expect(windowFor("year", NOW)).toEqual({
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-07-12T10:00:00.000Z",
    });
  });
});

describe("yearWindow", () => {
  it("is the trailing 12 months", () => {
    expect(yearWindow(NOW)).toEqual({
      from: "2025-07-12T10:00:00.000Z",
      to: "2026-07-12T10:00:00.000Z",
    });
  });
});

describe("CONTRIB_QUERY", () => {
  it("queries the viewer's contributionsCollection with a date-typed window", () => {
    expect(CONTRIB_QUERY).toContain("contributionsCollection(from: $from, to: $to)");
    expect(CONTRIB_QUERY).toContain("$from: DateTime!");
    expect(CONTRIB_QUERY).toContain("contributionLevel");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- github-stats-window`
Expected: FAIL — cannot resolve `@/modules/github-stats/stats`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/modules/github-stats/stats.ts
import type { Timeframe } from "./manifest";

const DAY_MS = 86_400_000;

/** Preset window: `to` is always `now`; `year` means Jan 1 of now's UTC year. */
export function windowFor(timeframe: Timeframe, now: Date): { from: string; to: string } {
  const to = now.toISOString();
  if (timeframe === "year") {
    return { from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString(), to };
  }
  const days = timeframe === "7d" ? 7 : timeframe === "30d" ? 30 : 90;
  return { from: new Date(now.getTime() - days * DAY_MS).toISOString(), to };
}

/** Trailing 12 months (~53 weeks) for the classic heatmap. */
export function yearWindow(now: Date): { from: string; to: string } {
  const from = new Date(now);
  from.setUTCFullYear(now.getUTCFullYear() - 1);
  return { from: from.toISOString(), to: now.toISOString() };
}

export const CONTRIB_QUERY = `query($from: DateTime!, $to: DateTime!) {
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
}`;

export type ContributionLevel =
  | "NONE" | "FIRST_QUARTILE" | "SECOND_QUARTILE" | "THIRD_QUARTILE" | "FOURTH_QUARTILE";

export type RawContributionDay = {
  date: string;
  contributionCount: number;
  contributionLevel: ContributionLevel;
};
export type RawWeek = { contributionDays: RawContributionDay[] };
export type RawContributions = {
  totalCommitContributions: number;
  totalPullRequestContributions: number;
  totalPullRequestReviewContributions: number;
  totalIssueContributions: number;
  contributionCalendar: { totalContributions: number; weeks: RawWeek[] };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- github-stats-window`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/github-stats/stats.ts tests/modules/github-stats-window.test.ts
git commit -m "feat: github-stats window helpers + GraphQL query"
```

---

### Task 3: Normalizers — raw GraphQL → StatsData / HeatmapData (pure)

**Files:**
- Modify: `src/modules/github-stats/stats.ts` (append normalizers)
- Test: `tests/modules/github-stats-normalize.test.ts`

**Interfaces:**
- Consumes: `RawContributions` (from Task 2), data types from `./manifest`.
- Produces:
  - `toStatsData(raw: RawContributions): StatsData`.
  - `toHeatmapData(raw: RawContributions): HeatmapData`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/github-stats-normalize.test.ts
import { describe, it, expect } from "vitest";
import { toStatsData, toHeatmapData, type RawContributions } from "@/modules/github-stats/stats";

const raw: RawContributions = {
  totalCommitContributions: 42,
  totalPullRequestContributions: 7,
  totalPullRequestReviewContributions: 5,
  totalIssueContributions: 3,
  contributionCalendar: {
    totalContributions: 57,
    weeks: [
      { contributionDays: [
        { date: "2026-07-06", contributionCount: 0, contributionLevel: "NONE" },
        { date: "2026-07-07", contributionCount: 4, contributionLevel: "SECOND_QUARTILE" },
      ] },
      { contributionDays: [
        { date: "2026-07-13", contributionCount: 12, contributionLevel: "FOURTH_QUARTILE" },
      ] },
    ],
  },
};

describe("toStatsData", () => {
  it("maps totals and flattens the calendar into a trend series", () => {
    expect(toStatsData(raw)).toEqual({
      commits: 42, prs: 7, reviews: 5, issues: 3, total: 57,
      trend: [
        { date: "2026-07-06", count: 0 },
        { date: "2026-07-07", count: 4 },
        { date: "2026-07-13", count: 12 },
      ],
    });
  });
});

describe("toHeatmapData", () => {
  it("keeps week columns and maps contribution levels to 0-4", () => {
    expect(toHeatmapData(raw)).toEqual({
      total: 57,
      weeks: [
        { days: [
          { date: "2026-07-06", count: 0, level: 0 },
          { date: "2026-07-07", count: 4, level: 2 },
        ] },
        { days: [
          { date: "2026-07-13", count: 12, level: 4 },
        ] },
      ],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- github-stats-normalize`
Expected: FAIL — `toStatsData` / `toHeatmapData` are not exported.

- [ ] **Step 3: Write minimal implementation** (append to `src/modules/github-stats/stats.ts`)

`ContributionLevel` is declared locally in `stats.ts` (Task 2), so no new import is needed for it. Adjust the existing top-of-file import to pull the two new data types from the manifest — change it to read exactly:

```ts
import type { Timeframe, StatsData, HeatmapData, HeatmapDay } from "./manifest";
```

Then append:

```ts
export function toStatsData(raw: RawContributions): StatsData {
  const trend = raw.contributionCalendar.weeks.flatMap((w) =>
    w.contributionDays.map((d) => ({ date: d.date, count: d.contributionCount })),
  );
  return {
    commits: raw.totalCommitContributions,
    prs: raw.totalPullRequestContributions,
    reviews: raw.totalPullRequestReviewContributions,
    issues: raw.totalIssueContributions,
    total: raw.contributionCalendar.totalContributions,
    trend,
  };
}

const LEVELS: Record<ContributionLevel, HeatmapDay["level"]> = {
  NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4,
};

export function toHeatmapData(raw: RawContributions): HeatmapData {
  const weeks = raw.contributionCalendar.weeks.map((w) => ({
    days: w.contributionDays.map((d) => ({
      date: d.date,
      count: d.contributionCount,
      level: LEVELS[d.contributionLevel],
    })),
  }));
  return { total: raw.contributionCalendar.totalContributions, weeks };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- github-stats-normalize`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/github-stats/stats.ts tests/modules/github-stats-normalize.test.ts
git commit -m "feat: github-stats normalizers for stats + heatmap"
```

---

### Task 4: GraphQL runner + fetch functions + fetch barrel

**Files:**
- Modify: `src/modules/github-stats/stats.ts` (append `fetchContributions`)
- Create: `src/modules/github-stats/fetch.ts`
- Modify: `src/modules/fetch.ts` (register the module's fetch barrel)
- Test: `tests/modules/github-stats-fetch.test.ts`

**Interfaces:**
- Consumes: `runGh` from `@/modules/github/gh`; `CliError` from `@/server/cli`; `windowFor`/`yearWindow`/`CONTRIB_QUERY`/`toStatsData`/`toHeatmapData`/`RawContributions` from `./stats`; manifests + config types from `./manifest`.
- Produces:
  - `fetchContributions(from: string, to: string): Promise<RawContributions>`.
  - `fetchSummary(config: SummaryConfig): Promise<StatsData>`.
  - `fetchHeatmap(config: HeatmapConfig): Promise<HeatmapData>`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/github-stats-fetch.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/modules/github/gh", () => ({ runGh: vi.fn(), ghJson: vi.fn() }));
import { runGh } from "@/modules/github/gh";
import { fetchSummary, fetchHeatmap } from "@/modules/github-stats/stats";

const mockRun = runGh as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => { mockRun.mockReset(); });

const okBody = JSON.stringify({
  data: { viewer: { contributionsCollection: {
    totalCommitContributions: 10,
    totalPullRequestContributions: 2,
    totalPullRequestReviewContributions: 1,
    totalIssueContributions: 0,
    contributionCalendar: {
      totalContributions: 13,
      weeks: [{ contributionDays: [
        { date: "2026-07-07", contributionCount: 4, contributionLevel: "SECOND_QUARTILE" },
      ] }],
    },
  } } },
});

describe("fetchSummary", () => {
  it("calls gh api graphql with the contributions query and returns StatsData", async () => {
    mockRun.mockResolvedValueOnce(okBody);
    const data = await fetchSummary({ timeframe: "30d" });
    expect(data).toEqual({
      commits: 10, prs: 2, reviews: 1, issues: 0, total: 13,
      trend: [{ date: "2026-07-07", count: 4 }],
    });
    const args = mockRun.mock.calls[0][0] as string[];
    expect(args[0]).toBe("api");
    expect(args[1]).toBe("graphql");
    expect(args.join(" ")).toContain("contributionsCollection");
    expect(args.some((a) => a.startsWith("from="))).toBe(true);
    expect(args.some((a) => a.startsWith("to="))).toBe(true);
  });
});

describe("fetchHeatmap", () => {
  it("returns HeatmapData with mapped levels", async () => {
    mockRun.mockResolvedValueOnce(okBody);
    const data = await fetchHeatmap({});
    expect(data.total).toBe(13);
    expect(data.weeks[0].days[0]).toEqual({ date: "2026-07-07", count: 4, level: 2 });
  });
});

describe("GraphQL error surfacing", () => {
  it("throws when the response body carries a GraphQL errors[] array", async () => {
    mockRun.mockResolvedValueOnce(JSON.stringify({ errors: [{ message: "Bad credentials" }] }));
    await expect(fetchSummary({ timeframe: "7d" })).rejects.toThrow("Bad credentials");
  });

  it("throws on non-JSON output", async () => {
    mockRun.mockResolvedValueOnce("not json");
    await expect(fetchSummary({ timeframe: "7d" })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- github-stats-fetch`
Expected: FAIL — `fetchSummary` / `fetchHeatmap` are not exported from `stats`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/modules/github-stats/stats.ts`:

```ts
import { runGh } from "@/modules/github/gh";
import { CliError } from "@/server/cli";
import type { SummaryConfig, HeatmapConfig } from "./manifest";

type GraphqlResponse = {
  data?: { viewer?: { contributionsCollection?: RawContributions } };
  errors?: { message: string }[];
};

/** Runs the contributions query for a window; surfaces GraphQL `errors[]` (HTTP-200 case). */
export async function fetchContributions(from: string, to: string): Promise<RawContributions> {
  const stdout = await runGh([
    "api", "graphql",
    "-f", `query=${CONTRIB_QUERY}`,
    "-f", `from=${from}`,
    "-f", `to=${to}`,
  ]);
  let body: GraphqlResponse;
  try {
    body = JSON.parse(stdout);
  } catch {
    throw new CliError("GitHub returned non-JSON output", "failed");
  }
  if (body.errors?.length) throw new CliError(body.errors[0].message, "failed");
  const cc = body.data?.viewer?.contributionsCollection;
  if (!cc) throw new CliError("No contributions data in response", "failed");
  return cc;
}

export async function fetchSummary(config: SummaryConfig): Promise<StatsData> {
  const { from, to } = windowFor(config.timeframe, new Date());
  return toStatsData(await fetchContributions(from, to));
}

export async function fetchHeatmap(_config: HeatmapConfig): Promise<HeatmapData> {
  const { from, to } = yearWindow(new Date());
  return toHeatmapData(await fetchContributions(from, to));
}
```

Create `src/modules/github-stats/fetch.ts`:

```ts
import { registerFetch } from "@/modules/fetch-registry";
import { summaryManifest, heatmapManifest } from "./manifest";
import { fetchSummary, fetchHeatmap } from "./stats";

registerFetch(summaryManifest, { fetch: fetchSummary });
registerFetch(heatmapManifest, { fetch: fetchHeatmap });
```

Modify `src/modules/fetch.ts` — add after the `github/fetch` import:

```ts
import "./github-stats/fetch";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- github-stats-fetch`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/github-stats/stats.ts src/modules/github-stats/fetch.ts src/modules/fetch.ts tests/modules/github-stats-fetch.test.ts
git commit -m "feat: github-stats gh graphql runner + fetch registration"
```

---

### Task 5: Summary widget (KPI tiles + trend) + chart color

**Files:**
- Create: `src/modules/github-stats/widgets/summary-widget.tsx`
- Create: `src/modules/github-stats/render.ts`
- Modify: `src/globals.css` (add `--chart-contrib`)
- Test: `tests/modules/github-stats-summary-widget.test.tsx`

**Interfaces:**
- Consumes: `WidgetBodyProps` from `@/modules/contracts`; `StatsData`/`SummaryConfig`/`TrendPoint` from `../manifest`; `summaryManifest` from `./manifest`.
- Produces: `SummaryWidget` React component; render registration for `summaryManifest`.

**Note on size-adaptivity:** the spec mentions "size-adaptive following the system-widget adaptive-layout spec." That shared hook (`useElementHeight`) is **not yet implemented** (its own spec is still pending). Tiles + a 64px trend chart are naturally compact (~130px), so this widget uses a fixed stacked layout. A ResizeObserver mode-switch can be added later if/when the shared hook lands — out of scope here (YAGNI).

- [ ] **Step 1: Write the failing test**

```tsx
// tests/modules/github-stats-summary-widget.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SummaryWidget } from "@/modules/github-stats/widgets/summary-widget";
import { summaryDefaultConfig } from "@/modules/github-stats/manifest";
import type { StatsData } from "@/modules/github-stats/manifest";

const data: StatsData = {
  commits: 42, prs: 7, reviews: 5, issues: 3, total: 57,
  trend: [
    { date: "2026-07-06", count: 0 },
    { date: "2026-07-07", count: 4 },
  ],
};

function renderWidget(d: StatsData) {
  return render(<SummaryWidget data={d} config={summaryDefaultConfig} refresh={async () => {}} />);
}

describe("SummaryWidget", () => {
  it("renders the four KPI tiles with labels", () => {
    renderWidget(data);
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("Commits")).toBeInTheDocument();
    expect(screen.getByText("PRs")).toBeInTheDocument();
    expect(screen.getByText("Reviews")).toBeInTheDocument();
    expect(screen.getByText("Issues")).toBeInTheDocument();
  });

  it("shows an empty state when there is no activity", () => {
    renderWidget({ commits: 0, prs: 0, reviews: 0, issues: 0, total: 0, trend: [] });
    expect(screen.getByText(/No activity in this timeframe/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- github-stats-summary-widget`
Expected: FAIL — cannot resolve the widget module.

- [ ] **Step 3: Write minimal implementation**

Create `src/modules/github-stats/widgets/summary-widget.tsx`:

```tsx
"use client";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { WidgetBodyProps } from "@/modules/contracts";
import type { StatsData, SummaryConfig, TrendPoint } from "../manifest";

type Props = WidgetBodyProps<StatsData, SummaryConfig>;

const TILES: { key: "commits" | "prs" | "reviews" | "issues"; label: string }[] = [
  { key: "commits", label: "Commits" },
  { key: "prs", label: "PRs" },
  { key: "reviews", label: "Reviews" },
  { key: "issues", label: "Issues" },
];

type TrendTooltipPayload = { value: number; payload: TrendPoint };
function TrendTooltip({ active, payload }: { active?: boolean; payload?: TrendTooltipPayload[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md bg-panel px-2 py-1 text-xs shadow-lg ring-1 ring-border dark:bg-panel-dark dark:ring-border-dark">
      <span className="font-medium tabular-nums text-slate-900 dark:text-slate-100">{p.count}</span>
      <span className="ml-1.5 text-muted">{new Date(p.date).toLocaleDateString()}</span>
    </div>
  );
}

export function SummaryWidget({ data }: Props) {
  if (data.total === 0)
    return <p className="py-2 text-sm text-slate-500 dark:text-slate-400">No activity in this timeframe.</p>;
  return (
    <div className="space-y-3 py-1">
      <div className="grid grid-cols-2 gap-3">
        {TILES.map((t) => (
          <div key={t.key} className="flex flex-col">
            <span className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {data[t.key]}
            </span>
            <span className="text-xs uppercase tracking-wide text-muted">{t.label}</span>
          </div>
        ))}
      </div>
      <div className="h-16">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.trend} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
            <XAxis dataKey="date" hide />
            <YAxis hide />
            <Tooltip
              content={<TrendTooltip />}
              cursor={{ fill: "currentColor", fillOpacity: 0.06 }}
              isAnimationActive={false}
            />
            <Bar dataKey="count" fill="var(--chart-contrib)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
```

Create `src/modules/github-stats/render.ts`:

```ts
import { SiGithub } from "react-icons/si";
import { registerRender } from "@/modules/render-registry";
import { summaryManifest } from "./manifest";
import { SummaryWidget } from "./widgets/summary-widget";

registerRender(summaryManifest, {
  Component: SummaryWidget,
  count: (d) => d.total,
  icon: { Icon: SiGithub, className: "text-[#181717] dark:text-white" },
});
```

Modify `src/globals.css` — inside the existing `:root { --chart-cpu: … }` block add `--chart-contrib: #40c463;` and inside the `.dark { … }` chart block add `--chart-contrib: #39d353;` (place each next to the other `--chart-*` vars, around lines 57 and 63).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- github-stats-summary-widget`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/github-stats/widgets/summary-widget.tsx src/modules/github-stats/render.ts src/globals.css tests/modules/github-stats-summary-widget.test.tsx
git commit -m "feat: github-stats summary widget (tiles + trend)"
```

---

### Task 6: Heatmap widget + heatmap color scale

**Files:**
- Create: `src/modules/github-stats/widgets/heatmap-widget.tsx`
- Modify: `src/modules/github-stats/render.ts` (add heatmap registration)
- Modify: `src/globals.css` (add `--heat-0`..`--heat-4`)
- Test: `tests/modules/github-stats-heatmap-widget.test.tsx`

**Interfaces:**
- Consumes: `WidgetBodyProps` from `@/modules/contracts`; `HeatmapData`/`HeatmapConfig`/`HeatmapDay` from `../manifest`; `heatmapManifest` + `HeatmapWidget`.
- Produces: `HeatmapWidget` React component; render registration for `heatmapManifest`.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/modules/github-stats-heatmap-widget.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HeatmapWidget } from "@/modules/github-stats/widgets/heatmap-widget";
import { heatmapDefaultConfig } from "@/modules/github-stats/manifest";
import type { HeatmapData } from "@/modules/github-stats/manifest";

const data: HeatmapData = {
  total: 16,
  weeks: [
    { days: [
      { date: "2026-07-06", count: 0, level: 0 },
      { date: "2026-07-07", count: 4, level: 2 },
    ] },
    { days: [
      { date: "2026-07-13", count: 12, level: 4 },
    ] },
  ],
};

function renderWidget(d: HeatmapData) {
  return render(<HeatmapWidget data={d} config={heatmapDefaultConfig} refresh={async () => {}} />);
}

describe("HeatmapWidget", () => {
  it("renders one cell per contribution day", () => {
    const { container } = renderWidget(data);
    expect(container.querySelectorAll("span[title]")).toHaveLength(3);
  });

  it("labels a cell with its count and date", () => {
    renderWidget(data);
    expect(screen.getByTitle(/4 contributions on Jul 7/i)).toBeInTheDocument();
  });

  it("shows an empty state when the year has no activity", () => {
    renderWidget({ total: 0, weeks: [] });
    expect(screen.getByText(/No activity this year/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- github-stats-heatmap-widget`
Expected: FAIL — cannot resolve the widget module.

- [ ] **Step 3: Write minimal implementation**

Create `src/modules/github-stats/widgets/heatmap-widget.tsx`:

```tsx
"use client";
import type { WidgetBodyProps } from "@/modules/contracts";
import type { HeatmapData, HeatmapConfig, HeatmapDay } from "../manifest";

const LEVEL_VAR = ["--heat-0", "--heat-1", "--heat-2", "--heat-3", "--heat-4"] as const;

function cellTitle(d: HeatmapDay): string {
  const n = d.count === 1 ? "1 contribution" : `${d.count} contributions`;
  const when = new Date(d.date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${n} on ${when}`;
}

export function HeatmapWidget({ data }: WidgetBodyProps<HeatmapData, HeatmapConfig>) {
  if (data.total === 0)
    return <p className="py-2 text-sm text-slate-500 dark:text-slate-400">No activity this year.</p>;
  return (
    <div className="overflow-x-auto py-1">
      <div className="flex gap-[3px]">
        {data.weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-[3px]">
            {week.days.map((d) => (
              <span
                key={d.date}
                title={cellTitle(d)}
                className="h-[11px] w-[11px] rounded-[2px]"
                style={{ backgroundColor: `var(${LEVEL_VAR[d.level]})` }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
```

Modify `src/modules/github-stats/render.ts` to add the heatmap import + registration:

```ts
import { SiGithub } from "react-icons/si";
import { registerRender } from "@/modules/render-registry";
import { summaryManifest, heatmapManifest } from "./manifest";
import { SummaryWidget } from "./widgets/summary-widget";
import { HeatmapWidget } from "./widgets/heatmap-widget";

registerRender(summaryManifest, {
  Component: SummaryWidget,
  count: (d) => d.total,
  icon: { Icon: SiGithub, className: "text-[#181717] dark:text-white" },
});
registerRender(heatmapManifest, {
  Component: HeatmapWidget,
  count: (d) => d.total,
  icon: { Icon: SiGithub, className: "text-[#181717] dark:text-white" },
});
```

Modify `src/globals.css` — in the `:root` chart block add:

```css
    --heat-0: #ebedf0;
    --heat-1: #9be9a8;
    --heat-2: #40c463;
    --heat-3: #30a14e;
    --heat-4: #216e39;
```

and in the `.dark` chart block add:

```css
    --heat-0: rgba(255, 255, 255, 0.06);
    --heat-1: #0e4429;
    --heat-2: #006d32;
    --heat-3: #26a641;
    --heat-4: #39d353;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- github-stats-heatmap-widget`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/github-stats/widgets/heatmap-widget.tsx src/modules/github-stats/render.ts src/globals.css tests/modules/github-stats-heatmap-widget.test.tsx
git commit -m "feat: github-stats contribution heatmap widget"
```

---

### Task 7: Wire render barrel, bump cache version, registration test

**Files:**
- Modify: `src/modules/render.ts` (register the module's render barrel)
- Modify: `src/server/cache-version.ts` (bump `CACHE_VERSION`)
- Test: `tests/modules/github-stats-registration.test.ts`

**Interfaces:**
- Consumes: `SUMMARY_TYPE`/`HEATMAP_TYPE` from `@/modules/github-stats/manifest`; the module barrels via `@/modules/fetch` and `@/modules/render`.
- Produces: both widget types resolvable in both registries.

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/github-stats-registration.test.ts
import { describe, it, expect } from "vitest";
import "@/modules/fetch";
import "@/modules/render";
import { getFetchWidget } from "@/modules/fetch-registry";
import { getRenderWidget } from "@/modules/render-registry";
import { SUMMARY_TYPE, HEATMAP_TYPE } from "@/modules/github-stats/manifest";

describe("github-stats registration barrels", () => {
  it("registers both widgets on both sides with a shared manifest", () => {
    for (const t of [SUMMARY_TYPE, HEATMAP_TYPE]) {
      expect(getFetchWidget(t), `fetch ${t}`).toBeDefined();
      expect(getRenderWidget(t), `render ${t}`).toBeDefined();
      expect(getFetchWidget(t)!.manifest).toBe(getRenderWidget(t)!.manifest);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- github-stats-registration`
Expected: FAIL — render side (`getRenderWidget`) is undefined because `src/modules/render.ts` does not yet import the module's render barrel.

- [ ] **Step 3: Write minimal implementation**

Modify `src/modules/render.ts` — add after the `github/render` import:

```ts
import "./github-stats/render";
```

Modify `src/server/cache-version.ts` — bump the constant:

```ts
export const CACHE_VERSION = 2;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- github-stats-registration`
Expected: PASS (1 test).

- [ ] **Step 5: Run the full suite + lint + typecheck**

Run: `npm test && npm run lint && npm run build:vite`
Expected: all pass — no regressions, TypeScript compiles.

- [ ] **Step 6: Commit**

```bash
git add src/modules/render.ts src/server/cache-version.ts tests/modules/github-stats-registration.test.ts
git commit -m "feat: wire github-stats render barrel + bump cache version"
```

---

## Manual verification (after all tasks)

Run the real app (`npm run dev`) and confirm end-to-end against live GitHub:

1. Add the **GitHub Stats** widget → tiles show non-zero counts for a 30-day window; changing Timeframe in Configure re-fetches and updates counts; trend bars render; refresh button works.
2. Add the **Contribution Heatmap** widget → ~53 columns of cells render with a green intensity gradient; hovering a cell shows `N contributions on Mon D`; horizontal scroll works in a narrow card.
3. Toggle dark mode → chart bar + heatmap colors adapt.
4. With `gh` logged out (`gh auth logout`), both cards show the auth error ("run `gh auth login`") rather than crashing.

## Self-Review Notes

- **Spec coverage:** viewer scope (Task 4 `viewer` query), KPI tiles + trend (Tasks 3/5), heatmap trailing-year (Tasks 2/6), preset timeframe enum (Task 1), two independent fetches (Task 4), GraphQL error surfacing (Task 4), registration test + normalizer tests + window test (Tasks 7/3/2), cache bump + wiring (Tasks 4/7). ✅
- **Deviation:** size-adaptive ResizeObserver layout (spec) → fixed compact layout, because the shared `useElementHeight` hook is unbuilt; flagged in Task 5. This is the only departure from the spec.
- **PRs merged** intentionally excluded (single-call constraint) — consistent with spec's "out of scope."
- **Type consistency:** `StatsData`/`HeatmapData`/`TrendPoint`/`HeatmapDay` defined once in `manifest.ts` and imported everywhere; `RawContributions` defined once in `stats.ts`.
