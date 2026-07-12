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
