# Grid Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the column-masonry layout with a responsive ordered-flow grid whose modules drag-resize in both dimensions, fill the full viewport width, and reflow losslessly on window resize.

**Architecture:** A single global `order` per widget is the width-independent source of truth; widgets flow in `order` into a CSS Grid whose column count is computed from container width (`ResizeObserver`). Each widget stores `colSpan`/`rowSpan`; cards are fixed-height with scrolling bodies. dnd-kit handles reorder (flat `rectSortingStrategy`); a bespoke pointer-driven handle does resize.

**Tech Stack:** Next.js (App Router), React, TypeScript, Tailwind v4, Drizzle ORM + better-sqlite3, dnd-kit, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-10-grid-layout-design.md`

---

## File Structure

- **Create** `src/lib/grid.ts` — pure grid math + constants (`columnCountForWidth`, `clampSpan`, `spanFromDelta`, `COL_UNIT_PX`, `ROW_UNIT_PX`, `DEFAULT_ROW_SPAN`, `MAX_COLS`).
- **Create** `tests/lib/grid.test.ts` — tests for the above.
- **Create** `src/components/resize-handle.tsx` — pointer-driven corner resize handle.
- **Rewrite** `src/components/dashboard-logic.ts` — flat-order helpers (`orderedWidgets`, `applyReorder`, `applyResize`, `persistPositions`) replacing column helpers.
- **Rewrite** `tests/components/dashboard-logic.test.ts` — tests for the flat helpers.
- **Delete** `src/lib/layout.ts` + `tests/lib/layout.test.ts` — column reducer, made dead by this change.
- **Modify** `src/db/schema.ts` — add `colSpan`/`rowSpan`, drop `column`.
- **Create** `drizzle/0003_grid_layout.sql` (via `db:generate`, contents replaced) — structural change + global `order` backfill. (`0002_breezy_iceman.sql` already exists on `main`.)
- **Modify** `src/server/config-repo.ts` — order by `order`, span defaults in `addWidget`, new `setPositions` signature.
- **Modify** `tests/server/config-repo.test.ts` — assert `order`/spans instead of `column`.
- **Modify** `src/app/api/layout/route.ts` — new PATCH payload shape + validation.
- **Modify** `tests/api/layout.test.ts` — updated payload/expectations.
- **Modify** `src/components/widget-shell.tsx` — fixed-height card, scrolling body.
- **Modify** `src/components/sortable-card.tsx` — grid span styles + resize handle.
- **Rewrite** `src/components/dashboard.tsx` — flat sortable grid + `ResizeObserver` + resize wiring.
- **Modify** `src/app/globals.css` — `.wd-grid` becomes an auto-rows grid.
- **Modify** `src/app/page.tsx` — drop `columnCount` plumbing.

---

## Task 1: Grid math library

**Files:**
- Create: `src/lib/grid.ts`
- Test: `tests/lib/grid.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/grid.test.ts
import { describe, it, expect } from "vitest";
import { columnCountForWidth, clampSpan, spanFromDelta } from "@/lib/grid";

describe("grid math", () => {
  it("derives column count from width (3 -> 6 -> 9 at ~300px units)", () => {
    expect(columnCountForWidth(900)).toBe(3);
    expect(columnCountForWidth(1800)).toBe(6);
    expect(columnCountForWidth(2700)).toBe(9);
  });

  it("never returns fewer than 1 column", () => {
    expect(columnCountForWidth(0)).toBe(1);
    expect(columnCountForWidth(120)).toBe(1);
  });

  it("caps at MAX_COLS", () => {
    expect(columnCountForWidth(100_000)).toBe(12);
  });

  it("clamps a span between 1 and the column count", () => {
    expect(clampSpan(3, 6)).toBe(3);
    expect(clampSpan(9, 6)).toBe(6);
    expect(clampSpan(0, 6)).toBe(1);
  });

  it("computes a new span from a drag delta, snapping to whole cells", () => {
    expect(spanFromDelta(2, 0, 300)).toBe(2);
    expect(spanFromDelta(2, 320, 300)).toBe(3); // +1.06 cells -> round to +1
    expect(spanFromDelta(2, -700, 300)).toBe(1); // clamps to 1
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/lib/grid.test.ts`
Expected: FAIL — cannot resolve `@/lib/grid`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/grid.ts
export const COL_UNIT_PX = 300; // target physical column width
export const ROW_UNIT_PX = 40; // height of one grid row unit
export const DEFAULT_ROW_SPAN = 6; // ~240px starting card height
export const MAX_COLS = 12;

/** Number of columns that fit in `width`, clamped to [1, MAX_COLS]. */
export function columnCountForWidth(width: number, unitPx = COL_UNIT_PX, maxCols = MAX_COLS): number {
  return Math.max(1, Math.min(maxCols, Math.floor(width / unitPx)));
}

/** A span is at least 1 and at most the available column count. */
export function clampSpan(span: number, cols: number): number {
  return Math.max(1, Math.min(Math.floor(span), Math.max(1, cols)));
}

/** New span after dragging `deltaPx` from `startSpan`, snapped to whole `cellPx` cells. */
export function spanFromDelta(startSpan: number, deltaPx: number, cellPx: number): number {
  return Math.max(1, Math.round(startSpan + deltaPx / cellPx));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/lib/grid.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/grid.ts tests/lib/grid.test.ts
git commit -m "feat: add grid math library"
```

---

## Task 2: Flat-order layout logic

Replaces the column reducer with flat-order helpers. `order` becomes a global sequence over **visible** widgets; hidden widgets are preserved untouched.

**Files:**
- Rewrite: `src/components/dashboard-logic.ts`
- Rewrite: `tests/components/dashboard-logic.test.ts`
- Delete: `src/lib/layout.ts`, `tests/lib/layout.test.ts`

- [ ] **Step 1: Write the failing test (replace file contents)**

```typescript
// tests/components/dashboard-logic.test.ts
import { describe, it, expect } from "vitest";
import { orderedWidgets, applyReorder, applyResize } from "@/components/dashboard-logic";
import type { Widget } from "@/server/config-repo";

const mk = (id: string, order: number, extra: Partial<Widget> = {}): Widget => ({
  id, type: "core.status", title: null, order, colSpan: 1, rowSpan: 6,
  hidden: false, config: {}, ...extra,
});

describe("dashboard-logic", () => {
  it("orders visible widgets by order, skipping hidden", () => {
    const ws = [mk("a", 1), mk("b", 0), mk("c", 2, { hidden: true })];
    expect(orderedWidgets(ws).map((w) => w.id)).toEqual(["b", "a"]);
  });

  it("reorders a widget before another and reassigns a 0..n order", () => {
    const ws = [mk("a", 0), mk("b", 1), mk("c", 2)];
    const next = applyReorder(ws, "c", "a"); // move c to a's slot
    const map = Object.fromEntries(next.map((w) => [w.id, w.order]));
    expect(map).toEqual({ c: 0, a: 1, b: 2 });
  });

  it("keeps hidden widgets in the returned set unchanged", () => {
    const ws = [mk("a", 0), mk("b", 1), mk("h", 2, { hidden: true })];
    const next = applyReorder(ws, "b", "a");
    expect(next.find((w) => w.id === "h")).toMatchObject({ hidden: true });
  });

  it("applies a resize to one widget's spans", () => {
    const ws = [mk("a", 0), mk("b", 1)];
    const next = applyResize(ws, "a", 3, 8);
    expect(next.find((w) => w.id === "a")).toMatchObject({ colSpan: 3, rowSpan: 8 });
    expect(next.find((w) => w.id === "b")).toMatchObject({ colSpan: 1, rowSpan: 6 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/components/dashboard-logic.test.ts`
Expected: FAIL — `orderedWidgets`/`applyReorder`/`applyResize` not exported (and `Widget` has no `colSpan`; that lands in Task 3 — expect a type error here too).

- [ ] **Step 3: Write the implementation (replace file contents)**

```typescript
// src/components/dashboard-logic.ts
import type { Widget } from "@/server/config-repo";
import type { DragEndEvent } from "@dnd-kit/core";

/** Visible widgets in global flow order. */
export function orderedWidgets(widgets: Widget[]): Widget[] {
  return widgets.filter((w) => !w.hidden).sort((a, b) => a.order - b.order);
}

/** Move `activeId` to `overId`'s slot; reassign a dense 0..n order over visible widgets. */
export function applyReorder(widgets: Widget[], activeId: string, overId: string): Widget[] {
  const visible = orderedWidgets(widgets);
  const from = visible.findIndex((w) => w.id === activeId);
  const to = visible.findIndex((w) => w.id === overId);
  if (from < 0 || to < 0) return widgets;
  const reordered = [...visible];
  const [moved] = reordered.splice(from, 1);
  reordered.splice(to, 0, moved);
  const orderById = new Map(reordered.map((w, i) => [w.id, i]));
  return widgets.map((w) => (orderById.has(w.id) ? { ...w, order: orderById.get(w.id)! } : w));
}

/** Set one widget's spans. */
export function applyResize(widgets: Widget[], id: string, colSpan: number, rowSpan: number): Widget[] {
  return widgets.map((w) => (w.id === id ? { ...w, colSpan, rowSpan } : w));
}

export function applyDragEnd(widgets: Widget[], e: DragEndEvent): Widget[] | null {
  if (!e.over || e.active.id === e.over.id) return null;
  return applyReorder(widgets, String(e.active.id), String(e.over.id));
}

export async function persistPositions(widgets: Widget[]): Promise<void> {
  const positions = widgets.map((w) => ({
    id: w.id, order: w.order, colSpan: w.colSpan, rowSpan: w.rowSpan,
  }));
  await fetch("/api/layout", { method: "PATCH", body: JSON.stringify({ positions }) });
}
```

- [ ] **Step 4: Delete the dead column reducer**

```bash
git rm src/lib/layout.ts tests/lib/layout.test.ts
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/components/dashboard-logic.test.ts`
Expected: PASS (4 tests). (Type errors on `colSpan`/`rowSpan` resolve once Task 3 updates the schema — if running the whole suite now, do Task 3 next before `npm test`.)

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard-logic.ts tests/components/dashboard-logic.test.ts
git commit -m "refactor: flat-order layout logic, drop column reducer"
```

---

## Task 3: Schema + migration

`order` is repurposed as a global sequence; `colSpan`/`rowSpan` are added; `column` is dropped. The migration backfills a global `order` from the old `(column, order)` **before** the column disappears, using a window function.

**Files:**
- Modify: `src/db/schema.ts`
- Create: `drizzle/0003_grid_layout.sql` (generate, then replace contents)

Note: `main` already dropped `refreshInterval` from the schema, and `drizzle/0002_breezy_iceman.sql` exists — so this migration is **`0003`** and the rebuilt table has **no** `refresh_interval` column. Current `widgets` columns are: `id, type, title, column, order, hidden, config`.

- [ ] **Step 1: Update the schema**

In `src/db/schema.ts`, replace the `column` line in the `widgets` table with the two span columns (leave `order`, `hidden`, `config` as-is):

```typescript
export const widgets = sqliteTable("widgets", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  title: text("title"), // null = use the widget definition's default title
  order: integer("order").notNull().default(0), // global flow order
  colSpan: integer("col_span").notNull().default(1),
  rowSpan: integer("row_span").notNull().default(6),
  hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
  config: text("config", { mode: "json" }).notNull().$type<Record<string, unknown>>(),
});
```

- [ ] **Step 2: Generate the migration skeleton**

Run: `npm run db:generate`
Expected: creates `drizzle/0003_<name>.sql` and updates `drizzle/meta`. Note the generated filename.

- [ ] **Step 3: Replace the generated SQL with the backfilling version**

Overwrite the generated `drizzle/0003_*.sql` file's contents with this (SQLite rebuilds the table to drop a column; we inject the global-order computation into the copy step):

```sql
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_widgets` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`title` text,
	`order` integer DEFAULT 0 NOT NULL,
	`col_span` integer DEFAULT 1 NOT NULL,
	`row_span` integer DEFAULT 6 NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`config` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_widgets` (`id`, `type`, `title`, `order`, `col_span`, `row_span`, `hidden`, `config`)
SELECT `id`, `type`, `title`,
	ROW_NUMBER() OVER (ORDER BY `column`, `order`) - 1 AS `order`,
	1 AS `col_span`, 6 AS `row_span`,
	`hidden`, `config`
FROM `widgets`;
--> statement-breakpoint
DROP TABLE `widgets`;
--> statement-breakpoint
ALTER TABLE `__new_widgets` RENAME TO `widgets`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
```

- [ ] **Step 4: Apply and manually verify against the real db**

Run: `npm run db:migrate`
Then inspect the result:

Run: `sqlite3 dashboard.db "SELECT id, \"order\", col_span, row_span FROM widgets ORDER BY \"order\";"`
Expected: `order` is a gap-free `0..n-1` sequence; every `col_span` is `1` and `row_span` is `6`. (If you have no `sqlite3` binary, start `npm run dev` after Task 10 and confirm widgets render once.)

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat: grid layout schema + migration (colSpan/rowSpan, global order)"
```

---

## Task 4: config-repo — order + spans

**Files:**
- Modify: `src/server/config-repo.ts`
- Modify: `tests/server/config-repo.test.ts`

- [ ] **Step 1: Update `getWidgets` ordering**

Replace the body of `getWidgets` (line ~11):

```typescript
export function getWidgets(): Widget[] {
  return getDb().select().from(widgets).orderBy(asc(widgets.order)).all();
}
```

- [ ] **Step 2: Update `addWidget` to append in order with default spans**

Replace `addWidget` (the `COLUMN_COUNT_DEFAULT` const above it is now unused — delete it):

```typescript
export function addWidget(type: string, config: Record<string, unknown>): Widget {
  const def = getServerWidget(type);
  const validated = def ? (def.configSchema.parse(config) as Record<string, unknown>) : config;
  const existing = getWidgets();
  const order = existing.reduce((max, w) => Math.max(max, w.order + 1), 0);
  const row: Widget = {
    id: randomUUID(), type, title: null, order, colSpan: 1, rowSpan: 6,
    hidden: false, config: validated,
  };
  getDb().insert(widgets).values(row).run();
  return row;
}
```

- [ ] **Step 3: Update `setPositions` signature**

```typescript
export function setPositions(
  positions: { id: string; order: number; colSpan: number; rowSpan: number }[],
): void {
  const db = getDb();
  db.transaction((tx) => {
    for (const p of positions) {
      tx.update(widgets)
        .set({ order: p.order, colSpan: p.colSpan, rowSpan: p.rowSpan })
        .where(eq(widgets.id, p.id))
        .run();
    }
  });
}
```

- [ ] **Step 4: Update `tests/server/config-repo.test.ts`**

The first two tests assert `.column`; the prefs test uses `"columnCount"` as a key (which Task 10's grep will flag). Replace those three `it(...)` blocks (leave "hides and removes widgets" as-is):

```typescript
  it("appends widgets in order", () => {
    const a = repo.addWidget("core.status", { label: "A" });
    const b = repo.addWidget("core.status", { label: "B" });
    expect(a.order).toBe(0);
    expect(b.order).toBe(1);
    expect(repo.getWidgets()).toHaveLength(2);
  });

  it("persists positions", () => {
    const a = repo.addWidget("core.status", {});
    repo.setPositions([{ id: a.id, order: 5, colSpan: 3, rowSpan: 8 }]);
    const got = repo.getWidget(a.id)!;
    expect(got.order).toBe(5);
    expect(got.colSpan).toBe(3);
    expect(got.rowSpan).toBe(8);
  });

  it("reads and writes prefs with defaults", () => {
    expect(repo.getPref("theme", "dark")).toBe("dark");
    repo.setPref("theme", "light");
    expect(repo.getPref("theme", "dark")).toBe("light");
  });
```

- [ ] **Step 5: Run repo tests + verify types compile**

Run: `npm test -- tests/server/config-repo.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: no errors in `config-repo.ts`/`dashboard-logic.ts` (the `dashboard.tsx`/`page.tsx` errors are addressed in later tasks).

- [ ] **Step 6: Commit**

```bash
git add src/server/config-repo.ts tests/server/config-repo.test.ts
git commit -m "feat: order-based widget repo with span defaults"
```

---

## Task 5: /api/layout PATCH payload

**Files:**
- Modify: `src/app/api/layout/route.ts`
- Modify: `tests/api/layout.test.ts`

- [ ] **Step 1: Update the failing API test**

In `tests/api/layout.test.ts`, first delete the stale `columnCount` assertion in the "adds a widget and returns it in the layout" test:

```typescript
    expect(layout.prefs.columnCount).toBe("3"); // <-- DELETE this line
```

Then update the "persists positions" test to the new payload (it currently asserts `layout.widgets[0].column`). Replace the `it("persists positions via PATCH /api/layout", ...)` body:

```typescript
  it("persists positions via PATCH /api/layout", async () => {
    const added = await (await addWidget(new Request("http://x/api/widgets", {
      method: "POST", body: JSON.stringify({ type: "core.status" }),
    }))).json();
    const res = await patchLayout(new Request("http://x/api/layout", {
      method: "PATCH",
      body: JSON.stringify({ positions: [{ id: added.id, order: 0, colSpan: 3, rowSpan: 8 }] }),
    }));
    expect(res.status).toBe(200);
    const layout = await (await getLayout()).json();
    expect(layout.widgets[0]).toMatchObject({ colSpan: 3, rowSpan: 8 });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/api/layout.test.ts`
Expected: FAIL — `colSpan`/`rowSpan` are not persisted yet (old `setPositions` ignored them / route typed for `column`).

- [ ] **Step 3: Update the route**

Replace the PATCH handler's body type and keep the validation shape:

```typescript
export async function PATCH(req: Request) {
  let body: { positions?: { id: string; order: number; colSpan: number; rowSpan: number }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (body.positions !== undefined) {
    if (!Array.isArray(body.positions)) {
      return NextResponse.json({ error: "positions must be an array" }, { status: 400 });
    }
    setPositions(body.positions);
  }
  return NextResponse.json({ ok: true });
}
```

Also drop the now-irrelevant `columnCount` from the GET response prefs (keep `theme`):

```typescript
export async function GET() {
  return NextResponse.json({
    widgets: getWidgets(),
    prefs: { theme: getPref("theme", "dark") },
  });
}
```

If any test asserts `layout.prefs.columnCount`, remove that assertion.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/api/layout.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/layout/route.ts tests/api/layout.test.ts
git commit -m "feat: grid-span layout PATCH payload"
```

---

## Task 6: Fixed-height card with scrolling body

**Files:**
- Modify: `src/components/widget-shell.tsx`

- [ ] **Step 1: Make the card fill its grid cell and scroll its body**

In `WidgetShell`, change the `<section>` to a full-height flex column and the content `<div>` to a scrolling flex child. Replace the `<section ...>` opening tag and the content `<div className="px-3.5 py-3">`:

```tsx
    <section className="group/card flex h-full flex-col overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-border transition-shadow duration-150 hover:shadow-md dark:bg-card-dark dark:shadow-none dark:ring-border-dark dark:hover:ring-white/15">
```

and the body wrapper:

```tsx
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
```

(Leave the `<header>` as-is — `flex-col` keeps it fixed at the top while the body scrolls.)

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no new errors in `widget-shell.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/widget-shell.tsx
git commit -m "feat: fixed-height widget cards with scrolling body"
```

---

## Task 7: Grid CSS

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Replace the masonry `.wd-grid` block**

Replace the `.wd-grid` rule and its two `@media` blocks (the "Masonry columns" comment through the `1024px` media query) with:

```css
  /* Ordered-flow grid: JS sets --wd-cols from container width; rows are fixed units. */
  .wd-grid {
    display: grid;
    gap: 1rem;
    grid-template-columns: repeat(var(--wd-cols, 1), minmax(0, 1fr));
    grid-auto-rows: var(--wd-row-unit, 40px);
    grid-auto-flow: row;
  }
```

- [ ] **Step 2: Verify the build compiles CSS**

Run: `npm run build`
Expected: build succeeds (component wiring in Task 8 may still be pending; if `dashboard.tsx` errors, do Task 8 first, then re-run). At minimum the CSS is syntactically valid.

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "feat: auto-rows grid CSS for ordered-flow layout"
```

---

## Task 8: Dashboard grid + sortable-card spans + ResizeObserver

**Files:**
- Rewrite: `src/components/dashboard.tsx`
- Modify: `src/components/sortable-card.tsx`

- [ ] **Step 1: Rewrite `dashboard.tsx`**

Replace the whole file. This drops the per-column droppable + `col:N` collision logic, uses one flat `SortableContext` with `rectSortingStrategy`, computes `--wd-cols` via a `ResizeObserver`, and threads `cols` + resize down to the cards.

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import {
  DndContext, DragOverlay, closestCenter,
  PointerSensor, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import type { Widget } from "@/server/config-repo";
import { orderedWidgets, applyDragEnd, applyResize, persistPositions } from "@/components/dashboard-logic";
import { columnCountForWidth, clampSpan, ROW_UNIT_PX } from "@/lib/grid";
import { SortableCard } from "./sortable-card";
import { WidgetCard } from "./widget-card";
import { AddWidgetDrawer } from "./add-widget-drawer";
import { ConfigureDialog } from "./configure-dialog";
import { useAutoRefresh } from "./auto-refresh-context";

// Preserved from main — the global auto-refresh toggle + refresh-all button.
function AutoRefreshControls() {
  const { enabled, toggle, refreshAll } = useAutoRefresh();
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={enabled}
        className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 transition-colors ${
          enabled
            ? "bg-primary-600 text-white ring-primary-600"
            : "text-slate-600 ring-border hover:bg-slate-50 dark:text-slate-300 dark:ring-border-dark dark:hover:bg-white/5"
        }`}
      >
        Auto-refresh {enabled ? "on" : "off"}
      </button>
      <button
        type="button"
        onClick={refreshAll}
        aria-label="Refresh all widgets"
        title="Refresh all widgets"
        className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 ring-1 ring-border transition-colors hover:bg-slate-50 hover:text-slate-700 dark:text-slate-400 dark:ring-border-dark dark:hover:bg-white/5"
      >
        ↻
      </button>
    </div>
  );
}

function Toolbar({ onAdd }: { onAdd: (type: string) => void }) {
  return (
    <div className="sticky top-0 z-30 border-b border-border/80 bg-surface/80 backdrop-blur dark:border-border-dark/80 dark:bg-surface-dark/70">
      <div className="mx-auto flex max-w-[110rem] items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="grid h-7 w-7 place-items-center rounded-lg bg-primary-600 text-sm font-bold text-white shadow-sm"
          >
            P
          </span>
          <h1 className="text-[0.9375rem] font-semibold tracking-tight">Pulse</h1>
        </div>
        <div className="flex items-center gap-3">
          <AutoRefreshControls />
          <AddWidgetDrawer onAdd={onAdd} />
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mt-16 flex flex-col items-center justify-center text-center" style={{ gridColumn: "1 / -1" }}>
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-xl text-slate-400 ring-1 ring-border dark:bg-white/5 dark:ring-border-dark">
        ▦
      </div>
      <p className="mt-4 text-sm font-medium">Your dashboard is empty</p>
      <p className="mt-1 max-w-xs text-sm text-slate-500 dark:text-slate-400">
        Use <span className="font-medium text-slate-700 dark:text-slate-300">Add widget</span> to start
        assembling your workspace.
      </p>
    </div>
  );
}

export function Dashboard({ initialWidgets }: { initialWidgets: Widget[] }) {
  const [widgets, setWidgets] = useState(initialWidgets);
  const [configuring, setConfiguring] = useState<Widget | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [cols, setCols] = useState(1);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const update = () => setCols(columnCountForWidth(el.clientWidth));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const visible = orderedWidgets(widgets);
  const isEmpty = visible.length === 0;
  const activeWidget = activeId ? widgets.find((w) => w.id === activeId) ?? null : null;
  const cellWidth = gridRef.current ? gridRef.current.clientWidth / cols : ROW_UNIT_PX;

  async function onAdd(type: string) {
    const res = await fetch("/api/widgets", { method: "POST", body: JSON.stringify({ type }) });
    if (res.ok) setWidgets((w) => [...w, await res.json()]);
  }
  async function onRemove(id: string) {
    await fetch(`/api/widgets/${id}`, { method: "DELETE" });
    setWidgets((w) => w.filter((x) => x.id !== id));
  }
  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const next = applyDragEnd(widgets, e);
    if (next) { setWidgets(next); void persistPositions(next); }
  }
  function onResize(id: string, colSpan: number, rowSpan: number) {
    const next = applyResize(widgets, id, colSpan, rowSpan);
    setWidgets(next);
    void persistPositions(next);
  }
  function onConfigSaved(id: string, config: Record<string, unknown>, title: string | null) {
    setWidgets((ws) => ws.map((w) => (w.id === id ? { ...w, config, title } : w)));
  }

  return (
    <>
      <Toolbar onAdd={onAdd} />
      <main className="mx-auto max-w-[110rem] px-4 py-6 sm:px-6 lg:px-8">
        <div ref={gridRef} className="wd-grid" style={{ ["--wd-cols" as string]: cols, ["--wd-row-unit" as string]: `${ROW_UNIT_PX}px` }}>
          {isEmpty ? (
            <EmptyState />
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
              onDragEnd={onDragEnd}
              onDragCancel={() => setActiveId(null)}
            >
              <SortableContext items={visible.map((w) => w.id)} strategy={rectSortingStrategy}>
                {visible.map((w) => (
                  <SortableCard
                    key={w.id}
                    widget={w}
                    cols={cols}
                    cellWidth={cellWidth}
                    onRemove={onRemove}
                    onConfigure={setConfiguring}
                    onResize={onResize}
                  />
                ))}
              </SortableContext>
              <DragOverlay>
                {activeWidget ? (
                  <div className="cursor-grabbing rounded-xl shadow-2xl ring-1 ring-black/5 dark:ring-white/10">
                    <WidgetCard widget={activeWidget} />
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          )}
        </div>
      </main>
      {configuring && (
        <ConfigureDialog
          widget={configuring}
          onClose={() => setConfiguring(null)}
          onSaved={onConfigSaved}
        />
      )}
    </>
  );
}
```

Note: `EmptyState` sits inside the grid container so the `ResizeObserver` always has a stable node to measure.

- [ ] **Step 2: Update `sortable-card.tsx` for grid spans + resize handle**

Replace the file. The card now sets `grid-column`/`grid-row` spans (colSpan clamped to `cols`) and renders a `ResizeHandle` (built in Task 9) wired to `onResize`.

```tsx
"use client";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Widget } from "@/server/config-repo";
import { clampSpan, ROW_UNIT_PX } from "@/lib/grid";
import { WidgetCard } from "./widget-card";
import { ResizeHandle } from "./resize-handle";

export function SortableCard({
  widget, cols, cellWidth, onRemove, onConfigure, onResize,
}: {
  widget: Widget;
  cols: number;
  cellWidth: number;
  onRemove: (id: string) => void;
  onConfigure: (w: Widget) => void;
  onResize: (id: string, colSpan: number, rowSpan: number) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: widget.id });
  const colSpan = clampSpan(widget.colSpan, cols);
  const style = {
    transform: isDragging ? undefined : CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    gridColumn: `span ${colSpan}`,
    gridRow: `span ${widget.rowSpan}`,
  };
  return (
    <div ref={setNodeRef} style={style} className="relative min-h-0">
      <WidgetCard
        widget={widget}
        onRemove={onRemove}
        onConfigure={onConfigure}
        dragHandle={{ setRef: setActivatorNodeRef, attributes, listeners }}
      />
      <ResizeHandle
        colSpan={colSpan}
        rowSpan={widget.rowSpan}
        cellWidth={cellWidth}
        rowUnit={ROW_UNIT_PX}
        maxCols={cols}
        onCommit={(c, r) => onResize(widget.id, c, r)}
      />
    </div>
  );
}
```

- [ ] **Step 3: Verify types compile (ResizeHandle missing until Task 9)**

Run: `npx tsc --noEmit`
Expected: the only remaining error is the missing `./resize-handle` module — resolved by Task 9. All span/`cols` types check.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard.tsx src/components/sortable-card.tsx
git commit -m "feat: ordered-flow grid dashboard with responsive column count"
```

---

## Task 9: Resize handle

A corner handle driven by raw pointer events. It tracks the pointer delta, converts it to whole-cell spans via `spanFromDelta`, shows a live preview by writing spans on the parent grid item during the drag, and commits on pointer-up.

**Files:**
- Create: `src/components/resize-handle.tsx`

- [ ] **Step 1: Implement the handle**

```tsx
"use client";
import { useRef } from "react";
import { clampSpan, spanFromDelta } from "@/lib/grid";

export function ResizeHandle({
  colSpan, rowSpan, cellWidth, rowUnit, maxCols, onCommit,
}: {
  colSpan: number;
  rowSpan: number;
  cellWidth: number;
  rowUnit: number;
  maxCols: number;
  onCommit: (colSpan: number, rowSpan: number) => void;
}) {
  const state = useRef<{ x: number; y: number; c: number; r: number } | null>(null);

  function gridItem(el: HTMLElement | null): HTMLElement | null {
    return el?.parentElement ?? null; // the SortableCard wrapper div
  }

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    state.current = { x: e.clientX, y: e.clientY, c: colSpan, r: rowSpan };
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const s = state.current;
    if (!s) return;
    const c = clampSpan(spanFromDelta(s.c, e.clientX - s.x, cellWidth), maxCols);
    const r = spanFromDelta(s.r, e.clientY - s.y, rowUnit);
    const item = gridItem(e.currentTarget.parentElement);
    if (item) {
      item.style.gridColumn = `span ${c}`;
      item.style.gridRow = `span ${r}`;
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    const s = state.current;
    state.current = null;
    if (!s) return;
    const c = clampSpan(spanFromDelta(s.c, e.clientX - s.x, cellWidth), maxCols);
    const r = spanFromDelta(s.r, e.clientY - s.y, rowUnit);
    onCommit(c, r);
  }

  return (
    <button
      type="button"
      aria-label="Resize"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="absolute bottom-1 right-1 z-10 hidden h-4 w-4 cursor-se-resize touch-none place-items-center rounded text-slate-400 opacity-0 transition-opacity group-hover/card:grid group-hover/card:opacity-100 hover:text-slate-600 dark:hover:text-slate-200"
    >
      <span aria-hidden className="text-[0.7rem] leading-none">⇲</span>
    </button>
  );
}
```

Note: `WidgetShell`'s `<section>` carries `group/card`, so the handle reveals on card hover. The handle lives as a sibling of `WidgetCard` inside the `relative` wrapper, so `parentElement.parentElement` is the grid item whose spans we preview.

- [ ] **Step 2: Verify types + full suite compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/resize-handle.tsx
git commit -m "feat: pointer-driven module resize handle"
```

---

## Task 10: Page cleanup + full verification

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Drop `columnCount` plumbing from the page**

```tsx
import "@/modules/server";
import { getWidgets, addWidget } from "@/server/config-repo";
import { statusDefaultConfig } from "@/modules/core/manifest";
import { Dashboard } from "@/components/dashboard";
import "@/modules/client";

export const dynamic = "force-dynamic";

export default function Page() {
  let widgets = getWidgets();
  if (widgets.length === 0) {
    addWidget("core.status", statusDefaultConfig as Record<string, unknown>);
    widgets = getWidgets();
  }
  return <Dashboard initialWidgets={widgets} />;
}
```

- [ ] **Step 2: Grep for stale `columnCount` / `column` references**

Run: `grep -rn "columnCount\|\.column\b\|buildColumns\|reorderWidgets\|wd-cols\|from \"@/lib/layout\"" src/ tests/`
Expected: no matches (the only `--wd-cols` usage is the inline style in `dashboard.tsx`, which grep for `wd-cols` will show — confirm it's just that one line).

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: all tests PASS (grid, dashboard-logic, layout API, module registration, smoke).

- [ ] **Step 4: Typecheck, lint, build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all succeed.

- [ ] **Step 5: Manual smoke test**

Run: `npm run dev`, open the dashboard, and confirm:
- Widgets render in a grid that fills the window width.
- Dragging a title reorders widgets; the order survives a reload.
- Hovering a card shows the ⇲ handle; dragging it grows/shrinks the module in whole cells; the size survives a reload.
- A module whose content exceeds its box scrolls internally.
- Narrowing the window drops columns (9→6→3→1) and widgets wrap down; widening restores the exact arrangement.

- [ ] **Step 6: Commit**

```bash
git add src/app/page.tsx
git commit -m "chore: drop columnCount plumbing; grid layout complete"
```

---

## Self-Review Notes

- **Spec coverage:** ordered-flow + global `order` (Tasks 2–4), responsive column count 3→6→9 (Tasks 1, 8), full-width `1fr` grid (Task 7), drag-resize both dimensions (Tasks 1, 9), bounded scroll (Task 6), strict `grid-auto-flow: row` (Task 7), lossless reflow via width-independent order (Tasks 2, 8 — verified in Task 10 Step 5), migration flatten columns→order (Task 3), tests for reflow/clamp/reorder/resize math (Tasks 1, 2, 5). All covered.
- **`columnCount` pref:** intentionally removed end-to-end (schema had none; page + layout GET dropped in Tasks 5, 10). No orphan reads remain after Task 10 Step 2.
- **Type consistency:** `Widget` gains `colSpan`/`rowSpan` in Task 3; every consumer (`dashboard-logic`, `config-repo`, route, cards) uses those exact names. `persistPositions` payload `{id, order, colSpan, rowSpan}` matches the route body type and `setPositions` signature.
