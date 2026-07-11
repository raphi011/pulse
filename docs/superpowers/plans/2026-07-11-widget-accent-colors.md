# Per-Widget Accent Colors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user assign one of 8 preset accent colors to each widget instance, rendered as a 3px bar on the card's left edge; no color = today's exact look.

**Architecture:** New nullable `accent` column on the `widgets` table (shell-level concern, like `title` — never inside module-owned `config`). One palette module (`src/lib/accents.ts`) is the single source of truth for names → Tailwind classes, used by both the card shell and the configure dialog's swatch picker. Unknown/stale names degrade to no accent everywhere.

**Tech Stack:** Drizzle ORM (sqlite), Tauri v2 SQL-plugin migrations (registered in `src-tauri/src/lib.rs`), React 19, Tailwind v4, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-11-widget-accent-colors-design.md`

## Global Constraints

- No Jira prefix on commits/branches — plain conventional messages (`feat: …`).
- All repo functions are async — always `await` them; tests use `useTempDb()` from `tests/helpers/db.ts` (it runs the `drizzle/` migrations against a temp better-sqlite3 DB).
- Preset names (exact, stored in DB): `red`, `orange`, `amber`, `green`, `teal`, `blue`, `violet`, `pink`. `null` = no accent.
- Invalid/unknown accent values must silently degrade to "no accent" (normalize to `null` on write, render nothing on read) — never throw, never crash a card.
- Tailwind v4 compiles statically — accent classes must be complete literal strings in the source (no `bg-${name}-500` interpolation).
- Default look unchanged: `accent = null` must produce DOM identical to today (assert no bar element).
- Run tests with `npx vitest run <path>`; full suite with `npm test`.

---

### Task 1: Palette module (`src/lib/accents.ts`)

**Files:**
- Create: `src/lib/accents.ts`
- Test: `tests/lib/accents.test.ts`

**Interfaces:**
- Consumes: nothing (pure module, no runtime deps).
- Produces (used by Tasks 3, 4, 5):
  - `ACCENT_NAMES: readonly ["red","orange","amber","green","teal","blue","violet","pink"]`
  - `type AccentName = (typeof ACCENT_NAMES)[number]`
  - `isAccentName(v: unknown): v is AccentName`
  - `accentClass(name: string | null | undefined): string | null` — Tailwind background classes for a preset; `null` for absent/unknown names.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/accents.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ACCENT_NAMES, isAccentName, accentClass } from "@/lib/accents";

describe("accents", () => {
  it("exposes the 8 preset names", () => {
    expect(ACCENT_NAMES).toEqual(["red", "orange", "amber", "green", "teal", "blue", "violet", "pink"]);
  });

  it("resolves a class for every preset", () => {
    for (const name of ACCENT_NAMES) {
      expect(accentClass(name)).toEqual(expect.stringContaining(`bg-${name}-`));
    }
  });

  it("degrades unknown, null, and undefined to null instead of throwing", () => {
    expect(accentClass("magenta")).toBeNull();
    expect(accentClass(null)).toBeNull();
    expect(accentClass(undefined)).toBeNull();
  });

  it("type-guards preset names", () => {
    expect(isAccentName("teal")).toBe(true);
    expect(isAccentName("magenta")).toBe(false);
    expect(isAccentName(null)).toBe(false);
    expect(isAccentName(42)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/accents.test.ts`
Expected: FAIL — cannot resolve `@/lib/accents`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/accents.ts`:

```ts
/** Preset accent palette for widget cards. Stored in the DB as a *name* so hues can be re-tuned here without touching stored data. */
export const ACCENT_NAMES = ["red", "orange", "amber", "green", "teal", "blue", "violet", "pink"] as const;
export type AccentName = (typeof ACCENT_NAMES)[number];

// Literal class strings — Tailwind v4 compiles statically, no interpolation.
// 500 reads right on light cards; 400 pops slightly better on the dark card surface.
const CLASSES: Record<AccentName, string> = {
  red: "bg-red-500 dark:bg-red-400",
  orange: "bg-orange-500 dark:bg-orange-400",
  amber: "bg-amber-500 dark:bg-amber-400",
  green: "bg-green-500 dark:bg-green-400",
  teal: "bg-teal-500 dark:bg-teal-400",
  blue: "bg-blue-500 dark:bg-blue-400",
  violet: "bg-violet-500 dark:bg-violet-400",
  pink: "bg-pink-500 dark:bg-pink-400",
};

export function isAccentName(v: unknown): v is AccentName {
  return typeof v === "string" && (ACCENT_NAMES as readonly string[]).includes(v);
}

/** Background classes for a preset; null for absent/unknown names so stale DB values degrade to no accent. */
export function accentClass(name: string | null | undefined): string | null {
  return isAccentName(name) ? CLASSES[name] : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/accents.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/accents.ts tests/lib/accents.test.ts
git commit -m "feat: accent color preset palette"
```

---

### Task 2: `accent` column, migration, and repo write

**Files:**
- Modify: `src/db/schema.ts` (widgets table, after `title`)
- Modify: `src/server/config-repo.ts` (add `setAccent`, extend `addWidget` row literal)
- Modify: `src-tauri/src/lib.rs:8-12` (register migration 2)
- Create: `drizzle/0001_*.sql` (generated — do not hand-write)
- Test: `tests/server/config-repo.test.ts` (extend existing file)

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Task 3):
  - `widgets.accent` column → `Widget.accent: string | null` (via `$inferSelect`)
  - `setAccent(id: string, accent: string | null): Promise<void>` in `src/server/config-repo.ts`

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe("config-repo", …)` block in `tests/server/config-repo.test.ts`:

```ts
  it("defaults accent to null and round-trips setAccent", async () => {
    const a = await repo.addWidget("core.status", {});
    expect((await repo.getWidget(a.id))!.accent).toBeNull();
    await repo.setAccent(a.id, "teal");
    expect((await repo.getWidget(a.id))!.accent).toBe("teal");
    await repo.setAccent(a.id, null);
    expect((await repo.getWidget(a.id))!.accent).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/config-repo.test.ts`
Expected: FAIL — `repo.setAccent is not a function` (and TS error: `accent` not on `Widget`).

- [ ] **Step 3: Add the column to the Drizzle schema**

In `src/db/schema.ts`, inside the `widgets` table after the `title` line:

```ts
  accent: text("accent"), // preset name from ACCENT_NAMES; null = no accent (default look)
```

- [ ] **Step 4: Generate the migration**

Run: `npm run db:generate`
Expected: a new file `drizzle/0001_<random-name>.sql` containing `ALTER TABLE \`widgets\` ADD \`accent\` text;`. Note the exact filename — the next step embeds it.

- [ ] **Step 5: Register the migration in the Tauri runner**

In `src-tauri/src/lib.rs`, extend `migrations()` (use the actual generated filename from Step 4):

```rust
fn migrations() -> Vec<Migration> {
    vec![
        Migration { version: 1, description: "baseline", sql: include_str!("../../drizzle/0000_silky_bromley.sql"), kind: MigrationKind::Up },
        Migration { version: 2, description: "widget accent", sql: include_str!("../../drizzle/0001_<random-name>.sql"), kind: MigrationKind::Up },
    ]
}
```

Verify it compiles: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: finishes with no errors.

- [ ] **Step 6: Repo write function + row literal**

In `src/server/config-repo.ts`, add after `setTitle` (line 53):

```ts
/** Per-widget accent color preset name (see src/lib/accents.ts); null = no accent. */
export async function setAccent(id: string, accent: string | null): Promise<void> {
  await getDb().update(widgets).set({ accent }).where(eq(widgets.id, id));
}
```

In `addWidget`, the explicit `row: Widget` literal now misses the new column — add `accent: null`:

```ts
  const row: Widget = {
    id: crypto.randomUUID(), type, title: null, accent: null, order, colSpan: 1, rowSpan: DEFAULT_ROW_SPAN,
    hidden: false, config: validated,
  };
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/server/config-repo.test.ts`
Expected: PASS (all tests in the file — `useTempDb` picks up the new migration from `drizzle/` automatically).

- [ ] **Step 8: Full suite guard**

Run: `npm test`
Expected: PASS — nothing else constructs a full `Widget` literal, but this catches any stragglers.

- [ ] **Step 9: Commit**

```bash
git add src/db/schema.ts drizzle/ src-tauri/src/lib.rs src/server/config-repo.ts tests/server/config-repo.test.ts
git commit -m "feat: accent column on widgets with setAccent repo write"
```

---

### Task 3: `updateWidget` accepts and normalizes `accent`

**Files:**
- Modify: `src/lib/dashboard-data.ts:31-47`
- Test: `tests/lib/dashboard-data.test.ts` (extend existing file)

**Interfaces:**
- Consumes: `setAccent` (Task 2), `isAccentName` (Task 1).
- Produces (used by Task 5):
  - `WidgetPatch` gains `accent?: string | null`
  - `updateWidget(id, patch)` returns `{ config?: unknown; title: string | null; accent: string | null }`
  - Normalization rule: any non-preset value in `patch.accent` is stored as `null`, silently.

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe("dashboard-data", …)` block in `tests/lib/dashboard-data.test.ts`:

```ts
  it("stores a preset accent and clears it with null", async () => {
    const w = await data.createWidget("core.status");
    const res = await data.updateWidget(w.id, { accent: "violet" });
    expect(res.accent).toBe("violet");
    const cleared = await data.updateWidget(w.id, { accent: null });
    expect(cleared.accent).toBeNull();
  });

  it("silently normalizes a non-preset accent to null", async () => {
    const w = await data.createWidget("core.status");
    await data.updateWidget(w.id, { accent: "violet" });
    const res = await data.updateWidget(w.id, { accent: "magenta" });
    expect(res.accent).toBeNull();
  });

  it("leaves accent untouched when the patch omits it", async () => {
    const w = await data.createWidget("core.status");
    await data.updateWidget(w.id, { accent: "teal" });
    const res = await data.updateWidget(w.id, { title: "Renamed" });
    expect(res.accent).toBe("teal");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/dashboard-data.test.ts`
Expected: FAIL — `res.accent` is `undefined` (TS also errors on `accent` in the patch).

- [ ] **Step 3: Implement**

In `src/lib/dashboard-data.ts`:

Extend the import from `@/server/config-repo` with `setAccent`, and add:

```ts
import { isAccentName } from "@/lib/accents";
```

Replace the `WidgetPatch` type and `updateWidget`:

```ts
export type WidgetPatch = {
  hidden?: boolean;
  config?: Record<string, unknown>;
  title?: string | null;
  accent?: string | null;
};

/** Mirrors PATCH /api/widgets/:id — validates config against the schema, echoes stored config+title+accent. */
export async function updateWidget(
  id: string, patch: WidgetPatch,
): Promise<{ config?: unknown; title: string | null; accent: string | null }> {
  const widget = await getWidget(id);
  if (!widget) throw new Error("Not found");
  if (typeof patch.hidden === "boolean") await setHidden(id, patch.hidden);
  if (patch.title !== undefined) await setTitle(id, patch.title);
  if (patch.accent !== undefined) {
    // Non-preset values degrade to "no accent" silently (spec: never an error).
    await setAccent(id, isAccentName(patch.accent) ? patch.accent : null);
  }
  if (patch.config !== undefined) {
    const def = getFetchWidget(widget.type);
    const parsed = def?.manifest.configSchema.safeParse(patch.config);
    if (def && parsed && !parsed.success) throw new Error("Invalid config");
    await setConfig(id, (parsed?.success ? parsed.data : patch.config) as Record<string, unknown>);
  }
  const fresh = await getWidget(id);
  return { config: fresh?.config, title: fresh?.title ?? null, accent: fresh?.accent ?? null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/dashboard-data.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard-data.ts tests/lib/dashboard-data.test.ts
git commit -m "feat: updateWidget accepts and normalizes accent"
```

---

### Task 4: Accent bar in `WidgetShell` + pass-through from `WidgetCard`

**Files:**
- Modify: `src/components/widget-shell.tsx` (prop + bar element + `relative` on the section)
- Modify: `src/components/widget-card.tsx` (pass `widget.accent` to both `WidgetShell` renders)
- Test: `tests/components/widget-shell.test.tsx` (extend existing file)

**Interfaces:**
- Consumes: `accentClass` (Task 1), `Widget.accent` (Task 2).
- Produces: `WidgetShell` prop `accent?: string | null`. Bar element is `<span aria-hidden data-accent …>` — tests locate it via `container.querySelector("[data-accent]")`.

- [ ] **Step 1: Write the failing test**

Append at the end of `tests/components/widget-shell.test.tsx`:

```tsx
describe("WidgetShell accent", () => {
  it("renders a colored edge bar for a preset accent in every state", () => {
    for (const state of ["loading", "error", "empty", "ok"] as const) {
      const { container, unmount } = render(
        <WidgetShell title="X" state={state} fetchedAt={null} onRefresh={() => {}} accent="teal">
          <div>body</div>
        </WidgetShell>,
      );
      const bar = container.querySelector("[data-accent]");
      expect(bar, `state=${state}`).not.toBeNull();
      expect(bar!.className).toContain("bg-teal-500");
      unmount();
    }
  });

  it("renders no bar when accent is absent", () => {
    const { container } = render(
      <WidgetShell title="X" state="ok" fetchedAt={null} onRefresh={() => {}}>
        <div>body</div>
      </WidgetShell>,
    );
    expect(container.querySelector("[data-accent]")).toBeNull();
  });

  it("renders no bar for an unknown accent name", () => {
    const { container } = render(
      <WidgetShell title="X" state="ok" fetchedAt={null} onRefresh={() => {}} accent="magenta">
        <div>body</div>
      </WidgetShell>,
    );
    expect(container.querySelector("[data-accent]")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/widget-shell.test.tsx`
Expected: FAIL — no `[data-accent]` element rendered (TS also errors on the unknown `accent` prop).

- [ ] **Step 3: Implement the bar**

In `src/components/widget-shell.tsx`:

Add the import:

```ts
import { accentClass } from "@/lib/accents";
```

Add `accent` to the destructured props and the type (after `title`):

```ts
  title, icon, count, state, error, fetchedAt, onRefresh, refreshing, refreshable = true, children, headerExtra, menu, dragHandle, issue, accent,
```

```ts
  /** Preset accent name (src/lib/accents.ts); null/unknown = no accent bar. */
  accent?: string | null;
```

In the body, resolve the class and render the bar as the first child of the section. The section needs `relative` added to its className (it already has `overflow-hidden rounded-xl`, which keeps the bar's corners clean):

```tsx
  const bar = accentClass(accent);
  return (
    <section className="group/card relative flex h-full flex-col overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-border transition-shadow duration-150 hover:shadow-md dark:bg-card-dark dark:shadow-none dark:ring-border-dark dark:hover:ring-white/15">
      {bar && <span aria-hidden data-accent className={`pointer-events-none absolute inset-y-0 left-0 w-[3px] ${bar}`} />}
      <header ...
```

(Only `relative` and the bar line are new; the rest of the section is unchanged.)

- [ ] **Step 4: Pass it through from the card**

In `src/components/widget-card.tsx`, add `accent={widget.accent}` to **both** `WidgetShell` usages — the no-renderer fallback (line 23) and the main return (line 52).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/components/widget-shell.test.tsx tests/components/widget-card.test.tsx`
Expected: PASS (all tests in both files).

- [ ] **Step 6: Commit**

```bash
git add src/components/widget-shell.tsx src/components/widget-card.tsx tests/components/widget-shell.test.tsx
git commit -m "feat: accent edge bar on widget cards"
```

---

### Task 5: Swatch picker in the configure dialog + dashboard state

**Files:**
- Modify: `src/components/configure-dialog.tsx` (accent state, swatch row, save path, `onSaved` signature)
- Modify: `src/components/dashboard.tsx:132-133` (`onConfigSaved` carries accent)
- Test: Create `tests/components/configure-dialog.test.tsx`

**Interfaces:**
- Consumes: `ACCENT_NAMES`, `accentClass` (Task 1); `updateWidget` accent patch + echo (Task 3); `WidgetShell` accent rendering (Task 4).
- Produces: `ConfigureDialog` prop `onSaved: (id: string, config: Record<string, unknown>, title: string | null, accent: string | null) => void` — `dashboard.tsx` is the only caller.

- [ ] **Step 1: Write the failing test**

Create `tests/components/configure-dialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/dashboard-data", () => ({
  updateWidget: vi.fn(async () => ({ config: { label: "" }, title: null, accent: "teal" })),
  fetchWidgetData: vi.fn(async () => ({ widgetId: "w1", payload: null, fetchedAt: 0, status: "ok", error: null, errorKind: null })),
}));

import "@/modules/render";
import { updateWidget } from "@/lib/dashboard-data";
import { ConfigureDialog } from "@/components/configure-dialog";
import type { Widget } from "@/server/config-repo";

const widget: Widget = {
  id: "w1", type: "core.status", title: null, accent: null,
  order: 0, colSpan: 1, rowSpan: 6, hidden: false, config: { label: "" },
};

function renderDialog(onSaved = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ConfigureDialog widget={widget} onClose={() => {}} onSaved={onSaved} />
    </QueryClientProvider>,
  );
  return onSaved;
}

beforeEach(() => vi.clearAllMocks());

describe("ConfigureDialog accent picker", () => {
  it("shows a none swatch plus the 8 presets", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "No color" })).toBeInTheDocument();
    for (const name of ["red", "orange", "amber", "green", "teal", "blue", "violet", "pink"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("saves the selected accent and passes the stored value to onSaved", async () => {
    const onSaved = renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "teal" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(vi.mocked(updateWidget)).toHaveBeenCalledWith("w1", expect.objectContaining({ accent: "teal" }));
    expect(onSaved).toHaveBeenCalledWith("w1", expect.anything(), null, "teal");
  });

  it("marks the current selection with aria-pressed", async () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "No color" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "violet" }));
    expect(screen.getByRole("button", { name: "violet" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "No color" })).toHaveAttribute("aria-pressed", "false");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/configure-dialog.test.tsx`
Expected: FAIL — no button named "No color".

- [ ] **Step 3: Implement the picker**

In `src/components/configure-dialog.tsx`:

Add the import:

```ts
import { ACCENT_NAMES, accentClass } from "@/lib/accents";
```

Change the `onSaved` prop type:

```ts
  onSaved: (id: string, config: Record<string, unknown>, title: string | null, accent: string | null) => void;
```

Add state next to `title` (rename the setter to avoid shadowing confusion is unnecessary — `setAccent` here is local component state, the repo function is not imported in this file):

```ts
  const [accent, setAccent] = useState<string | null>(widget.accent ?? null);
```

In `save()`, include accent in the patch and the callback:

```ts
    let stored: unknown;
    let storedTitle: string | null | undefined;
    let storedAccent: string | null = null;
    try {
      ({ config: stored, title: storedTitle, accent: storedAccent } =
        await updateWidget(widget.id, { config: values, title: nextTitle, accent }));
    } catch {
      setError("Invalid configuration");
      setSaving(false);
      return;
    }
    const fresh = await fetchWidgetData(widget.id, true);
    qc.setQueryData(["widget", widget.id], fresh);
    onSaved(widget.id, (stored ?? values) as Record<string, unknown>, storedTitle ?? nextTitle, storedAccent);
```

Add the swatch row between the Title block (ends line 75) and the `SchemaForm`:

```tsx
        <div className="mb-4 space-y-1.5">
          <span className="block text-xs font-medium text-slate-600 dark:text-slate-300">Color</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="No color"
              aria-pressed={accent === null}
              onClick={() => setAccent(null)}
              className={`grid h-5 w-5 place-items-center rounded-full bg-surface text-[0.6rem] leading-none text-slate-400 ring-1 ring-border dark:bg-surface-dark dark:ring-border-dark ${
                accent === null ? "ring-2 ring-primary-500" : ""
              }`}
            >
              <span aria-hidden>✕</span>
            </button>
            {ACCENT_NAMES.map((name) => (
              <button
                key={name}
                type="button"
                aria-label={name}
                aria-pressed={accent === name}
                onClick={() => setAccent(name)}
                className={`h-5 w-5 rounded-full ${accentClass(name)} ${
                  accent === name ? "ring-2 ring-primary-500 ring-offset-1 dark:ring-offset-card-dark" : ""
                }`}
              />
            ))}
          </div>
        </div>
```

- [ ] **Step 4: Thread accent through dashboard state**

In `src/components/dashboard.tsx`, replace `onConfigSaved` (lines 132-133):

```ts
  function onConfigSaved(id: string, config: Record<string, unknown>, title: string | null, accent: string | null) {
    setWidgets((ws) => ws.map((w) => (w.id === id ? { ...w, config, title, accent } : w)));
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/components/configure-dialog.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Full suite + lint**

Run: `npm test && npm run lint`
Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/configure-dialog.tsx src/components/dashboard.tsx tests/components/configure-dialog.test.tsx
git commit -m "feat: accent swatch picker in configure dialog"
```

---

### Task 6: End-to-end verification in the real app

**Files:** none (verification only).

- [ ] **Step 1: Build and open the release app**

Run: `npm start`
Expected: the app builds and opens (this exercises the new migration against the real `~/Library/Application Support/com.pulse.dashboard/dashboard.db`).

- [ ] **Step 2: Verify the flow by hand**

1. Open any card's menu → Configure. The Color row shows the ✕ swatch + 8 dots, ✕ selected.
2. Pick a color, Save → a 3px bar in that color appears on the card's left edge; rounded corners stay clean; toggle theme (light/dark) and confirm the bar reads well in both.
3. Reopen Configure → the picked swatch is selected. Choose ✕, Save → bar disappears, card identical to before.
4. Restart the app → the accent survives (persisted, not cache).

- [ ] **Step 3: Commit any leftovers / verify clean tree**

Run: `git status`
Expected: clean (all work committed in Tasks 1-5).
