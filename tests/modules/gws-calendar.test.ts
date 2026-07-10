import { describe, it, expect } from "vitest";
import { normalizeEvent, dayWindow } from "@/modules/gws/calendar";

describe("normalizeEvent", () => {
  it("maps a timed event with a Meet link", () => {
    const e = normalizeEvent({
      id: "e1",
      summary: "Standup",
      htmlLink: "https://cal/e1",
      hangoutLink: "https://meet.google.com/abc",
      start: { dateTime: "2026-07-10T09:00:00Z" },
      end: { dateTime: "2026-07-10T09:15:00Z" },
    });
    expect(e).toMatchObject({
      title: "Standup",
      allDay: false,
      start: "2026-07-10T09:00:00Z",
      meetUrl: "https://meet.google.com/abc",
      url: "https://cal/e1",
    });
  });

  it("flags all-day events (date, not dateTime) and fills title fallback", () => {
    const e = normalizeEvent({ id: "e2", start: { date: "2026-07-10" }, end: { date: "2026-07-11" } });
    expect(e).toMatchObject({ title: "(no title)", allDay: true, start: "2026-07-10" });
  });
});

describe("dayWindow", () => {
  it("spans local midnight to the next local midnight", () => {
    const { timeMin, timeMax } = dayWindow(new Date("2026-07-10T13:37:00"));
    const min = new Date(timeMin);
    const max = new Date(timeMax);
    expect(min.getHours()).toBe(0);
    expect(min.getMinutes()).toBe(0);
    expect(max.getTime() - min.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});
