# gws Next-Meeting Countdown Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `gws.nextMeeting` widget to the existing gws module: a live client-side countdown to the next real meeting today, with in-meeting awareness and a Join button.

**Architecture:** New widget inside `src/modules/gws/` following the module's manifest/fetch/render split. The fetch returns the list of remaining qualifying meetings today (`[now, local midnight)`); the widget derives current/next client-side on a 1 s tick, so no re-fetch is needed as time passes. Spec: `docs/superpowers/specs/2026-07-12-gws-next-meeting-widget-design.md`.

**Tech Stack:** TypeScript, React 19, Zod, Tailwind v4, Vitest + Testing Library. CLI fetch via the existing `gwsJson` wrapper.

## Global Constraints

- Commit messages: plain conventional style, **no Jira prefix** (e.g. `feat: add next-meeting widget`).
- `src/modules/gws/manifest.ts` must have **no runtime deps** beyond `zod` and `@/modules/contracts` (pure helpers are fine — see `filterDriveFiles` precedent).
- Feature-flag-style toggles default to **disabled** → `includeSoloEvents` defaults to `false`.
- Run single test files with `npx vitest run <path>`; full suite `npm test`; lint `npm run lint`.
- Match existing gws module patterns exactly; keep changes surgical.
- Do not touch unrelated dirty files in the working tree (`src/components/widget-shell.tsx`, `src/lib/accents.ts`, system module files, their tests) — commit only the files each task names.

---

### Task 1: Manifest — types, config schema, derivation helper

**Files:**
- Modify: `src/modules/gws/manifest.ts`
- Test: `tests/modules/gws-next-meeting.test.ts` (create)

**Interfaces:**
- Consumes: existing `defineManifest` from `@/modules/contracts`, `z` from zod.
- Produces (later tasks rely on these exact names):
  - `NEXT_MEETING_TYPE = "gws.nextMeeting"` (const string)
  - `nextMeetingConfigSchema`, `type NextMeetingConfig = { calendarId: string; includeSoloEvents: boolean }`, `nextMeetingDefaultConfig`
  - `type MeetingItem = { id: string; title: string; start: string; end: string; meetUrl?: string; url: string }`
  - `type NextMeetingData = { meetings: MeetingItem[] }`
  - `deriveMeetingState(meetings: MeetingItem[], now: Date): { current: MeetingItem | null; next: MeetingItem | null }`
  - `nextMeetingManifest` (a `defineManifest` result, title `"Next meeting"`, integration `"gws"`)

- [ ] **Step 1: Write the failing test**

Create `tests/modules/gws-next-meeting.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  deriveMeetingState,
  nextMeetingConfigSchema,
  nextMeetingDefaultConfig,
  type MeetingItem,
} from "@/modules/gws/manifest";

const m = (id: string, start: string, end: string): MeetingItem => ({
  id,
  title: id,
  start,
  end,
  url: `https://cal/${id}`,
});

describe("deriveMeetingState", () => {
  const now = new Date("2026-07-12T10:00:00Z");

  it("picks the in-progress meeting as current and the following one as next", () => {
    const meetings = [
      m("standup", "2026-07-12T09:45:00Z", "2026-07-12T10:15:00Z"),
      m("review", "2026-07-12T10:30:00Z", "2026-07-12T11:00:00Z"),
    ];
    const { current, next } = deriveMeetingState(meetings, now);
    expect(current?.id).toBe("standup");
    expect(next?.id).toBe("review");
  });

  it("treats a meeting starting exactly now as current, not next", () => {
    const meetings = [m("kickoff", "2026-07-12T10:00:00Z", "2026-07-12T10:30:00Z")];
    const { current, next } = deriveMeetingState(meetings, now);
    expect(current?.id).toBe("kickoff");
    expect(next).toBeNull();
  });

  it("returns next only when nothing is in progress", () => {
    const meetings = [m("later", "2026-07-12T11:00:00Z", "2026-07-12T11:30:00Z")];
    const { current, next } = deriveMeetingState(meetings, now);
    expect(current).toBeNull();
    expect(next?.id).toBe("later");
  });

  it("returns nulls when every meeting has ended (stale cache falls to empty state)", () => {
    const meetings = [m("done", "2026-07-12T08:00:00Z", "2026-07-12T09:00:00Z")];
    expect(deriveMeetingState(meetings, now)).toEqual({ current: null, next: null });
  });
});

describe("nextMeetingConfigSchema", () => {
  it("defaults calendarId to primary and includeSoloEvents to false", () => {
    expect(nextMeetingConfigSchema.parse({})).toEqual(nextMeetingDefaultConfig);
    expect(nextMeetingDefaultConfig).toEqual({ calendarId: "primary", includeSoloEvents: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/gws-next-meeting.test.ts`
Expected: FAIL — `@/modules/gws/manifest` has no export named `deriveMeetingState` (module resolution/type error at import).

- [ ] **Step 3: Write minimal implementation**

In `src/modules/gws/manifest.ts`, add after the Tasks section (after `export type TasksData = { tasks: TaskItem[] };`, before the `defineManifest` block):

```ts
// --- Next meeting (countdown) ---
export const NEXT_MEETING_TYPE = "gws.nextMeeting";

export const nextMeetingConfigSchema = z.object({
  calendarId: z.string().default("primary").describe("Calendar ID"),
  includeSoloEvents: z
    .boolean()
    .default(false)
    .describe("Count solo events (no other attendees, no Meet link)"),
});
export type NextMeetingConfig = z.infer<typeof nextMeetingConfigSchema>;
export const nextMeetingDefaultConfig: NextMeetingConfig = {
  calendarId: "primary",
  includeSoloEvents: false,
};

export type MeetingItem = {
  id: string;
  title: string;
  start: string; // ISO datetime (timed events only — all-day is filtered out)
  end: string;
  meetUrl?: string;
  url: string; // htmlLink
};
/** All in-progress or not-yet-started qualifying meetings today, sorted by start. */
export type NextMeetingData = { meetings: MeetingItem[] };

/** Derive the running and upcoming meeting at `now`. Pure — safe to import from client or server. */
export function deriveMeetingState(
  meetings: MeetingItem[],
  now: Date,
): { current: MeetingItem | null; next: MeetingItem | null } {
  const t = now.getTime();
  const current =
    meetings.find((m) => new Date(m.start).getTime() <= t && t < new Date(m.end).getTime()) ?? null;
  const next = meetings.find((m) => new Date(m.start).getTime() > t) ?? null;
  return { current, next };
}
```

And add the manifest entry at the bottom, after `tasksManifest`:

```ts
export const nextMeetingManifest = defineManifest({
  type: NEXT_MEETING_TYPE, title: "Next meeting",
  configSchema: nextMeetingConfigSchema, defaultConfig: nextMeetingDefaultConfig,
  integration: "gws",
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/modules/gws-next-meeting.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/modules/gws/manifest.ts tests/modules/gws-next-meeting.test.ts
git commit -m "feat: gws next-meeting manifest + derivation helper"
```

---

### Task 2: Fetch — event filter + fetchNextMeeting

**Files:**
- Modify: `src/modules/gws/calendar.ts`
- Test: `tests/modules/gws-next-meeting.test.ts` (extend)

**Interfaces:**
- Consumes: `gwsJson` from `./gws`; `dayWindow` (already in `calendar.ts`); Task 1's `NextMeetingConfig`, `NextMeetingData`, `MeetingItem` from `./manifest`.
- Produces:
  - `isMeetingEvent(e: GEvent, includeSoloEvents: boolean): boolean` (exported for tests)
  - `normalizeMeeting(e: GEvent): MeetingItem` (exported for tests)
  - `fetchNextMeeting(config: NextMeetingConfig): Promise<NextMeetingData>`
  - `GEvent` gains optional `attendees?: { self?: boolean; responseStatus?: string }[]` and is exported.

Note: existing gws fetch tests cover only the pure helpers, never the `gwsJson` call (see `tests/modules/gws-gmail.test.ts`). Follow that pattern — test `isMeetingEvent` and `normalizeMeeting`, not `fetchNextMeeting` itself.

- [ ] **Step 1: Write the failing test**

Append to `tests/modules/gws-next-meeting.test.ts`:

```ts
import { isMeetingEvent, normalizeMeeting, type GEvent } from "@/modules/gws/calendar";

describe("isMeetingEvent", () => {
  const timed: GEvent = {
    id: "e1",
    summary: "1:1",
    start: { dateTime: "2026-07-12T10:00:00Z" },
    end: { dateTime: "2026-07-12T10:30:00Z" },
    attendees: [{ self: true, responseStatus: "accepted" }, { responseStatus: "accepted" }],
  };

  it("accepts a timed event with other attendees", () => {
    expect(isMeetingEvent(timed, false)).toBe(true);
  });

  it("rejects cancelled events", () => {
    expect(isMeetingEvent({ ...timed, status: "cancelled" }, false)).toBe(false);
  });

  it("rejects all-day events (date, not dateTime)", () => {
    expect(
      isMeetingEvent({ ...timed, start: { date: "2026-07-12" }, end: { date: "2026-07-13" } }, false),
    ).toBe(false);
  });

  it("rejects events I declined", () => {
    expect(
      isMeetingEvent(
        { ...timed, attendees: [{ self: true, responseStatus: "declined" }, {}] },
        false,
      ),
    ).toBe(false);
  });

  it("rejects solo events without a Meet link by default", () => {
    expect(isMeetingEvent({ ...timed, attendees: undefined }, false)).toBe(false);
    expect(isMeetingEvent({ ...timed, attendees: [{ self: true }] }, false)).toBe(false);
  });

  it("accepts solo events with a Meet link", () => {
    expect(
      isMeetingEvent({ ...timed, attendees: undefined, hangoutLink: "https://meet.google.com/x" }, false),
    ).toBe(true);
  });

  it("accepts solo events when includeSoloEvents is on", () => {
    expect(isMeetingEvent({ ...timed, attendees: undefined }, true)).toBe(true);
  });
});

describe("normalizeMeeting", () => {
  it("maps title, times, meet url, and html link with fallbacks", () => {
    const item = normalizeMeeting({
      id: "e9",
      summary: "Design review",
      htmlLink: "https://cal/e9",
      hangoutLink: "https://meet.google.com/abc",
      start: { dateTime: "2026-07-12T10:23:00Z" },
      end: { dateTime: "2026-07-12T10:53:00Z" },
    });
    expect(item).toEqual({
      id: "e9",
      title: "Design review",
      start: "2026-07-12T10:23:00Z",
      end: "2026-07-12T10:53:00Z",
      meetUrl: "https://meet.google.com/abc",
      url: "https://cal/e9",
    });
    expect(normalizeMeeting({ id: "x" })).toMatchObject({ title: "(no title)", start: "", end: "", url: "" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/gws-next-meeting.test.ts`
Expected: FAIL — `@/modules/gws/calendar` has no export named `isMeetingEvent` (and `GEvent` is not exported).

- [ ] **Step 3: Write minimal implementation**

In `src/modules/gws/calendar.ts`:

1. Change the imports at the top to include the new manifest types:

```ts
import { gwsJson } from "./gws";
import type {
  CalendarConfig, CalendarData, CalendarEventItem,
  NextMeetingConfig, NextMeetingData, MeetingItem,
} from "./manifest";
```

2. Export `GEvent` and add `attendees` (change `type GEvent = {` to `export type GEvent = {` and add the field):

```ts
export type GEvent = {
  id: string;
  status?: string;
  summary?: string;
  htmlLink?: string;
  location?: string;
  hangoutLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
};
```

3. Append at the end of the file:

```ts
/** A "real meeting": timed, not cancelled, not declined by me, and not a solo
 *  event (no other attendees and no Meet link) unless includeSoloEvents. */
export function isMeetingEvent(e: GEvent, includeSoloEvents: boolean): boolean {
  if (e.status === "cancelled") return false;
  if (!e.start?.dateTime) return false; // all-day events carry `date`, not `dateTime`
  if (e.attendees?.find((a) => a.self)?.responseStatus === "declined") return false;
  if (!includeSoloEvents) {
    const others = (e.attendees ?? []).filter((a) => !a.self);
    if (others.length === 0 && !e.hangoutLink) return false;
  }
  return true;
}

export function normalizeMeeting(e: GEvent): MeetingItem {
  return {
    id: e.id,
    title: e.summary || "(no title)",
    start: e.start?.dateTime ?? "",
    end: e.end?.dateTime ?? "",
    meetUrl: e.hangoutLink,
    url: e.htmlLink ?? "",
  };
}

export async function fetchNextMeeting(config: NextMeetingConfig): Promise<NextMeetingData> {
  const now = new Date();
  const resp = await gwsJson<EventsResp>([
    "calendar", "events", "list",
    "--params", JSON.stringify({
      calendarId: config.calendarId,
      timeMin: now.toISOString(), // in-progress events end after now, so they're included
      timeMax: dayWindow(now).timeMax,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 20,
    }),
  ]);
  const meetings = (resp.items ?? [])
    .filter((e) => isMeetingEvent(e, config.includeSoloEvents))
    .map(normalizeMeeting);
  return { meetings };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/modules/gws-next-meeting.test.ts`
Expected: PASS (all tests, now including the 8 new ones)

Also run the existing calendar tests to confirm no regression:
Run: `npx vitest run tests/modules/gws-calendar.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/gws/calendar.ts tests/modules/gws-next-meeting.test.ts
git commit -m "feat: gws next-meeting fetch with real-meeting filter"
```

---

### Task 3: Widget component

**Files:**
- Create: `src/modules/gws/widgets/next-meeting-widget.tsx`
- Test: `tests/modules/gws-next-meeting-widget.test.tsx` (create)

**Interfaces:**
- Consumes: `WidgetBodyProps` from `@/modules/contracts`; Task 1's `deriveMeetingState`, `NextMeetingData`, `NextMeetingConfig`, `MeetingItem`, `nextMeetingDefaultConfig` from `../manifest`.
- Produces:
  - `NextMeetingWidget: FC<WidgetBodyProps<NextMeetingData, NextMeetingConfig>>`
  - `formatCountdown(msUntil: number): string` — `"in 23 min"` / `"in 1h 30m"` (exported for tests)
  - `urgencyClass(msUntil: number): string` — red `< 2 min`, amber `< 10 min` (exported for tests)

- [ ] **Step 1: Write the failing test**

Create `tests/modules/gws-next-meeting-widget.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { NextMeetingWidget, formatCountdown, urgencyClass } from "@/modules/gws/widgets/next-meeting-widget";
import { nextMeetingDefaultConfig, type NextMeetingData, type MeetingItem } from "@/modules/gws/manifest";

const NOW = new Date("2026-07-12T10:00:00Z");

const meeting = (id: string, start: string, end: string, meetUrl?: string): MeetingItem => ({
  id,
  title: id,
  start,
  end,
  meetUrl,
  url: `https://cal/${id}`,
});

function renderWidget(data: NextMeetingData) {
  return render(
    <NextMeetingWidget data={data} config={nextMeetingDefaultConfig} refresh={async () => {}} />,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("formatCountdown", () => {
  it("formats minutes and hours", () => {
    expect(formatCountdown(23 * 60_000)).toBe("in 23 min");
    expect(formatCountdown(90 * 60_000)).toBe("in 1h 30m");
    expect(formatCountdown(30_000)).toBe("in 1 min"); // rounds up, never "in 0 min"
  });
});

describe("urgencyClass", () => {
  it("escalates amber under 10 min and red under 2 min", () => {
    expect(urgencyClass(30 * 60_000)).not.toMatch(/amber|red/);
    expect(urgencyClass(5 * 60_000)).toContain("amber");
    expect(urgencyClass(60_000)).toContain("red");
  });
});

describe("NextMeetingWidget", () => {
  it("counts down to the next meeting with a Join button", () => {
    renderWidget({
      meetings: [meeting("review", "2026-07-12T10:23:00Z", "2026-07-12T10:53:00Z", "https://meet.google.com/abc")],
    });
    expect(screen.getByText("review")).toBeInTheDocument();
    expect(screen.getByText("in 23 min")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Join" })).toHaveAttribute("href", "https://meet.google.com/abc");
  });

  it("shows the running meeting above the next countdown", () => {
    renderWidget({
      meetings: [
        meeting("standup", "2026-07-12T09:45:00Z", "2026-07-12T10:15:00Z"),
        meeting("review", "2026-07-12T10:30:00Z", "2026-07-12T11:00:00Z"),
      ],
    });
    expect(screen.getByText("In: standup — 15 min left")).toBeInTheDocument();
    expect(screen.getByText("in 30 min")).toBeInTheDocument();
  });

  it("shows only the running meeting when nothing follows", () => {
    renderWidget({ meetings: [meeting("standup", "2026-07-12T09:45:00Z", "2026-07-12T10:15:00Z")] });
    expect(screen.getByText("In: standup — 15 min left")).toBeInTheDocument();
    expect(screen.queryByText(/^in /)).not.toBeInTheDocument();
  });

  it("shows the empty state when no meetings remain", () => {
    renderWidget({ meetings: [] });
    expect(screen.getByText("No more meetings today.")).toBeInTheDocument();
  });

  it("ticks the countdown forward without a re-fetch", () => {
    renderWidget({ meetings: [meeting("review", "2026-07-12T10:23:00Z", "2026-07-12T10:53:00Z")] });
    expect(screen.getByText("in 23 min")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(screen.getByText("in 13 min")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/gws-next-meeting-widget.test.tsx`
Expected: FAIL — cannot resolve `@/modules/gws/widgets/next-meeting-widget`.

- [ ] **Step 3: Write minimal implementation**

Create `src/modules/gws/widgets/next-meeting-widget.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import type { WidgetBodyProps } from "@/modules/contracts";
import {
  deriveMeetingState,
  type NextMeetingData,
  type NextMeetingConfig,
  type MeetingItem,
} from "../manifest";

/** "in 23 min" / "in 1h 30m"; rounds up so it never reads "in 0 min". */
export function formatCountdown(msUntil: number): string {
  const mins = Math.max(1, Math.ceil(msUntil / 60_000));
  if (mins >= 60) return `in ${Math.floor(mins / 60)}h ${mins % 60}m`;
  return `in ${mins} min`;
}

export function urgencyClass(msUntil: number): string {
  if (msUntil < 2 * 60_000) return "text-red-600 dark:text-red-400";
  if (msUntil < 10 * 60_000) return "text-amber-600 dark:text-amber-400";
  return "text-slate-900 dark:text-slate-100";
}

function minutesLeft(m: MeetingItem, now: Date): number {
  return Math.max(1, Math.ceil((new Date(m.end).getTime() - now.getTime()) / 60_000));
}

export function NextMeetingWidget({ data }: WidgetBodyProps<NextMeetingData, NextMeetingConfig>) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(id);
  }, []);

  const { current, next } = deriveMeetingState(data.meetings ?? [], now);
  if (!current && !next)
    return <p className="text-sm text-slate-500 dark:text-slate-400">No more meetings today.</p>;

  const msUntilNext = next ? new Date(next.start).getTime() - now.getTime() : 0;
  return (
    <div className="space-y-1.5">
      {current && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          In: {current.title} — {minutesLeft(current, now)} min left
        </p>
      )}
      {next && (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <a
              href={next.url}
              target="_blank"
              rel="noreferrer"
              className="block truncate text-sm font-medium hover:underline"
            >
              {next.title}
            </a>
            <p className={`text-2xl font-semibold tabular-nums ${urgencyClass(msUntilNext)}`}>
              {formatCountdown(msUntilNext)}
            </p>
          </div>
          {next.meetUrl && (
            <a
              href={next.meetUrl}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 rounded-md bg-primary-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-primary-700"
            >
              Join
            </a>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/modules/gws-next-meeting-widget.test.tsx`
Expected: PASS (7 tests)

If `bg-primary-600` fails lint or doesn't exist in the theme, check `src/globals.css` for the primary palette (the calendar widget already uses `text-primary-600`, so it exists); do not invent new theme tokens.

- [ ] **Step 5: Commit**

```bash
git add src/modules/gws/widgets/next-meeting-widget.tsx tests/modules/gws-next-meeting-widget.test.tsx
git commit -m "feat: gws next-meeting countdown widget"
```

---

### Task 4: Registration wiring + full verification

**Files:**
- Modify: `src/modules/gws/fetch.ts`
- Modify: `src/modules/gws/render.ts`
- Test: `tests/modules/gws-registration.test.ts` (extend)

**Interfaces:**
- Consumes: Task 1's `nextMeetingManifest`, `NEXT_MEETING_TYPE`; Task 2's `fetchNextMeeting`; Task 3's `NextMeetingWidget`.
- Produces: `gws.nextMeeting` resolvable in both registries (the shell picks it up automatically).

- [ ] **Step 1: Write the failing test**

In `tests/modules/gws-registration.test.ts`:

1. Add `NEXT_MEETING_TYPE` to the manifest import:

```ts
import { GMAIL_TYPE, CALENDAR_TYPE, CHAT_DMS_TYPE, CHAT_CHANNELS_TYPE, DRIVE_TYPE, TASKS_TYPE, NEXT_MEETING_TYPE } from "@/modules/gws/manifest";
```

2. Add `NEXT_MEETING_TYPE` to the loop array:

```ts
for (const t of [GMAIL_TYPE, CALENDAR_TYPE, CHAT_DMS_TYPE, CHAT_CHANNELS_TYPE, DRIVE_TYPE, TASKS_TYPE, NEXT_MEETING_TYPE]) {
```

3. Add assertions at the end of the `it` block, after the TASKS assertions:

```ts
expect(getRenderWidget(NEXT_MEETING_TYPE)!.manifest.title).toBe("Next meeting");
expect(getFetchWidget(NEXT_MEETING_TYPE)!.manifest.defaultConfig).toMatchObject({
  calendarId: "primary", includeSoloEvents: false,
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/gws-registration.test.ts`
Expected: FAIL — `getFetchWidget("gws.nextMeeting")` is undefined.

- [ ] **Step 3: Write minimal implementation**

In `src/modules/gws/fetch.ts` — add `nextMeetingManifest` to the manifest import, `fetchNextMeeting` to the calendar import, and a registration line:

```ts
import {
  gmailManifest, calendarManifest, chatDmsManifest, chatChannelsManifest, driveManifest, tasksManifest,
  nextMeetingManifest,
} from "./manifest";
import { fetchCalendar, fetchNextMeeting } from "./calendar";
```

```ts
registerFetch(nextMeetingManifest, { fetch: fetchNextMeeting });
```

In `src/modules/gws/render.ts` — add `nextMeetingManifest` to the manifest import, import the widget, and register (reuses the calendar icon; `count` = meetings remaining):

```ts
import {
  gmailManifest, calendarManifest, chatDmsManifest, chatChannelsManifest, driveManifest, tasksManifest,
  nextMeetingManifest, filterDriveFiles,
} from "./manifest";
import { NextMeetingWidget } from "./widgets/next-meeting-widget";
```

```ts
registerRender(nextMeetingManifest, {
  Component: NextMeetingWidget,
  count: (d) => d.meetings.length,
  icon: { Icon: SiGooglecalendar, className: "text-[#4285F4]" },
});
```

- [ ] **Step 4: Run test to verify it passes, then full suite + lint**

Run: `npx vitest run tests/modules/gws-registration.test.ts`
Expected: PASS

Run: `npm test`
Expected: PASS. Note: the working tree may carry unrelated in-progress changes to the system module / widget-shell from another session — pre-existing failures in `tests/modules/system-*` or `tests/components/widget-shell.test.tsx` are NOT caused by this work; report them but do not fix or touch those files.

Run: `npm run lint`
Expected: clean for the files this plan touches.

- [ ] **Step 5: Commit**

```bash
git add src/modules/gws/fetch.ts src/modules/gws/render.ts tests/modules/gws-registration.test.ts
git commit -m "feat: register gws next-meeting widget"
```
