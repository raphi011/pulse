# Interactive Google Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Google Tasks widget toggle task completion inline (optimistically), sink completed tasks to the bottom, and filter completed tasks by age.

**Architecture:** Add a `completedAt` timestamp to `TaskItem`; add a `completedMaxAge` enum to the config; put the age-filter and completed-last sort as pure helpers in `manifest.ts` (mirroring `filterDriveFiles`); add a `setTaskCompleted` mutation in `tasks.ts` that shells out to `gws tasks tasks patch`; rewrite the widget to render clickable checkboxes with optimistic overrides, calling the mutation then `refresh()`.

**Tech Stack:** React 19 + TypeScript, Zod config schema, `gws` CLI via `gwsJson` (`runJsonCli`), Vitest + Testing Library.

## Global Constraints

- No Jira prefix on commits — plain conventional-style messages (e.g. `feat: …`).
- Feature-flag-style toggles default to disabled; new config defaults must be additive (Zod `.default()` backfills stored config).
- Match existing patterns; keep changes surgical. Do NOT add generic conditional-visibility to `schema-form` — the age field is always rendered, with the hint baked into its `.describe()` label.
- All repo/cache functions are async — `await` them. The widget calls module functions directly (no server/RPC boundary), exactly as `bookmarks` does.
- Client-side filtering pattern: fetch everything, the widget filters (as `drive` does with `filterDriveFiles`).
- Commit messages end with the trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Add `completedAt` to TaskItem and bump the cache version

**Files:**
- Modify: `src/modules/gws/manifest.ts` (the `TaskItem` type, ~line 137-144)
- Modify: `src/modules/gws/tasks.ts` (the `GTask` type and `normalizeTask`, lines 4-23)
- Modify: `src/server/cache-version.ts` (`CACHE_VERSION`, currently `3`)
- Test: `tests/modules/gws-tasks.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `TaskItem.completedAt?: string` (RFC3339 completion timestamp, `""` when not completed) — consumed by Tasks 2 and 4.

- [ ] **Step 1: Add the failing test**

Add these cases to `tests/modules/gws-tasks.test.ts` inside the existing `describe("normalizeTask", …)`:

```ts
  it("captures the completion timestamp on completed tasks", () => {
    const t = normalizeTask({
      id: "t3",
      title: "shipped",
      status: "completed",
      completed: "2026-07-13T09:30:00.000Z",
      webViewLink: "https://tasks.google.com/task/xyz",
    });
    expect(t.completed).toBe(true);
    expect(t.completedAt).toBe("2026-07-13T09:30:00.000Z");
  });

  it("leaves completedAt empty when there is no timestamp", () => {
    expect(normalizeTask({ id: "t4", status: "needsAction" }).completedAt).toBe("");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/modules/gws-tasks.test.ts`
Expected: FAIL — `completedAt` is `undefined` / not a property.

- [ ] **Step 3: Add the field to the type and normalizer**

In `src/modules/gws/manifest.ts`, add `completedAt` to `TaskItem`:

```ts
export type TaskItem = {
  id: string;
  title: string;
  notes?: string; // free-text note (often a Jira/GitHub URL)
  due: string; // ISO date ("" if none)
  completed: boolean;
  completedAt?: string; // RFC3339 completion timestamp ("" if not completed)
  url: string; // webViewLink into Google Tasks
};
```

In `src/modules/gws/tasks.ts`, add `completed` to the `GTask` type and populate `completedAt`:

```ts
type GTask = {
  id: string;
  title?: string;
  notes?: string;
  status?: string; // "needsAction" | "completed"
  due?: string;
  completed?: string; // RFC3339 timestamp, present only on completed tasks
  webViewLink?: string;
};
```

```ts
export function normalizeTask(t: GTask): TaskItem {
  return {
    id: t.id,
    title: t.title || "(no title)",
    notes: t.notes,
    due: t.due ?? "",
    completed: t.status === "completed",
    completedAt: t.completed ?? "",
    url: t.webViewLink ?? "",
  };
}
```

- [ ] **Step 4: Bump the cache version**

In `src/server/cache-version.ts` change `export const CACHE_VERSION = 3;` to `export const CACHE_VERSION = 4;` (the Tasks payload shape changed; the cache is wiped on startup mismatch).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/modules/gws-tasks.test.ts`
Expected: PASS (all normalizeTask cases, including the two new ones).

- [ ] **Step 6: Commit**

```bash
git add src/modules/gws/manifest.ts src/modules/gws/tasks.ts src/server/cache-version.ts tests/modules/gws-tasks.test.ts
git commit -m "feat: capture Google Tasks completion timestamp

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Add the `completedMaxAge` config and the pure age-filter + sort helpers

**Files:**
- Modify: `src/modules/gws/manifest.ts` (`tasksConfigSchema`, `tasksDefaultConfig`, and new exported helpers)
- Test: `tests/modules/gws-tasks.test.ts`

**Interfaces:**
- Consumes: `TaskItem.completedAt` (Task 1).
- Produces:
  - `TasksConfig.completedMaxAge: "Today" | "Last 7 days" | "Last 30 days" | "All time"` (default `"All time"`)
  - `filterTasksByAge(tasks: TaskItem[], maxAge: TasksConfig["completedMaxAge"], now: Date): TaskItem[]`
  - `sortTasks(tasks: TaskItem[]): TaskItem[]`
  - Both consumed by Task 4.

- [ ] **Step 1: Add the failing tests**

Add to `tests/modules/gws-tasks.test.ts`. First extend the import at the top:

```ts
import { filterTasksByAge, sortTasks, type TaskItem } from "@/modules/gws/manifest";
```

Then append these describe blocks:

```ts
const mk = (id: string, completed: boolean, completedAt = ""): TaskItem => ({
  id, title: id, due: "", completed, completedAt, url: "",
});

describe("sortTasks", () => {
  it("puts incomplete tasks first and completed last, stable within each group", () => {
    const out = sortTasks([mk("a", true), mk("b", false), mk("c", true), mk("d", false)]);
    expect(out.map((t) => t.id)).toEqual(["b", "d", "a", "c"]);
  });
});

describe("filterTasksByAge", () => {
  const now = new Date("2026-07-13T12:00:00.000Z");
  const tasks = [
    mk("todo", false),
    mk("earlierToday", true, "2026-07-13T08:00:00.000Z"),
    mk("threeDaysAgo", true, "2026-07-10T12:00:00.000Z"),
    mk("longAgo", true, "2026-05-01T12:00:00.000Z"),
    mk("noStamp", true, ""),
  ];

  it("keeps everything for All time", () => {
    expect(filterTasksByAge(tasks, "All time", now).map((t) => t.id)).toEqual(
      ["todo", "earlierToday", "threeDaysAgo", "longAgo", "noStamp"],
    );
  });

  it("Today keeps only completions since local midnight (plus incomplete and unstamped)", () => {
    // Note: uses local midnight; assert membership, not order, to stay timezone-robust.
    const ids = filterTasksByAge(tasks, "Today", now).map((t) => t.id);
    expect(ids).toContain("todo");
    expect(ids).toContain("noStamp");
    expect(ids).not.toContain("threeDaysAgo");
    expect(ids).not.toContain("longAgo");
  });

  it("Last 7 days drops completions older than the rolling window", () => {
    const ids = filterTasksByAge(tasks, "Last 7 days", now).map((t) => t.id);
    expect(ids).toEqual(["todo", "earlierToday", "threeDaysAgo", "noStamp"]);
  });

  it("Last 30 days keeps the three-day-old one but drops the two-month-old one", () => {
    const ids = filterTasksByAge(tasks, "Last 30 days", now).map((t) => t.id);
    expect(ids).not.toContain("longAgo");
    expect(ids).toContain("threeDaysAgo");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/modules/gws-tasks.test.ts`
Expected: FAIL — `filterTasksByAge` / `sortTasks` are not exported from manifest.

- [ ] **Step 3: Add the config field and default**

In `src/modules/gws/manifest.ts`, extend `tasksConfigSchema` and `tasksDefaultConfig`:

```ts
export const tasksConfigSchema = z.object({
  tasklist: z.string().default("@default").meta({ optionsKey: TASK_LISTS_KEY }).describe("Task list"),
  showCompleted: z.boolean().default(false).describe("Show completed tasks"),
  completedMaxAge: z
    .enum(["Today", "Last 7 days", "Last 30 days", "All time"])
    .default("All time")
    .describe("Show completed up to (only when completed shown)"),
  limit: z.number().int().min(1).max(100).default(25).describe("Max tasks"),
});
export type TasksConfig = z.infer<typeof tasksConfigSchema>;
export const tasksDefaultConfig: TasksConfig = {
  tasklist: "@default",
  showCompleted: false,
  completedMaxAge: "All time",
  limit: 25,
};
```

(The hint lives in the `.describe()` label — no `schema-form` change. The enum option labels are the raw enum values, which read naturally.)

- [ ] **Step 4: Add the pure helpers**

In `src/modules/gws/manifest.ts`, directly after the `TaskItem` / `TasksData` declarations, add:

```ts
export type CompletedMaxAge = TasksConfig["completedMaxAge"];

/** Millisecond cutoff for a completed-age bucket, or null for "All time". Pure. */
function ageCutoff(maxAge: CompletedMaxAge, now: Date): number | null {
  switch (maxAge) {
    case "All time":
      return null;
    case "Today": {
      const midnight = new Date(now);
      midnight.setHours(0, 0, 0, 0);
      return midnight.getTime();
    }
    case "Last 7 days":
      return now.getTime() - 7 * 24 * 60 * 60 * 1000;
    case "Last 30 days":
      return now.getTime() - 30 * 24 * 60 * 60 * 1000;
  }
}

/**
 * Drop completed tasks older than the configured age. Incomplete tasks are always
 * kept; a completed task with no timestamp is kept (fail-open, so nothing silently
 * vanishes). Pure — safe to import from client or server.
 */
export function filterTasksByAge(tasks: TaskItem[], maxAge: CompletedMaxAge, now: Date): TaskItem[] {
  const cutoff = ageCutoff(maxAge, now);
  if (cutoff === null) return tasks;
  return tasks.filter((t) => {
    if (!t.completed || !t.completedAt) return true;
    return new Date(t.completedAt).getTime() >= cutoff;
  });
}

/** Incomplete tasks first (preserving order), completed tasks last. Stable. Pure. */
export function sortTasks(tasks: TaskItem[]): TaskItem[] {
  return [...tasks].sort((a, b) => Number(a.completed) - Number(b.completed));
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/modules/gws-tasks.test.ts`
Expected: PASS (normalizeTask + sortTasks + filterTasksByAge blocks).

- [ ] **Step 6: Verify the config-form schema test still passes**

Run: `npx vitest run tests/modules/gws-options-schema.test.ts`
Expected: PASS — it only asserts the `tasklist` field, so the added enum is compatible.

- [ ] **Step 7: Commit**

```bash
git add src/modules/gws/manifest.ts tests/modules/gws-tasks.test.ts
git commit -m "feat: add completed-task age filter config and task sort/filter helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Add the `setTaskCompleted` mutation

**Files:**
- Modify: `src/modules/gws/tasks.ts`
- Test: `tests/modules/gws-tasks.test.ts`

**Interfaces:**
- Consumes: `gwsJson` (`src/modules/gws/gws.ts`).
- Produces: `setTaskCompleted(tasklist: string, taskId: string, completed: boolean): Promise<void>` — consumed by Task 4.

- [ ] **Step 1: Add the failing test**

At the very top of `tests/modules/gws-tasks.test.ts`, add the module mock (hoisted by Vitest) and import, mirroring `gws-drive.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/modules/gws/gws", () => ({ gwsJson: vi.fn() }));
import { normalizeTask, setTaskCompleted } from "@/modules/gws/tasks";
import { gwsJson } from "@/modules/gws/gws";

const mockJson = gwsJson as unknown as ReturnType<typeof vi.fn>;
```

(Remove the now-duplicate `import { describe, it, expect } from "vitest";` and the existing `import { normalizeTask } …` line so imports aren't declared twice. `normalizeTask` does not call `gwsJson`, so mocking the module leaves those tests unaffected.)

Append this describe block:

```ts
describe("setTaskCompleted", () => {
  beforeEach(() => mockJson.mockReset());

  it("patches status=completed when completing", async () => {
    mockJson.mockResolvedValue({});
    await setTaskCompleted("@default", "t1", true);
    const [args] = mockJson.mock.calls[0];
    expect(args.slice(0, 3)).toEqual(["tasks", "tasks", "patch"]);
    expect(args[3]).toBe("--params");
    expect(JSON.parse(args[4])).toEqual({ tasklist: "@default", task: "t1" });
    expect(args[5]).toBe("--json");
    expect(JSON.parse(args[6])).toEqual({ status: "completed" });
  });

  it("clears the completion timestamp when un-completing", async () => {
    mockJson.mockResolvedValue({});
    await setTaskCompleted("listB", "t2", false);
    const [args] = mockJson.mock.calls[0];
    expect(JSON.parse(args[6])).toEqual({ status: "needsAction", completed: null });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/modules/gws-tasks.test.ts`
Expected: FAIL — `setTaskCompleted` is not exported.

- [ ] **Step 3: Implement the mutation**

In `src/modules/gws/tasks.ts`, add after `fetchTasks`:

```ts
/**
 * Flip a task's completion via `gws tasks tasks patch`. Un-completing sends
 * `completed: null` so the timestamp clears under patch semantics.
 */
export async function setTaskCompleted(
  tasklist: string,
  taskId: string,
  completed: boolean,
): Promise<void> {
  const body = completed
    ? { status: "completed" }
    : { status: "needsAction", completed: null };
  await gwsJson<GTask>([
    "tasks", "tasks", "patch",
    "--params", JSON.stringify({ tasklist, task: taskId }),
    "--json", JSON.stringify(body),
  ]);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/modules/gws-tasks.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify against the real CLI (manual, optional but recommended)**

If a `gws`-authenticated task list is available, dry-run the shape:
Run: `gws tasks tasks patch --params '{"tasklist":"@default","task":"<id>"}' --json '{"status":"completed"}' --dry-run`
Expected: validates without error (no auth/param complaint).

- [ ] **Step 6: Commit**

```bash
git add src/modules/gws/tasks.ts tests/modules/gws-tasks.test.ts
git commit -m "feat: add setTaskCompleted mutation for Google Tasks

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Make the widget interactive (optimistic toggle, sort, age filter)

**Files:**
- Modify: `src/modules/gws/widgets/tasks-widget.tsx` (full rewrite of the body)
- Test: `tests/modules/gws-tasks-widget.test.tsx` (new)

**Interfaces:**
- Consumes: `setTaskCompleted` (Task 3), `filterTasksByAge` + `sortTasks` + `TasksConfig.completedMaxAge` (Task 2), `TaskItem.completedAt` (Task 1).
- Produces: the interactive widget (terminal deliverable).

- [ ] **Step 1: Write the failing widget test**

Create `tests/modules/gws-tasks-widget.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { TasksWidget } from "@/modules/gws/widgets/tasks-widget";
import { tasksDefaultConfig, type TaskItem } from "@/modules/gws/manifest";
import { setTaskCompleted } from "@/modules/gws/tasks";

vi.mock("@/modules/gws/tasks", () => ({ setTaskCompleted: vi.fn().mockResolvedValue(undefined) }));
const mockSet = setTaskCompleted as unknown as ReturnType<typeof vi.fn>;

const task = (id: string, completed: boolean): TaskItem => ({
  id,
  title: id,
  due: "",
  completed,
  completedAt: completed ? "2026-07-13T09:00:00.000Z" : "",
  url: `https://tasks/${id}`,
});

function renderWidget(tasks: TaskItem[]) {
  const refresh = vi.fn().mockResolvedValue(undefined);
  render(
    <TasksWidget
      data={{ tasks }}
      config={{ ...tasksDefaultConfig, showCompleted: true }}
      refresh={refresh}
    />,
  );
  return { refresh };
}

beforeEach(() => mockSet.mockClear());

describe("TasksWidget", () => {
  it("shows an empty message when there are no tasks", () => {
    renderWidget([]);
    expect(screen.getByText("No tasks.")).toBeInTheDocument();
  });

  it("renders incomplete tasks before completed ones", () => {
    renderWidget([task("done", true), task("todo", false)]);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["todo", "done"]);
  });

  it("optimistically completes a task, then syncs via CLI + refresh", async () => {
    const { refresh } = renderWidget([task("todo", false)]);
    const btn = screen.getByRole("button", { name: 'Mark "todo" complete' });
    await act(async () => {
      btn.click();
    });
    expect(mockSet).toHaveBeenCalledWith("@default", "todo", true);
    expect(refresh).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/modules/gws-tasks-widget.test.tsx`
Expected: FAIL — the widget has no toggle button / different structure.

- [ ] **Step 3: Rewrite the widget**

Replace the entire contents of `src/modules/gws/widgets/tasks-widget.tsx` with:

```tsx
"use client";
import { useState } from "react";
import type { WidgetBodyProps } from "@/modules/contracts";
import {
  filterTasksByAge,
  sortTasks,
  type TasksData,
  type TasksConfig,
  type TaskItem,
} from "../manifest";
import { setTaskCompleted } from "../tasks";

// Google Tasks due dates are date-only at UTC midnight — format in UTC to avoid a day shift.
function dueLabel(due: string): string {
  return new Date(due).toLocaleDateString([], { month: "short", day: "numeric", timeZone: "UTC" });
}

function TaskRow({
  t,
  pending,
  onToggle,
}: {
  t: TaskItem;
  pending: boolean;
  onToggle: (t: TaskItem) => void;
}) {
  return (
    <li className="py-2">
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          disabled={pending}
          onClick={() => onToggle(t)}
          aria-label={t.completed ? `Mark "${t.title}" incomplete` : `Mark "${t.title}" complete`}
          className={`shrink-0 text-[0.9rem] leading-none transition-colors disabled:opacity-50 ${
            t.completed ? "text-ok" : "text-slate-400 hover:text-ok dark:text-slate-500"
          }`}
        >
          {t.completed ? "✓" : "○"}
        </button>
        <a
          href={t.url}
          target="_blank"
          rel="noreferrer"
          className={`min-w-0 flex-1 truncate text-sm hover:underline ${
            t.completed ? "text-slate-400 line-through dark:text-slate-500" : ""
          }`}
        >
          {t.title}
        </a>
        {t.due && (
          <span className="shrink-0 text-[0.6875rem] tabular-nums text-slate-500 dark:text-slate-400">
            {dueLabel(t.due)}
          </span>
        )}
      </div>
      {t.notes && (
        <p className="mt-0.5 truncate pl-[1.4rem] text-[0.6875rem] text-slate-400 dark:text-slate-500">
          {t.notes}
        </p>
      )}
    </li>
  );
}

export function TasksWidget({ data, config, refresh }: WidgetBodyProps<TasksData, TasksConfig>) {
  // Optimistic completion overrides keyed by task id, layered over fetched data
  // until refresh() brings reality back. `pending` disables a row mid-flight.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const clear = (setter: typeof setOverrides, id: string) =>
    setter((m) => {
      const { [id]: _drop, ...rest } = m;
      return rest;
    });

  async function toggle(t: TaskItem) {
    const next = !t.completed;
    setOverrides((o) => ({ ...o, [t.id]: next }));
    setPending((p) => ({ ...p, [t.id]: true }));
    try {
      await setTaskCompleted(config.tasklist, t.id, next);
      await refresh(); // fetched data now reflects the change
      clear(setOverrides, t.id);
    } catch {
      clear(setOverrides, t.id); // roll back the optimistic flip
    } finally {
      clear(setPending, t.id);
    }
  }

  const merged: TaskItem[] = data.tasks.map((t) =>
    t.id in overrides ? { ...t, completed: overrides[t.id] } : t,
  );
  const visible = sortTasks(filterTasksByAge(merged, config.completedMaxAge, new Date()));

  if (visible.length === 0)
    return <p className="text-sm text-slate-500 dark:text-slate-400">No tasks.</p>;
  return (
    <ul className="divide-y divide-border dark:divide-border-dark">
      {visible.map((t) => (
        <TaskRow key={t.id} t={t} pending={Boolean(pending[t.id])} onToggle={toggle} />
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Run the widget test to verify it passes**

Run: `npx vitest run tests/modules/gws-tasks-widget.test.tsx`
Expected: PASS (empty state, ordering, optimistic toggle).

- [ ] **Step 5: Run the full gws + registration suite and typecheck/lint**

Run: `npx vitest run tests/modules/gws-tasks.test.ts tests/modules/gws-tasks-widget.test.tsx tests/modules/gws-registration.test.ts tests/modules/gws-options-schema.test.ts`
Expected: PASS.
Run: `npm run lint`
Expected: no errors in the changed files.

- [ ] **Step 6: Commit**

```bash
git add src/modules/gws/widgets/tasks-widget.tsx tests/modules/gws-tasks-widget.test.tsx
git commit -m "feat: interactive Google Tasks widget with optimistic completion toggle

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Manual end-to-end verification in the app

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all suites PASS.

- [ ] **Step 2: Drive the real widget**

Use the `run` / `verify` skill (or `npm run dev`) to exercise the Tasks widget with a live `gws` login:
- Click a pending task's `○` → it flips to `✓`, greys out, and drops to the bottom immediately; the change persists after the next refresh.
- Click a completed task's `✓` → it flips back to `○` and returns to the incomplete group.
- With **Show completed tasks** on, set **Show completed up to** = `Today` and confirm older completed tasks disappear while today's remain; set back to `All time` and confirm they return.

Note: the app may already be running for daily use — do NOT quit/relaunch the user's running instance without asking; hand off the restart if a rebuild is needed.

- [ ] **Step 3: Report results**

Summarize what was verified (tests + manual flows) with the actual command output.

---

## Self-Review

**Spec coverage:**
- Toggle items / interactive list → Tasks 3 (mutation) + 4 (widget). ✓
- Config option for completed-task age, shown when completed shown → Task 2 (enum + hint in label; always-visible per approved design). ✓
- Completed tasks move to bottom → Task 2 `sortTasks` + Task 4 wiring. ✓
- Data `completedAt` + cache bump → Task 1. ✓
- Client-side age filtering (Drive pattern) → Task 2 `filterTasksByAge`, Task 4 wiring. ✓
- Optimistic toggle with rollback → Task 4. ✓
- Tests for pure helpers + widget → Tasks 2, 4; mutation contract → Task 3. ✓
- Known consequence (header count stays a raw total) → unchanged `render.ts`, no task needed. ✓

**Placeholder scan:** none — every code/test step contains full content.

**Type consistency:** `setTaskCompleted(tasklist, taskId, completed)`, `filterTasksByAge(tasks, maxAge, now)`, `sortTasks(tasks)`, `TaskItem.completedAt`, `TasksConfig.completedMaxAge` are named identically across Tasks 1-4. ✓
