# ccusage Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Claude Usage" dashboard widget that shows today's Claude Code spend (USD) from the `ccusage` CLI, with a configurable daily limit and a bar that turns green→red as spend approaches the limit.

**Architecture:** A self-contained CLI-backed module under `src/modules/ccusage/`, following the `github`/`jira` manifest/fetch/render/integration split. `fetch` runs `ccusage daily --json` scoped to today and returns `{ costUsd, date }`. The widget renders a big cost number over a gradient bar whose color is a pure function of `spend / limit`.

**Tech Stack:** TypeScript, React 19, Zod, Tailwind v4, Vitest + Testing Library, `tauri-plugin-shell` (via existing `runCli`).

## Global Constraints

- **Commits:** plain conventional style, **no Jira prefix** (personal project). End commit messages with the `Co-Authored-By` trailer used elsewhere in this repo.
- **Manifest purity:** `manifest.ts` has **no runtime deps** (no React/react-icons).
- **CLI errors:** reuse `runCli` from `src/server/cli.ts`; missing binary surfaces as `CliError` kind `not-found`.
- **Cache:** any new/changed `Data` payload requires bumping `CACHE_VERSION` in `src/server/cache-version.ts`.
- **Tailwind v4:** use existing token classes (`text-danger`, `bg-slate-200 dark:bg-slate-700`, etc.); dynamic gradient color is inline `style` (not a class).
- **Tests:** `npm test` (Vitest). Follow existing `tests/modules/*` patterns.
- **Integration type:** `IntegrationTool.authHint` is required by the type; provide a "no auth needed" string since ccusage reads local logs.

## File Structure

- Create `src/modules/ccusage/manifest.ts` — type constant, config schema + default, `Data` type, `WidgetManifest`.
- Create `src/modules/ccusage/ccusage.ts` — `runCcusage(args)` wrapper.
- Create `src/modules/ccusage/fetch.ts` — `fetchCcusage` + `registerFetch`.
- Create `src/modules/ccusage/widgets/ccusage-widget.tsx` — `costColor` + `CcusageWidget`.
- Create `src/modules/ccusage/integration.ts` — `registerIntegration`.
- Create `src/modules/ccusage/render.ts` — `registerRender`.
- Modify `src/modules/fetch.ts` — add `import "./ccusage/fetch";`.
- Modify `src/modules/render.ts` — add `import "./ccusage/render";`.
- Modify `src/modules/integrations.ts` — add `import "./ccusage/integration";`.
- Modify `src/server/cache-version.ts` — bump `CACHE_VERSION` 2 → 3.
- Create `tests/modules/ccusage-fetch.test.ts`, `tests/modules/ccusage-widget.test.tsx`, `tests/modules/ccusage-registration.test.ts`.

---

### Task 1: Manifest + fetch logic

**Files:**
- Create: `src/modules/ccusage/manifest.ts`
- Create: `src/modules/ccusage/ccusage.ts`
- Create: `src/modules/ccusage/fetch.ts`
- Test: `tests/modules/ccusage-fetch.test.ts`

**Interfaces:**
- Produces:
  - `CCUSAGE_SPEND_TYPE = "ccusage.spend"` (string const)
  - `ccusageSpendConfigSchema: ZodType<CcusageSpendConfig>`, `ccusageSpendDefaultConfig: CcusageSpendConfig` where `CcusageSpendConfig = { dailyLimitUsd: number }`
  - `CcusageSpendData = { costUsd: number; date: string }`
  - `ccusageSpendManifest: WidgetManifest<CcusageSpendConfig>`
  - `runCcusage(args: string[]): Promise<{ stdout: string; stderr: string }>`
  - `fetchCcusage(config: CcusageSpendConfig): Promise<CcusageSpendData>`

- [ ] **Step 1: Write `manifest.ts`**

```ts
import { z } from "zod";
import { defineManifest } from "@/modules/contracts";

export const CCUSAGE_SPEND_TYPE = "ccusage.spend";

export const ccusageSpendConfigSchema = z.object({
  dailyLimitUsd: z.number().min(0).default(20).describe("Daily limit (USD)"),
});
export type CcusageSpendConfig = z.infer<typeof ccusageSpendConfigSchema>;
export const ccusageSpendDefaultConfig: CcusageSpendConfig = { dailyLimitUsd: 20 };

/** Today's spend as returned by fetch. `date` is the local YYYY-MM-DD it covers. */
export type CcusageSpendData = { costUsd: number; date: string };

export const ccusageSpendManifest = defineManifest({
  type: CCUSAGE_SPEND_TYPE,
  title: "Claude Usage",
  configSchema: ccusageSpendConfigSchema,
  defaultConfig: ccusageSpendDefaultConfig,
  refreshable: true,
  integration: "ccusage",
});
```

- [ ] **Step 2: Write `ccusage.ts`**

```ts
import { runCli } from "@/server/cli";

/** Run the ccusage CLI. Process-model: exit 0 with JSON on stdout; missing binary → not-found. */
export function runCcusage(args: string[]) {
  return runCli("ccusage", args, { timeoutMs: 20000 });
}
```

- [ ] **Step 3: Write `fetch.ts`**

```ts
import { registerFetch } from "@/modules/fetch-registry";
import { ccusageSpendManifest, type CcusageSpendConfig, type CcusageSpendData } from "./manifest";
import { runCcusage } from "./ccusage";

/** Today's local date as ccusage's compact `YYYYMMDD` plus a display `YYYY-MM-DD`. */
function today(): { compact: string; iso: string } {
  const now = new Date();
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return { compact: `${y}${m}${d}`, iso: `${y}-${m}-${d}` };
}

export async function fetchCcusage(_config: CcusageSpendConfig): Promise<CcusageSpendData> {
  const { compact, iso } = today();
  const { stdout } = await runCcusage(["daily", "--json", "--since", compact, "--until", compact]);
  const body = JSON.parse(stdout) as { totals?: { totalCost?: number } };
  return { costUsd: body.totals?.totalCost ?? 0, date: iso };
}

registerFetch(ccusageSpendManifest, { fetch: fetchCcusage });
```

- [ ] **Step 4: Write the failing test** — `tests/modules/ccusage-fetch.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/modules/ccusage/ccusage", () => ({ runCcusage: vi.fn() }));
import { runCcusage } from "@/modules/ccusage/ccusage";
import { fetchCcusage } from "@/modules/ccusage/fetch";

const mockRun = runCcusage as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => { mockRun.mockReset(); });

const cfg = { dailyLimitUsd: 20 };

describe("fetchCcusage", () => {
  it("parses today's totalCost and queries a single day", async () => {
    mockRun.mockResolvedValueOnce({ stdout: JSON.stringify({ totals: { totalCost: 2.65 } }), stderr: "" });
    const data = await fetchCcusage(cfg);
    expect(data.costUsd).toBe(2.65);

    const args = mockRun.mock.calls[0][0] as string[];
    expect(args[0]).toBe("daily");
    expect(args).toContain("--json");
    const since = args[args.indexOf("--since") + 1];
    const until = args[args.indexOf("--until") + 1];
    expect(since).toMatch(/^\d{8}$/);
    expect(until).toBe(since); // single day
    // date field mirrors the queried day
    expect(data.date).toBe(`${since.slice(0, 4)}-${since.slice(4, 6)}-${since.slice(6, 8)}`);
  });

  it("returns 0 when ccusage reports no usage for today", async () => {
    mockRun.mockResolvedValueOnce({ stdout: JSON.stringify({ daily: [] }), stderr: "" });
    const data = await fetchCcusage(cfg);
    expect(data.costUsd).toBe(0);
  });
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- ccusage-fetch`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/modules/ccusage/manifest.ts src/modules/ccusage/ccusage.ts src/modules/ccusage/fetch.ts tests/modules/ccusage-fetch.test.ts
git commit -m "feat: ccusage module manifest + today-spend fetch

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Widget + gradient color

**Files:**
- Create: `src/modules/ccusage/widgets/ccusage-widget.tsx`
- Test: `tests/modules/ccusage-widget.test.tsx`

**Interfaces:**
- Consumes: `CcusageSpendData`, `CcusageSpendConfig` (Task 1); `WidgetBodyProps` from `@/modules/contracts`.
- Produces:
  - `costColor(pct: number): string` — `hsl(<hue> 70% 45%)`, `hue = 140·(1−clamp(pct,0,1))`.
  - `CcusageWidget: FC<WidgetBodyProps<CcusageSpendData, CcusageSpendConfig>>`.

- [ ] **Step 1: Write the failing test** — `tests/modules/ccusage-widget.test.tsx`

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { costColor, CcusageWidget } from "@/modules/ccusage/widgets/ccusage-widget";

const noop = async () => {};

describe("costColor", () => {
  it("is green when empty, yellow-green mid, red at/over limit, clamped", () => {
    expect(costColor(0)).toBe("hsl(140 70% 45%)");
    expect(costColor(0.5)).toBe("hsl(70 70% 45%)");
    expect(costColor(1)).toBe("hsl(0 70% 45%)");
    expect(costColor(2)).toBe("hsl(0 70% 45%)");   // clamped above 1
    expect(costColor(-1)).toBe("hsl(140 70% 45%)"); // clamped below 0
  });
});

describe("CcusageWidget", () => {
  it("shows cost, limit and percent, with a bar filled to the fraction", () => {
    render(<CcusageWidget data={{ costUsd: 2.65, date: "2026-07-13" }} config={{ dailyLimitUsd: 20 }} refresh={noop} />);
    expect(screen.getByText("$2.65")).toBeInTheDocument();
    expect(screen.getByText(/of \$20\.00 · 13%/)).toBeInTheDocument();
    expect(screen.getByTestId("ccusage-bar").style.width).toBe("13.25%");
  });

  it("caps the bar at 100% and reddens the cost when over the limit", () => {
    render(<CcusageWidget data={{ costUsd: 25, date: "2026-07-13" }} config={{ dailyLimitUsd: 20 }} refresh={noop} />);
    expect(screen.getByText(/· 125%/)).toBeInTheDocument();
    expect(screen.getByTestId("ccusage-bar").style.width).toBe("100%");
    expect(screen.getByText("$25.00").className).toContain("text-danger");
  });

  it("hides the bar and shows 'No limit set' when the limit is 0", () => {
    render(<CcusageWidget data={{ costUsd: 2.65, date: "2026-07-13" }} config={{ dailyLimitUsd: 0 }} refresh={noop} />);
    expect(screen.getByText("No limit set")).toBeInTheDocument();
    expect(screen.queryByTestId("ccusage-bar")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ccusage-widget`
Expected: FAIL — cannot resolve `@/modules/ccusage/widgets/ccusage-widget`.

- [ ] **Step 3: Write `ccusage-widget.tsx`**

```tsx
"use client";
import type { WidgetBodyProps } from "@/modules/contracts";
import type { CcusageSpendData, CcusageSpendConfig } from "../manifest";

/** green (empty) → red (at/over limit). hue 140→0 linearly across pct 0→1, clamped. */
export function costColor(pct: number): string {
  const hue = 140 * (1 - Math.min(Math.max(pct, 0), 1));
  return `hsl(${hue} 70% 45%)`;
}

export function CcusageWidget({ data, config }: WidgetBodyProps<CcusageSpendData, CcusageSpendConfig>) {
  const limit = config.dailyLimitUsd;
  const pct = limit > 0 ? data.costUsd / limit : 0;
  const over = limit > 0 && pct >= 1;

  return (
    <div className="flex flex-col gap-2">
      <div
        className={`text-3xl font-semibold tabular-nums ${
          over ? "text-danger" : "text-slate-900 dark:text-slate-100"
        }`}
      >
        ${data.costUsd.toFixed(2)}
      </div>

      {limit > 0 ? (
        <div className="flex flex-col gap-1">
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
            <div
              data-testid="ccusage-bar"
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.min(pct, 1) * 100}%`, backgroundColor: costColor(pct) }}
            />
          </div>
          <div className="tabular-nums text-xs text-slate-500 dark:text-slate-400">
            of ${limit.toFixed(2)} · {Math.round(pct * 100)}%
          </div>
        </div>
      ) : (
        <div className="text-xs text-slate-500 dark:text-slate-400">No limit set</div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- ccusage-widget`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/ccusage/widgets/ccusage-widget.tsx tests/modules/ccusage-widget.test.tsx
git commit -m "feat: ccusage widget with green-to-red limit gauge

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Integration, render, barrels, cache bump

**Files:**
- Create: `src/modules/ccusage/integration.ts`
- Create: `src/modules/ccusage/render.ts`
- Modify: `src/modules/fetch.ts`
- Modify: `src/modules/render.ts`
- Modify: `src/modules/integrations.ts`
- Modify: `src/server/cache-version.ts:19` (the `CACHE_VERSION` line)
- Test: `tests/modules/ccusage-registration.test.ts`

**Interfaces:**
- Consumes: `ccusageSpendManifest`, `CCUSAGE_SPEND_TYPE` (Task 1); `CcusageWidget` (Task 2); `runCcusage` (Task 1); `registerIntegration`, `probeHealth`, `registerRender`, `registerFetch` (existing).
- Produces: integration id `"ccusage"`; both registries resolve `CCUSAGE_SPEND_TYPE`.

- [ ] **Step 1: Write `integration.ts`**

```ts
import { registerIntegration } from "@/modules/integration-registry";
import { probeHealth } from "@/modules/integration-health";
import { runCcusage } from "./ccusage";

registerIntegration({
  id: "ccusage",
  name: "Claude Usage (ccusage)",
  tool: {
    bin: "ccusage",
    installHint: "Install ccusage — `npm i -g ccusage`.",
    authHint: "No authentication needed — ccusage reads local ~/.claude logs.",
  },
  checkHealth: () => probeHealth(() => runCcusage(["--version"])),
});
```

- [ ] **Step 2: Write `render.ts`**

```ts
import { FiDollarSign } from "react-icons/fi";
import { registerRender } from "@/modules/render-registry";
import { ccusageSpendManifest } from "./manifest";
import { CcusageWidget } from "./widgets/ccusage-widget";

registerRender(ccusageSpendManifest, {
  Component: CcusageWidget,
  icon: { Icon: FiDollarSign, className: "text-emerald-600 dark:text-emerald-400" },
});
```

- [ ] **Step 3: Wire the barrels** — add one import line to each (keep the existing "Register future…" comment last):

`src/modules/fetch.ts`:
```ts
import "./ccusage/fetch";
```
`src/modules/render.ts`:
```ts
import "./ccusage/render";
```
`src/modules/integrations.ts`:
```ts
import "./ccusage/integration";
```

- [ ] **Step 4: Bump the cache version** — `src/server/cache-version.ts`, change:
```ts
export const CACHE_VERSION = 2;
```
to:
```ts
export const CACHE_VERSION = 3;
```

- [ ] **Step 5: Write the failing test** — `tests/modules/ccusage-registration.test.ts`

```ts
import { describe, it, expect } from "vitest";
import "@/modules/fetch";
import "@/modules/render";
import "@/modules/integrations";
import { getFetchWidget } from "@/modules/fetch-registry";
import { getRenderWidget } from "@/modules/render-registry";
import { getIntegration } from "@/modules/integration-registry";
import { CCUSAGE_SPEND_TYPE } from "@/modules/ccusage/manifest";

describe("ccusage registration barrels", () => {
  it("registers the widget on both sides with a shared manifest", () => {
    expect(getFetchWidget(CCUSAGE_SPEND_TYPE)).toBeDefined();
    expect(getRenderWidget(CCUSAGE_SPEND_TYPE)).toBeDefined();
    expect(getFetchWidget(CCUSAGE_SPEND_TYPE)!.manifest).toBe(getRenderWidget(CCUSAGE_SPEND_TYPE)!.manifest);
  });

  it("registers the ccusage integration", () => {
    expect(getIntegration("ccusage")).toBeDefined();
  });
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- ccusage-registration`
Expected: PASS (2 tests).

- [ ] **Step 7: Run the full suite + typecheck/lint**

Run: `npm test`
Expected: all pass (including the pre-existing `integrations-registration` test, which should still be green with the new integration).

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 8: Commit**

```bash
git add src/modules/ccusage/integration.ts src/modules/ccusage/render.ts src/modules/fetch.ts src/modules/render.ts src/modules/integrations.ts src/server/cache-version.ts tests/modules/ccusage-registration.test.ts
git commit -m "feat: wire ccusage render + integration barrels, bump cache version

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Manual verification (after Task 3)

1. Install the CLI if needed: `npm i -g ccusage` (confirm `ccusage --version`).
2. Run the app (`npm run dev`), add the **Claude Usage** widget from the add-widget picker.
3. Confirm today's cost shows and the bar color tracks `cost / limit`. Open Configure, set `Daily limit (USD)` low (e.g. 1) and confirm the bar reddens / caps and the number turns red when over.
4. Confirm the Integrations panel lists **Claude Usage (ccusage)** as installed; temporarily rename the binary to confirm the install hint appears.

> Do not restart the user's already-running app without asking — hand off the restart if one is running.

## Self-Review notes

- **Spec coverage:** module layout (Task 1–3), config `dailyLimitUsd` default 20 (Task 1), today-only fetch via `ccusage daily --json --since/--until` (Task 1), `costColor` linear green→red + gauge + red-over-limit + no-bar-at-0 (Task 2), integration health/install hint (Task 3), 3 barrels + CACHE_VERSION bump (Task 3), registration test (Task 3). Zero-cost path covered (Task 1 test 2). No `authHint`-optional assumption — provided explicitly per the type.
- **Type consistency:** `CcusageSpendData`/`CcusageSpendConfig`/`CCUSAGE_SPEND_TYPE`/`ccusageSpendManifest`/`runCcusage`/`fetchCcusage`/`costColor`/`CcusageWidget` used identically across tasks.
- **No placeholders:** all steps contain full code/commands.
