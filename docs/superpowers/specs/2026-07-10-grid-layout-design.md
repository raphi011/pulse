# Grid Layout — Design

**Date:** 2026-07-10
**Status:** Approved for planning

Replace the column-masonry layout with a responsive **ordered-flow grid** where modules
can grow both horizontally and vertically (drag-resize), fill the full viewport width, and
reflow losslessly as the window resizes.

> **Supersedes a prior non-goal.** The original work-dashboard spec
> (`2026-07-09-work-dashboard-design.md`) listed "free-form resizable grid" as a non-goal
> "in favor of column masonry." This design intentionally reverses that decision.

## Goals

- Modules can **grow horizontally** (wide lists get more room) and **vertically**, via
  drag-resize handles.
- The grid **uses the full viewport width** and adds columns as the window widens.
- Resizing the browser is **lossless**: narrowing then widening restores the exact
  arrangement, with no per-breakpoint layout storage.

## Non-Goals

- Free 2D placement with arbitrary `(x, y)` and intentional empty cells (the
  react-grid-layout model). Rejected in favor of ordered flow — see Approach below.
- Per-breakpoint stored layouts. Not needed; the model is lossless by construction.
- Multi-user / responsive design beyond the single-user desktop-first case (mobile still
  collapses to 1 column).

## Approach: ordered-flow grid

The single source of truth is a **global, width-independent `order`** per widget. Widgets
flow in `order` into however many columns currently fit; when the window widens and columns
are added, widgets that were wrapping onto later rows slide **up and to the right** into the
freed space; narrowing wraps them back down. Because `order` and the per-widget spans never
change on resize, round-trips are lossless with **nothing to cache**.

This was chosen over two alternatives surfaced during research
([react-grid-layout](https://github.com/react-grid-layout/react-grid-layout),
[gridstack.js](https://github.com/gridstack/gridstack.js)):

- **react-grid-layout** stays lossless by storing an independent layout *per breakpoint*.
  Rejected: N layouts to manage; a change at one width doesn't propagate to others.
- **gridstack** keeps one canonical (widest) layout and *caches* it to restore on column
  change. Rejected: caching/restore machinery we don't need if the source of truth is
  already width-independent.

Making `order` width-independent achieves gridstack's losslessness without the cache, and is
the natural evolution of the current `column`+`order` model.

## Data model

`widgets` table (Drizzle + better-sqlite3):

| field | change | notes |
|-------|--------|-------|
| `order` | **repurpose** | now a *global* `0..N-1` flow sequence (was per-column) |
| `colSpan` | **new** `integer` default `1` | width in column units |
| `rowSpan` | **new** `integer` default `6` | height in row units |
| `column` | **drop** | replaced by `order` + spans |

**Migration** (Drizzle): add `col_span`, `row_span`; recompute a global `order` by
flattening today's widgets read **columns left→right, `order` top→bottom** (preserves the
current arrangement roughly intact); drop `column`. `colSpan=1`, `rowSpan=`default for all.

## Grid + responsive column count

- CSS Grid on the container:
  `grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); grid-auto-rows: var(--row-unit); gap: 1rem;`
  Columns always stretch to fill the viewport (`1fr`).
- **`grid-auto-flow: row`** (strict order — see Packing).
- A `ResizeObserver` on the container computes
  `--cols = clamp(floor(width / COL_UNIT_PX), 1, MAX_COLS)`, giving **3 → 6 → 9** columns
  across desktop widths (`COL_UNIT_PX ≈ 300`). Mobile/tablet still collapse toward 1.
- `colSpan` is **clamped to the current `--cols`** at render (a "3-wide" module can't exceed
  the columns available on a narrow screen).
- `COL_UNIT_PX` / `MAX_COLS` are a single config knob; changing 3→6→9 into any other scheme
  is a one-line change and touches nothing in the data model or reflow logic.

### Constants (initial, tunable)

- `COL_UNIT_PX ≈ 300` (target physical column width)
- `--row-unit ≈ 40px`, default `rowSpan = 6` (~240px starting card height)

## Bounded height + scroll

Modules no longer grow with content. Each card fills its `rowSpan × row-unit` box:

- Card `<section>` becomes a fixed-height flex column (`h-full`, height from the grid cell).
- Header stays fixed; the body (`WidgetShell`'s content `<div>`) gets `min-h-0 overflow-y-auto`.
- This is the one change to `WidgetShell`; widget bodies are unaffected.

## Drag interactions

- **Reorder** — existing dnd-kit sortable, moved to a **single flat `SortableContext`** using
  `rectSortingStrategy` (grid-aware) instead of the per-column `verticalListSortingStrategy`.
  A drop rewrites the global `order`. The per-column droppable / `col:N` collision logic in
  `dashboard.tsx` is removed.
- **Resize** — **net-new**, not dnd-kit (it has no resize). A corner handle on each card uses
  raw pointer events; the drag delta snaps to whole `colSpan` / `rowSpan` units, with an
  optimistic update and persist.
- **Persist** — `PATCH /api/layout` payload becomes `{ id, order, colSpan, rowSpan }[]`.

## Packing: strict order

`grid-auto-flow: row` (**not** `dense`). `order` is always visually respected; a tall module
may leave a gap beside or below it. Chosen over `dense` (which backfills gaps but lets a later
module jump visually ahead of an earlier one, breaking the meaning of `order` and
drag-reorder intuition). Occasional gaps are acceptable.

## Testing

Pure functions, covered with Vitest:

- Migration flatten: `(column, order)[] → global order`.
- Reorder: drop position → new global `order` sequence.
- `colSpan` clamp to current `--cols`.
- Column-count computation from container width.

Existing module registration tests are unaffected.

## Out of scope / follow-ups

- Snap-to-fill or masonry-style gap elimination (would require `dense` or a packing pass).
- Saving multiple named layouts.
