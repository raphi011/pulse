# Per-Widget Accent Colors — Design

**Date:** 2026-07-11
**Status:** Approved

## Goal

Let the user assign an accent color to each widget *instance* for visual grouping/scanning. Widgets with no color assigned look exactly as they do today.

## Decisions (from brainstorming)

- **Scope:** per widget instance (not per module). Matches the existing `title` override pattern.
- **Visual treatment:** a ~3px colored bar along the card's left edge. No change to title text, ring, or header. Chosen over title+border tint (too loud/noisy across a grid) and dot/chip (too weak for scanning).
- **Color selection:** fixed preset palette of 8 curated swatches, not a free hex picker. Stored as a preset *name*, so the palette hues can be re-tuned later without touching stored data.
- **Storage:** new nullable column on the `widgets` table — a shell-level concern like `title`. Explicitly *not* inside the module-owned `config` JSON, which is Zod-validated against each manifest schema on every read.

## Data

- `widgets.accent: text | null`
  - `null` (default) = no accent, today's look.
  - Values: `"red" | "orange" | "amber" | "green" | "teal" | "blue" | "violet" | "pink"`.
  - Drizzle migration generated with `npm run db:generate`; runs in-app via the SQL plugin's migration runner on startup (nullable column ⇒ plain additive `ALTER TABLE`).

## Palette source of truth

One `ACCENTS` map (name → color values/classes tuned once for light *and* dark mode), shared by:

- the shell (bar color), and
- the configure dialog (swatch dots).

Lookup is defensive: an unknown or stale name degrades to *no accent* — it must never crash the card or the dialog.

## Rendering (`src/components/widget-shell.tsx`)

- `WidgetShell` gains an optional `accent?: string | null` prop; `WidgetCard` passes `widget.accent` through.
- When set (and known): a 3px vertical bar flush to the card's left edge (`absolute inset-y-0 left-0 w-[3px]`), inside the existing `overflow-hidden rounded-xl` section so corners stay clean.
- Bar spans full card height and is present in **all** states (loading / error / empty / ok).
- `accent = null` or unknown name ⇒ nothing rendered; DOM identical to today.

## Picker (`src/components/configure-dialog.tsx`)

- A "Color" row below the Title field: a "none" swatch (clears to `null`) plus the 8 preset dots; click to select, with a visible selected state and accessible labels (`aria-label` per color).
- Saved through the existing `updateWidget` path — `accent` travels alongside `title` in the update payload and in `onSaved`.
- `updateWidget` (repo/service layer) accepts and persists the new field; values outside the preset list are normalized to `null` at the service boundary (silently, no error).

## Error handling

- Unknown/stale accent name in the DB → renders as no accent (defensive `ACCENTS` lookup). No migration/backfill needed beyond the additive column.

## Testing

- **Shell:** accent name renders the bar; `null` renders nothing; unknown name renders nothing.
- **Repo/service:** `accent` persists through `updateWidget` and round-trips via `getWidgets`/`getWidget`; invalid value normalizes to `null`.
- **Dialog:** selecting a swatch and saving passes `accent` through the save path (covered by the service test plus a light component test if cheap).

## Out of scope

- Per-module default colors or module-level grouping.
- Free-form hex colors.
- Any other colored surfaces (header tint, title color, ring).
