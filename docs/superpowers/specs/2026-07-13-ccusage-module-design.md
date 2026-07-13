# ccusage module — today's Claude spend with a limit gauge

**Date:** 2026-07-13
**Status:** Approved design, pending implementation

## Goal

A dashboard widget showing how much I've spent on Claude Code **today** (USD), with a
configurable **daily limit**. The card renders a bar that shifts color green→amber→red as
today's spend approaches the limit — the closer to the limit, the redder.

Data comes from [`ccusage`](https://github.com/ryoppippi/ccusage), a CLI that reads Claude
Code's local usage logs (`~/.claude/projects/**`) and prices them. No auth, no network.

## Scope (decided)

- **Track:** today's cost only (single number vs. a daily limit). No month/block views.
- **CLI:** global `ccusage` binary on PATH (`npm i -g ccusage`). Not installed today → the
  widget surfaces a `not-found` install hint via the standard integration-health path.
- **Body:** big today's-cost number + a color-gradient bar toward the limit. No token counts,
  no per-model breakdown.
- **Gradient curve:** linear.
- **Default limit:** $20.

## Module layout

Standard self-contained module under `src/modules/ccusage/`, mirroring `github`/`jira`:

| File | Responsibility |
| --- | --- |
| `manifest.ts` | Type constant, Zod config schema + default, `Data` payload type, `WidgetManifest` via `defineManifest`. No runtime deps. |
| `ccusage.ts` | `runCcusage(args)` — thin wrapper over `runCli("ccusage", args, opts)`. |
| `fetch.ts` | `registerFetch(manifest, { fetch: fetchCcusage })`. |
| `integration.ts` | `registerIntegration({ id: "ccusage", … })` for health/install hint. |
| `render.ts` | `registerRender(manifest, { Component, icon })`. |
| `widgets/ccusage-widget.tsx` | The gauge UI + pure `costColor(pct)`. |

### Wiring (barrels + housekeeping)

- Add `import "./ccusage/fetch";` to `src/modules/fetch.ts`.
- Add `import "./ccusage/render";` to `src/modules/render.ts`.
- Add `import "./ccusage/integration";` to `src/modules/integrations.ts`.
- Bump `CACHE_VERSION` in `src/server/cache-version.ts` (new payload shape).
- Add `tests/modules/ccusage-registration.test.ts`.

## manifest.ts

```ts
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

## ccusage.ts

```ts
import { runCli } from "@/server/cli";

/** Run the ccusage CLI. Process-model: exit 0 + JSON on stdout; missing binary → not-found. */
export function runCcusage(args: string[]) {
  return runCli("ccusage", args, { timeoutMs: 20000 });
}
```

## fetch.ts / fetchCcusage

- Compute today's local date. ccusage `--since`/`--until` take `YYYYMMDD`.
- Run `ccusage daily --json --since <today> --until <today>`.
- Parse stdout JSON: `{ totals: { totalCost: number } }`. Return
  `{ costUsd: totals?.totalCost ?? 0, date: <YYYY-MM-DD> }`.
- If ccusage returns no rows for today, `daily` is `[]` and `totals.totalCost` is `0` — a valid
  zero-cost result, not an error.
- Errors propagate as `CliError` (missing binary → `not-found`, non-zero exit → `failed`,
  timeout → `timeout`) and render through the shell's standard per-card error UI.

```ts
export async function fetchCcusage(): Promise<CcusageSpendData> {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const compact = `${y}${m}${d}`;
  const { stdout } = await runCcusage([
    "daily", "--json", "--since", compact, "--until", compact,
  ]);
  const body = JSON.parse(stdout) as { totals?: { totalCost?: number } };
  return { costUsd: body.totals?.totalCost ?? 0, date: `${y}-${m}-${d}` };
}
```

(`new Date()` is available in the webview runtime; the workflow-script restriction does not apply here.)

## integration.ts

```ts
registerIntegration({
  id: "ccusage",
  name: "Claude Usage (ccusage)",
  tool: {
    bin: "ccusage",
    installHint: "Install ccusage — `npm i -g ccusage`.",
    // no authHint: ccusage reads local ~/.claude logs, no auth
  },
  checkHealth: () => probeHealth(() => runCcusage(["--version"])),
});
```

## Widget UI (`ccusage-widget.tsx`)

Props: `{ data, config }: WidgetBodyProps<CcusageSpendData, CcusageSpendConfig>`.

- `const limit = config.dailyLimitUsd;`
- `const pct = limit > 0 ? data.costUsd / limit : 0;` (can exceed 1 when over budget)
- **Cost number:** `$${data.costUsd.toFixed(2)}`, large. Turns red (`text-danger`) when `pct >= 1`.
- **Bar (only when `limit > 0`):** a track with a fill at `width: min(pct,1)*100%` and inline
  `backgroundColor: costColor(pct)`. Below/beside it: `of $${limit.toFixed(2)} · ${Math.round(pct*100)}%`.
- **No limit (`limit === 0`):** show just the cost number, no bar.

### `costColor(pct)` — pure, linear

```ts
/** green (empty) → red (at/over limit). hue 140→0 linearly across pct 0→1. */
export function costColor(pct: number): string {
  const hue = 140 * (1 - Math.min(Math.max(pct, 0), 1));
  return `hsl(${hue} 70% 45%)`;
}
```

The bar background uses this HSL directly (dynamic value → inline style, not a Tailwind class).
The track behind it uses existing muted tokens (e.g. `bg-slate-200 dark:bg-slate-700`) for
theme parity. Saturation/lightness fixed so the hue reads clearly in both themes.

## Testing

- `tests/modules/ccusage-registration.test.ts` — assert both registries resolve
  `ccusage.spend` (copy an existing `*-registration.test.ts`).
- Unit-test `costColor`: `pct<=0` → hue 140 (green), `pct=0.5` → hue 70, `pct>=1` → hue 0 (red),
  and that it clamps above 1.
- Optionally a `fetchCcusage` parse test with a captured ccusage JSON fixture (zero-cost and
  non-zero cases), stubbing `runCcusage`.

## Non-goals (YAGNI)

- Token counts / per-model breakdown in the body.
- Monthly total or 5-hour billing-block views.
- Separate warn-threshold config (the gradient conveys proximity to the limit).
- npx fallback (global install is the chosen path; missing binary shows an install hint).
