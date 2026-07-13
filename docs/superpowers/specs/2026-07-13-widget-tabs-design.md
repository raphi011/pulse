# Widget Tabs (Tab Groups) — Design

**Date:** 2026-07-13
**Status:** Approved

## Goal

Organize widgets into named tabs shown at the top of the dashboard. Each tab is a
separate board that owns its own widgets; switching tabs swaps the whole grid to
that tab's widgets. A widget lives on exactly one tab.

## Decisions (from brainstorming)

- **Model:** tabs = separate boards (not saved filters, not scroll anchors). A
  widget belongs to exactly one tab.
- **Management in scope:** create, rename, delete, reorder tabs; move a widget
  between tabs. **Out:** per-tab icon/color.
- **Move widget → tab:** *both* mechanisms — (a) card menu "Move to tab…" submenu,
  and (b) drag a widget card onto a tab in the strip.
- **Delete tab:** confirmation dialog, then delete the tab **and its widgets**. The
  **last remaining tab cannot be deleted** (there is always ≥1 tab).
- **New widgets** are added to the currently-active tab.

## Data

- **New `tabs` table** (`src/db/schema.ts`):
  - `id: text` (pk)
  - `name: text` not null
  - `order: integer` not null default 0 — tab strip order.
- **New column `widgets.tabId: text`** not null — each widget's owning tab.
- **Migration** (`npm run db:generate`, then wire the generated SQL into
  `src-tauri` migrations like the others). The migration is a fixed SQL script:
  1. `CREATE TABLE tabs …`
  2. Insert one default tab with the **fixed id `'default'`**, name `"Dashboard"`,
     order `0`.
  3. `ALTER TABLE widgets ADD COLUMN tab_id text NOT NULL DEFAULT 'default'`.

  Using a fixed id (rather than a generated uuid) lets the pure-SQL migration
  backfill every existing widget to the default tab with no app-side code. New
  tabs created at runtime get `crypto.randomUUID()` ids.
- **Active tab** persisted in `prefs` under key `ui.activeTab` (value = tab id).
  On load, fall back to the first tab (lowest `order`) when the key is missing or
  points at a deleted tab.

## Loading & rendering

- Loading stays **cache-first and unchanged**: still load all widgets once
  (`getWidgets`) plus the tab list. The grid renders only the **active tab's**
  widgets (filtered in-component by `tabId`).
- `widgets.order` stays **global**. Within a tab we render that tab's widgets
  sorted by `order`; gaps across tabs are irrelevant. Reordering/resizing within a
  tab persists positions exactly as today.

## Repo layer (`src/server/config-repo.ts`, or new `src/server/tabs-repo.ts`)

New async functions (all through `getDb()`), following existing repo style:

- `getTabs(): Tab[]` — ordered by `order`.
- `addTab(name): Tab` — new uuid id, `order` = max+1.
- `renameTab(id, name): void`.
- `deleteTab(id): void` — batch: delete the tab's widgets **and** the tab row in
  one `db.batch([...])` (atomic; caller guarantees it is not the last tab).
- `setTabOrder(orders: {id, order}[]): void` — batch update.
- `addWidget(type, config, tabId)` — extend the existing signature to assign the
  new widget to `tabId`.
- Active-tab helpers reuse existing `getPref`/`setPref` (`ui.activeTab`).

## Data-access layer (`src/lib/dashboard-data.ts`)

Thin async wrappers exposed to React (matching existing ones): `getTabs`,
`createTab`, `renameTab`, `deleteTab`, `reorderTabs`, `setActiveTab`,
`moveWidgetToTab(widgetId, tabId)` (updates `widgets.tabId`). `createWidget` gains
a `tabId` argument.

## UI — tab bar (`src/components/tab-bar.tsx`, new)

- Rendered on the **left of the existing sticky toolbar row** in `dashboard.tsx`;
  auto-refresh / integrations / add-widget controls stay right. One clean row.
- **Underline-style tabs:** active = `primary-600` text with an underline
  indicator; inactive = slate with a hover background. Matches existing palette,
  radii, and dark-mode conventions; visually distinct from the pill buttons on the
  right so it reads as a real tab strip.
- **`+` button** at the end of the strip creates a tab ("New tab", switches to it,
  focuses inline rename).
- **Rename:** double-click a tab name → inline editable text; Enter/blur commits,
  Escape cancels.
- **Delete:** a small caret/menu on the active tab → "Delete tab" → confirmation
  dialog. No reusable confirm component exists today, so add a small modal modeled
  on `configure-dialog.tsx`'s overlay pattern (`role="dialog"`, backdrop, Cancel /
  Delete). Hidden/disabled when only one tab remains.

## Interactions & drag (`src/components/dashboard.tsx`, `dashboard-logic.ts`)

Dragging a card onto a tab requires the tab strip and the widget grid to share
**one `DndContext`** at the dashboard level (today the grid has its own). The
existing `onDragEnd` in `dashboard-logic.ts` becomes a branch on the dragged
item's type (carried via dnd-kit `data.current.type`):

- **`widget` over `widget`** → reorder widgets (existing `applyDragEnd`).
- **`tab` over `tab`** → reorder tabs (dnd-kit horizontal sortable; persist via
  `setTabOrder`).
- **`widget` over `tab`** → move the widget to that tab (`moveWidgetToTab`), then
  it disappears from the current grid.

Card menu (`src/components/card-menu.tsx`) gains a **"Move to tab…"** submenu
listing the other tabs; selecting one calls `moveWidgetToTab` and the card leaves
the active grid.

## Error handling

- `ui.activeTab` missing or pointing at a deleted tab → fall back to first tab.
- A widget whose `tabId` matches no existing tab (should not happen given cascade
  delete) → treated as belonging to no visible tab; not rendered, never crashes.
- Delete is guarded so the **last tab can never be removed**.

## Testing

- **Repo/tabs:** create/rename/delete/reorder round-trip via `getTabs`;
  `deleteTab` removes the tab and its widgets atomically; `addWidget` assigns
  `tabId`; `moveWidgetToTab` updates the column.
- **Migration/data:** existing widgets backfill to the `'default'` tab.
- **Dashboard logic:** `onDragEnd` branches correctly for widget-reorder,
  tab-reorder, and widget-onto-tab; grid filters to the active tab.
- **Component (light):** active-tab switching renders the right widget subset;
  last-tab delete is disabled.

## Out of scope

- Per-tab icon or accent color.
- Widgets appearing on multiple tabs; cross-tab shared layouts.
- Reassigning `order` to be per-tab (stays global).
