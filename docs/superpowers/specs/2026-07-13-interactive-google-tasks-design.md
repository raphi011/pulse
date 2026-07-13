# Interactive Google Tasks — Design

Date: 2026-07-13
Module: `src/modules/gws` (Tasks widget, `gws.tasks`)

## Goal

Make the Google Tasks widget interactive and smarter about completed tasks:

1. Toggle a task's completion state directly from the list (optimistic).
2. Add a config option to only show completed tasks up to a certain age.
3. Completed tasks sink to the bottom of the list.

## Non-goals

- Creating, editing, deleting, or reordering tasks.
- Multi-list views (still one task list per widget).
- Server/RPC boundary — the widget calls module functions directly, as `bookmarks` does.

## 1. Data — completion timestamp

`TaskItem` gains an optional `completedAt` field:

```ts
export type TaskItem = {
  id: string;
  title: string;
  notes?: string;
  due: string;        // ISO date ("" if none)
  completed: boolean;
  completedAt?: string; // RFC3339 completion timestamp ("" / undefined if not completed)
  url: string;
};
```

`normalizeTask` populates it from the Google task's `completed` field (the RFC3339
timestamp the Tasks API sets when a task is completed — distinct from `status`).

Bump `CACHE_VERSION` (`src/server/cache-version.ts`) so cached rows predating this
field are wiped on startup rather than rendering without `completedAt`.

## 2. Config — completed-age filter

Add to `tasksConfigSchema` (fixed buckets, displayed labels == enum values because
`schema-form` renders enum options by their raw value):

```ts
completedMaxAge: z
  .enum(["Today", "Last 7 days", "Last 30 days", "All time"])
  .default("All time")
  .describe("Show completed up to"),
```

- Always rendered in the config form (the shared `schema-form` has no conditional
  visibility; adding generic `showWhen` support was considered and declined to keep
  the change surgical). The field label/help conveys that it only applies when
  **Show completed tasks** is on.
- Filtering is **client-side in the widget**, mirroring the Drive module's
  "fetch everything, widget filters" pattern (`filterDriveFiles`). This re-evaluates
  the cutoff at render time so the window doesn't drift with cached data.

### Cutoff semantics (evaluated at render `now`)

- `All time` — no filtering.
- `Today` — keep completed tasks with `completedAt >=` local midnight today.
- `Last 7 days` — `completedAt >=` now − 7×24h (rolling window).
- `Last 30 days` — `completedAt >=` now − 30×24h.

Incomplete tasks are never filtered. A completed task missing `completedAt` is kept
(fail-open) so nothing silently vanishes.

## 3. Ordering — completed sink to bottom

The widget sorts before rendering: incomplete tasks first (preserving the API's
`position` order), then completed tasks. Stable within each group. This covers both
the steady-state view and the "just-completed row drops down" behaviour.

## 4. Interactivity — optimistic toggle

### Mutation function (`tasks.ts`)

```ts
export async function setTaskCompleted(
  tasklist: string,
  taskId: string,
  completed: boolean,
): Promise<void>
```

Runs:

```
gws tasks tasks patch
  --params {"tasklist": <tasklist>, "task": <taskId>}
  --json   {"status": "completed"}         // when completing
  --json   {"status": "needsAction", "completed": null}  // when un-completing
```

Un-completing explicitly nulls `completed` so the timestamp clears under patch
semantics. Uses `gwsJson` (payload-model error handling). No shell-scope change —
`gws` is already permitted for the module.

### Widget behaviour (`tasks-widget.tsx`)

- The leading `✓ / ○` glyph becomes a clickable checkbox button with an accessible
  label (e.g. `Mark "<title>" complete` / `… incomplete`). The title remains a link
  to Google Tasks.
- Local override state: `Map<taskId, boolean>` of pending completion values, layered
  over `data.tasks` when deriving the displayed (and sorted) list.
- On click:
  1. Set the override immediately → row greys + line-through and re-sorts to bottom.
  2. `await setTaskCompleted(config.tasklist, id, next)`.
  3. `await refresh()`.
  4. Clear the override for that id (fresh data now reflects reality).
- On error in step 2/3: remove the override (roll back) and swallow, matching the
  bookmarks failure posture (row stays as it was; no unhandled rejection).
- While an override is pending for a row, its checkbox is disabled to prevent
  double-clicks.

## 5. Testing

Extract the pure logic into `manifest.ts` (alongside `filterDriveFiles` /
`deriveMeetingState`), so it is unit-testable without a DB or CLI:

- `filterTasksByAge(tasks, maxAge, now): TaskItem[]` — bucket cutoff filtering.
- `sortTasks(tasks): TaskItem[]` — incomplete-first, completed-last, stable.

Vitest covers: each age bucket boundary (including the fail-open missing-timestamp
case), `All time` no-op, and the sort ordering with mixed completion. The existing
`gws-registration` test is unaffected.

## Known consequence

The widget header **count** (`count: (d) => d.tasks.length` in `render.ts`) receives
only `data`, not `config`, so it stays a raw total and will not subtract
age-filtered completed tasks. Accepted — consistent with how the shell derives all
widget counts.
