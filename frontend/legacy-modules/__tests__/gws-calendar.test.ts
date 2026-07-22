import { describe, it, expect } from "vitest";
import { normalizeEvent, dayWindow } from "@/modules/gws/calendar";
import { deriveEventEmphasis, type CalendarEventItem } from "@/modules/gws/manifest";

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

describe("deriveEventEmphasis", () => {
  const ev = (id: string, start: string, end: string): CalendarEventItem => ({
    id, title: id, start, end, allDay: false, url: "",
  });
  const allDay = (id: string): CalendarEventItem => ({
    id, title: id, start: "2026-07-10", end: "2026-07-11", allDay: true, url: "",
  });
  const events = [
    allDay("a1"),
    ev("e1", "2026-07-10T09:00:00Z", "2026-07-10T09:30:00Z"),
    ev("e2", "2026-07-10T10:00:00Z", "2026-07-10T11:00:00Z"),
    ev("e3", "2026-07-10T13:00:00Z", "2026-07-10T14:00:00Z"),
  ];

  it("marks ended events past and highlights the in-progress event", () => {
    const { pastIds, highlightId } = deriveEventEmphasis(events, new Date("2026-07-10T10:15:00Z"));
    expect([...pastIds]).toEqual(["e1"]);
    expect(highlightId).toBe("e2");
  });

  it("highlights the next upcoming event when none is running", () => {
    const { pastIds, highlightId } = deriveEventEmphasis(events, new Date("2026-07-10T11:30:00Z"));
    expect([...pastIds]).toEqual(["e1", "e2"]);
    expect(highlightId).toBe("e3");
  });

  it("never dims or highlights all-day events, and highlights nothing after the last event", () => {
    const { pastIds, highlightId } = deriveEventEmphasis(events, new Date("2026-07-10T15:00:00Z"));
    expect(pastIds.has("a1")).toBe(false);
    expect([...pastIds]).toEqual(["e1", "e2", "e3"]);
    expect(highlightId).toBeNull();
  });
});

describe("deriveEventEmphasis", () => {
  const ev = (id: string, start: string, end: string): CalendarEventItem => ({
    id, title: id, start, end, allDay: false, url: "",
  });
  const allDay = (id: string): CalendarEventItem => ({
    id, title: id, start: "2026-07-10", end: "2026-07-11", allDay: true, url: "",
  });
  const events = [
    allDay("a1"),
    ev("e1", "2026-07-10T09:00:00Z", "2026-07-10T09:30:00Z"),
    ev("e2", "2026-07-10T10:00:00Z", "2026-07-10T11:00:00Z"),
    ev("e3", "2026-07-10T13:00:00Z", "2026-07-10T14:00:00Z"),
  ];

  it("marks ended events past and highlights the in-progress event", () => {
    const { pastIds, highlightId } = deriveEventEmphasis(events, new Date("2026-07-10T10:15:00Z"));
    expect([...pastIds]).toEqual(["e1"]);
    expect(highlightId).toBe("e2");
  });

  it("highlights the next upcoming event when none is running", () => {
    const { pastIds, highlightId } = deriveEventEmphasis(events, new Date("2026-07-10T11:30:00Z"));
    expect([...pastIds]).toEqual(["e1", "e2"]);
    expect(highlightId).toBe("e3");
  });

  it("never dims or highlights all-day events, and highlights nothing after the last event", () => {
    const { pastIds, highlightId } = deriveEventEmphasis(events, new Date("2026-07-10T15:00:00Z"));
    expect(pastIds.has("a1")).toBe(false);
    expect([...pastIds]).toEqual(["e1", "e2", "e3"]);
    expect(highlightId).toBeNull();
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
