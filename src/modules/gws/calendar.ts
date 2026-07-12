import { gwsJson } from "./gws";
import type {
  CalendarConfig, CalendarData, CalendarEventItem,
  NextMeetingConfig, NextMeetingData, MeetingItem,
} from "./manifest";

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
type EventsResp = { items?: GEvent[] };

export function normalizeEvent(e: GEvent): CalendarEventItem {
  return {
    id: e.id,
    title: e.summary || "(no title)",
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
    allDay: !e.start?.dateTime, // all-day events carry `date`, not `dateTime`
    location: e.location,
    meetUrl: e.hangoutLink,
    url: e.htmlLink ?? "",
  };
}

/** [local midnight, next local midnight) as absolute RFC3339 instants. */
export function dayWindow(now: Date): { timeMin: string; timeMax: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { timeMin: start.toISOString(), timeMax: end.toISOString() };
}

export async function fetchCalendar(config: CalendarConfig): Promise<CalendarData> {
  const { timeMin, timeMax } = dayWindow(new Date());
  const resp = await gwsJson<EventsResp>([
    "calendar", "events", "list",
    "--params", JSON.stringify({
      calendarId: config.calendarId,
      timeMin,
      timeMax,
      singleEvents: true, // expand recurring events into instances
      orderBy: "startTime",
      maxResults: config.limit,
    }),
  ]);
  const events = (resp.items ?? [])
    .filter((e) => e.status !== "cancelled")
    .map(normalizeEvent);
  return { events };
}

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
