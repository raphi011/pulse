# Task Toggle Error Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the optimistic completion toggle from the Google Tasks widget so a task's state changes only after the server confirms it, and surface toggle failures as an error toast.

**Architecture:** Rewrite `TasksWidget` to await `setTaskCompleted` + `refresh()` with no optimistic override (a `pending` map only disables/dims the row in flight), and call the existing `useToast()` on failure. Reuse the existing `ToastProvider`/`useToast` infrastructure and `CliError` — no new components, config, data, or migration changes.

**Tech Stack:** React 19 + TypeScript, Vitest + Testing Library, existing `@/components/toast-context` and `@/server/cli`.

## Global Constraints

- No Jira prefix on commits — plain conventional-style message (e.g. `fix: …`).
- Reuse the existing toast system (`ToastProvider` mounted at `src/app-root.tsx:72`, `useToast()` hook) — do NOT build a new one.
- Never render a completion state the server has not confirmed (no optimistic flip). The row's glyph changes only via `refresh()`-supplied `data.tasks`.
- Keep changes surgical; match existing widget patterns.
- Commit message MUST end with the trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Run the focused test file while iterating; run the full suite (`npm test`) once before committing, plus `npm run lint`.

---

### Task 1: De-optimistic toggle + error toast in the Tasks widget

**Files:**
- Modify: `src/modules/gws/widgets/tasks-widget.tsx` (rewrite `TasksWidget` body; `TaskRow` gains a dim-while-pending class)
- Test: `tests/modules/gws-tasks-widget.test.tsx` (rewrite)

**Interfaces:**
- Consumes: `setTaskCompleted(tasklist, taskId, completed): Promise<void>` (`../tasks`); `filterTasksByAge`, `sortTasks`, `TaskItem`, `TasksData`, `TasksConfig` (`../manifest`); `useToast(): { toast(message, variant?) }` (`@/components/toast-context`); `CliError` (`@/server/cli`).
- Produces: the final widget (terminal deliverable).

- [ ] **Step 1: Rewrite the test file (failing tests first)**

Replace the entire contents of `tests/modules/gws-tasks-widget.test.tsx` with:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { TasksWidget } from "@/modules/gws/widgets/tasks-widget";
import { ToastProvider } from "@/components/toast-context";
import { tasksDefaultConfig, type TaskItem } from "@/modules/gws/manifest";
import { setTaskCompleted } from "@/modules/gws/tasks";
import { CliError } from "@/server/cli";

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
    <ToastProvider>
      <TasksWidget
        data={{ tasks }}
        config={{ ...tasksDefaultConfig, showCompleted: true }}
        refresh={refresh}
      />
    </ToastProvider>,
  );
  return { refresh };
}

beforeEach(() => {
  mockSet.mockReset();
  mockSet.mockResolvedValue(undefined);
});

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

  it("does not flip optimistically; updates only after the CLI resolves + refresh", async () => {
    let resolveSet: () => void = () => {};
    mockSet.mockImplementationOnce(() => new Promise<void>((r) => { resolveSet = () => r(); }));
    const { refresh } = renderWidget([task("todo", false)]);
    const btn = screen.getByRole("button", { name: 'Mark "todo" complete' });
    await act(async () => {
      btn.click();
    });
    // In flight: no optimistic flip, button disabled, refresh not yet called.
    expect(btn.textContent).toBe("○");
    expect(btn).toBeDisabled();
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => {
      resolveSet();
    });
    expect(mockSet).toHaveBeenCalledWith("@default", "todo", true);
    expect(refresh).toHaveBeenCalled();
  });

  it("shows an error toast and does not refresh when the toggle fails", async () => {
    mockSet.mockRejectedValueOnce(
      new CliError("Request had insufficient authentication scopes.", "failed"),
    );
    const { refresh } = renderWidget([task("todo", false)]);
    const btn = screen.getByRole("button", { name: 'Mark "todo" complete' });
    await act(async () => {
      btn.click();
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't update task: Request had insufficient authentication scopes.",
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify the two new ones fail**

Run: `npx vitest run tests/modules/gws-tasks-widget.test.tsx`
Expected: FAIL. The empty-state and ordering tests pass. The "does not flip optimistically" test fails (the current widget flips the glyph to `✓` in flight, so `btn.textContent` is `✓` not `○`). The "error toast" test fails (the current `catch {}` shows no toast, so `getByRole("alert")` finds nothing).

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
import { useToast } from "@/components/toast-context";
import { CliError } from "@/server/cli";

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
    <li className={`py-2 ${pending ? "opacity-60" : ""}`}>
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
  // While a toggle is in flight the row is disabled and dimmed. Completion is never
  // changed optimistically — it updates only when refresh() brings server-confirmed
  // data, so a rejected toggle (e.g. read-only Tasks scope) leaves the row untouched
  // and surfaces an error toast.
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const { toast } = useToast();

  async function toggle(t: TaskItem) {
    const next = !t.completed;
    setPending((p) => ({ ...p, [t.id]: true }));
    try {
      await setTaskCompleted(config.tasklist, t.id, next);
      await refresh(); // the row's new state comes only from server data
    } catch (err) {
      const message = err instanceof CliError ? err.message : "please try again.";
      toast(`Couldn't update task: ${message}`, "error");
    } finally {
      setPending((p) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to drop it from `rest`
        const { [t.id]: _drop, ...rest } = p;
        return rest;
      });
    }
  }

  const visible = sortTasks(filterTasksByAge(data.tasks, config.completedMaxAge, new Date()));

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
Expected: PASS (all four tests).

- [ ] **Step 5: Run the full suite and lint**

Run: `npm test`
Expected: all suites PASS (no regressions).
Run: `npm run lint`
Expected: no errors in the changed files.

- [ ] **Step 6: Commit**

```bash
git add src/modules/gws/widgets/tasks-widget.tsx tests/modules/gws-tasks-widget.test.tsx
git commit -m "fix: surface Google Tasks toggle failures via toast, drop optimistic flip

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Remove optimistic toggle (state only from server) → Task 1 widget rewrite (no `overrides`; `visible` derives from `data.tasks`). ✓
- Row dimmed/disabled while in flight → `pending` map + `opacity-60` + `disabled`. ✓
- Error surfaced as toast, `refresh` not called on failure → `catch` calls `toast(...)`, `refresh()` only on the success path. ✓
- Reuse existing toast infra, no new system → imports `useToast`/`ToastProvider`, no new files. ✓
- Message from `CliError.message` with generic fallback → `err instanceof CliError ? err.message : "please try again."`. ✓
- Tests: empty, ordering, non-optimistic success, error-toast; renders wrapped in `ToastProvider` → all four present. ✓
- No config/data/migration changes → none in the plan. ✓

**Placeholder scan:** none — full code in every step.

**Type consistency:** `setTaskCompleted(config.tasklist, t.id, next)`, `useToast().toast(message, "error")`, `CliError` (message, kind), and `filterTasksByAge`/`sortTasks` signatures match their existing definitions. ✓
