# Plugin Architecture Hardening — Design

**Date:** 2026-07-11
**Status:** Approved
**Scope:** Widget contract redesign + data-flow hardening + storage cleanup. Greenfield: no
migration/back-compat constraints; contracts change in one shot across all 5 modules.

## Problems (from architecture review)

1. **Refreshability is inferred, not declared.** A widget with `HeaderControls` loses the refresh
   button, fetchedAt, and (conceptually) refreshability — conflating "has a custom header button"
   with "is not refreshable". Non-refreshable widgets still auto-refresh every 5 minutes.
2. **Dead actions API.** `WidgetAction` / `FetchWidget.actions` / `runAction` exist in the contract
   but no module uses them; `WidgetCard` passes a silent no-op stub.
3. **Fetch/render contract drift.** `type`, `configSchema`, `defaultConfig` are duplicated across
   both registrations; consistency holds only by convention.
4. **Config never validated on read.** `def.fetch(widget.config)` passes raw stored JSON; schema is
   enforced only at create/PATCH, so schema evolution silently feeds stale shapes into `fetch()`.
5. **No payload guard.** Stale cached payloads (or any widget bug) throw inside `Body`, and with no
   ErrorBoundary a single widget crash takes down the whole dashboard.
6. **Data-as-config.** Bookmarks store user data in widget config: deleting the card deletes the
   data, the cache holds a duplicate, and the contract carries a staleness-warning comment instead
   of an API that prevents the race.
7. **Orphan `bookmarks` table** in `src/db/schema.ts` with zero references.

## Design

### 1. Contract: shared manifest, two-sided registration

`manifest.ts` stays runtime-dep-free and exports one manifest object per widget:

```ts
export interface WidgetManifest<Data = unknown, Config = unknown> {
  type: string;
  title: string;
  configSchema: ZodType<Config>;
  defaultConfig: Config;
  /** Default true. False = no refresh button, no fetchedAt, no auto-refresh. */
  refreshable?: boolean;
  /** Integration id; omit for always-available widgets. */
  integration?: string;
}
```

Both sides consume the same object, so shared fields cannot drift:

```ts
// fetch.ts
registerFetch(manifest, { fetch: fetchBookmarks });

// render.ts
registerRender(manifest, {
  Component: BookmarksWidget,
  icon: { Icon: FaRegBookmark, className: "…" }, // stays render-side: react-icons is a runtime dep
  count: (d) => d.bookmarks.length,
  HeaderControls: AddBookmarkButton,
  formEditable: false,
});
```

Registries stay two maps keyed by `manifest.type`; duplicate registration still throws. The
per-module registration test additionally asserts both registries hold the *same* manifest object
(reference equality).

**Deleted from the contract:** `WidgetAction`, `FetchWidget.actions`, `runAction`, `saveConfig`.
`WidgetBodyProps` becomes:

```ts
export interface WidgetBodyProps<Data = unknown, Config = unknown> {
  data: Data;
  config: Config;
  /** Force a re-fetch + re-cache (same as the header refresh button). */
  refresh: () => Promise<void>;
}
```

Config edits happen only through the Configure dialog. Widgets that mutate module data call the
module's own functions, then `refresh()`.

### 2. UI semantics

- `refreshable: false` (from the manifest) gates all of: the header refresh button, the fetchedAt
  timestamp, the 5-minute auto-refresh interval, and the global refresh-all nonce in
  `useWidgetData`. Internal `refresh()` keeps working (used after mutations).
- `HeaderControls` is **additive**: rendered next to the refresh button, never replacing it. A
  widget can have both.
- The add-widget drawer and integration gating are unchanged (they already read the render
  registry + integration statuses).

### 3. Local data pattern (bookmarks as reference)

User data lives in a **module-owned table**, not widget config:

- Use the existing `bookmarks` table (`id`, `title`, `url`, `icon?`, `order`).
- New `src/modules/bookmarks/repo.ts`: `listBookmarks()`, `addBookmark()`, `removeBookmark()`,
  via `getDb()` like other repos.
- `fetch()` reads the table; the result is cached in `widget_cache` like any widget — one uniform
  data path.
- Widget mutations are plain in-process calls: `await addBookmark(…); await refresh();`. There is
  no server boundary, so no RPC-shaped action API is needed.
- Bookmarks config becomes `{}` (`formEditable: false` stays). Data survives widget deletion;
  multiple bookmark cards share one list.

This is the blessed pattern for future local-data modules: module-owned table + repo functions +
`refresh()`.

### 4. Data-flow hardening

- **Config parse on read** (`widget-service.ts`): `configSchema.safeParse(widget.config)` before
  `fetch()`. Success → pass the parsed value (Zod `.default()`s backfill additive schema changes).
  Failure → cache an error row (`"Invalid config — open Configure"`, errorKind `failed`); the
  stored config is *not* overwritten, so user input (e.g. a JQL query) survives a breaking schema
  change and can be fixed in the dialog.
- **Per-card ErrorBoundary**: a class component wraps `Body` in `WidgetCard`. A throwing widget
  body renders the in-card error state; the rest of the dashboard keeps working.
- **Cache versioning**: a `CACHE_VERSION` constant in code, mirrored in `prefs`. On startup, a
  mismatch wipes `widget_cache` and updates the pref. Bumped manually whenever a payload shape
  changes. The cache is disposable by design (everything is re-fetchable).

### 5. Storage & migrations

Squash instead of evolving: delete the existing `drizzle/*.sql` files, regenerate a single
`0000_` baseline from the final schema (`widgets`, `prefs`, `widget_cache`, `bookmarks`), and
update the `include_str!` migration list in `src-tauri`. The local `dashboard.db` is deleted once;
the app recreates it on startup.

### 6. Testing

- Registration test per module: both registries resolve each type **and** share the manifest
  object.
- Bookmarks repo CRUD test (better-sqlite3 transport).
- widget-service: invalid stored config → error row, config untouched.
- Cache-version mismatch → `widget_cache` wiped, pref updated.
- ErrorBoundary: throwing `Body` → in-card error state, siblings unaffected.
- Existing widget/component tests updated for `{ data, config, refresh }` props, additive
  `HeaderControls`, and `refreshable` gating in `useWidgetData` / `WidgetShell`.

## Out of scope

- Per-widget refresh intervals / jittered auto-refresh (revisit if N simultaneous CLI spawns ever
  hurt).
- Wiring any replacement action API (deleted; plain function imports cover the need).
- Render-side re-validation of config (fetch-side validation is the single gate; the render side
  receives the stored config as-is).
