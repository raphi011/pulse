# Design — Starred Drive files (extends the `gws` module)

**Date:** 2026-07-10
**Depends on:** the existing `gws` module (`src/modules/gws/`, Gmail + Calendar + Chat) — the `gwsJson()`
plumbing, `gws` CLI, and auth are reused verbatim.
**Prev designs:** `2026-07-09-work-dashboard-design.md` (overall product),
`2026-07-10-work-dashboard-gws-chat-design.md` (multi-widget extension of `gws`).

Adds **one new read-only widget type inside the existing `gws` module** — `gws.drive` — listing the
user's **starred** Google Drive files (all types), most-recently-modified first, each opening in a new
tab. No new module, CLI, dependency, or auth flow.

---

## Goals

- **`gws.drive` — Starred files.** Show every starred Drive file as a scannable list: type icon ·
  name (links out) · modified date. See what you've starred at a glance and jump into it.
- Category **filter toggles** (Docs / Sheets / Slides / Other), all **on by default**, applied
  **client-side** from cached data so toggling is instant.
- Reuse the `gws` plumbing unchanged, proving it generalizes to Drive.

## Non-Goals (deliberately deferred)

- **Any write action** — no starring/unstarring, renaming, moving, deleting. Read-only + link-out,
  matching every existing widget.
- **Non-starred views** (shared-with-me, recent, search-by-query). Starred only.
- **Nested icons / thumbnails / previews.** The API `iconLink` (Google's per-type glyph) is enough.
- **Server-side category filtering.** Rejected in favor of client-side (see Decisions).
- Any change to the cache-first data flow, drag/reorder, refresh, config UI, or schema-form.

---

## API facts (verified live against the installed, authenticated `gws` CLI, 2026-07-10)

- **Command is `gws drive files list`** — the service is `drive`, *not* `files`
  (`gws files list` → `400 Unknown service 'files'`).
- Request used:
  ```
  gws drive files list --params '{
    "q":"starred=true",
    "orderBy":"modifiedTime desc",
    "pageSize":<limit>,
    "fields":"files(id,name,mimeType,modifiedTime,webViewLink,iconLink)"
  }'
  ```
- Response shape (confirmed):
  ```json
  {
    "files": [
      {
        "id": "1p_hGD9…",
        "name": "RFC: In-house Technical Overdraft Recognition",
        "mimeType": "application/vnd.google-apps.document",
        "modifiedTime": "2026-07-10T08:10:57.082Z",
        "webViewLink": "https://docs.google.com/document/d/1p_hGD9…/edit?usp=drivesdk",
        "iconLink": "https://drive-thirdparty.googleusercontent.com/16/type/application/vnd.google-apps.document"
      }
    ]
  }
  ```
- `iconLink` is Google's official per-type icon. The `/16/` segment is a pixel size; requesting
  `/32/` yields a crisper icon for retina (render at `h-4 w-4`). Present for the file types observed
  (Docs, Sheets); treated as optional (`""` fallback) for safety.
- Errors surface via the standard `gws` payload model (`{ "error": { code, message, reason } }` on
  stdout), already handled by `gwsJson`/`runJsonCli`.

---

## Decisions (resolved during brainstorming)

- **Placement:** a new widget type in the **existing `gws` module**, not a separate `drive` module —
  Drive is Google Workspace and shares the `gws` CLI + auth; a separate module would duplicate the
  `gwsJson` plumbing for no gain (same rationale as the Chat extension).
- **Fetch all starred, filter client-side.** `fetch()` always pulls *all* starred files (one call,
  `q=starred=true`) and caches them. The widget applies the category toggles to cached data, so
  toggling a category is instant and requires no refetch — true to the cache-first design. Config
  never changes what is fetched. (Server-side `q` mimeType clauses were rejected: more complex, forces
  a refetch per toggle, no upside for the small starred set.)
- **Four category buckets:** `docs` / `sheets` / `slides` / `other`. `mimeType` maps
  `…google-apps.document`→docs, `…google-apps.spreadsheet`→sheets, `…google-apps.presentation`→slides,
  **everything else**→other (PDFs, folders, uploads, Forms, Drawings, …).
- **Icons via `iconLink`, no icon library.** Existing widgets use no icon dependency; `iconLink` gives
  authoritative per-type Google glyphs for free. Neutral dot fallback when `iconLink` is `""`.
- **Sort:** `orderBy=modifiedTime desc` (most recently edited first).

---

## Architecture

### Files — extend `src/modules/gws/`

```
manifest.ts             # ADD: DRIVE_TYPE = "gws.drive", driveConfigSchema + driveDefaultConfig,
                        #   DriveCategory / DriveFileItem / DriveData types.
drive.ts                # NEW server-only: fetchDrive(cfg) — one gws drive files list call,
                        #   normalizes rows + buckets mimeType → category. Built on gwsJson<T>().
widgets/drive-widget.tsx # NEW "use client" body (WidgetBodyProps<DriveData, DriveConfig>),
                        #   client-side category filter + list UI.
server.ts               # ADD one registerServerWidget({...}) call.
client.ts               # ADD one registerClientWidget({...}) call (title "Starred files").
```

**Reused unchanged:** `gwsJson`/`runJsonCli`/`CliError`, the cache-first data flow, refresh
(manual/interval/post-config-save), the config UI + `schema-form`, the per-widget title override, and
every `WidgetShell` state. No barrel edits — `gws/server.ts` and `gws/client.ts` are already imported
by `src/modules/{server,client}.ts`.

### Config schema (auto-renders via `schema-form`)

```ts
export const driveConfigSchema = z.object({
  showDocs:   z.boolean().default(true).describe("Show Docs"),
  showSheets: z.boolean().default(true).describe("Show Sheets"),
  showSlides: z.boolean().default(true).describe("Show Slides"),
  showOther:  z.boolean().default(true).describe("Show other files"),
  limit:      z.number().int().min(1).max(100).default(25).describe("Max files"),
});
export type DriveConfig = z.infer<typeof driveConfigSchema>;
export const driveDefaultConfig: DriveConfig = {
  showDocs: true, showSheets: true, showSlides: true, showOther: true, limit: 25,
};
```
All four toggles render as booleans; `limit` as a number field — all supported field kinds.

### Data shapes

```ts
export type DriveCategory = "docs" | "sheets" | "slides" | "other";
export type DriveFileItem = {
  id: string;
  name: string;
  category: DriveCategory;
  modifiedTime: string; // ISO ("" if unknown)
  url: string;          // webViewLink
  iconLink: string;     // Google per-type icon URL ("" if missing)
};
export type DriveData = { files: DriveFileItem[] }; // ALL starred (unfiltered); widget filters
```

### Fetch (`drive.ts`)

Single call — no N+1, so no `Promise.allSettled` needed (simpler than Gmail).

```ts
export async function fetchDrive(config: DriveConfig): Promise<DriveData> {
  const resp = await gwsJson<{ files?: RawFile[] }>([
    "drive", "files", "list",
    "--params", JSON.stringify({
      q: "starred=true",
      orderBy: "modifiedTime desc",
      pageSize: config.limit,
      fields: "files(id,name,mimeType,modifiedTime,webViewLink,iconLink)",
    }),
  ]);
  return { files: (resp.files ?? []).map(normalizeFile) };
}
```

`normalizeFile` maps `mimeType → category` (the four-bucket rule above; unknown → `"other"`), copies
`webViewLink → url`, defaults missing `iconLink`/`modifiedTime` to `""`. `pageSize` uses `config.limit`
(fetch bound); category toggles do **not** touch the fetch.

### Widget (`drive-widget.tsx`)

Mirrors the Gmail widget's row rhythm.

- **Client-side filter:** map each category to its toggle
  (`{ docs: showDocs, sheets: showSheets, slides: showSlides, other: showOther }`) and
  `data.files.filter(f => enabled[f.category])`.
- **Row:** `[icon]  name (link)  ·  modified date`
  - **icon:** `<img src={iconLink} className="h-4 w-4 shrink-0" alt="">` (swap `/16/`→`/32/` in the
    URL for crispness); when `iconLink === ""`, render the neutral `h-2 w-2 rounded-full bg-slate-300
    dark:bg-slate-600` dot (Gmail's dot idiom). One lint suppression if Next flags `<img>` over
    `next/image` — justified: local single-user app, matches existing plain-element widgets.
  - **name:** `<a href={url} target="_blank" rel="noreferrer">`, `truncate`, hover underline.
  - **date:** reuse Gmail's `shortDate()` logic (today → time, else month/day), right-aligned,
    `text-xs tabular-nums`, muted.
- **Empty states:** no starred files at all, *or* all filtered out by toggles → "No starred files."
  (matches Gmail's empty message). Distinguish copy only if trivial; otherwise one message.

### Data flow (unchanged, reused)

Widget mounts → `GET /api/widgets/:id/data` returns the cached row instantly → refresh (manual,
interval, or post-config-save) re-runs `fetch()` → writes `widget_cache` → returns fresh.
`getWidgetData` keeps the last-good payload on error; the UI shows a "stale" badge.

## Error handling

- **API/auth failures** flow through `gwsJson` → `runJsonCli`: embedded `401/403` → `kind:"auth"`
  ("Not authenticated — run `gws auth login`"); other embedded errors → `kind:"failed"`.
  `widget-service` keeps last-good and surfaces the message. Already wired.
- **No `Promise.allSettled` needed** — single list call; a failed call fails the whole fetch (correct,
  there's nothing partial to salvage).
- **Missing `iconLink`/`modifiedTime`** → `""`, handled by the dot fallback / empty date.
- **No starred files / everything toggled off** → `WidgetShell` empty state.

## Testing (TDD)

No network in tests. Sanitized fixture under `tests/fixtures/gws/drive/files-list.json` (recorded from
real output, names replaced with placeholders; include at least a Doc, a Sheet, a Slide, and one
"other" type e.g. a PDF or folder, plus one row missing `iconLink`).

1. **`fetchDrive()`** — mock `gwsJson`: assert `mimeType → category` bucketing incl. the `"other"`
   fallback, `url` = `webViewLink`, missing `iconLink`/`modifiedTime` → `""`, empty result →
   `{ files: [] }`, and that `pageSize` = `config.limit` is passed. (Category toggles are **not**
   exercised here — the fetch ignores them.)
2. **Widget filter** (optional, light) — the category→toggle filter drops the right rows; all-off →
   empty. Can be a small render test if it stays cheap; otherwise fold the mapping into a pure helper
   and unit-test that.
3. **Registration test** — `tests/modules/gws-registration.test.ts`: `gws.drive` resolves in the
   server *and* client registries (per-module convention).

`cli.ts`, the config PATCH, and `schema-form` introspection are already covered and need no new tests.

## Verification (definition of done)

- `npm run lint`, `tsc --noEmit`, `npm test` clean; `npm run build` succeeds.
- Prereq: `gws auth login` done.
- Live: add a **Starred files** widget → shows current starred Drive files, newest-modified first, each
  with its Google type icon and opening in a new tab on click (or the correct auth/error/empty state).
  Toggling a category off in config instantly hides that type without a refetch; toggles + title +
  `limit` persist across reload.

## Files touched

- **New:** `src/modules/gws/drive.ts`; `src/modules/gws/widgets/drive-widget.tsx`;
  `tests/fixtures/gws/drive/files-list.json`; `fetchDrive` test (+ registration-test addition).
- **Edited:** `src/modules/gws/manifest.ts`, `src/modules/gws/server.ts`,
  `src/modules/gws/client.ts` (module-internal wiring only).
