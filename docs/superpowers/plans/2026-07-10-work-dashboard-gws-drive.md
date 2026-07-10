# gws Drive (Starred files) Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `gws.drive` widget that lists the user's starred Google Drive files (all types), newest-modified first, with client-side category filter toggles and Google's per-type icons.

**Architecture:** A new read-only widget type inside the existing `gws` module — reuses `gwsJson()`, the `gws` CLI, and its auth verbatim (like `gws.gmail`/`gws.calendar`/`gws.chat*`). `fetchDrive()` makes one `gws drive files list` call and normalizes rows; the widget filters by category from cached data client-side (instant, no refetch). Pure helpers (`categorize`, `normalizeFile`, `filterDriveFiles`) hold the logic and are unit-tested; the CLI wiring is thin.

**Tech Stack:** Next.js (App Router) + React + TypeScript, Zod (config schema), Vitest + Testing Library, the `gws` CLI via `runJsonCli`.

**Spec:** `docs/superpowers/specs/2026-07-10-work-dashboard-gws-drive-design.md`

---

## File Structure

- **Modify** `src/modules/gws/manifest.ts` — add `DRIVE_TYPE`, `DriveCategory`/`DriveFileItem`/`DriveData` types, `driveConfigSchema` + `driveDefaultConfig`, and the pure `filterDriveFiles()` helper (shared by client + server, no runtime deps).
- **Create** `src/modules/gws/drive.ts` — server-only: `categorize()`, `normalizeFile()`, `fetchDrive()`.
- **Create** `src/modules/gws/widgets/drive-widget.tsx` — `"use client"` list body.
- **Modify** `src/modules/gws/server.ts` — register `DRIVE_TYPE` → `fetchDrive`.
- **Modify** `src/modules/gws/client.ts` — register `DRIVE_TYPE` → `DriveWidget`, title "Starred files".
- **Create** `tests/modules/gws-drive.test.ts` — unit tests for `categorize`, `normalizeFile`, `filterDriveFiles`.
- **Modify** `tests/modules/gws-registration.test.ts` — assert `gws.drive` resolves both sides.

---

## Task 1: Manifest — types, config schema, defaults

**Files:**
- Modify: `src/modules/gws/manifest.ts`

- [ ] **Step 1: Add the Drive type id, config schema, defaults, data shapes, and filter helper**

Append to the end of `src/modules/gws/manifest.ts` (the file already imports `z` from `"zod"` at the top — do not re-import):

```ts
// --- Drive (starred files) ---
export const DRIVE_TYPE = "gws.drive";

export const driveConfigSchema = z.object({
  showDocs: z.boolean().default(true).describe("Show Docs"),
  showSheets: z.boolean().default(true).describe("Show Sheets"),
  showSlides: z.boolean().default(true).describe("Show Slides"),
  showOther: z.boolean().default(true).describe("Show other files"),
  limit: z.number().int().min(1).max(100).default(25).describe("Max files"),
});
export type DriveConfig = z.infer<typeof driveConfigSchema>;
export const driveDefaultConfig: DriveConfig = {
  showDocs: true,
  showSheets: true,
  showSlides: true,
  showOther: true,
  limit: 25,
};

export type DriveCategory = "docs" | "sheets" | "slides" | "other";
export type DriveFileItem = {
  id: string;
  name: string;
  category: DriveCategory;
  modifiedTime: string; // ISO ("" if unknown)
  url: string; // webViewLink
  iconLink: string; // Google per-type icon URL ("" if missing)
};
export type DriveData = { files: DriveFileItem[] }; // ALL starred (unfiltered); the widget filters.

/** Drop files whose category toggle is off. Pure — safe to import from client or server. */
export function filterDriveFiles(files: DriveFileItem[], config: DriveConfig): DriveFileItem[] {
  const enabled: Record<DriveCategory, boolean> = {
    docs: config.showDocs,
    sheets: config.showSheets,
    slides: config.showSlides,
    other: config.showOther,
  };
  return files.filter((f) => enabled[f.category]);
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: PASS (no errors). This confirms the schema/types/helper compile before anything depends on them.

- [ ] **Step 3: Commit**

```bash
git add src/modules/gws/manifest.ts
git commit -m "feat(gws): add drive widget types, config schema, and filter helper"
```

---

## Task 2: `drive.ts` — categorize, normalizeFile, fetchDrive (TDD)

**Files:**
- Create: `src/modules/gws/drive.ts`
- Test: `tests/modules/gws-drive.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/modules/gws-drive.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { categorize, normalizeFile } from "@/modules/gws/drive";
import { filterDriveFiles, type DriveFileItem, type DriveConfig } from "@/modules/gws/manifest";

describe("categorize", () => {
  it("maps Google editor mime types to their buckets", () => {
    expect(categorize("application/vnd.google-apps.document")).toBe("docs");
    expect(categorize("application/vnd.google-apps.spreadsheet")).toBe("sheets");
    expect(categorize("application/vnd.google-apps.presentation")).toBe("slides");
  });
  it("buckets everything else as 'other'", () => {
    expect(categorize("application/pdf")).toBe("other");
    expect(categorize("application/vnd.google-apps.folder")).toBe("other");
    expect(categorize("")).toBe("other");
  });
});

describe("normalizeFile", () => {
  it("maps fields, categorizes, and copies webViewLink to url", () => {
    const item = normalizeFile({
      id: "1abc",
      name: "RFC: Overdraft",
      mimeType: "application/vnd.google-apps.document",
      modifiedTime: "2026-07-10T08:10:57.082Z",
      webViewLink: "https://docs.google.com/document/d/1abc/edit",
      iconLink: "https://drive-thirdparty.googleusercontent.com/16/type/application/vnd.google-apps.document",
    });
    expect(item).toEqual({
      id: "1abc",
      name: "RFC: Overdraft",
      category: "docs",
      modifiedTime: "2026-07-10T08:10:57.082Z",
      url: "https://docs.google.com/document/d/1abc/edit",
      iconLink: "https://drive-thirdparty.googleusercontent.com/16/type/application/vnd.google-apps.document",
    });
  });
  it("falls back for missing name, modifiedTime, url, and iconLink", () => {
    const item = normalizeFile({ id: "x", mimeType: "application/pdf" });
    expect(item).toEqual({
      id: "x",
      name: "(untitled)",
      category: "other",
      modifiedTime: "",
      url: "",
      iconLink: "",
    });
  });
});

describe("filterDriveFiles", () => {
  const files: DriveFileItem[] = (["docs", "sheets", "slides", "other"] as const).map((c, i) => ({
    id: String(i),
    name: c,
    category: c,
    modifiedTime: "",
    url: "",
    iconLink: "",
  }));
  const cfg = (over: Partial<DriveConfig>): DriveConfig => ({
    showDocs: true, showSheets: true, showSlides: true, showOther: true, limit: 25, ...over,
  });

  it("keeps all categories when every toggle is on", () => {
    expect(filterDriveFiles(files, cfg({}))).toHaveLength(4);
  });
  it("drops a category whose toggle is off", () => {
    const kept = filterDriveFiles(files, cfg({ showOther: false, showSheets: false }));
    expect(kept.map((f) => f.category)).toEqual(["docs", "slides"]);
  });
  it("returns nothing when all toggles are off", () => {
    expect(filterDriveFiles(files, cfg({ showDocs: false, showSheets: false, showSlides: false, showOther: false }))).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/modules/gws-drive.test.ts`
Expected: FAIL — `categorize`/`normalizeFile` not exported from `@/modules/gws/drive` (module doesn't exist yet). The `filterDriveFiles` block should already pass (defined in Task 1).

- [ ] **Step 3: Create `src/modules/gws/drive.ts`**

```ts
import "server-only";
import { gwsJson } from "./gws";
import type { DriveCategory, DriveFileItem, DriveData, DriveConfig } from "./manifest";

type RawFile = {
  id: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  webViewLink?: string;
  iconLink?: string;
};

/** Map a Drive mimeType to one of the four config buckets; unknown types → "other". */
export function categorize(mimeType: string): DriveCategory {
  switch (mimeType) {
    case "application/vnd.google-apps.document":
      return "docs";
    case "application/vnd.google-apps.spreadsheet":
      return "sheets";
    case "application/vnd.google-apps.presentation":
      return "slides";
    default:
      return "other";
  }
}

export function normalizeFile(raw: RawFile): DriveFileItem {
  return {
    id: raw.id,
    name: raw.name || "(untitled)",
    category: categorize(raw.mimeType ?? ""),
    modifiedTime: raw.modifiedTime ?? "",
    url: raw.webViewLink ?? "",
    iconLink: raw.iconLink ?? "",
  };
}

export async function fetchDrive(config: DriveConfig): Promise<DriveData> {
  const resp = await gwsJson<{ files?: RawFile[] }>([
    "drive",
    "files",
    "list",
    "--params",
    JSON.stringify({
      q: "starred=true",
      orderBy: "modifiedTime desc",
      pageSize: config.limit,
      fields: "files(id,name,mimeType,modifiedTime,webViewLink,iconLink)",
    }),
  ]);
  return { files: (resp.files ?? []).map(normalizeFile) };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/modules/gws-drive.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/modules/gws/drive.ts tests/modules/gws-drive.test.ts
git commit -m "feat(gws): add drive fetch + normalization helpers with tests"
```

---

## Task 3: Drive widget body

**Files:**
- Create: `src/modules/gws/widgets/drive-widget.tsx`

- [ ] **Step 1: Create the widget component**

Create `src/modules/gws/widgets/drive-widget.tsx`. The `shortDate` helper mirrors the one in `gmail-widget.tsx` (it is defined inline there, not exported — duplicating this 6-line helper is intentional and surgical; do not refactor the Gmail widget). The `<img>` uses the API `iconLink`, swapping the `/16/` size segment for `/32/` for a crisper glyph rendered at `h-4 w-4`:

```tsx
"use client";
import type { WidgetBodyProps } from "@/modules/contracts";
import { filterDriveFiles, type DriveData, type DriveConfig } from "../manifest";

function shortDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function DriveWidget({ data, config }: WidgetBodyProps<DriveData, DriveConfig>) {
  const files = filterDriveFiles(data.files, config);
  if (files.length === 0)
    return <p className="text-sm text-slate-500 dark:text-slate-400">No starred files.</p>;
  return (
    <ul className="divide-y divide-border dark:divide-border-dark">
      {files.map((f) => (
        <li key={f.id} className="flex items-center gap-2.5 py-2">
          {f.iconLink ? (
            // eslint-disable-next-line @next/next/no-img-element -- local single-user app; Google's static icon host, matches existing plain-element widgets
            <img src={f.iconLink.replace("/16/", "/32/")} alt="" className="h-4 w-4 shrink-0" />
          ) : (
            <span className="h-2 w-2 shrink-0 rounded-full bg-slate-300 dark:bg-slate-600" />
          )}
          <a href={f.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 hover:underline">
            <span className="block truncate text-sm">{f.name}</span>
          </a>
          <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">
            {shortDate(f.modifiedTime)}
          </span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: PASS. (The component is not yet registered, so nothing renders it — this step only confirms it compiles.)

- [ ] **Step 3: Commit**

```bash
git add src/modules/gws/widgets/drive-widget.tsx
git commit -m "feat(gws): add starred-files drive widget body"
```

---

## Task 4: Register the widget + registration test (TDD)

**Files:**
- Modify: `tests/modules/gws-registration.test.ts`
- Modify: `src/modules/gws/server.ts`
- Modify: `src/modules/gws/client.ts`

- [ ] **Step 1: Extend the registration test (failing)**

Edit `tests/modules/gws-registration.test.ts`. The file already imports and tests the gmail, calendar, and two chat types — leave all of that intact. Change the import line to add `DRIVE_TYPE` at the end:

```ts
import { GMAIL_TYPE, CALENDAR_TYPE, CHAT_DMS_TYPE, CHAT_CHANNELS_TYPE, DRIVE_TYPE } from "@/modules/gws/manifest";
```

Add `DRIVE_TYPE` to the end of the loop array:

```ts
    for (const t of [GMAIL_TYPE, CALENDAR_TYPE, CHAT_DMS_TYPE, CHAT_CHANNELS_TYPE, DRIVE_TYPE]) {
```

Add two assertions inside the `it(...)` body, after the existing `CHAT_CHANNELS_TYPE` defaultConfig assertion (the last line before the closing `});`):

```ts
    expect(getClientWidget(DRIVE_TYPE)!.title).toBe("Starred files");
    expect(getServerWidget(DRIVE_TYPE)!.defaultConfig).toMatchObject({
      showDocs: true, showSheets: true, showSlides: true, showOther: true, limit: 25,
    });
```

- [ ] **Step 2: Run the registration test to verify it fails**

Run: `npx vitest run tests/modules/gws-registration.test.ts`
Expected: FAIL — `getServerWidget(DRIVE_TYPE)` / `getClientWidget(DRIVE_TYPE)` return `undefined` (not registered yet).

- [ ] **Step 3: Register on the server side**

Edit `src/modules/gws/server.ts`. The file already registers gmail, calendar, and the two chat widgets — keep all of that. Make three additive changes: (a) add `DRIVE_TYPE` to the type-id line and `driveConfigSchema, driveDefaultConfig` to the manifest import; (b) add `import { fetchDrive } from "./drive";` after the existing chat import; (c) append one registration call at the end. The resulting file:

```ts
import "server-only";
import { registerServerWidget } from "@/modules/server-registry";
import {
  GMAIL_TYPE, CALENDAR_TYPE,
  CHAT_DMS_TYPE, CHAT_CHANNELS_TYPE, DRIVE_TYPE,
  gmailConfigSchema, gmailDefaultConfig,
  calendarConfigSchema, calendarDefaultConfig,
  chatDmsConfigSchema, chatDmsDefaultConfig,
  chatChannelsConfigSchema, chatChannelsDefaultConfig,
  driveConfigSchema, driveDefaultConfig,
} from "./manifest";
import { fetchGmail } from "./gmail";
import { fetchCalendar } from "./calendar";
import { fetchChatDms, fetchChatChannels } from "./chat";
import { fetchDrive } from "./drive";

registerServerWidget({
  type: GMAIL_TYPE, configSchema: gmailConfigSchema, defaultConfig: gmailDefaultConfig, fetch: fetchGmail,
});
registerServerWidget({
  type: CALENDAR_TYPE, configSchema: calendarConfigSchema, defaultConfig: calendarDefaultConfig, fetch: fetchCalendar,
});
registerServerWidget({
  type: CHAT_DMS_TYPE, configSchema: chatDmsConfigSchema, defaultConfig: chatDmsDefaultConfig, fetch: fetchChatDms,
});
registerServerWidget({
  type: CHAT_CHANNELS_TYPE, configSchema: chatChannelsConfigSchema, defaultConfig: chatChannelsDefaultConfig, fetch: fetchChatChannels,
});
registerServerWidget({
  type: DRIVE_TYPE, configSchema: driveConfigSchema, defaultConfig: driveDefaultConfig, fetch: fetchDrive,
});
```

- [ ] **Step 4: Register on the client side**

Edit `src/modules/gws/client.ts`. The file already registers gmail, calendar, and the two chat widgets — keep all of that. Make three additive changes: (a) add `DRIVE_TYPE` to the type-id line and `driveConfigSchema, driveDefaultConfig` to the manifest import; (b) add `import { DriveWidget } from "./widgets/drive-widget";` after the existing chat widget imports; (c) append one registration call at the end. The resulting file:

```ts
import { registerClientWidget } from "@/modules/client-registry";
import {
  GMAIL_TYPE, CALENDAR_TYPE, CHAT_DMS_TYPE, CHAT_CHANNELS_TYPE, DRIVE_TYPE,
  gmailConfigSchema, gmailDefaultConfig,
  calendarConfigSchema, calendarDefaultConfig,
  chatDmsConfigSchema, chatDmsDefaultConfig,
  chatChannelsConfigSchema, chatChannelsDefaultConfig,
  driveConfigSchema, driveDefaultConfig,
} from "./manifest";
import { GmailWidget } from "./widgets/gmail-widget";
import { CalendarWidget } from "./widgets/calendar-widget";
import { ChatDmsWidget } from "./widgets/chat-dms-widget";
import { ChatChannelsWidget } from "./widgets/chat-channels-widget";
import { DriveWidget } from "./widgets/drive-widget";

registerClientWidget({
  type: GMAIL_TYPE, title: "Gmail", Component: GmailWidget,
  configSchema: gmailConfigSchema, defaultConfig: gmailDefaultConfig,
});
registerClientWidget({
  type: CALENDAR_TYPE, title: "Calendar", Component: CalendarWidget,
  configSchema: calendarConfigSchema, defaultConfig: calendarDefaultConfig,
});
registerClientWidget({
  type: CHAT_DMS_TYPE, title: "Unread DMs", Component: ChatDmsWidget,
  configSchema: chatDmsConfigSchema, defaultConfig: chatDmsDefaultConfig,
});
registerClientWidget({
  type: CHAT_CHANNELS_TYPE, title: "Chat Channels", Component: ChatChannelsWidget,
  configSchema: chatChannelsConfigSchema, defaultConfig: chatChannelsDefaultConfig,
});
registerClientWidget({
  type: DRIVE_TYPE, title: "Starred files", Component: DriveWidget,
  configSchema: driveConfigSchema, defaultConfig: driveDefaultConfig,
});
```

- [ ] **Step 5: Run the registration test to verify it passes**

Run: `npx vitest run tests/modules/gws-registration.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/gws/server.ts src/modules/gws/client.ts tests/modules/gws-registration.test.ts
git commit -m "feat(gws): register gws.drive widget on both registries"
```

---

## Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — all tests, including `gws-drive.test.ts` and `gws-registration.test.ts`.

- [ ] **Step 2: Lint and type-check**

Run: `npm run lint && npx tsc --noEmit`
Expected: PASS — no errors and no `@next/next/no-img-element` warning (suppressed inline in the widget).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Live smoke test**

Prereq: `gws auth login` completed.

Run: `npm run dev`, then in the dashboard add a **Starred files** widget. Verify:
- It lists your starred Drive files, newest-modified first, each with its Google type icon.
- Clicking a row opens the file in a new tab.
- Toggling a category off in the widget config instantly hides that file type (no refetch/loading).
- The `limit`, toggles, and any title override persist across a page reload.
- With no auth, the widget shows the "Not authenticated — run `gws auth login`" state.

- [ ] **Step 5: Final commit (if any uncommitted cleanup)**

```bash
git status
# if clean, nothing to do; otherwise commit any leftover fixes:
git commit -am "chore(gws): drive widget verification fixes"
```

---

## Self-Review Notes

- **Spec coverage:** scope (all starred, four buckets) → Task 1 schema + Task 2 `categorize`; client-side filter → `filterDriveFiles` (Task 1) used in widget (Task 3); sort `modifiedTime desc` + `fields` + `q=starred=true` → Task 2 `fetchDrive`; `iconLink` icons + dot fallback + `shortDate` → Task 3; single-call error handling → inherited via `gwsJson`; tests (`categorize`/`normalizeFile`/`filterDriveFiles` + registration) → Tasks 2 & 4; verification (lint/tsc/test/build + live) → Task 5.
- **Type consistency:** `DriveConfig` keys (`showDocs`/`showSheets`/`showSlides`/`showOther`/`limit`), `DriveCategory` values (`docs`/`sheets`/`slides`/`other`), and `DriveFileItem` fields are identical across manifest, drive.ts, widget, tests, and registration.
- **Command correctness:** `gws drive files list` (service is `drive`, not `files`) — verified live in the spec.
