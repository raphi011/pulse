# Jira Module — Live-Findings Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Correct the Jira Custom-JQL module so it works against the **real** `jira issue list --raw` output, which differs from the assumptions baked into the original module (spec `2026-07-10-work-dashboard-jira-module-design.md`, plan `2026-07-10-work-dashboard-jira-module.md`).

**Status:** The module (6 commits, `8d02b1f`…`3f243b1`) is on `main`, lint/tsc/build/100 tests green — but **live verification against an authenticated `jira` CLI revealed the fetch/normalize layer is wrong**. This plan fixes it.

## Findings (all confirmed live against `acme-jira.atlassian.net`, authed as dev@example.com)

| # | Assumption in current code | Real `jira issue list --raw` behavior | Impact |
|---|---|---|---|
| 1 | Response is `{ issues: [...] }` | Response is a **bare JSON array** of issues | `fetchJql` `raw.issues.map` throws |
| 2 | Each issue has `self` | Issues have only `key` + `fields` (**no `self`/`id`**) | `browseUrl(self,…)` throws (`new URL(undefined)`) |
| 3 | `fields.status.statusCategory.key` exists | status is only `{ name }` — **no category** | every pill maps to `todo` |
| 4 | JQL may contain `ORDER BY` | jira-cli appends its own order → JQL with `ORDER BY` is a **syntax error** | the default card errors immediately |
| 5 | No matches → `{ issues: [] }` | No matches → **exit 1**, stderr `No result found for given query in project "CORE"`, no JSON | empty query shows a red error, never the "No matching issues" empty state |
| 6 | Unassigned → `assignee: null`/missing | Unassigned → `assignee: { displayName: "" }` (empty string) | normalized assignee is `""`, not `null` |

**Confirmed real per-issue shape:** `{ key: string, fields: { summary: string, status: { name: string }, assignee: { displayName: string } | null, updated: string, … } }`.
**Ordering:** `--order-by updated` (no `--reverse`) = newest-updated first (verified); `--reverse` = oldest first.
**Server base URL:** in jira-cli's own config `~/.config/.jira/.config.yml` → `server: https://acme-jira.atlassian.net` (respect `JIRA_CONFIG_FILE` override).

## Decisions (carried from this session)

- **Status pill:** **neutral** — show the status *name* in one muted pill color. Drop the `statusCategory` concept entirely (the data doesn't support it). (User-chosen.)
- **Browse URL:** derive the base from jira-cli's config `server:` (no new user config, no per-issue enrichment).
- **Ordering:** the widget owns ordering. Strip any trailing `ORDER BY …` from the user's JQL and always pass `--order-by updated` (newest-updated first).
- **Empty results:** catch the "No result found" `CliError` in `fetchJql` and return `{ issues: [] }` so the existing empty state renders.

## Files touched

- **Edit** `src/modules/jira/manifest.ts` — remove `StatusCategory` + `statusCategory` field; change default JQL (drop `ORDER BY`).
- **Edit** `src/modules/jira/jira.ts` — add `jiraServerUrl()` (reads config `server:`, cached).
- **Rewrite** `src/modules/jira/jql.ts` — array shape, `normalizeIssue(raw, serverUrl)`, `fetchJql` with ORDER-BY strip + `--order-by updated` + empty-result catch.
- **Edit** `src/modules/jira/widgets/jql-widget.tsx` — neutral pill, drop category.
- **Rewrite** `tests/fixtures/jira/jql.json` — real array shape.
- **Rewrite** `tests/modules/jira-jql.test.ts` and `tests/modules/jira-widget.test.tsx`.
- **Unchanged:** `server.ts`, `client.ts`, the barrels, `jira-registration.test.ts`, `jira-auth-pattern.test.ts`.

---

## Task 1: Fix the data layer for the real `--raw` shape (TDD)

Because removing `statusCategory` from `manifest.ts` ripples into `jql.ts` and the widget, this task edits all coupled files and lands as **one green commit** (each intermediate `npm test`/`tsc` may be red mid-task; the commit at the end is green).

**Files:** manifest.ts, jira.ts, jql.ts, jql-widget.tsx, fixtures/jira/jql.json, jira-jql.test.ts, jira-widget.test.tsx

- [ ] **Step 1: Replace the fixture `tests/fixtures/jira/jql.json`** with the confirmed real shape (bare array; no `self`; status is `{name}` only; covers normal / empty-string / null assignee):

```json
[
  {
    "key": "CORE-101",
    "fields": {
      "summary": "Fix seizure edge case",
      "status": { "name": "In Progress" },
      "assignee": { "displayName": "Raphael Gruber" },
      "updated": "2026-07-09T10:00:00.000+0200"
    }
  },
  {
    "key": "CORE-102",
    "fields": {
      "summary": "Investigate flaky test",
      "status": { "name": "To Do" },
      "assignee": { "displayName": "" },
      "updated": "2026-07-08T09:00:00.000+0200"
    }
  },
  {
    "key": "CORE-103",
    "fields": {
      "summary": "Ship dashboard",
      "status": { "name": "Done" },
      "assignee": null,
      "updated": "2026-07-07T08:00:00.000+0200"
    }
  }
]
```

- [ ] **Step 2: Edit `src/modules/jira/manifest.ts`** — remove `StatusCategory`, drop `statusCategory` from `JiraIssue`, and remove `ORDER BY` from the default JQL. Final file:

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
  jql: "assignee = currentUser() AND resolution = EMPTY",
  limit: 10,
};

export type JiraIssue = {
  key: string;              // e.g. "CORE-123"
  summary: string;
  status: string;           // status display name (no category available from `issue list --raw`)
  assignee: string | null;  // displayName, null if unassigned (empty string normalized to null)
  url: string;              // <server>/browse/<KEY>
};
export type JqlData = { issues: JiraIssue[] };
```

- [ ] **Step 3: Add `jiraServerUrl()` to `src/modules/jira/jira.ts`** (append; keep existing exports). It reads jira-cli's own config once and caches the server base URL:

```ts
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

let cachedServer: string | null = null;

/** Base URL of the Jira instance, read from jira-cli's config (`server:`). Cached. */
export function jiraServerUrl(): string {
  if (cachedServer) return cachedServer;
  const path = process.env.JIRA_CONFIG_FILE ?? join(homedir(), ".config", ".jira", ".config.yml");
  const text = readFileSync(path, "utf8");
  const match = text.match(/^server:\s*(\S+)/m);
  if (!match) throw new Error("Could not find `server:` in jira-cli config — run `jira init`");
  cachedServer = match[1].replace(/\/$/, "");
  return cachedServer;
}
```

(Place the three `node:` imports at the top of the file alongside the existing imports.)

- [ ] **Step 4: Write the failing tests `tests/modules/jira-jql.test.ts`** (replace the file):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/modules/jira/jira", () => ({
  runJira: vi.fn(), jiraJson: vi.fn(), jiraServerUrl: vi.fn(() => "https://x.atlassian.net"),
}));
import { jiraJson } from "@/modules/jira/jira";
import { CliError } from "@/server/cli";
import { normalizeIssue, fetchJql, type JiraRawIssue } from "@/modules/jira/jql";
import fixture from "../fixtures/jira/jql.json";

const mockJson = jiraJson as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => { mockJson.mockReset(); });

describe("normalizeIssue", () => {
  it("maps a raw issue to JiraIssue with a browse URL from the server base", () => {
    expect(normalizeIssue(fixture[0] as JiraRawIssue, "https://x.atlassian.net")).toEqual({
      key: "CORE-101",
      summary: "Fix seizure edge case",
      status: "In Progress",
      assignee: "Raphael Gruber",
      url: "https://x.atlassian.net/browse/CORE-101",
    });
  });

  it("normalizes an empty-string assignee to null", () => {
    expect(normalizeIssue(fixture[1] as JiraRawIssue, "https://x.atlassian.net").assignee).toBeNull();
  });

  it("normalizes a null assignee to null", () => {
    expect(normalizeIssue(fixture[2] as JiraRawIssue, "https://x.atlassian.net").assignee).toBeNull();
  });
});

describe("fetchJql", () => {
  it("maps the top-level array and passes JQL with --order-by updated (no --raw here)", async () => {
    mockJson.mockResolvedValueOnce(fixture);
    const data = await fetchJql({ jql: "project = CORE", limit: 25 });
    expect(data.issues).toHaveLength(3);
    expect(data.issues[0].url).toBe("https://x.atlassian.net/browse/CORE-101");
    expect(mockJson.mock.calls[0][0]).toEqual(
      ["issue", "list", "-q", "project = CORE", "--order-by", "updated", "--paginate", "0:25"],
    );
  });

  it("strips a trailing ORDER BY clause from the user's JQL", async () => {
    mockJson.mockResolvedValueOnce(fixture);
    await fetchJql({ jql: "project = CORE ORDER BY updated DESC", limit: 10 });
    const args = mockJson.mock.calls[0][0] as string[];
    expect(args[3]).toBe("project = CORE");
  });

  it("returns an empty list when jira-cli reports no results", async () => {
    mockJson.mockRejectedValueOnce(
      new CliError('No result found for given query in project "CORE"', "failed"),
    );
    await expect(fetchJql({ jql: "project = CORE", limit: 10 })).resolves.toEqual({ issues: [] });
  });

  it("rethrows other CLI errors", async () => {
    mockJson.mockRejectedValueOnce(new CliError("Not authenticated — run `jira init`", "auth"));
    await expect(fetchJql({ jql: "project = CORE", limit: 10 })).rejects.toThrow(/Not authenticated/);
  });
});
```

- [ ] **Step 5: Run to verify it fails:** `npm test -- jira-jql` → FAIL (old `jql.ts` still expects `.issues`/`self`/`statusCategory`).

- [ ] **Step 6: Rewrite `src/modules/jira/jql.ts`:**

```ts
import "server-only";
import { jiraJson, jiraServerUrl } from "./jira";
import { CliError } from "@/server/cli";
import type { JiraIssue, JqlData, JqlConfig } from "./manifest";

export type JiraRawIssue = {
  key: string;
  fields: {
    summary: string;
    status?: { name?: string };
    assignee?: { displayName?: string } | null;
  };
};

export function normalizeIssue(raw: JiraRawIssue, serverUrl: string): JiraIssue {
  const displayName = raw.fields.assignee?.displayName?.trim();
  return {
    key: raw.key,
    summary: raw.fields.summary,
    status: raw.fields.status?.name ?? "Unknown",
    assignee: displayName ? displayName : null,
    url: `${serverUrl}/browse/${raw.key}`,
  };
}

export async function fetchJql(config: JqlConfig): Promise<JqlData> {
  // jira-cli appends its own ORDER BY, so a trailing ORDER BY in the JQL is a syntax error.
  const jql = config.jql.replace(/\s+order\s+by\s+.+$/is, "").trim();
  try {
    const raw = await jiraJson<JiraRawIssue[]>([
      "issue", "list", "-q", jql, "--order-by", "updated", "--paginate", `0:${config.limit}`,
    ]);
    const server = jiraServerUrl();
    return { issues: raw.map((r) => normalizeIssue(r, server)) };
  } catch (err) {
    // jira-cli exits non-zero with this message when a query matches nothing.
    if (err instanceof CliError && /no result found/i.test(err.message)) {
      return { issues: [] };
    }
    throw err;
  }
}
```

- [ ] **Step 7: Run to verify it passes:** `npm test -- jira-jql` → PASS (7 tests).

- [ ] **Step 8: Update the widget `src/modules/jira/widgets/jql-widget.tsx`** — drop the category pill map, show the status name in one neutral pill:

```tsx
"use client";
import type { WidgetBodyProps } from "@/modules/contracts";
import type { JqlData, JqlConfig } from "../manifest";

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
          <span className="shrink-0 rounded-full bg-slate-500/15 px-1.5 py-0.5 text-[0.6875rem] font-medium text-slate-500 dark:text-slate-400">
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

- [ ] **Step 9: Update `tests/modules/jira-widget.test.tsx`** to the new `JqlData` shape (no `statusCategory`). Replace the `data` constants and the third test:

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
      assignee: "Raphael Gruber", url: "https://x.atlassian.net/browse/CORE-101" },
  ],
};

describe("JqlWidget", () => {
  it("renders each issue as a link to its browse URL", () => {
    render(<JqlWidget data={data} config={config} runAction={noop} />);
    expect(screen.getByText("CORE-101")).toBeInTheDocument();
    expect(screen.getByText(/Fix seizure edge case/)).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "https://x.atlassian.net/browse/CORE-101");
  });

  it("shows the status name and assignee initials, with — for unassigned", () => {
    const two: JqlData = {
      issues: [
        data.issues[0],
        { key: "CORE-102", summary: "Investigate flaky test", status: "To Do",
          assignee: null, url: "https://x.atlassian.net/browse/CORE-102" },
      ],
    };
    render(<JqlWidget data={two} config={config} runAction={noop} />);
    expect(screen.getByText("RG")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
  });

  it("shows an empty message when there are no issues", () => {
    render(<JqlWidget data={{ issues: [] }} config={config} runAction={noop} />);
    expect(screen.getByText(/no matching issues/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 10: Full gate:** `npm run lint && npx tsc --noEmit && npm run build && npm test` → all green (100+ tests; jira-jql now 7, jira-widget 3).

- [ ] **Step 11: Commit:**

```bash
git add src/modules/jira tests/modules/jira-jql.test.ts tests/modules/jira-widget.test.tsx tests/fixtures/jira/jql.json
git commit -m "fix: align jira module with real jira-cli --raw output"
```

---

## Task 2: Live verification (requires authed `jira`)

**Files:** none (manual/observational).

- [ ] **Step 1:** `npm run dev` (launched from a shell where `JIRA_API_TOKEN` is exported).
- [ ] **Step 2:** In the app: **Edit → + Add widget → Jira Query**. The default card (`assignee = currentUser() AND resolution = EMPTY`) must render real issues **with no ORDER BY error** — this is the finding-#4 regression check.
- [ ] **Step 3:** ⋯ → Configure → set JQL to something matching nothing (e.g. `project = CORE AND summary ~ "zzzzz-no-match"`); save → the card shows **"No matching issues"** (empty state), not a red error — finding-#5 check.
- [ ] **Step 4:** Click an issue row → opens `https://acme-jira.atlassian.net/browse/<KEY>` — finding-#2 check.
- [ ] **Step 5:** Confirm a status pill shows the status name and unassigned rows show "—".
- [ ] **Step 6:** If anything is off, capture the real output (`jira issue list -q "assignee = currentUser()" --raw --paginate 0:2`) and adjust normalization; otherwise done.

---

## Also update the spec (small)

- [ ] In `docs/superpowers/specs/2026-07-10-work-dashboard-jira-module-design.md`, correct the "Normalized shape" / data-flow section: `issue list --raw` returns a **bare array** of `{key, fields}` with no `self` and no statusCategory; URL comes from jira-cli config `server:`; ordering via `--order-by updated`; empty results arrive as a non-zero "No result found" error mapped to an empty list. Note the pill is neutral (no category). Commit `docs: correct jira module spec to match real jira-cli output`.

---

## Self-Review

- **Findings coverage:** #1 array → Step 6 (`raw.map`, `JiraRawIssue[]`); #2 URL → Steps 3+6 (`jiraServerUrl` + `${server}/browse/${key}`); #3 no category → Steps 2,6,8 (drop `statusCategory`, neutral pill); #4 ORDER BY → Step 6 (strip regex + `--order-by updated`) + Task 2 Step 2; #5 empty-as-error → Step 6 (`CliError` + `/no result found/i`) + Task 2 Step 3; #6 empty-string assignee → Step 6 (`displayName?.trim()` → null) + test Step 4. All six covered.
- **No placeholders:** every step has concrete code/commands.
- **Type consistency:** `JiraIssue` loses `statusCategory` everywhere it's referenced (manifest, jql.ts, widget, both tests) in the same commit; `normalizeIssue` gains a `serverUrl` param used by `fetchJql`; the jira-module mock in the test now also stubs `jiraServerUrl`. `CliError` imported from `@/server/cli` in both `jql.ts` and its test.
- **Scope:** `server.ts`/`client.ts`/barrels/registration+auth tests untouched — the fix is confined to normalization, config-derived URL, the widget pill, and their tests.
