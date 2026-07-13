# Task Toggle Error Handling — Design

Date: 2026-07-13
Module: `src/modules/gws` (Tasks widget) + existing `src/components/toast-context.tsx`

## Problem

The interactive Tasks widget flips completion optimistically, then reconciles via
`refresh()`. When `setTaskCompleted` fails — most commonly because the machine's
`gws` OAuth token holds the read-only Tasks scope (`.../auth/tasks.readonly`)
instead of read-write (`.../auth/tasks`) — the `gws tasks tasks patch` call is
rejected with a 403. The widget's `catch {}` silently rolls the override back, so
the row flips to done and immediately snaps back with no explanation.

## Goal

1. Remove the optimistic toggle: a task's completion state changes **only** after
   the server confirms it. A failed toggle leaves the row untouched.
2. Surface the failure as a toast so the user sees why nothing happened.

## Non-goals

- Building a toast system — one already exists (`ToastProvider` + `useToast()`).
- Changing `setTaskCompleted`, the config, the data shape, or the fetch path.
- Auto-detecting or fixing the `gws` scope (the user re-auths `gws` themselves).

## Existing infrastructure (reused as-is)

`src/components/toast-context.tsx`:
- `ToastProvider` — mounted once at the app root (`src/app-root.tsx:72`), renders a
  bottom-right stack, auto-dismiss after 6s, dismissable, `error`/`info` variants.
- `useToast(): { toast(message, variant?) }` — already consumed by
  `integrations-panel.tsx` and `use-widget-data.ts`.

`setTaskCompleted` throws a `CliError` (`src/server/cli.ts`) whose `.message`
carries Google's API error text (e.g. "Request had insufficient authentication
scopes.").

## Change: `src/modules/gws/widgets/tasks-widget.tsx`

- Remove the `overrides` state and the `merged` mapping.
- Keep a `pending` map (`Record<string, boolean>`), now used only to disable the
  toggle button and dim the row while the request is in flight.
- Add `const { toast } = useToast();`.
- New `toggle(t)`:

```ts
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
      const { [t.id]: _drop, ...rest } = p;
      return rest;
    });
  }
}
```

- Visible list derives directly from server data:
  `sortTasks(filterTasksByAge(data.tasks, config.completedMaxAge, new Date()))`.
- `TaskRow` unchanged in structure; while `pending`, the button is `disabled` and
  the row is dimmed (e.g. `opacity-60`) to signal work in flight. The completion
  glyph does not change until `refresh()` brings the confirmed state.

Import `CliError` from `@/server/cli`.

## Data flow

Click → `pending=true` (row dims) → `setTaskCompleted` → on success `refresh()`
repopulates `data.tasks` with the confirmed state (and re-sorts completed to the
bottom) → `pending=false`. On failure → toast, `data.tasks` unchanged, row returns
to its original state when `pending` clears. No intermediate flip ever renders.

Trade-off: the row no longer updates instantly; it updates after the CLI + refresh
round-trip (~1s), with the dim state as the in-flight affordance. This is the
intended behavior — never show a state the server hasn't confirmed.

## Testing: `tests/modules/gws-tasks-widget.test.tsx`

Wrap every render in `<ToastProvider>` (the widget now calls `useToast`; without a
provider the hook throws). Add a small `renderWidget` helper that includes it.

- **Empty state** — unchanged.
- **Ordering** — incomplete before completed — unchanged (derives from `data.tasks`).
- **Success path** (replaces the old optimistic test): click the toggle → asserts
  `setTaskCompleted("@default", "todo", true)` and `refresh` are both called; the
  glyph does not flip before `refresh` (no optimistic state).
- **Error path** (new): mock `setTaskCompleted` to reject with
  `new CliError("Request had insufficient authentication scopes.", "failed")` →
  assert `refresh` is NOT called and a toast with
  `Couldn't update task: Request had insufficient authentication scopes.` renders
  (query the `role="alert"` node).

Mock `@/modules/gws/tasks` for `setTaskCompleted`; import the real `CliError`.
The pure helpers (`sortTasks`, `filterTasksByAge`) keep their existing unit tests.
