import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  deriveMeetingState,
  nextMeetingConfigSchema,
  nextMeetingDefaultConfig,
  type MeetingItem,
} from "@/modules/gws/manifest";

vi.mock("@/modules/gws/gws", () => ({ gwsJson: vi.fn() }));
import { gwsJson } from "@/modules/gws/gws";
import { isMeetingEvent, normalizeMeeting, fetchNextMeeting, type GEvent } from "@/modules/gws/calendar";

const mockGws = gwsJson as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => mockGws.mockReset());

const meetingEvt = (id: string, start: string, end: string): GEvent => ({
  id, summary: id,
  start: { dateTime: start }, end: { dateTime: end },
  attendees: [{ self: true, responseStatus: "accepted" }, { responseStatus: "accepted" }],
});
const allDayEvt = (id: string): GEvent => ({ id, start: { date: "2026-07-12" }, end: { date: "2026-07-13" } });

describe("fetchNextMeeting pagination (F3)", () => {
  it("follows nextPageToken so a meeting past the first page isn't missed", async () => {
    mockGws
      .mockResolvedValueOnce({ items: [allDayEvt("a1")], nextPageToken: "PAGE2" })
      .mockResolvedValueOnce({ items: [meetingEvt("m1", "2026-07-12T15:00:00Z", "2026-07-12T15:30:00Z")] });
    const data = await fetchNextMeeting({ calendarId: "primary", includeSoloEvents: false });
    expect(data.meetings.map((m) => m.id)).toEqual(["m1"]);
    expect(mockGws).toHaveBeenCalledTimes(2);
    expect((mockGws.mock.calls[1][0] as string[]).join(" ")).toContain("PAGE2");
  });

  it("stops after one page when there is no nextPageToken", async () => {
    mockGws.mockResolvedValueOnce({ items: [meetingEvt("m1", "2026-07-12T15:00:00Z", "2026-07-12T15:30:00Z")] });
    const data = await fetchNextMeeting({ calendarId: "primary", includeSoloEvents: false });
    expect(data.meetings).toHaveLength(1);
    expect(mockGws).toHaveBeenCalledTimes(1);
  });
});

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
