# Gmail Widget Inline Hover Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-row hover actions (Archive, Mark-as-read, Trash) to the Gmail widget that mutate the message via the `gws` CLI and refresh.

**Architecture:** Three thin `gwsJson` mutation wrappers in `gmail.ts` (shaped like `setTaskCompleted`), plus a widget rewrite that reveals an absolutely-positioned icon-button cluster on per-row hover/focus. Mutations are non-optimistic: the row dims + disables while in flight, then `refresh()` drops it from the `is:unread in:inbox` list on server-confirmed data. Failures raise an error toast and leave the row intact.

**Tech Stack:** React 19, TypeScript, Tailwind v4, `react-icons/fi` (Feather), Vitest + Testing Library, `gws` CLI via `gwsJson`.

## Global Constraints

- **No Jira prefix on commits.** Plain conventional-style messages (e.g. `feat: ...`).
- **Trash = move to Trash**, reversible, no confirmation dialog: `gmail users messages trash`.
- **Non-optimistic**: rows change only via `refresh()`-supplied server data; never mutate `data` locally on click.
- **Mark-as-read appears only on unread rows** (`m.unread`); Archive and Trash appear on every row.
- **Action cluster overlays the date** (gradient-masked), revealed on `group-hover/mailrow` + `focus-within`, mirroring pomodoro's control-bar language.
- **No manifest/config/schema/CACHE_VERSION changes**; **no Tauri capability changes** (`gws` already scoped).
- Match existing patterns; keep changes surgical. Feature-flag-style toggles default disabled (n/a here — no new toggle).
- All repo/CLI functions are async — `await` them.

---

### Task 1: Gmail mutation functions

Add `archiveEmail`, `markEmailRead`, `trashEmail` to `gmail.ts` and prove their CLI arg shape with unit tests. These mirror `setTaskCompleted` in `tasks.ts`.

**Files:**
- Modify: `src/modules/gws/gmail.ts` (append three exported functions)
- Test: `tests/modules/gws-gmail.test.ts` (append a `describe` block)

**Interfaces:**
- Consumes: `gwsJson<T>(args: string[]): Promise<T>` from `src/modules/gws/gws.ts`.
- Produces:
  - `archiveEmail(id: string): Promise<void>`
  - `markEmailRead(id: string): Promise<void>`
  - `trashEmail(id: string): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Append to `tests/modules/gws-gmail.test.ts`. The existing file imports `{ parseFrom, normalizeMessage }` from `@/modules/gws/gmail` and does **not** mock `gwsJson`. Add the mock + new imports at the top of the file (mock hoists), and the `describe` block at the end.

At the very top of the file, add:

```ts
import { vi, beforeEach } from "vitest";
vi.mock("@/modules/gws/gws", () => ({ gwsJson: vi.fn() }));
import { archiveEmail, markEmailRead, trashEmail } from "@/modules/gws/gmail";
import { gwsJson } from "@/modules/gws/gws";
const mockJson = gwsJson as unknown as ReturnType<typeof vi.fn>;
```

(If `describe`/`it`/`expect` are already imported from `vitest` at the top, merge `vi` and `beforeEach` into that existing import instead of adding a second line.)

At the end of the file, add:

```ts
describe("gmail mutations", () => {
  beforeEach(() => mockJson.mockReset());

  it("archiveEmail removes the INBOX label", async () => {
    mockJson.mockResolvedValue({});
    await archiveEmail("m1");
    const [args] = mockJson.mock.calls[0];
    expect(args.slice(0, 4)).toEqual(["gmail", "users", "messages", "modify"]);
    expect(args[4]).toBe("--params");
    expect(JSON.parse(args[5])).toEqual({ userId: "me", id: "m1" });
    expect(args[6]).toBe("--json");
    expect(JSON.parse(args[7])).toEqual({ removeLabelIds: ["INBOX"] });
  });

  it("markEmailRead removes the UNREAD label", async () => {
    mockJson.mockResolvedValue({});
    await markEmailRead("m2");
    const [args] = mockJson.mock.calls[0];
    expect(args.slice(0, 4)).toEqual(["gmail", "users", "messages", "modify"]);
    expect(JSON.parse(args[5])).toEqual({ userId: "me", id: "m2" });
    expect(JSON.parse(args[7])).toEqual({ removeLabelIds: ["UNREAD"] });
  });

  it("trashEmail calls the trash endpoint", async () => {
    mockJson.mockResolvedValue({});
    await trashEmail("m3");
    const [args] = mockJson.mock.calls[0];
    expect(args.slice(0, 4)).toEqual(["gmail", "users", "messages", "trash"]);
    expect(args[4]).toBe("--params");
    expect(JSON.parse(args[5])).toEqual({ userId: "me", id: "m3" });
    expect(args).toHaveLength(6); // no --json body for trash
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- gws-gmail`
Expected: FAIL — `archiveEmail is not a function` (or import error) for the three new tests; existing `parseFrom`/`normalizeMessage` tests still pass.

- [ ] **Step 3: Implement the mutations**

Append to `src/modules/gws/gmail.ts` (the file already imports `{ gwsJson }` from `./gws`):

```ts
/** Archive: remove the INBOX label (message stays searchable, leaves the inbox). */
export async function archiveEmail(id: string): Promise<void> {
  await gwsJson<unknown>([
    "gmail", "users", "messages", "modify",
    "--params", JSON.stringify({ userId: "me", id }),
    "--json", JSON.stringify({ removeLabelIds: ["INBOX"] }),
  ]);
}

/** Mark read: remove the UNREAD label. */
export async function markEmailRead(id: string): Promise<void> {
  await gwsJson<unknown>([
    "gmail", "users", "messages", "modify",
    "--params", JSON.stringify({ userId: "me", id }),
    "--json", JSON.stringify({ removeLabelIds: ["UNREAD"] }),
  ]);
}

/** Trash: move to Trash (reversible in Gmail for 30 days). */
export async function trashEmail(id: string): Promise<void> {
  await gwsJson<unknown>([
    "gmail", "users", "messages", "trash",
    "--params", JSON.stringify({ userId: "me", id }),
  ]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- gws-gmail`
Expected: PASS (all tests, old + new).

- [ ] **Step 5: Commit**

```bash
git add src/modules/gws/gmail.ts tests/modules/gws-gmail.test.ts
git commit -m "feat: gmail archive/mark-read/trash mutation helpers"
```

---

### Task 2: Gmail widget hover actions

Rewrite `gmail-widget.tsx` to reveal per-row action buttons on hover/focus, wired to the Task 1 mutations with non-optimistic refresh + error toasts.

**Files:**
- Modify: `src/modules/gws/widgets/gmail-widget.tsx` (full rewrite of the component)
- Create: `tests/modules/gws-gmail-widget.test.tsx`

**Interfaces:**
- Consumes:
  - `archiveEmail`, `markEmailRead`, `trashEmail` from `../gmail` (Task 1).
  - `WidgetBodyProps<GmailData, GmailConfig>` (`{ data, config, refresh }`) from `@/modules/contracts`.
  - `useToast()` → `{ toast(message, variant?) }` from `@/components/toast-context`.
  - `CliError` from `@/server/cli`.
  - `EmailItem`, `GmailData`, `GmailConfig` from `../manifest`.
  - `FiArchive`, `FiCheck`, `FiTrash2` from `react-icons/fi`.
- Produces: `GmailWidget` component (registered type unchanged — no render.ts change needed).

- [ ] **Step 1: Write the failing widget test**

Create `tests/modules/gws-gmail-widget.test.tsx` (mirrors `gws-tasks-widget.test.tsx`):

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { GmailWidget } from "@/modules/gws/widgets/gmail-widget";
import { ToastProvider } from "@/components/toast-context";
import { gmailDefaultConfig, type EmailItem } from "@/modules/gws/manifest";
import { archiveEmail, markEmailRead, trashEmail } from "@/modules/gws/gmail";
import { CliError } from "@/server/cli";

vi.mock("@/modules/gws/gmail", () => ({
  archiveEmail: vi.fn().mockResolvedValue(undefined),
  markEmailRead: vi.fn().mockResolvedValue(undefined),
  trashEmail: vi.fn().mockResolvedValue(undefined),
}));
const mockArchive = archiveEmail as unknown as ReturnType<typeof vi.fn>;
const mockRead = markEmailRead as unknown as ReturnType<typeof vi.fn>;
const mockTrash = trashEmail as unknown as ReturnType<typeof vi.fn>;

const email = (id: string, unread: boolean): EmailItem => ({
  id,
  subject: `subject-${id}`,
  from: `from-${id}`,
  date: "2026-07-13T09:00:00.000Z",
  unread,
  url: `https://mail/${id}`,
});

function renderWidget(emails: EmailItem[]) {
  const refresh = vi.fn().mockResolvedValue(undefined);
  render(
    <ToastProvider>
      <GmailWidget data={{ emails }} config={gmailDefaultConfig} refresh={refresh} />
    </ToastProvider>,
  );
  return { refresh };
}

beforeEach(() => {
  mockArchive.mockReset().mockResolvedValue(undefined);
  mockRead.mockReset().mockResolvedValue(undefined);
  mockTrash.mockReset().mockResolvedValue(undefined);
});

describe("GmailWidget actions", () => {
  it("shows an empty message when there are no emails", () => {
    renderWidget([]);
    expect(screen.getByText("No emails.")).toBeInTheDocument();
  });

  it("shows Mark as read only on unread rows", () => {
    renderWidget([email("a", true), email("b", false)]);
    expect(screen.getByRole("button", { name: /mark .*from-a.* read/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark .*from-b.* read/i })).toBeNull();
    // archive + trash present on both rows
    expect(screen.getAllByRole("button", { name: /archive/i })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /trash/i })).toHaveLength(2);
  });

  it("archives non-optimistically: calls the CLI, then refresh, and disables while in flight", async () => {
    let resolveArchive: () => void = () => {};
    mockArchive.mockImplementationOnce(() => new Promise<void>((r) => { resolveArchive = () => r(); }));
    const { refresh } = renderWidget([email("a", true)]);
    const btn = screen.getByRole("button", { name: /archive .*from-a/i });

    await act(async () => { btn.click(); });
    // In flight: button disabled, refresh not yet called.
    expect(btn).toBeDisabled();
    expect(refresh).not.toHaveBeenCalled();

    await act(async () => { resolveArchive(); });
    expect(mockArchive).toHaveBeenCalledWith("a");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("shows an error toast and does not refresh when a mutation fails", async () => {
    mockTrash.mockRejectedValueOnce(new CliError("failed", "PERMISSION_DENIED", "gws"));
    const { refresh } = renderWidget([email("a", true)]);
    const btn = screen.getByRole("button", { name: /trash .*from-a/i });

    await act(async () => { btn.click(); });

    expect(screen.getByText(/couldn't trash email/i)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Verify the CliError constructor signature**

The test constructs `new CliError("failed", "PERMISSION_DENIED", "gws")`. Confirm the real signature before running:

Run: `grep -n "class CliError" -A 8 src/server/cli.ts`

If the constructor differs (arg order/count), update the `new CliError(...)` call in the test and the `mockRejectedValueOnce` accordingly. The only property the widget reads is `.message`, so ensure the constructed error's `.message` is `"failed"`.

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- gws-gmail-widget`
Expected: FAIL — the current `GmailWidget` renders no action buttons (`Unable to find role="button"`), and its props type doesn't include the mutation behavior.

- [ ] **Step 4: Implement the widget**

Replace the entire contents of `src/modules/gws/widgets/gmail-widget.tsx` with:

```tsx
"use client";
import { useState } from "react";
import { FiArchive, FiCheck, FiTrash2 } from "react-icons/fi";
import type { IconType } from "react-icons";
import type { WidgetBodyProps } from "@/modules/contracts";
import type { GmailData, GmailConfig, EmailItem } from "../manifest";
import { archiveEmail, markEmailRead, trashEmail } from "../gmail";
import { useToast } from "@/components/toast-context";
import { CliError } from "@/server/cli";

function shortDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

type RowAction = { verb: string; label: string; Icon: IconType; run: () => Promise<void>; danger?: boolean };

/** Actions for one row. Mark-as-read only appears while the email is unread. */
function rowActions(m: EmailItem): RowAction[] {
  const actions: RowAction[] = [
    { verb: "archive", label: `Archive email from ${m.from}`, Icon: FiArchive, run: () => archiveEmail(m.id) },
  ];
  if (m.unread) {
    actions.push({ verb: "mark read", label: `Mark email from ${m.from} as read`, Icon: FiCheck, run: () => markEmailRead(m.id) });
  }
  actions.push({ verb: "trash", label: `Trash email from ${m.from}`, Icon: FiTrash2, run: () => trashEmail(m.id), danger: true });
  return actions;
}

export function GmailWidget({ data, refresh }: WidgetBodyProps<GmailData, GmailConfig>) {
  // Non-optimistic: the row is dimmed + disabled while a mutation is in flight, and
  // leaves the list only when refresh() brings server-confirmed data. A rejected
  // action leaves the row untouched and surfaces an error toast.
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const { toast } = useToast();

  async function perform(m: EmailItem, action: RowAction) {
    setPending((p) => ({ ...p, [m.id]: true }));
    try {
      await action.run();
      await refresh();
    } catch (err) {
      const message = err instanceof CliError ? err.message : "please try again.";
      toast(`Couldn't ${action.verb} email: ${message}`, "error");
    } finally {
      setPending((p) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to drop it from `rest`
        const { [m.id]: _drop, ...rest } = p;
        return rest;
      });
    }
  }

  if (data.emails.length === 0)
    return <p className="text-sm text-slate-500 dark:text-slate-400">No emails.</p>;

  return (
    <ul className="divide-y divide-border dark:divide-border-dark">
      {data.emails.map((m) => {
        const busy = Boolean(pending[m.id]);
        return (
          <li
            key={m.id}
            className={`group/mailrow relative flex items-center gap-2.5 py-2 transition-opacity ${busy ? "opacity-60" : ""}`}
          >
            <span
              aria-label={m.unread ? "unread" : "read"}
              className={`h-2 w-2 shrink-0 rounded-full ${m.unread ? "bg-primary-500" : "bg-transparent"}`}
            />
            <a href={m.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 hover:underline">
              <span className="block truncate text-sm">{m.subject}</span>
              <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{m.from}</span>
            </a>
            <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">{shortDate(m.date)}</span>

            {/* Actions overlay the date, revealed on row hover/focus. */}
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center gap-0.5 bg-gradient-to-l from-card via-card to-transparent pl-8 opacity-0 transition-opacity duration-150 ease-out focus-within:pointer-events-auto focus-within:opacity-100 group-hover/mailrow:pointer-events-auto group-hover/mailrow:opacity-100 dark:from-card-dark dark:via-card-dark">
              {rowActions(m).map((a) => (
                <button
                  key={a.verb}
                  type="button"
                  disabled={busy}
                  onClick={() => perform(m, a)}
                  title={a.label}
                  aria-label={a.label}
                  className={`grid h-7 w-7 place-items-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 disabled:opacity-50 dark:text-slate-500 dark:hover:bg-white/10 ${
                    a.danger ? "hover:text-[var(--color-danger)]" : "hover:text-slate-700 dark:hover:text-slate-200"
                  }`}
                >
                  <a.Icon className="h-4 w-4" />
                </button>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- gws-gmail-widget`
Expected: PASS (all four tests).

- [ ] **Step 6: Typecheck + lint the changed files**

Run: `npm run lint`
Expected: no errors. (Confirms the `IconType` import, the eslint-disable comment, and the `--color-danger` arbitrary value are all accepted.)

- [ ] **Step 7: Commit**

```bash
git add src/modules/gws/widgets/gmail-widget.tsx tests/modules/gws-gmail-widget.test.tsx
git commit -m "feat: inline archive/mark-read/trash hover actions on Gmail widget"
```

---

### Task 3: Verify the `gmail.modify` scope + manual check

Confirm the running `gws` grant can actually perform the mutations, and drive the real widget once. This is the prerequisite flagged in the spec.

**Files:** none (verification only).

- [ ] **Step 1: Check the granted gws scopes**

Run whichever the `gws` CLI supports to inspect the current grant, e.g.:
`gws auth status` (or `gws auth list` / `gws auth scopes` — try `gws auth --help`).
Expected: the grant includes a Gmail write scope (`https://www.googleapis.com/auth/gmail.modify`). If only `gmail.readonly` is present, STOP and tell the user they must re-run `gws auth login` with the modify scope before the buttons will work — the UI ships correctly regardless (failures toast gracefully), but the actions are inert without it.

- [ ] **Step 2: Drive the real widget (use the `verify` skill)**

Invoke the `verify` skill to launch the app and exercise the flow end-to-end: hover an email row, confirm the Archive/Mark-as-read/Trash cluster fades in over the date; click Archive on a throwaway/unimportant email and confirm the row disappears after refresh; click a stubbed-fail case if reproducible and confirm the error toast. Do NOT restart the user's already-running app without asking (see the "don't restart running app" memory) — ask them to trigger the run, or use a separate `npm run dev:vite` instance.
Expected: cluster reveals on hover only for the hovered row; archived email leaves the list; errors surface as a toast without crashing the card.

- [ ] **Step 3: Full test suite**

Run: `npm test`
Expected: PASS (whole suite green — confirms no regressions in sibling gws widgets/tests).

---

## Self-Review

**Spec coverage:**
- Three mutations (archive/mark-read/trash) → Task 1. ✓
- Trash = `messages trash`, no confirm → Task 1 Step 3 + Global Constraints. ✓
- Non-optimistic dim/disable + refresh + error toast → Task 2 `perform()` + tests. ✓
- Mark-as-read only on unread rows → Task 2 `rowActions()` + test "shows Mark as read only on unread rows". ✓
- Cluster overlays the date, gradient mask, hover + focus-within reveal, per-row group → Task 2 widget markup. ✓
- Feather icons via `react-icons/fi` → Task 2 imports. ✓
- No manifest/capability/CACHE_VERSION changes → not touched; called out in Global Constraints. ✓
- `gmail.modify` scope prerequisite → Task 3. ✓
- Tests mirror `gws-tasks.test.ts` / `gws-tasks-widget.test.tsx` → Tasks 1 & 2. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; the only conditional ("if CliError signature differs") includes exact remediation. ✓

**Type consistency:** `archiveEmail`/`markEmailRead`/`trashEmail` return `Promise<void>` and take `(id: string)` in both Task 1 (definition) and Task 2 (consumption + mock). `EmailItem`/`GmailData`/`GmailConfig` imported from `../manifest`. `useToast()` returns `{ toast }`. `WidgetBodyProps` destructures `{ data, refresh }` (config intentionally unused — the widget doesn't need it, matching the current file which passed only `data`). ✓
