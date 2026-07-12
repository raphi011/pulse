# gws Next-Meeting Countdown Widget — Design

**Date:** 2026-07-12
**Status:** Approved
**Module:** `gws` (existing) — new widget `gws.nextMeeting`

## Goal

A dashboard widget showing a live countdown to the next real meeting today, with a
Join button for video calls, and awareness of a currently running meeting.

## Approach

New widget inside the existing `gws` module (one manifest per widget, own fetch +
render, reuses `gwsJson` CLI plumbing and the gws integration). Rejected: a
countdown mode on `gws.calendar` (conditional config/data shape, can't run both
widgets at once) and deriving from the calendar widget's cache (cross-widget cache
reads are outside the widget contract).

Cache-first constraint: the fetch returns event *data*; the countdown ticks
client-side in the widget. The fetch returns the full list of remaining qualifying
meetings today — not a pre-computed "next" — so the widget re-derives
current/next as time passes without a re-fetch.

## Fetch (`src/modules/gws/calendar.ts`, extended)

- Query window: `[now, next local midnight)`; `singleEvents: true`,
  `orderBy: "startTime"`. Request attendees + self response status.
- Filter out: cancelled events, all-day events, events declined by me, and solo
  events (no other attendees **and** no Meet link) unless `includeSoloEvents`.
- Data shape:

```ts
export type MeetingItem = {
  id: string;
  title: string;
  start: string; // ISO datetime
  end: string;   // ISO datetime
  meetUrl?: string;
  url: string;   // htmlLink
};
export type NextMeetingData = { meetings: MeetingItem[] };
```

`meetings` = all in-progress or not-yet-started qualifying meetings today, sorted
by start.

## Widget (`src/modules/gws/widgets/next-meeting-widget.tsx`)

Client-side `setInterval` tick (1 s). Each tick derives from the cached list:

- `current` = first meeting with `start ≤ now < end`
- `next` = first meeting with `start > now`

Render states:

1. **Next meeting**: prominent countdown — "**Design review** in 23 min" — with a
   prominent **Join** button when `meetUrl` is set.
2. **In a meeting**: small line "In: Standup — 12 min left" above the next-meeting
   countdown (or alone if nothing follows).
3. **Nothing left**: "No more meetings today." A stale cache whose last meeting has
   ended falls into this state naturally.

Urgency styling on the countdown text via existing accent tokens: amber under
10 min, red under 2 min. Countdown format: `in Xh Ym` / `in X min`; minutes-level
granularity is fine (no seconds display).

## Config

```ts
{
  calendarId: string    // default "primary"
  includeSoloEvents: boolean // default false (feature toggles default disabled)
}
```

Both field kinds are supported by the auto-generated schema form.

## Wiring

- `manifest.ts`: `NEXT_MEETING_TYPE = "gws.nextMeeting"`, config schema, defaults,
  `defineManifest` entry (`refreshable: true`, gws integration).
- Register in the module's `fetch.ts` and `render.ts` (reuse gws icon).

## Error handling

Same as other gws widgets: `gwsJson` payload-model error extraction
(`not-found`/`auth`/`timeout`/`failed`) surfaces via the standard widget error
path; widget body wrapped in the per-card ErrorBoundary. New data shape → no
`CACHE_VERSION` bump needed (new widget type, no existing cached payloads).

## Testing

- Unit: fetch filter logic (cancelled/all-day/declined/solo, `includeSoloEvents`
  toggle) and current/next derivation (in-progress, back-to-back, none left).
- Widget: render states 1–3 and urgency classes, with fake timers.
- Registration test: both registries resolve `gws.nextMeeting`.
