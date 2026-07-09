# GitHub Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first real integration — four GitHub widgets (My PRs, Team PRs, Failing Actions, Dependabot) driven by the `gh` CLI — plus the framework pieces they need: a reusable CLI runner and per-widget config editing.

**Architecture:** A generic `runCli` helper classifies CLI failures into typed errors that the existing cache-first data flow already surfaces. A self-contained `src/modules/github/` module registers four widgets; each `fetch()` shells out to `gh`, parses `--json`, and normalizes to a typed shape. A schema-driven config form (derived from each widget's Zod schema via `z.toJSONSchema`) is reached from a new card overflow menu and persisted through an extended `PATCH /api/widgets/[id]`.

**Tech Stack:** Next.js 16 (App Router, route `params` is a Promise), React 19, TypeScript, Zod v4, Drizzle + better-sqlite3, Vitest + Testing Library, `gh` 2.96.

**Spec:** `docs/superpowers/specs/2026-07-09-work-dashboard-github-module-design.md`

**Conventions:** No Jira prefix (personal project); conventional commits (`feat:`/`fix:`/`test:`/`refactor:`). Branch `github-module` already exists. TDD; commit after each task.

---

## File Structure

**New — framework:**
- `src/server/cli.ts` — `runCli()` + `CliError`. Server-only. Spawn a CLI, classify failures.
- `src/components/schema-form.tsx` — `describeSchema()` (Zod→field descriptors) + `<SchemaForm>`.
- `src/components/card-menu.tsx` — `⋯` header menu (Configure / Remove).
- `src/components/configure-dialog.tsx` — modal hosting `<SchemaForm>`, PATCHes config, refreshes.

**New — GitHub module:**
- `src/modules/github/manifest.ts` — type ids, Zod config schemas + defaults, shared Data types. Client-safe, no runtime deps.
- `src/modules/github/gh.ts` — server-only `runGh()` / `ghJson()` wrapping `runCli` with gh's auth pattern.
- `src/modules/github/prs.ts` — server-only PR search + CI rollup + normalize/enrich; `fetchMyPrs`/`fetchTeamPrs`. Shared by My PRs and Team PRs.
- `src/modules/github/runs.ts` — server-only `fetchFailingActions` + `normalizeRun`.
- `src/modules/github/dependabot.ts` — server-only `fetchDependabot` + `normalizeAlert`.
- `src/modules/github/server.ts` — imports the above; `registerServerWidget` ×4.
- `src/modules/github/client.ts` — `registerClientWidget` ×4.
- `src/modules/github/widgets/pr-list-widget.tsx` — body shared by My PRs + Team PRs.
- `src/modules/github/widgets/failing-actions-widget.tsx`, `dependabot-widget.tsx`.

**Edited:**
- `src/modules/contracts.ts` — `ClientWidget` gains `configSchema` + `defaultConfig`.
- `src/modules/core/client.ts` — supply the two new fields.
- `src/modules/server.ts`, `src/modules/client.ts` — barrels: add github imports.
- `src/app/api/widgets/[id]/route.ts` — PATCH accepts `config` (validated).
- `src/server/config-repo.ts` — `setConfig()`; validate config in `addWidget` (lenient).
- `src/components/widget-shell.tsx` — `menu` slot in header.
- `src/components/widget-card.tsx` — build `CardMenu`, thread `onConfigure`/`onRemove`.
- `src/components/sortable-card.tsx` — pass `onConfigure` through.
- `src/components/dashboard.tsx` — configure-dialog state, config-save state update.
- `tests/modules/registry.test.ts` — client cases pass the now-required fields.

**Test fixtures:** `tests/fixtures/github/` (recorded `gh --json` samples — see Task 4).

---

## Task 1: CLI runner + error classifier

**Files:**
- Create: `src/server/cli.ts`
- Test: `tests/server/cli.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/cli.test.ts
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));
import { execFile } from "node:child_process";
import { runCli, CliError } from "@/server/cli";

const mockExec = execFile as unknown as Mock;

// execFile(bin, args, opts, cb) — drive the callback the way node does.
function whenExec(err: unknown, stdout = "", stderr = "") {
  mockExec.mockImplementation((_bin: string, _args: string[], _opts: unknown, cb: Function) =>
    cb(err, stdout, stderr),
  );
}

beforeEach(() => mockExec.mockReset());

describe("runCli", () => {
  it("resolves stdout/stderr on success", async () => {
    whenExec(null, "hello", "");
    await expect(runCli("gh", ["--version"])).resolves.toEqual({ stdout: "hello", stderr: "" });
  });

  it("throws not-found on ENOENT", async () => {
    whenExec(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }));
    const err = await runCli("gh", ["x"]).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.kind).toBe("not-found");
    expect(err.message).toMatch(/gh not found/);
  });

  it("throws auth when stderr matches the auth pattern", async () => {
    whenExec(Object.assign(new Error("exit 1"), { code: 1 }), "", "gh auth login required");
    const err = await runCli("gh", ["x"], {
      notAuthenticatedPattern: /gh auth login/i,
      notAuthenticatedMessage: "Not authenticated — run `gh auth login`",
    }).catch((e) => e);
    expect(err.kind).toBe("auth");
    expect(err.message).toBe("Not authenticated — run `gh auth login`");
  });

  it("throws failed with stderr for other non-zero exits", async () => {
    whenExec(Object.assign(new Error("exit 1"), { code: 1 }), "", "some error text");
    const err = await runCli("gh", ["x"]).catch((e) => e);
    expect(err.kind).toBe("failed");
    expect(err.message).toBe("some error text");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/server/cli.test.ts`
Expected: FAIL — cannot find module `@/server/cli`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server/cli.ts
import "server-only";
import { execFile } from "node:child_process";

export type CliErrorKind = "not-found" | "auth" | "failed";

export class CliError extends Error {
  constructor(message: string, readonly kind: CliErrorKind, readonly stderr = "") {
    super(message);
    this.name = "CliError";
  }
}

export interface RunCliOptions {
  notAuthenticatedPattern?: RegExp;
  notAuthenticatedMessage?: string;
}

/** Spawn a CLI with an arg array (no shell interpolation). Throws CliError on failure. */
export function runCli(
  bin: string,
  args: string[],
  opts: RunCliOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) return resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return reject(new CliError(`${bin} not found — install it`, "not-found"));
      const errText = (stderr || "").toString();
      if (opts.notAuthenticatedPattern?.test(errText)) {
        return reject(new CliError(opts.notAuthenticatedMessage ?? "Not authenticated", "auth", errText));
      }
      return reject(new CliError(errText.trim() || `${bin} exited with an error`, "failed", errText));
    });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/server/cli.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/cli.ts tests/server/cli.test.ts
git commit -m "feat: add CLI runner with typed error classification"
```

---

## Task 2: GitHub manifest (types, config schemas, defaults)

**Files:**
- Create: `src/modules/github/manifest.ts`

No test — pure declarations exercised by later tasks.

- [ ] **Step 1: Write the manifest**

```ts
// src/modules/github/manifest.ts
import { z } from "zod";

export const MY_PRS_TYPE = "github.myPrs";
export const TEAM_PRS_TYPE = "github.teamPrs";
export const FAILING_ACTIONS_TYPE = "github.failingActions";
export const DEPENDABOT_TYPE = "github.dependabot";

// --- Config schemas (.describe() drives form labels) ---
export const myPrsConfigSchema = z.object({
  limit: z.number().int().min(1).max(50).default(20).describe("Max PRs"),
});
export type MyPrsConfig = z.infer<typeof myPrsConfigSchema>;
export const myPrsDefaultConfig: MyPrsConfig = { limit: 20 };

export const teamPrsConfigSchema = z.object({
  authors: z.array(z.string()).default([]).describe("GitHub usernames"),
  limit: z.number().int().min(1).max(50).default(20).describe("Max PRs"),
});
export type TeamPrsConfig = z.infer<typeof teamPrsConfigSchema>;
export const teamPrsDefaultConfig: TeamPrsConfig = { authors: [], limit: 20 };

export const failingActionsConfigSchema = z.object({
  repos: z.array(z.string()).default([]).describe("Repos (owner/name)"),
  limit: z.number().int().min(1).max(50).default(10).describe("Max runs per repo"),
});
export type FailingActionsConfig = z.infer<typeof failingActionsConfigSchema>;
export const failingActionsDefaultConfig: FailingActionsConfig = { repos: [], limit: 10 };

export const dependabotConfigSchema = z.object({
  repos: z.array(z.string()).default([]).describe("Repos (owner/name)"),
  severity: z.enum(["low", "medium", "high", "critical"]).optional().describe("Min severity"),
});
export type DependabotConfig = z.infer<typeof dependabotConfigSchema>;
export const dependabotDefaultConfig: DependabotConfig = { repos: [] };

// --- Shared data shapes ---
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

export type MyPrsData = { prs: PrItem[] };
export type TeamPrsData = { prs: PrItem[] };
export type FailingActionsData = { runs: RunItem[] };
export type DependabotData = { alerts: AlertItem[] };
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/github/manifest.ts
git commit -m "feat: add github module manifest (types, config schemas)"
```

---

## Task 3: `gh` helper

**Files:**
- Create: `src/modules/github/gh.ts`
- Test: `tests/modules/github-gh.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/github-gh.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/cli", () => ({
  runCli: vi.fn(),
  CliError: class CliError extends Error {},
}));
import { runCli } from "@/server/cli";
import { runGh, ghJson } from "@/modules/github/gh";

const mockRun = runCli as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => mockRun.mockReset());

describe("gh helper", () => {
  it("runGh returns stdout and passes gh auth options", async () => {
    mockRun.mockResolvedValue({ stdout: "out", stderr: "" });
    await expect(runGh(["pr", "list"])).resolves.toBe("out");
    const [bin, args, opts] = mockRun.mock.calls[0];
    expect(bin).toBe("gh");
    expect(args).toEqual(["pr", "list"]);
    expect(opts.notAuthenticatedPattern).toBeInstanceOf(RegExp);
    expect(opts.notAuthenticatedMessage).toMatch(/gh auth login/);
  });

  it("ghJson parses JSON stdout", async () => {
    mockRun.mockResolvedValue({ stdout: '[{"n":1}]', stderr: "" });
    await expect(ghJson(["x"])).resolves.toEqual([{ n: 1 }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/modules/github-gh.test.ts`
Expected: FAIL — cannot find module `@/modules/github/gh`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/modules/github/gh.ts
import "server-only";
import { runCli } from "@/server/cli";

const GH_AUTH_PATTERN = /gh auth login|not logged in|authentication|HTTP 401|Bad credentials/i;

export async function runGh(args: string[]): Promise<string> {
  const { stdout } = await runCli("gh", args, {
    notAuthenticatedPattern: GH_AUTH_PATTERN,
    notAuthenticatedMessage: "Not authenticated — run `gh auth login`",
  });
  return stdout;
}

export async function ghJson<T>(args: string[]): Promise<T> {
  return JSON.parse(await runGh(args)) as T;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/modules/github-gh.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/github/gh.ts tests/modules/github-gh.test.ts
git commit -m "feat: add gh runner helper"
```

---

## Task 4: Record `gh` fixtures + PR helpers (CI rollup, normalize)

The pure helpers are tested against small controlled fixtures. **First record real `gh` output and confirm the field names below match** — if `gh` differs, update the `Gh*` types + fixtures accordingly before proceeding.

**Files:**
- Create: `tests/fixtures/github/search-prs.json`, `tests/fixtures/github/pr-view.json`
- Create: `src/modules/github/prs.ts`
- Test: `tests/modules/github-prs.test.ts`

- [ ] **Step 1: Record real fixtures and verify field names**

Run (save output, then inspect):
```bash
gh search prs --author=@me --state=open \
  --json number,title,url,repository,author,updatedAt,isDraft --limit 3 \
  > tests/fixtures/github/search-prs.json
# Pick one PR url from the above, then:
gh pr view <URL> --json statusCheckRollup,reviewDecision > tests/fixtures/github/pr-view.json
```
Confirm: `repository.nameWithOwner`, `author.login`, `statusCheckRollup` (array), `reviewDecision` exist. If a name differs, adjust `GhSearchPr` / `GhPrView` in Step 3 and the test fixtures in Step 2 to match reality. If a fixture ends up empty (e.g. no open PRs), hand-author a representative file using the shapes in Step 2.

- [ ] **Step 2: Write the failing test (controlled fixtures inline)**

```ts
// tests/modules/github-prs.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/modules/github/gh", () => ({ runGh: vi.fn(), ghJson: vi.fn() }));
import { ghJson } from "@/modules/github/gh";
import { rollupCi, normalizeSearchPr, fetchMyPrs, type GhSearchPr } from "@/modules/github/prs";

const mockJson = ghJson as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => mockJson.mockReset());

const rawPr: GhSearchPr = {
  number: 7, title: "Fix thing", url: "https://github.com/o/r/pull/7",
  repository: { nameWithOwner: "o/r" }, author: { login: "alice" },
  updatedAt: "2026-07-08T10:00:00Z", isDraft: false,
};

describe("rollupCi", () => {
  it("returns none for empty checks", () => expect(rollupCi([])).toBe("none"));
  it("returns danger when any check failed", () =>
    expect(rollupCi([{ conclusion: "SUCCESS" }, { conclusion: "FAILURE" }])).toBe("danger"));
  it("returns warn when a check is pending and none failed", () =>
    expect(rollupCi([{ status: "IN_PROGRESS" }, { conclusion: "SUCCESS" }])).toBe("warn"));
  it("returns ok when all succeed", () =>
    expect(rollupCi([{ conclusion: "SUCCESS" }])).toBe("ok"));
  it("handles StatusContext state shape", () =>
    expect(rollupCi([{ state: "FAILURE" }])).toBe("danger"));
});

describe("normalizeSearchPr", () => {
  it("maps gh fields to PrItem with unknown ci/review", () => {
    expect(normalizeSearchPr(rawPr)).toEqual({
      repo: "o/r", number: 7, title: "Fix thing", url: "https://github.com/o/r/pull/7",
      author: "alice", ci: "none", review: "none", updatedAt: "2026-07-08T10:00:00Z",
    });
  });
});

describe("fetchMyPrs", () => {
  it("searches then enriches each PR with CI + review", async () => {
    mockJson
      .mockResolvedValueOnce([rawPr]) // search
      .mockResolvedValueOnce({ statusCheckRollup: [{ conclusion: "FAILURE" }], reviewDecision: "APPROVED" }); // enrich
    const data = await fetchMyPrs({ limit: 20 });
    expect(data.prs).toHaveLength(1);
    expect(data.prs[0].ci).toBe("danger");
    expect(data.prs[0].review).toBe("APPROVED");
    // first call is the search with --author=@me
    expect((mockJson.mock.calls[0][0] as string[]).join(" ")).toContain("--author=@me");
  });

  it("returns empty prs when search finds nothing", async () => {
    mockJson.mockResolvedValueOnce([]);
    await expect(fetchMyPrs({ limit: 20 })).resolves.toEqual({ prs: [] });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/modules/github-prs.test.ts`
Expected: FAIL — cannot find module `@/modules/github/prs`.

- [ ] **Step 4: Write minimal implementation**

```ts
// src/modules/github/prs.ts
import "server-only";
import { ghJson } from "./gh";
import type { CiStatus, PrItem, MyPrsData, TeamPrsData, MyPrsConfig, TeamPrsConfig } from "./manifest";

export type GhSearchPr = {
  number: number; title: string; url: string;
  repository: { nameWithOwner: string };
  author: { login: string };
  updatedAt: string; isDraft: boolean;
};

type GhCheck = { status?: string; conclusion?: string; state?: string };
type GhPrView = { statusCheckRollup?: GhCheck[]; reviewDecision?: string };

const FAIL = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ERROR", "STARTUP_FAILURE", "ACTION_REQUIRED"]);
const PENDING = new Set(["IN_PROGRESS", "QUEUED", "PENDING", "WAITING", "REQUESTED"]);

export function rollupCi(checks: GhCheck[] | undefined): CiStatus {
  if (!checks || checks.length === 0) return "none";
  let sawPending = false;
  for (const c of checks) {
    const signal = c.conclusion || c.state || c.status || "";
    if (FAIL.has(signal)) return "danger";
    if (PENDING.has(signal) || (!c.conclusion && !c.state)) sawPending = true;
  }
  return sawPending ? "warn" : "ok";
}

export function normalizeSearchPr(raw: GhSearchPr): PrItem {
  return {
    repo: raw.repository.nameWithOwner,
    number: raw.number,
    title: raw.title,
    url: raw.url,
    author: raw.author.login,
    ci: "none",
    review: "none",
    updatedAt: raw.updatedAt,
  };
}

async function enrichPr(pr: PrItem): Promise<PrItem> {
  const view = await ghJson<GhPrView>(["pr", "view", pr.url, "--json", "statusCheckRollup,reviewDecision"]);
  return { ...pr, ci: rollupCi(view.statusCheckRollup), review: view.reviewDecision || "none" };
}

async function searchAndEnrich(searchArgs: string[]): Promise<PrItem[]> {
  const raw = await ghJson<GhSearchPr[]>(searchArgs);
  const base = raw.map(normalizeSearchPr);
  return Promise.all(base.map(enrichPr));
}

const SEARCH_JSON = "number,title,url,repository,author,updatedAt,isDraft";

export async function fetchMyPrs(config: MyPrsConfig): Promise<MyPrsData> {
  const prs = await searchAndEnrich([
    "search", "prs", "--author=@me", "--state=open",
    "--json", SEARCH_JSON, "--limit", String(config.limit),
  ]);
  return { prs };
}

export async function fetchTeamPrs(config: TeamPrsConfig): Promise<TeamPrsData> {
  if (config.authors.length === 0) return { prs: [] };
  const authorArgs = config.authors.map((a) => `--author=${a}`);
  const prs = await searchAndEnrich([
    "search", "prs", ...authorArgs, "--state=open",
    "--json", SEARCH_JSON, "--limit", String(config.limit),
  ]);
  return { prs };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/modules/github-prs.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add tests/fixtures/github/ src/modules/github/prs.ts tests/modules/github-prs.test.ts
git commit -m "feat: add github PR search/enrich helpers + fixtures"
```

---

## Task 5: Failing Actions fetch

**Files:**
- Create: `src/modules/github/runs.ts`
- Test: `tests/modules/github-runs.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/github-runs.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/modules/github/gh", () => ({ runGh: vi.fn(), ghJson: vi.fn() }));
import { ghJson } from "@/modules/github/gh";
import { normalizeRun, fetchFailingActions, type GhRun } from "@/modules/github/runs";

const mockJson = ghJson as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => mockJson.mockReset());

const rawRun: GhRun = {
  displayTitle: "CI on main", workflowName: "CI", headBranch: "main",
  event: "push", url: "https://github.com/o/r/actions/runs/1", createdAt: "2026-07-08T09:00:00Z",
};

describe("normalizeRun", () => {
  it("maps a gh run to RunItem", () => {
    expect(normalizeRun("o/r", rawRun)).toEqual({
      repo: "o/r", name: "CI on main", url: "https://github.com/o/r/actions/runs/1",
      branch: "main", event: "push", createdAt: "2026-07-08T09:00:00Z",
    });
  });
});

describe("fetchFailingActions", () => {
  it("queries each repo with --status=failure and merges runs", async () => {
    mockJson.mockResolvedValueOnce([rawRun]).mockResolvedValueOnce([]);
    const data = await fetchFailingActions({ repos: ["o/r", "o/r2"], limit: 10 });
    expect(data.runs).toHaveLength(1);
    expect((mockJson.mock.calls[0][0] as string[]).join(" ")).toContain("--status=failure");
    expect((mockJson.mock.calls[0][0] as string[]).join(" ")).toContain("-R o/r");
  });

  it("keeps successful repos when one repo errors (partial failure)", async () => {
    mockJson.mockResolvedValueOnce([rawRun]).mockRejectedValueOnce(new Error("boom"));
    const data = await fetchFailingActions({ repos: ["o/r", "o/bad"], limit: 10 });
    expect(data.runs).toHaveLength(1);
  });

  it("returns empty when no repos configured", async () => {
    await expect(fetchFailingActions({ repos: [], limit: 10 })).resolves.toEqual({ runs: [] });
  });

  it("throws when every repo errors", async () => {
    mockJson.mockRejectedValue(new Error("boom"));
    await expect(fetchFailingActions({ repos: ["o/a", "o/b"], limit: 10 })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/modules/github-runs.test.ts`
Expected: FAIL — cannot find module `@/modules/github/runs`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/modules/github/runs.ts
import "server-only";
import { ghJson } from "./gh";
import type { RunItem, FailingActionsData, FailingActionsConfig } from "./manifest";

export type GhRun = {
  displayTitle: string; workflowName: string; headBranch: string;
  event: string; url: string; createdAt: string;
};

const RUN_JSON = "displayTitle,workflowName,headBranch,event,url,createdAt";

export function normalizeRun(repo: string, raw: GhRun): RunItem {
  return {
    repo, name: raw.displayTitle, url: raw.url,
    branch: raw.headBranch, event: raw.event, createdAt: raw.createdAt,
  };
}

export async function fetchFailingActions(config: FailingActionsConfig): Promise<FailingActionsData> {
  if (config.repos.length === 0) return { runs: [] };
  const results = await Promise.allSettled(
    config.repos.map(async (repo) => {
      const raw = await ghJson<GhRun[]>([
        "run", "list", "-R", repo, "--status=failure",
        "--json", RUN_JSON, "--limit", String(config.limit),
      ]);
      return raw.map((r) => normalizeRun(repo, r));
    }),
  );
  const runs = results.filter((r) => r.status === "fulfilled").flatMap((r) => (r as PromiseFulfilledResult<RunItem[]>).value);
  if (runs.length === 0 && results.every((r) => r.status === "rejected")) {
    throw (results[0] as PromiseRejectedResult).reason;
  }
  return { runs };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/modules/github-runs.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/github/runs.ts tests/modules/github-runs.test.ts
git commit -m "feat: add failing actions fetch"
```

---

## Task 6: Dependabot fetch

Uses `gh api` (not `gh search`), so raw shape is the REST payload (snake_case).

**Files:**
- Create: `src/modules/github/dependabot.ts`
- Test: `tests/modules/github-dependabot.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/github-dependabot.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/modules/github/gh", () => ({ runGh: vi.fn(), ghJson: vi.fn() }));
import { ghJson } from "@/modules/github/gh";
import { normalizeAlert, fetchDependabot, type GhAlert } from "@/modules/github/dependabot";

const mockJson = ghJson as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => mockJson.mockReset());

const rawAlert: GhAlert = {
  html_url: "https://github.com/o/r/security/dependabot/1",
  security_advisory: { summary: "RCE in foo", severity: "high" },
  security_vulnerability: { package: { name: "foo", ecosystem: "npm" } },
};

describe("normalizeAlert", () => {
  it("maps a REST alert to AlertItem", () => {
    expect(normalizeAlert("o/r", rawAlert)).toEqual({
      repo: "o/r", package: "foo", severity: "high",
      summary: "RCE in foo", url: "https://github.com/o/r/security/dependabot/1",
    });
  });
});

describe("fetchDependabot", () => {
  it("queries open alerts per repo and merges", async () => {
    mockJson.mockResolvedValueOnce([rawAlert]).mockResolvedValueOnce([]);
    const data = await fetchDependabot({ repos: ["o/r", "o/r2"] });
    expect(data.alerts).toHaveLength(1);
    expect((mockJson.mock.calls[0][0] as string[]).join(" ")).toContain("/repos/o/r/dependabot/alerts");
    expect((mockJson.mock.calls[0][0] as string[]).join(" ")).toContain("state=open");
  });

  it("passes severity filter when set", async () => {
    mockJson.mockResolvedValueOnce([]);
    await fetchDependabot({ repos: ["o/r"], severity: "critical" });
    expect((mockJson.mock.calls[0][0] as string[]).join(" ")).toContain("severity=critical");
  });

  it("returns empty when no repos configured", async () => {
    await expect(fetchDependabot({ repos: [] })).resolves.toEqual({ alerts: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/modules/github-dependabot.test.ts`
Expected: FAIL — cannot find module `@/modules/github/dependabot`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/modules/github/dependabot.ts
import "server-only";
import { ghJson } from "./gh";
import type { AlertItem, Severity, DependabotData, DependabotConfig } from "./manifest";

export type GhAlert = {
  html_url: string;
  security_advisory: { summary: string; severity: Severity };
  security_vulnerability: { package: { name: string; ecosystem: string } };
};

export function normalizeAlert(repo: string, raw: GhAlert): AlertItem {
  return {
    repo,
    package: raw.security_vulnerability.package.name,
    severity: raw.security_advisory.severity,
    summary: raw.security_advisory.summary,
    url: raw.html_url,
  };
}

export async function fetchDependabot(config: DependabotConfig): Promise<DependabotData> {
  if (config.repos.length === 0) return { alerts: [] };
  const sev = config.severity ? `&severity=${config.severity}` : "";
  const results = await Promise.allSettled(
    config.repos.map(async (repo) => {
      const raw = await ghJson<GhAlert[]>([
        "api", `/repos/${repo}/dependabot/alerts?state=open&per_page=50${sev}`,
      ]);
      return raw.map((a) => normalizeAlert(repo, a));
    }),
  );
  const alerts = results.filter((r) => r.status === "fulfilled").flatMap((r) => (r as PromiseFulfilledResult<AlertItem[]>).value);
  if (alerts.length === 0 && results.every((r) => r.status === "rejected")) {
    throw (results[0] as PromiseRejectedResult).reason;
  }
  return { alerts };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/modules/github-dependabot.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/github/dependabot.ts tests/modules/github-dependabot.test.ts
git commit -m "feat: add dependabot alerts fetch"
```

---

## Task 7: Register server widgets + server barrel

**Files:**
- Create: `src/modules/github/server.ts`
- Modify: `src/modules/server.ts`
- Test: covered by Task 12's registration test (deferred until client side exists).

- [ ] **Step 1: Write `server.ts`**

```ts
// src/modules/github/server.ts
import "server-only";
import { registerServerWidget } from "@/modules/server-registry";
import {
  MY_PRS_TYPE, TEAM_PRS_TYPE, FAILING_ACTIONS_TYPE, DEPENDABOT_TYPE,
  myPrsConfigSchema, myPrsDefaultConfig,
  teamPrsConfigSchema, teamPrsDefaultConfig,
  failingActionsConfigSchema, failingActionsDefaultConfig,
  dependabotConfigSchema, dependabotDefaultConfig,
} from "./manifest";
import { fetchMyPrs, fetchTeamPrs } from "./prs";
import { fetchFailingActions } from "./runs";
import { fetchDependabot } from "./dependabot";

registerServerWidget({
  type: MY_PRS_TYPE, configSchema: myPrsConfigSchema, defaultConfig: myPrsDefaultConfig, fetch: fetchMyPrs,
});
registerServerWidget({
  type: TEAM_PRS_TYPE, configSchema: teamPrsConfigSchema, defaultConfig: teamPrsDefaultConfig, fetch: fetchTeamPrs,
});
registerServerWidget({
  type: FAILING_ACTIONS_TYPE, configSchema: failingActionsConfigSchema, defaultConfig: failingActionsDefaultConfig, fetch: fetchFailingActions,
});
registerServerWidget({
  type: DEPENDABOT_TYPE, configSchema: dependabotConfigSchema, defaultConfig: dependabotDefaultConfig, fetch: fetchDependabot,
});
```

- [ ] **Step 2: Add to the server barrel**

Modify `src/modules/server.ts` — add after the core import:

```ts
import "server-only";
import "./core/server";
import "./github/server";
// Register future modules' server side here.
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/github/server.ts src/modules/server.ts
git commit -m "feat: register github server widgets"
```

---

## Task 8: Contract change — `ClientWidget` gains config fields

**Files:**
- Modify: `src/modules/contracts.ts`
- Modify: `src/modules/core/client.ts`
- Modify: `tests/modules/registry.test.ts`

- [ ] **Step 1: Update the failing test first**

In `tests/modules/registry.test.ts`, the two client registrations must supply the new required fields. Replace the "registers and lists a client widget" test body:

```ts
  it("registers and lists a client widget", () => {
    registerClientWidget({
      type: "t.a", title: "A", Component: () => null,
      configSchema: z.object({}), defaultConfig: {},
    });
    expect(getClientWidget("t.a")?.title).toBe("A");
    expect(listClientWidgets()).toEqual([{ type: "t.a", title: "A" }]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/modules/registry.test.ts`
Expected: FAIL — TypeScript error: `configSchema`/`defaultConfig` missing on `ClientWidget` (type not yet updated).

- [ ] **Step 3: Update the contract**

In `src/modules/contracts.ts`, extend `ClientWidget`:

```ts
/** Client-only: how a widget renders. */
export interface ClientWidget<Data = unknown, Config = unknown> {
  type: string;
  title: string;
  Component: FC<WidgetBodyProps<Data, Config>>;
  configSchema: ZodType<Config>;
  defaultConfig: Config;
}
```

(`ZodType` is already imported at the top of the file.)

- [ ] **Step 4: Update core client registration**

Replace `src/modules/core/client.ts`:

```ts
import { registerClientWidget } from "@/modules/client-registry";
import { STATUS_TYPE, statusConfigSchema, statusDefaultConfig } from "./manifest";
import { StatusWidget } from "./widgets/status-widget";

registerClientWidget({
  type: STATUS_TYPE,
  title: "System Status",
  Component: StatusWidget,
  configSchema: statusConfigSchema,
  defaultConfig: statusDefaultConfig,
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/modules/registry.test.ts && npx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/contracts.ts src/modules/core/client.ts tests/modules/registry.test.ts
git commit -m "feat: add configSchema+defaultConfig to ClientWidget contract"
```

---

## Task 9: `describeSchema` — Zod → field descriptors

**Files:**
- Create: `src/components/schema-form.tsx` (introspection half; component added in Task 10)
- Test: `tests/components/schema-form.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/components/schema-form.test.ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { describeSchema } from "@/components/schema-form";

describe("describeSchema", () => {
  it("derives fields with kind, label and default", () => {
    const schema = z.object({
      repos: z.array(z.string()).default([]).describe("Repos (owner/name)"),
      limit: z.number().int().default(10).describe("Max"),
      enabled: z.boolean().default(false),
      severity: z.enum(["low", "high"]).optional().describe("Min severity"),
    });
    const fields = describeSchema(schema);
    expect(fields).toEqual([
      { key: "repos", label: "Repos (owner/name)", kind: "stringList", def: [] },
      { key: "limit", label: "Max", kind: "number", def: 10 },
      { key: "enabled", label: "Enabled", kind: "boolean", def: false },
      { key: "severity", label: "Min severity", kind: "enum", options: ["low", "high"], def: undefined },
    ]);
  });

  it("throws on an unsupported field kind", () => {
    const schema = z.object({ nested: z.object({ a: z.string() }) });
    expect(() => describeSchema(schema)).toThrow(/Unsupported/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/components/schema-form.test.ts`
Expected: FAIL — cannot find module `@/components/schema-form`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/schema-form.tsx
"use client";
import { z, type ZodType } from "zod";

export type FieldKind = "string" | "number" | "boolean" | "stringList" | "enum";
export type Field = { key: string; label: string; kind: FieldKind; options?: string[]; def?: unknown };

function humanize(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
}

type JsonProp = {
  type?: string; description?: string; default?: unknown;
  enum?: string[]; items?: { type?: string };
};

export function describeSchema(schema: ZodType): Field[] {
  const json = z.toJSONSchema(schema) as { properties?: Record<string, JsonProp> };
  const props = json.properties ?? {};
  return Object.entries(props).map(([key, p]) => {
    const label = p.description ?? humanize(key);
    const def = p.default;
    if (Array.isArray(p.enum)) return { key, label, kind: "enum", options: p.enum, def };
    switch (p.type) {
      case "string": return { key, label, kind: "string", def };
      case "number":
      case "integer": return { key, label, kind: "number", def };
      case "boolean": return { key, label, kind: "boolean", def };
      case "array":
        if (p.items?.type === "string") return { key, label, kind: "stringList", def };
        throw new Error(`Unsupported array item type for "${key}"`);
      default:
        throw new Error(`Unsupported field type for "${key}": ${p.type}`);
    }
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/components/schema-form.test.ts`
Expected: PASS (2 tests).

> If the optional `severity` enum fails (Zod v4 may emit `anyOf` instead of a bare `enum` for `.optional()`), read the actual `z.toJSONSchema` output for that field and extend the enum detection to also read `p.anyOf?.flatMap(a => a.enum ?? [])`. Keep the test as the contract.

- [ ] **Step 5: Commit**

```bash
git add src/components/schema-form.tsx tests/components/schema-form.test.ts
git commit -m "feat: derive form fields from zod schema via toJSONSchema"
```

---

## Task 10: `<SchemaForm>` component

**Files:**
- Modify: `src/components/schema-form.tsx` (add the component)

No new unit test (rendering is exercised live in Task 16); logic lives in the tested `describeSchema`.

- [ ] **Step 1: Append the component to `src/components/schema-form.tsx`**

```tsx
const inputCls =
  "w-full rounded-lg bg-surface px-2.5 py-1.5 text-sm ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-primary-500/50 dark:bg-surface-dark dark:ring-border-dark";

function StringListEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <textarea
      className={inputCls}
      rows={4}
      value={value.join("\n")}
      placeholder="one per line"
      onChange={(e) => onChange(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))}
    />
  );
}

export function SchemaForm({
  schema, values, onChange,
}: {
  schema: ZodType;
  values: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
}) {
  const fields = describeSchema(schema);
  const set = (key: string, val: unknown) => onChange({ ...values, [key]: val });

  return (
    <div className="space-y-4">
      {fields.map((f) => (
        <div key={f.key} className="space-y-1.5">
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">{f.label}</label>
          {f.kind === "string" && (
            <input className={inputCls} value={String(values[f.key] ?? "")} onChange={(e) => set(f.key, e.target.value)} />
          )}
          {f.kind === "number" && (
            <input
              type="number"
              className={inputCls}
              value={String(values[f.key] ?? f.def ?? "")}
              onChange={(e) => set(f.key, e.target.value === "" ? undefined : Number(e.target.value))}
            />
          )}
          {f.kind === "boolean" && (
            <input type="checkbox" checked={Boolean(values[f.key])} onChange={(e) => set(f.key, e.target.checked)} />
          )}
          {f.kind === "enum" && (
            <select
              className={inputCls}
              value={String(values[f.key] ?? "")}
              onChange={(e) => set(f.key, e.target.value || undefined)}
            >
              <option value="">Any</option>
              {f.options!.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          )}
          {f.kind === "stringList" && (
            <StringListEditor value={(values[f.key] as string[]) ?? []} onChange={(v) => set(f.key, v)} />
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/schema-form.tsx
git commit -m "feat: add SchemaForm component"
```

---

## Task 11: Config persistence — `setConfig`, `addWidget` validation, PATCH route

**Files:**
- Modify: `src/server/config-repo.ts`
- Modify: `src/app/api/widgets/[id]/route.ts`
- Test: `tests/api/widget-config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/api/widget-config.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { useTempDb } from "../helpers/db";
import "@/modules/server";
import { addWidget, getWidget } from "@/server/config-repo";
import { PATCH } from "@/app/api/widgets/[id]/route";

beforeEach(() => useTempDb());

function patch(id: string, body: unknown) {
  return PATCH(new Request(`http://x/api/widgets/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) });
}

describe("PATCH /api/widgets/[id] config", () => {
  it("persists a valid config", async () => {
    const w = addWidget("github.failingActions", { repos: [], limit: 10 });
    const res = await patch(w.id, { config: { repos: ["o/r"], limit: 5 } });
    expect(res.status).toBe(200);
    expect(getWidget(w.id)?.config).toEqual({ repos: ["o/r"], limit: 5 });
  });

  it("rejects an invalid config with 400 and does not write", async () => {
    const w = addWidget("github.failingActions", { repos: [], limit: 10 });
    const res = await patch(w.id, { config: { repos: "not-an-array", limit: 5 } });
    expect(res.status).toBe(400);
    expect(getWidget(w.id)?.config).toEqual({ repos: [], limit: 10 });
  });

  it("still toggles hidden", async () => {
    const w = addWidget("core.status", { label: "System" });
    const res = await patch(w.id, { hidden: true });
    expect(res.status).toBe(200);
    expect(getWidget(w.id)?.hidden).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/api/widget-config.test.ts`
Expected: FAIL — `PATCH` ignores `config` / no `setConfig`.

- [ ] **Step 3: Add `setConfig` + lenient validation in `config-repo.ts`**

Add the `getServerWidget` import and two edits to `src/server/config-repo.ts`:

```ts
import { getServerWidget } from "@/modules/server-registry";
```

Replace `addWidget`'s config assignment so config is validated when a schema is registered:

```ts
export function addWidget(type: string, config: Record<string, unknown>): Widget {
  const def = getServerWidget(type);
  const validated = def ? (def.configSchema.parse(config) as Record<string, unknown>) : config;
  const columnCount = Number(getPref("columnCount", String(COLUMN_COUNT_DEFAULT)));
  const existing = getWidgets();
  const counts = Array.from({ length: columnCount }, () => 0);
  for (const w of existing) if (w.column < columnCount) counts[w.column]++;
  const column = counts.indexOf(Math.min(...counts));
  const order = existing.filter((w) => w.column === column).length;
  const row: Widget = {
    id: randomUUID(), type, column, order, hidden: false, config: validated, refreshInterval: null,
  };
  getDb().insert(widgets).values(row).run();
  return row;
}
```

Add `setConfig` near `setHidden`:

```ts
export function setConfig(id: string, config: Record<string, unknown>): void {
  getDb().update(widgets).set({ config }).where(eq(widgets.id, id)).run();
}
```

- [ ] **Step 4: Extend the PATCH route**

Replace `src/app/api/widgets/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import "@/modules/server";
import { setHidden, setConfig, removeWidget, getWidget } from "@/server/config-repo";
import { getServerWidget } from "@/modules/server-registry";

export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const widget = getWidget(id);
  if (!widget) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json()) as { hidden?: boolean; config?: Record<string, unknown> };

  if (typeof body.hidden === "boolean") setHidden(id, body.hidden);

  if (body.config !== undefined) {
    const def = getServerWidget(widget.type);
    const parsed = def?.configSchema.safeParse(body.config);
    if (def && parsed && !parsed.success) {
      return NextResponse.json({ error: "Invalid config" }, { status: 400 });
    }
    setConfig(id, (parsed?.success ? parsed.data : body.config) as Record<string, unknown>);
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  removeWidget(id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/api/widget-config.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/server/config-repo.ts "src/app/api/widgets/[id]/route.ts" tests/api/widget-config.test.ts
git commit -m "feat: validate + persist widget config via PATCH"
```

---

## Task 12: Card overflow menu + widget-shell slot + registration test

**Files:**
- Create: `src/components/card-menu.tsx`
- Modify: `src/components/widget-shell.tsx`
- Modify: `src/components/widget-card.tsx`
- Test: `tests/modules/github-registration.test.ts`

- [ ] **Step 1: Write the registration test (proves both barrels wire github)**

```ts
// tests/modules/github-registration.test.ts
import { describe, it, expect } from "vitest";
import "@/modules/server";
import "@/modules/client";
import { getServerWidget } from "@/modules/server-registry";
import { getClientWidget } from "@/modules/client-registry";
import { MY_PRS_TYPE, TEAM_PRS_TYPE, FAILING_ACTIONS_TYPE, DEPENDABOT_TYPE } from "@/modules/github/manifest";

describe("github registration barrels", () => {
  it("registers all four widgets on both sides", () => {
    for (const t of [MY_PRS_TYPE, TEAM_PRS_TYPE, FAILING_ACTIONS_TYPE, DEPENDABOT_TYPE]) {
      expect(getServerWidget(t), `server ${t}`).toBeDefined();
      expect(getClientWidget(t), `client ${t}`).toBeDefined();
    }
  });
});
```

This test stays red until Task 13 adds the client registrations + client barrel. That's expected — leave it red at the end of this task and green after Task 13. (If your executor requires each task to end green, run this file's assertions after Task 13.)

- [ ] **Step 2: Write `card-menu.tsx`**

```tsx
// src/components/card-menu.tsx
"use client";
import { useEffect, useRef, useState } from "react";

export function CardMenu({ onConfigure, onRemove }: { onConfigure: () => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button aria-label="Widget menu" aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((v) => !v)} className="icon-btn">
        <span className="text-[0.95rem] leading-none">⋯</span>
      </button>
      {open && (
        <div role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-36 overflow-hidden rounded-lg bg-panel py-1 shadow-lg ring-1 ring-border dark:bg-panel-dark dark:ring-border-dark">
          <button role="menuitem" onClick={() => { setOpen(false); onConfigure(); }}
            className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-white/5">
            Configure
          </button>
          <button role="menuitem" onClick={() => { setOpen(false); onRemove(); }}
            className="block w-full px-3 py-1.5 text-left text-sm text-danger hover:bg-danger/10">
            Remove
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add a `menu` slot to `widget-shell.tsx`**

Add `menu?: ReactNode;` to the props type, and render it in the header controls after `{headerExtra}` and before the refresh button:

```tsx
export function WidgetShell({
  title, state, error, fetchedAt, onRefresh, children, headerExtra, menu,
}: {
  title: string;
  state: WidgetState;
  error?: string | null;
  fetchedAt: number | null;
  onRefresh: () => void;
  children?: ReactNode;
  headerExtra?: ReactNode;
  menu?: ReactNode;
}) {
```

In the header controls div, insert `{menu}` right after `{headerExtra}`:

```tsx
          {fetchedAt && <span className="tabular-nums">{ago(fetchedAt)}</span>}
          {headerExtra}
          {menu}
          <button
            aria-label="Refresh"
```

- [ ] **Step 4: Build the menu in `widget-card.tsx`**

Update `WidgetCard` to accept optional callbacks and pass a `CardMenu` into the shell. Replace the component signature and the `<WidgetShell … menu={…}>` wiring:

```tsx
"use client";
import { getClientWidget } from "@/modules/client-registry";
import type { Widget } from "@/server/config-repo";
import { WidgetShell, type WidgetState } from "./widget-shell";
import { useWidgetData } from "./use-widget-data";
import { CardMenu } from "./card-menu";

export function WidgetCard({
  widget, onConfigure, onRemove,
}: {
  widget: Widget;
  onConfigure?: (w: Widget) => void;
  onRemove?: (id: string) => void;
}) {
  const def = getClientWidget(widget.type);
  const { data, isLoading, refresh } = useWidgetData(widget.id, widget.refreshInterval);

  if (!def) {
    return <WidgetShell title={widget.type} state="error" error={`No renderer for ${widget.type}`} fetchedAt={null} onRefresh={() => {}} />;
  }

  const hasData = data != null && data.payload != null;
  const errored = data?.status === "error";
  const state: WidgetState = isLoading ? "loading" : hasData ? "ok" : errored ? "error" : "empty";
  const Body = def.Component;
  const menu =
    onConfigure && onRemove ? (
      <CardMenu onConfigure={() => onConfigure(widget)} onRemove={() => onRemove(widget.id)} />
    ) : undefined;

  return (
    <WidgetShell
      title={def.title}
      state={state}
      error={data?.error}
      fetchedAt={data?.fetchedAt ?? null}
      onRefresh={refresh}
      menu={menu}
      headerExtra={
        errored && hasData ? (
          <span
            title={data?.error ?? "Refresh failed"}
            className="rounded-full bg-warn/15 px-1.5 py-0.5 text-[0.6875rem] font-medium text-warn"
          >
            stale
          </span>
        ) : undefined
      }
    >
      {hasData && (
        <Body data={data!.payload} config={widget.config} runAction={async () => {}} />
      )}
    </WidgetShell>
  );
}
```

- [ ] **Step 5: Verify compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/card-menu.tsx src/components/widget-shell.tsx src/components/widget-card.tsx tests/modules/github-registration.test.ts
git commit -m "feat: add card overflow menu with configure/remove"
```

---

## Task 13: GitHub widget bodies + client registrations + client barrel

**Files:**
- Create: `src/modules/github/widgets/pr-list-widget.tsx`
- Create: `src/modules/github/widgets/failing-actions-widget.tsx`
- Create: `src/modules/github/widgets/dependabot-widget.tsx`
- Create: `src/modules/github/client.ts`
- Modify: `src/modules/client.ts`

- [ ] **Step 1: PR list body (shared by My PRs + Team PRs)**

```tsx
// src/modules/github/widgets/pr-list-widget.tsx
"use client";
import type { WidgetBodyProps } from "@/modules/contracts";
import type { MyPrsData, CiStatus } from "../manifest";

const ciDot: Record<CiStatus, string> = {
  ok: "bg-ok", warn: "bg-warn", danger: "bg-danger", none: "bg-slate-300 dark:bg-white/20",
};

export function PrListWidget({ data }: WidgetBodyProps<MyPrsData, unknown>) {
  if (data.prs.length === 0) return <p className="text-sm text-slate-500 dark:text-slate-400">No open PRs.</p>;
  return (
    <ul className="divide-y divide-border dark:divide-border-dark">
      {data.prs.map((pr) => (
        <li key={pr.url} className="flex items-center gap-2.5 py-2">
          <span aria-label={`CI ${pr.ci}`} className={`h-2 w-2 shrink-0 rounded-full ${ciDot[pr.ci]}`} />
          <a href={pr.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-sm hover:underline">
            {pr.title}
          </a>
          <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
            {pr.repo}#{pr.number}
          </span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Failing Actions body**

```tsx
// src/modules/github/widgets/failing-actions-widget.tsx
"use client";
import type { WidgetBodyProps } from "@/modules/contracts";
import type { FailingActionsData } from "../manifest";

export function FailingActionsWidget({ data }: WidgetBodyProps<FailingActionsData, unknown>) {
  if (data.runs.length === 0) return <p className="text-sm text-slate-500 dark:text-slate-400">No failing runs.</p>;
  return (
    <ul className="divide-y divide-border dark:divide-border-dark">
      {data.runs.map((run) => (
        <li key={run.url} className="flex items-center gap-2.5 py-2">
          <span className="h-2 w-2 shrink-0 rounded-full bg-danger" />
          <a href={run.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-sm hover:underline">
            {run.name}
          </a>
          <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">{run.repo} · {run.branch}</span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 3: Dependabot body**

```tsx
// src/modules/github/widgets/dependabot-widget.tsx
"use client";
import type { WidgetBodyProps } from "@/modules/contracts";
import type { DependabotData, Severity } from "../manifest";

const sevCls: Record<Severity, string> = {
  low: "text-slate-500", medium: "text-warn", high: "text-danger", critical: "text-danger font-semibold",
};

export function DependabotWidget({ data }: WidgetBodyProps<DependabotData, unknown>) {
  if (data.alerts.length === 0) return <p className="text-sm text-slate-500 dark:text-slate-400">No open alerts.</p>;
  return (
    <ul className="divide-y divide-border dark:divide-border-dark">
      {data.alerts.map((a) => (
        <li key={a.url} className="flex items-center gap-2.5 py-2">
          <span className={`shrink-0 text-xs uppercase ${sevCls[a.severity]}`}>{a.severity}</span>
          <a href={a.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-sm hover:underline">
            {a.package}: {a.summary}
          </a>
          <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">{a.repo}</span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Client registrations**

```ts
// src/modules/github/client.ts
import { registerClientWidget } from "@/modules/client-registry";
import {
  MY_PRS_TYPE, TEAM_PRS_TYPE, FAILING_ACTIONS_TYPE, DEPENDABOT_TYPE,
  myPrsConfigSchema, myPrsDefaultConfig,
  teamPrsConfigSchema, teamPrsDefaultConfig,
  failingActionsConfigSchema, failingActionsDefaultConfig,
  dependabotConfigSchema, dependabotDefaultConfig,
} from "./manifest";
import { PrListWidget } from "./widgets/pr-list-widget";
import { FailingActionsWidget } from "./widgets/failing-actions-widget";
import { DependabotWidget } from "./widgets/dependabot-widget";

registerClientWidget({
  type: MY_PRS_TYPE, title: "My PRs", Component: PrListWidget,
  configSchema: myPrsConfigSchema, defaultConfig: myPrsDefaultConfig,
});
registerClientWidget({
  type: TEAM_PRS_TYPE, title: "Team PRs", Component: PrListWidget,
  configSchema: teamPrsConfigSchema, defaultConfig: teamPrsDefaultConfig,
});
registerClientWidget({
  type: FAILING_ACTIONS_TYPE, title: "Failing Actions", Component: FailingActionsWidget,
  configSchema: failingActionsConfigSchema, defaultConfig: failingActionsDefaultConfig,
});
registerClientWidget({
  type: DEPENDABOT_TYPE, title: "Dependabot Alerts", Component: DependabotWidget,
  configSchema: dependabotConfigSchema, defaultConfig: dependabotDefaultConfig,
});
```

- [ ] **Step 5: Add to the client barrel**

Modify `src/modules/client.ts`:

```ts
import "./core/client";
import "./github/client";
// Register future modules' client side here.
```

- [ ] **Step 6: Run the registration test + typecheck**

Run: `npm test -- tests/modules/github-registration.test.ts && npx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/modules/github/widgets/ src/modules/github/client.ts src/modules/client.ts
git commit -m "feat: add github widget bodies + client registrations"
```

---

## Task 14: Configure dialog + dashboard wiring

**Files:**
- Create: `src/components/configure-dialog.tsx`
- Modify: `src/components/sortable-card.tsx`
- Modify: `src/components/dashboard.tsx`

- [ ] **Step 1: Configure dialog**

```tsx
// src/components/configure-dialog.tsx
"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Widget } from "@/server/config-repo";
import { getClientWidget } from "@/modules/client-registry";
import { SchemaForm } from "./schema-form";

export function ConfigureDialog({
  widget, onClose, onSaved,
}: {
  widget: Widget;
  onClose: () => void;
  onSaved: (id: string, config: Record<string, unknown>) => void;
}) {
  const def = getClientWidget(widget.type);
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, unknown>>(widget.config);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (!def) return null;

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/widgets/${widget.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config: values }),
    });
    if (!res.ok) {
      setError("Invalid configuration");
      setSaving(false);
      return;
    }
    const fresh = await fetch(`/api/widgets/${widget.id}/data?refresh=1`).then((r) => r.json());
    qc.setQueryData(["widget", widget.id], fresh);
    onSaved(widget.id, values);
    setSaving(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4 [animation:wd-fade-in_.15s_ease-out] dark:bg-black/60"
      onClick={onClose} role="presentation">
      <div role="dialog" aria-modal="true" aria-label={`Configure ${def.title}`}
        className="w-full max-w-sm rounded-xl bg-panel p-5 shadow-xl ring-1 ring-border dark:bg-panel-dark dark:ring-border-dark"
        onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-sm font-semibold">Configure {def.title}</h2>
        <SchemaForm schema={def.configSchema} values={values} onChange={setValues} />
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button onClick={save} disabled={saving} className="btn btn-primary">{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Thread `onConfigure` through `sortable-card.tsx`**

Update the signature and the `<WidgetCard>` render:

```tsx
export function SortableCard({
  widget, onRemove, onConfigure,
}: {
  widget: Widget;
  onRemove: (id: string) => void;
  onConfigure: (w: Widget) => void;
}) {
```

and at the bottom replace the card render:

```tsx
      <WidgetCard widget={widget} onRemove={onRemove} onConfigure={onConfigure} />
```

- [ ] **Step 3: Wire dashboard state**

In `src/components/dashboard.tsx`: import the dialog and `Widget`, add configuring state, an `onConfigSaved` handler, pass `onConfigure` to `SortableCard`, and render the dialog.

Add imports:

```tsx
import { ConfigureDialog } from "./configure-dialog";
```

Inside `Dashboard`, add state + handler (near `onRemove`):

```tsx
  const [configuring, setConfiguring] = useState<Widget | null>(null);

  function onConfigSaved(id: string, config: Record<string, unknown>) {
    setWidgets((ws) => ws.map((w) => (w.id === id ? { ...w, config } : w)));
  }
```

Pass `onConfigure` in the map:

```tsx
                    {col.map((w) => (
                      <SortableCard key={w.id} widget={w} onRemove={onRemove} onConfigure={setConfiguring} />
                    ))}
```

Render the dialog just before the closing `</EditModeProvider>`:

```tsx
      {configuring && (
        <ConfigureDialog
          widget={configuring}
          onClose={() => setConfiguring(null)}
          onSaved={onConfigSaved}
        />
      )}
    </EditModeProvider>
```

- [ ] **Step 4: Verify compile + full test run**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/configure-dialog.tsx src/components/sortable-card.tsx src/components/dashboard.tsx
git commit -m "feat: add configure dialog + dashboard wiring"
```

---

## Task 15: Semantic color tokens for CI/severity

The widget bodies use `bg-ok` / `bg-warn` / `bg-danger` / `text-warn` / `text-danger`. Confirm these utilities resolve; if the theme only defines `--color-ok`/`--color-warn`/`--color-danger` without the `ok` utility, add the missing mappings.

**Files:**
- Modify (if needed): `src/app/globals.css`

- [ ] **Step 1: Check the tokens**

Run: `grep -nE "color-ok|color-warn|color-danger|--color-ok" src/app/globals.css`
Expected: `--color-ok`, `--color-warn`, `--color-danger` are defined in the `@theme` block (per the Plan 1 handoff). In Tailwind v4, a `@theme` `--color-ok` automatically yields `bg-ok`/`text-ok`. If `--color-ok` is missing, add it alongside the existing warn/danger tokens with an appropriate green (e.g. `--color-ok: oklch(0.72 0.19 149);`).

- [ ] **Step 2: Verify utilities render**

Run: `npm run build`
Expected: build succeeds with no "unknown utility" errors for `bg-ok`.

- [ ] **Step 3: Commit (only if globals.css changed)**

```bash
git add src/app/globals.css
git commit -m "feat: add --color-ok semantic token"
```

---

## Task 16: Full verification + live smoke

**Files:** none (verification only).

- [ ] **Step 1: Static checks**

Run: `npm run lint && npx tsc --noEmit && npm test && npm run build`
Expected: lint clean, no type errors, all tests pass, production build OK.

- [ ] **Step 2: Live smoke (manual)**

Run: `npm run dev`, open http://localhost:3000.
- Add each GitHub widget (My PRs, Team PRs, Failing Actions, Dependabot) via **Add widget**.
- Open each card's **⋯ → Configure**; set repos/authors/limit/severity; **Save**.
- Verify: real data renders, or the correct **empty** ("No open PRs" …) / **error** (e.g. auth) state shows.
- Reload the page → config persists.
- Click **↻** → data re-fetches.
- Temporarily rename `gh` on PATH (or point config at a nonexistent repo) → verify the friendly error / stale badge appears rather than a crash.

- [ ] **Step 3: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "chore: verification fixups for github module"
```

---

## Self-Review

**Spec coverage:**
- CLI runner + classification (not-found / auth / failed) → Task 1. ✓
- gh helper → Task 3. ✓
- My PRs (list + CI + review, link-out, no merge) → Task 4 (+ body Task 13). ✓
- Team PRs (configured author list) → Task 4 `fetchTeamPrs` (+ body Task 13). ✓
- Failing Actions (per-repo, partial failure) → Task 5. ✓
- Dependabot (gh api, optional severity) → Task 6. ✓
- Config UI: ⋯ menu + schema-driven form + `configSchema` validation + PATCH persist → Tasks 9–14. ✓
- Contract change (`ClientWidget` config fields) → Task 8. ✓
- Empty states, semantic tokens → Task 13 bodies + Task 15. ✓
- Deferred (action endpoint / merge) → not in plan, matching the spec's Non-Goals. ✓
- Tests: cli classifier, each fetch against fixtures, PATCH integration, describeSchema → Tasks 1,4,5,6,11,9. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; commands have expected output. The two "verify against real output" notes (Task 4 field names, Task 9 optional-enum) are backed by concrete code + a failing test as the contract, not placeholders.

**Type consistency:** `PrItem`/`RunItem`/`AlertItem`/`CiStatus`/`Severity` defined in Task 2 are the exact shapes returned by Tasks 4–6 and consumed by Task 13 bodies. `describeSchema`→`Field` (Task 9) is consumed by `SchemaForm` (Task 10). `setConfig` (Task 11) matches its call site (none client-side; PATCH route only). `onConfigure`/`onRemove` signatures match across `dashboard`→`sortable-card`→`widget-card`→`card-menu`. `fetchMyPrs`/`fetchTeamPrs`/`fetchFailingActions`/`fetchDependabot` names match Task 7 registrations.
