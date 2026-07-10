# Bookmarks Widget — Design

**Date:** 2026-07-10
**Status:** Approved (design)

## Summary

A simple link-bookmark widget for the work dashboard: a card holding the user's
favorite links (title + URL), managed **inline** in the widget body rather than
through the config panel. Add via a `+` button that replaces the (meaningless)
refresh button in the card header; remove per-row via a hover-revealed `×` with
an inline `Remove? ✓ ✕` confirm.

Unlike every existing module, this widget has **no external data source**: its
config *is* its data. It therefore needs a few small framework seams (below).

## Goals / Non-goals

**Goals**
- Store a list of bookmarks, each `{ title, url }`.
- Add / remove bookmarks inline, persisted to the `widgets.config` column.
- Show a favicon, title, and open the link in a new tab.

**Non-goals (YAGNI)**
- Drag-reordering rows.
- Editing an existing bookmark in place (remove + re-add covers it).
- Folders, tags, search, import from browser.

## Data shape & module

Module lives at `src/modules/bookmarks/`, following the manifest/server/client
split.

- **`manifest.ts`**
  - Type id: `"bookmarks.links"`.
  - `Bookmark = { title: string; url: string }`.
  - `bookmarksConfigSchema = z.object({ bookmarks: z.array(z.object({ title: z.string(), url: z.string() })).default([]) })`.
  - `BookmarksData = { bookmarks: Bookmark[] }`.
  - `bookmarksDefaultConfig = { bookmarks: [] }`.

- **`server.ts`**
  - `fetch(config) => ({ bookmarks: config.bookmarks })` — **identity**, no
    network, no CLI.
  - Registers into the server registry.

- **`client.ts`**
  - Registers `Component`, `HeaderControls`, `count: (d) => d.bookmarks.length`,
    `formEditable: false`, and a bookmark `icon` (react-icons `BrandMark`).
  - **No `integration`** — always available, like the `core` module.

- **`widgets/bookmarks-widget.tsx`**
  - The body (rows + inline remove) and the add-popover (used by
    `HeaderControls`).

Wiring: add imports to `src/modules/server.ts` and `src/modules/client.ts`.

## Framework seams

This widget breaks three shell assumptions (fetch-from-outside, refreshable,
config-form-editable). Each seam is minimal and — for the first two — reusable.

1. **`saveConfig` on the widget body props.**
   `WidgetBodyProps` gains `saveConfig(next: Config): Promise<void>`. Today the
   body receives `data / config / runAction` but cannot persist its own config.
   `WidgetCard` implements it: `PATCH /api/widgets/:id { config: next }`, then
   re-fetch (`?refresh=1`) and `qc.setQueryData(["widget", id], fresh)` — the
   exact pattern already used in `configure-dialog.tsx`. Both the body and
   `HeaderControls` receive it.

2. **Custom header action replacing refresh.**
   The refresh `<button>` is hardcoded in `WidgetShell`. Add an optional
   `headerAction?: ReactNode` prop; when present, `WidgetShell` renders it in the
   refresh slot **instead of** the built-in refresh button. `WidgetCard`
   computes it from an optional `ClientWidget.HeaderControls?: FC<WidgetBodyProps>`
   — rendering `<HeaderControls data config saveConfig />` and passing the result
   as `headerAction`.

3. **Opt out of the auto config-form.**
   The config is `{title,url}[]`, which `describeSchema` (`schema-form.tsx`)
   **throws** on (unsupported array item type). Opening "Configure" would crash.
   Add `ClientWidget.formEditable?: boolean` (default `true`). When `false`,
   `ConfigureDialog` renders only the always-present Title-override field and
   skips `<SchemaForm>`. This is a robustness fix any inline-managed widget needs;
   the fail-fast throw in `describeSchema` stays intact for genuine authoring
   mistakes.

## Interactions

**Rendering a row**
- Favicon: `https://www.google.com/s2/favicons?domain=<hostname>&sz=32` in an
  `<img>`; on error, hide the image and fall back to no icon. `<hostname>` is
  `new URL(url).hostname`.
- Title links to `url` with `target="_blank" rel="noopener noreferrer"`.
- Hover (via the existing `group/card` or a per-row `group`) reveals a `×`
  button. Clicking swaps that row into an inline `Remove? ✓ ✕` state
  (component-local `useState` for the pending-remove id). `✓` calls
  `saveConfig({ bookmarks: bookmarks.filter(b => b !== target) })`; `✕` cancels.

**Empty state**
- Identity fetch returns `{ bookmarks: [] }` (non-null), so `WidgetCard` treats
  it as `hasData` and renders the body. The body shows a subtle
  "No bookmarks yet — use +" line rather than the shell's generic empty state.

**Adding (the `+` header action)**
- `HeaderControls` renders a `+` icon button; clicking toggles a small popover
  anchored to it with Title and URL inputs and a Save button.
- On save: normalize the URL (prepend `https://` if it has no scheme), validate
  with the `URL()` constructor (show an inline error and keep the popover open if
  invalid), append `{ title, url }`, call `saveConfig`, then close the popover.

## Privacy note

Favicons come from Google's favicon service, so each bookmark's **hostname is
sent to Google** when a card renders. Acceptable for a local, single-user
dashboard; documented here so it's a conscious choice, not a surprise.

## Testing

- `fetch` returns config bookmarks unchanged (identity).
- URL normalize/validate helper: adds scheme when missing, rejects invalid input.
- Registration test (`tests/modules/bookmarks-registration.test.ts`): both
  registries resolve `bookmarks.links` (mirrors existing per-module tests).

## Files touched

New:
- `src/modules/bookmarks/{manifest,server,client}.ts`
- `src/modules/bookmarks/widgets/bookmarks-widget.tsx`
- `tests/modules/bookmarks-registration.test.ts`

Modified (seams):
- `src/modules/contracts.ts` — add `saveConfig` to `WidgetBodyProps`; add
  `HeaderControls?` and `formEditable?` to `ClientWidget`.
- `src/components/widget-shell.tsx` — `headerAction?` prop replacing refresh.
- `src/components/widget-card.tsx` — implement `saveConfig`; compute
  `headerAction` from `HeaderControls`.
- `src/components/configure-dialog.tsx` — skip `SchemaForm` when
  `formEditable === false`.
- `src/modules/server.ts`, `src/modules/client.ts` — register the module.
