# Gmail widget: inline hover actions (archive / mark-as-read / trash)

**Date:** 2026-07-13
**Status:** Design approved, spec under review
**Module:** `src/modules/gws/` (Gmail widget)

## Summary

Add per-row contextual actions to the Gmail widget. Hovering a single email row
reveals a right-aligned cluster of icon buttons — **Archive**, **Mark as read**,
**Trash** — that mutate the message through the `gws` CLI and then `refresh()` the
widget. Visually this borrows the pomodoro hover-controls language (fade-in,
card-bg gradient) but scopes the reveal to **one row** (a named Tailwind group)
rather than the whole card.

This is the same mutation shape as the just-shipped Google Tasks toggle
(`setTaskCompleted` + non-optimistic refresh + error toast).

## Decisions (locked)

- **Delete = move to Trash** (`gmail users messages trash`) — reversible, no
  confirmation dialog.
- **Non-optimistic** — clicking dims + disables the row while the `gws` call is in
  flight; the row only leaves the list when `refresh()` returns server-confirmed
  data. A rejected action leaves the row untouched and raises an error toast.
- **Mark-as-read shows only on unread rows** (a read email doesn't need it);
  Archive and Trash show on every row.
- **Action cluster overlays the date** — the date/time is hidden behind a
  gradient while the row is hovered/focused; actions fade in on top.
- **Mark-as-read is allowed to drop out** — with the default `is:unread in:inbox`
  query, marking read = handled, so the email leaves the list on the next refresh,
  consistent with archive and trash. No in-place read styling.

## Components

### 1. Mutations — `src/modules/gws/gmail.ts`

Three thin `gwsJson` wrappers, shaped exactly like `setTaskCompleted` in
`tasks.ts`. All target `userId: "me"`.

```ts
export async function archiveEmail(id: string): Promise<void> {
  await gwsJson<unknown>([
    "gmail", "users", "messages", "modify",
    "--params", JSON.stringify({ userId: "me", id }),
    "--json", JSON.stringify({ removeLabelIds: ["INBOX"] }),
  ]);
}

export async function markEmailRead(id: string): Promise<void> {
  await gwsJson<unknown>([
    "gmail", "users", "messages", "modify",
    "--params", JSON.stringify({ userId: "me", id }),
    "--json", JSON.stringify({ removeLabelIds: ["UNREAD"] }),
  ]);
}

export async function trashEmail(id: string): Promise<void> {
  await gwsJson<unknown>([
    "gmail", "users", "messages", "trash",
    "--params", JSON.stringify({ userId: "me", id }),
  ]);
}
```

Errors propagate as `CliError` (via `gwsJson` → `runJsonCli` → `extractGwsError`),
including auth/scope failures — the widget catches and toasts them.

### 2. Widget — `src/modules/gws/widgets/gmail-widget.tsx`

Changes to the existing component:

- Destructure `config` and `refresh` from `WidgetBodyProps` (currently only
  `data` is used).
- `useToast()` from `@/components/toast-context`; import `CliError` from
  `@/server/cli`.
- `pending: Record<string, boolean>` state keyed by email id — while an id is
  pending, its row is dimmed (`opacity-60`) and its buttons disabled. Same
  add/drop map bookkeeping as `TasksWidget`.
- A `rowActions(m)` helper (mirrors pomodoro's `controls()`), returning
  `{ label, Icon, run }[]`:
  - Archive → `FiArchive`, `run: () => archiveEmail(m.id)`
  - Mark as read → `FiCheck`, `run: () => markEmailRead(m.id)` — **only pushed when `m.unread`**
  - Trash → `FiTrash2`, `run: () => trashEmail(m.id)`
  - (Feather icons via `react-icons/fi`, matching repo convention.)
- One shared `perform(m, action)` runner:

  ```ts
  async function perform(m: EmailItem, label: string, run: () => Promise<void>) {
    setPending((p) => ({ ...p, [m.id]: true }));
    try {
      await run();
      await refresh(); // the row leaves the list only on server-confirmed data
    } catch (err) {
      const message = err instanceof CliError ? err.message : "please try again.";
      toast(`Couldn't ${label.toLowerCase()} email: ${message}`, "error");
    } finally {
      setPending((p) => { const { [m.id]: _drop, ...rest } = p; return rest; });
    }
  }
  ```

- **Row markup**: each `<li>` becomes a positioning context with a named group
  `group/mailrow relative`. The existing subject/from `<a>` and the date `<span>`
  stay. The action cluster is absolutely positioned at the right, over the date,
  hidden by default and revealed on hover/focus:

  - `pointer-events-none opacity-0 transition-opacity ... group-hover/mailrow:pointer-events-auto group-hover/mailrow:opacity-100 focus-within:...`
  - a left-to-right card-bg gradient mask (`from-card via-card to-transparent`,
    `dark:from-card-dark dark:via-card-dark`) so the buttons read cleanly over the
    date, echoing the pomodoro control bar.
  - Each button: `type="button"`, `disabled={pending}`, `title` + `aria-label`
    (e.g. `Archive email from {m.from}`), `onClick={() => perform(m, label, run)}`,
    ~`h-7 w-7` grid, muted slate → hover-accent (trash → hover `text-danger`/red).

- Empty state (`No emails.`) unchanged.

### 3. No new plumbing

- `gws` is already declared in `src-tauri/capabilities/default.json`; these are
  just more `gws` subcommands, so **no Tauri capability change** is needed.
- Cache-first refresh already exists; `refresh()` re-runs `fetchGmail` and re-caches.
- No manifest/config/schema changes. No `CACHE_VERSION` bump (payload shape
  unchanged).

## Prerequisite / risk

The `gws` OAuth grant must include the **`gmail.modify`** scope. If the current
grant is read-only, `modify`/`trash` return a 403 that surfaces via the error
toast (graceful — no crash), but the action won't take effect until the scope is
granted (`gws auth login` with the write scope). Verify the scope during
implementation; if missing, note it for the user rather than silently shipping
non-functional buttons.

## Testing

- **`tests/modules/gws-gmail.test.ts`** (extend): `describe` per mutation asserting
  the CLI arg shape — mock `gwsJson` (`vi.mock("@/modules/gws/gws", ...)`), call
  `archiveEmail`/`markEmailRead`/`trashEmail`, assert the first arg array
  (subcommand path + `--params`/`--json` JSON). Mirror `setTaskCompleted` tests in
  `gws-tasks.test.ts`.
- **`tests/modules/gws-gmail-widget.test.tsx`** (new): mirror
  `gws-tasks-widget.test.tsx`:
  - Mark-as-read button present on unread rows, absent on read rows.
  - Clicking an action: button disabled + row dimmed while the mocked mutation is
    in flight; `refresh` called only after it resolves (non-optimistic).
  - Mutation rejects with `CliError` → error toast shown, `refresh` not called
    (or row still present), pending cleared.

## Out of scope

- Undo affordance for trash/archive (Gmail's own Trash recovery suffices).
- Bulk / multi-select actions.
- Configurable action set or per-widget toggles.
- Reply / snooze / label actions.
