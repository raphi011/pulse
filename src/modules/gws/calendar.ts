import { gwsJson } from "./gws";
import type { CalendarConfig, CalendarData, CalendarEventItem } from "./manifest";

type GEvent = {
  id: string;
  status?: string;
  summary?: string;
  htmlLink?: string;
  location?: string;
  hangoutLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
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
