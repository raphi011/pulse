# Jira Module (Custom JQL) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `jira` module with a single **Custom JQL** widget that lists Jira issues from a per-card JQL query, via the authenticated `jira` CLI.

**Architecture:** A self-contained module `src/modules/jira/` mirroring `src/modules/github/`: a client-safe `manifest.ts`, a server-only CLI wrapper `jira.ts` (reusing `runCli`), a `jql.ts` fetch/normalize pair, a `server.ts`/`client.ts` registration pair, and one `"use client"` widget body. Only the two module barrels are edited. No framework changes — cache, refresh, config UI, title-rename, and widget-shell states are all inherited.

**Tech Stack:** Next.js 16 + React 19, TypeScript, Zod v4, Vitest + Testing Library. Data via `jira` CLI (ankitpokhrel/jira-cli v1.7.0) `--raw` JSON output.

**Spec:** `docs/superpowers/specs/2026-07-10-work-dashboard-jira-module-design.md`

**Conventions:** No Jira prefix on commits (personal project); conventional commits (`feat:`/`test:`). TDD; commit after each task. Fish shell — use absolute paths, avoid `cd` in compound commands.

---

## File Structure

```
src/modules/jira/
  manifest.ts            # NEW — JQL_TYPE, jqlConfigSchema + jqlDefaultConfig, JiraIssue/JqlData types. Client-safe, no runtime deps.
  jira.ts                # NEW — server-only: JIRA_AUTH_PATTERN, runJira(args), jiraJson<T>(args) (appends --raw + JSON.parse).
  jql.ts                 # NEW — server-only: normalizeIssue(), fetchJql(config). The testable core.
  server.ts              # NEW — import "server-only"; registerServerWidget(jira.jql).
  client.ts              # NEW — registerClientWidget(jira.jql) with configSchema + defaultConfig.
  widgets/jql-widget.tsx # NEW — "use client" body (WidgetBodyProps<JqlData, JqlConfig>).
src/modules/server.ts    # EDIT — add import "./jira/server";
src/modules/client.ts    # EDIT — add import "./jira/client";
tests/fixtures/jira/jql.json        # NEW — recorded-shape Jira search response.
tests/modules/jira-jql.test.ts      # NEW — normalizeIssue + fetchJql (wrapper mocked).
tests/modules/jira-widget.test.tsx  # NEW — JqlWidget render + empty state.
tests/modules/jira-registration.test.ts # NEW — both registries resolve jira.jql.
```

---

## Task 1: Manifest + CLI wrapper

**Files:**
- Create: `src/modules/jira/manifest.ts`
- Create: `src/modules/jira/jira.ts`
- Create: `tests/modules/jira-auth-pattern.test.ts`

- [ ] **Step 1: Write `src/modules/jira/manifest.ts`**

```ts
import { z } from "zod";

export const JQL_TYPE = "jira.jql";

// .describe() drives the config-form field label.
export const jqlConfigSchema = z.object({
  jql: z.string().min(1).describe("JQL"),
  limit: z.number().int().min(1).max(100).default(10).describe("Max issues"),
});
export type JqlConfig = z.infer<typeof jqlConfigSchema>;
export const jqlDefaultConfig: JqlConfig = {
  jql: "assignee = currentUser() AND resolution = EMPTY ORDER BY updated DESC",
  limit: 10,
};

export type StatusCategory = "todo" | "inprogress" | "done";

export type JiraIssue = {
  key: string;              // e.g. "CORE-123"
  summary: string;
  status: string;           // status display name
  statusCategory: StatusCategory;
  assignee: string | null;  // displayName, null if unassigned
  url: string;              // <origin>/browse/<KEY>
};
export type JqlData = { issues: JiraIssue[] };
```

- [ ] **Step 2: Write the failing test `tests/modules/jira-auth-pattern.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { JIRA_AUTH_PATTERN } from "@/modules/jira/jira";

describe("JIRA_AUTH_PATTERN", () => {
  it("matches jira-cli's unconfigured-token message", () => {
    expect(JIRA_AUTH_PATTERN.test("The tool needs a Jira API token to function.")).toBe(true);
  });

  it("matches a 401 unauthorized error", () => {
    expect(JIRA_AUTH_PATTERN.test("Received unexpected response '401 Unauthorized'")).toBe(true);
  });

  it("does not match an ordinary JQL error", () => {
    expect(JIRA_AUTH_PATTERN.test("Error in the JQL Query: expecting operator but got 'foo'")).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- jira-auth-pattern`
Expected: FAIL (`@/modules/jira/jira` not found).

- [ ] **Step 4: Write `src/modules/jira/jira.ts`**

```ts
import "server-only";
import { runCli } from "@/server/cli";

export const JIRA_AUTH_PATTERN = /needs a Jira API token|unauthorized|401|invalid credentials/i;

export async function runJira(args: string[]): Promise<string> {
  const { stdout } = await runCli("jira", args, {
    notAuthenticatedPattern: JIRA_AUTH_PATTERN,
    notAuthenticatedMessage: "Not authenticated — run `jira init`",
  });
  return stdout;
}

export async function jiraJson<T>(args: string[]): Promise<T> {
  return JSON.parse(await runJira([...args, "--raw"])) as T;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- jira-auth-pattern`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/modules/jira/manifest.ts src/modules/jira/jira.ts tests/modules/jira-auth-pattern.test.ts
git commit -m "feat: add jira module manifest and CLI wrapper"
```

---

## Task 2: JQL fetch + normalize (TDD)

**Files:**
- Create: `tests/fixtures/jira/jql.json`
- Create: `src/modules/jira/jql.ts`
- Create: `tests/modules/jira-jql.test.ts`

> **Note on the fixture:** jira-cli isn't authenticated yet (`jira init` not run), so this fixture is a
> hand-built response of the exact shape `jira issue list --raw` emits (the Jira search API response).
> Once auth is configured, re-record with
> `jira issue list -q "assignee = currentUser()" --raw --paginate 0:3 > tests/fixtures/jira/jql.json`
> and adjust field expectations if real output differs. Recording real output is the source of truth.

- [ ] **Step 1: Write the fixture `tests/fixtures/jira/jql.json`**

```json
{
  "issues": [
    {
      "key": "CORE-101",
      "self": "https://acme-jira.atlassian.net/rest/api/2/issue/100101",
      "fields": {
        "summary": "Fix seizure edge case",
        "status": { "name": "In Progress", "statusCategory": { "key": "indeterminate" } },
        "assignee": { "displayName": "Raphael Gruber" }
      }
    },
    {
      "key": "CORE-102",
      "self": "https://acme-jira.atlassian.net/rest/api/2/issue/100102",
      "fields": {
        "summary": "Investigate flaky test",
        "status": { "name": "To Do", "statusCategory": { "key": "new" } },
        "assignee": null
      }
    },
    {
      "key": "CORE-103",
      "self": "https://acme-jira.atlassian.net/rest/api/2/issue/100103",
      "fields": {
        "summary": "Ship dashboard",
        "status": { "name": "Done", "statusCategory": { "key": "done" } },
        "assignee": { "displayName": "Jane Doe" }
      }
    }
  ],
  "total": 3
}
```

- [ ] **Step 2: Write the failing test `tests/modules/jira-jql.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/modules/jira/jira", () => ({ runJira: vi.fn(), jiraJson: vi.fn() }));
import { jiraJson } from "@/modules/jira/jira";
import { normalizeIssue, fetchJql, type JiraRawIssue } from "@/modules/jira/jql";
import fixture from "../fixtures/jira/jql.json";

const mockJson = jiraJson as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => { mockJson.mockReset(); });

const rawInProgress = fixture.issues[0] as JiraRawIssue;

describe("normalizeIssue", () => {
  it("maps a raw issue to JiraIssue with a browse URL", () => {
    expect(normalizeIssue(rawInProgress)).toEqual({
      key: "CORE-101",
      summary: "Fix seizure edge case",
      status: "In Progress",
      statusCategory: "inprogress",
      assignee: "Raphael Gruber",
      url: "https://acme-jira.atlassian.net/browse/CORE-101",
    });
  });

  it("maps statusCategory keys new/indeterminate/done to todo/inprogress/done", () => {
    expect(normalizeIssue(fixture.issues[1] as JiraRawIssue).statusCategory).toBe("todo");
    expect(normalizeIssue(fixture.issues[2] as JiraRawIssue).statusCategory).toBe("done");
  });

  it("returns null assignee when unassigned", () => {
    expect(normalizeIssue(fixture.issues[1] as JiraRawIssue).assignee).toBeNull();
  });
});

describe("fetchJql", () => {
  it("runs the configured JQL with a paginate limit and normalizes every issue", async () => {
    mockJson.mockResolvedValueOnce(fixture);
    const data = await fetchJql({ jql: "project = CORE", limit: 25 });
    expect(data.issues).toHaveLength(3);
    expect(data.issues[0].key).toBe("CORE-101");
    const args = mockJson.mock.calls[0][0] as string[];
    expect(args).toEqual(["issue", "list", "-q", "project = CORE", "--paginate", "0:25"]);
  });

  it("returns an empty list when no issues match", async () => {
    mockJson.mockResolvedValueOnce({ issues: [], total: 0 });
    await expect(fetchJql({ jql: "project = CORE", limit: 10 })).resolves.toEqual({ issues: [] });
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- jira-jql`
Expected: FAIL (`@/modules/jira/jql` not found).

- [ ] **Step 4: Write `src/modules/jira/jql.ts`**

```ts
import "server-only";
import { jiraJson } from "./jira";
import type { JiraIssue, JqlData, JqlConfig, StatusCategory } from "./manifest";

export type JiraRawIssue = {
  key: string;
  self: string;
  fields: {
    summary: string;
    status?: { name?: string; statusCategory?: { key?: string } };
    assignee?: { displayName?: string } | null;
  };
};

function toCategory(key: string | undefined): StatusCategory {
  if (key === "done") return "done";
  if (key === "indeterminate") return "inprogress";
  return "todo"; // "new" or anything unexpected
}

function browseUrl(self: string, key: string): string {
  return `${new URL(self).origin}/browse/${key}`;
}

export function normalizeIssue(raw: JiraRawIssue): JiraIssue {
  return {
    key: raw.key,
    summary: raw.fields.summary,
    status: raw.fields.status?.name ?? "Unknown",
    statusCategory: toCategory(raw.fields.status?.statusCategory?.key),
    assignee: raw.fields.assignee?.displayName ?? null,
    url: browseUrl(raw.self, raw.key),
  };
}

export async function fetchJql(config: JqlConfig): Promise<JqlData> {
  const raw = await jiraJson<{ issues: JiraRawIssue[] }>([
    "issue", "list", "-q", config.jql, "--paginate", `0:${config.limit}`,
  ]);
  return { issues: raw.issues.map(normalizeIssue) };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- jira-jql`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/modules/jira/jql.ts tests/modules/jira-jql.test.ts tests/fixtures/jira/jql.json
git commit -m "feat: add jira JQL fetch and issue normalization"
```

---

## Task 3: Server registration + barrel

**Files:**
- Create: `src/modules/jira/server.ts`
- Modify: `src/modules/server.ts`
- Create: `tests/modules/jira-registration.test.ts`

- [ ] **Step 1: Write the failing test `tests/modules/jira-registration.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import "@/modules/server";
import { getServerWidget } from "@/modules/server-registry";
import { JQL_TYPE } from "@/modules/jira/manifest";

describe("jira server registration", () => {
  it("registers jira.jql on the server registry with defaults", () => {
    const def = getServerWidget(JQL_TYPE);
    expect(def).toBeDefined();
    expect(def!.defaultConfig).toMatchObject({ limit: 10 });
    expect(typeof def!.fetch).toBe("function");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- jira-registration`
Expected: FAIL (`jira.jql` not registered).

- [ ] **Step 3: Write `src/modules/jira/server.ts`**

```ts
import "server-only";
import { registerServerWidget } from "@/modules/server-registry";
import { JQL_TYPE, jqlConfigSchema, jqlDefaultConfig } from "./manifest";
import { fetchJql } from "./jql";

registerServerWidget({
  type: JQL_TYPE, configSchema: jqlConfigSchema, defaultConfig: jqlDefaultConfig, fetch: fetchJql,
});
```

- [ ] **Step 4: Add the server barrel import in `src/modules/server.ts`**

Add after the `import "./github/server";` line:
```ts
import "./jira/server";
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- jira-registration`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add src/modules/jira/server.ts src/modules/server.ts tests/modules/jira-registration.test.ts
git commit -m "feat: register jira.jql server widget"
```

---

## Task 4: JQL widget body (component TDD)

**Files:**
- Create: `src/modules/jira/widgets/jql-widget.tsx`
- Create: `tests/modules/jira-widget.test.tsx`

- [ ] **Step 1: Write the failing test `tests/modules/jira-widget.test.tsx`**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { JqlWidget } from "@/modules/jira/widgets/jql-widget";
import type { JqlData, JqlConfig } from "@/modules/jira/manifest";

const config: JqlConfig = { jql: "project = CORE", limit: 10 };
const noop = async () => {};

const data: JqlData = {
  issues: [
    { key: "CORE-101", summary: "Fix seizure edge case", status: "In Progress",
      statusCategory: "inprogress", assignee: "Raphael Gruber",
      url: "https://x.atlassian.net/browse/CORE-101" },
  ],
};

describe("JqlWidget", () => {
  it("renders each issue as a link to its browse URL", () => {
    render(<JqlWidget data={data} config={config} runAction={noop} />);
    expect(screen.getByText("CORE-101")).toBeInTheDocument();
    expect(screen.getByText(/Fix seizure edge case/)).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "https://x.atlassian.net/browse/CORE-101");
  });

  it("shows an empty message when there are no issues", () => {
    render(<JqlWidget data={{ issues: [] }} config={config} runAction={noop} />);
    expect(screen.getByText(/no matching issues/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- jira-widget`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/modules/jira/widgets/jql-widget.tsx`**

```tsx
"use client";
import type { WidgetBodyProps } from "@/modules/contracts";
import type { JqlData, JqlConfig, StatusCategory } from "../manifest";

const PILL: Record<StatusCategory, string> = {
  done: "bg-ok/15 text-ok",
  inprogress: "bg-warn/15 text-warn",
  todo: "bg-slate-500/15 text-slate-500 dark:text-slate-400",
};

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

export function JqlWidget({ data }: WidgetBodyProps<JqlData, JqlConfig>) {
  if (data.issues.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">No matching issues.</p>;
  }
  return (
    <ul className="divide-y divide-border dark:divide-border-dark">
      {data.issues.map((issue) => (
        <li key={issue.key} className="flex items-center gap-2.5 py-2">
          <a
            href={issue.url}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 flex-1 truncate text-sm hover:underline"
          >
            <span className="font-medium tabular-nums text-slate-500 dark:text-slate-400">{issue.key}</span>{" "}
            {issue.summary}
          </a>
          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[0.6875rem] font-medium ${PILL[issue.statusCategory]}`}>
            {issue.status}
          </span>
          <span
            className="shrink-0 text-xs text-slate-500 dark:text-slate-400"
            title={issue.assignee ?? "Unassigned"}
          >
            {issue.assignee ? initials(issue.assignee) : "—"}
          </span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- jira-widget`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/jira/widgets/jql-widget.tsx tests/modules/jira-widget.test.tsx
git commit -m "feat: add jira JQL widget body"
```

---

## Task 5: Client registration + barrel

**Files:**
- Create: `src/modules/jira/client.ts`
- Modify: `src/modules/client.ts`
- Modify: `tests/modules/jira-registration.test.ts`

- [ ] **Step 1: Add a failing client-registration assertion to `tests/modules/jira-registration.test.ts`**

Append this block after the existing `describe`:
```ts
import "@/modules/client";
import { getClientWidget } from "@/modules/client-registry";

describe("jira client registration", () => {
  it("registers jira.jql on the client registry with title, schema, and defaults", () => {
    const def = getClientWidget(JQL_TYPE);
    expect(def).toBeDefined();
    expect(def!.title).toBe("Jira Query");
    expect(def!.configSchema).toBeDefined();
    expect(def!.defaultConfig).toMatchObject({ limit: 10 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- jira-registration`
Expected: FAIL (`getClientWidget(JQL_TYPE)` is undefined).

- [ ] **Step 3: Write `src/modules/jira/client.ts`**

```ts
import { registerClientWidget } from "@/modules/client-registry";
import { JQL_TYPE, jqlConfigSchema, jqlDefaultConfig } from "./manifest";
import { JqlWidget } from "./widgets/jql-widget";

registerClientWidget({
  type: JQL_TYPE, title: "Jira Query", Component: JqlWidget,
  configSchema: jqlConfigSchema, defaultConfig: jqlDefaultConfig,
});
```

- [ ] **Step 4: Add the client barrel import in `src/modules/client.ts`**

Add after the `import "./github/client";` line:
```ts
import "./jira/client";
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- jira-registration`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/modules/jira/client.ts src/modules/client.ts tests/modules/jira-registration.test.ts
git commit -m "feat: register jira.jql client widget"
```

---

## Task 6: Full verification gate

**Files:** none (verification only).

- [ ] **Step 1: Lint, typecheck, build, test**

Run: `npm run lint && npx tsc --noEmit && npm run build && npm test`
Expected: all green; the full suite passes including the new jira tests.

- [ ] **Step 2: Live smoke (requires `jira init` first)**

If not already authenticated, run `jira init` (interactive — the user runs this). Then:
```bash
npm run dev
```
Open http://localhost:3000 and verify:
- **Edit → + Add widget → Jira Query** adds a card that lists issues for the default JQL (`assignee = currentUser() AND resolution = EMPTY`), or shows the correct auth/error/empty state.
- **⋯ → Configure** edits the JQL, limit, and Title; on save the card re-fetches and the new title/data persist across reload.
- The refresh (↻) control re-runs the query; clicking an issue row opens `<site>/browse/<KEY>` in the browser.

If jira-cli is not yet authenticated, the card shows "Not authenticated — run `jira init`" — this is correct behavior, not a bug.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: jira module verification fixes"
```

---

## Self-Review Notes

- **Spec coverage:** single `jira.jql` widget (Tasks 1–5); raw-JSON parsing via `jiraJson`+`--raw` (Task 1); `runCli` reuse with caller-supplied auth pattern (Task 1); config `{ jql, limit }` + universally-valid default JQL (Task 1); normalized shape with statusCategory mapping + `self`→browse-URL derivation + null assignee (Task 2); row = key · summary · status pill · assignee initials, link-out (Task 4); barrels-only edits (Tasks 3, 5); empty state "No matching issues" (Task 4); auth/error inherited (Task 1 pattern + widget-service, verified in Task 6). Title-rename is reused framework — no task needed. Actions/transitions, sprint/board widgets, and a JQL textarea are explicit non-goals — no tasks.
- **Placeholder scan:** none — every code/test/fixture step is complete.
- **Type consistency:** `JQL_TYPE`, `JqlConfig`, `JqlData`, `JiraIssue`, `StatusCategory` (manifest) and `JiraRawIssue`, `normalizeIssue`, `fetchJql` (jql.ts) are used consistently across tasks; `runJira`/`jiraJson`/`JIRA_AUTH_PATTERN` (jira.ts) match their import sites. Test mock target `@/modules/jira/jira` matches the module that exports `jiraJson`, mirroring the GitHub `runs.ts` test.
