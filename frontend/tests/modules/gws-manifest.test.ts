import { describe, it, expect } from "vitest";
import {
  deriveEventEmphasis, deriveMeetingState, filterDriveFiles, filterTasksByAge, sortTasks,
} from "@/modules/gws/manifest";
import type { CalendarEventItem, DriveFileItem, MeetingItem, TaskItem, DriveConfig } from "@/modules/gws/manifest";

const now = new Date("2026-07-22T12:00:00Z");

describe("deriveEventEmphasis", () => {
  const ev = (id: string, start: string, end: string, allDay = false): CalendarEventItem =>
    ({ id, title: id, start, end, allDay, url: "" });
  it("dims past timed events and highlights the in-progress one", () => {
    const events = [
      ev("past", "2026-07-22T09:00:00Z", "2026-07-22T10:00:00Z"),
      ev("current", "2026-07-22T11:30:00Z", "2026-07-22T12:30:00Z"),
      ev("next", "2026-07-22T14:00:00Z", "2026-07-22T15:00:00Z"),
      ev("holiday", "2026-07-22", "2026-07-23", true),
    ];
    const { pastIds, highlightId } = deriveEventEmphasis(events, now);
    expect([...pastIds]).toEqual(["past"]);
    expect(highlightId).toBe("current");
  });
  it("falls back to the next upcoming event", () => {
    const events = [ev("next", "2026-07-22T14:00:00Z", "2026-07-22T15:00:00Z")];
    expect(deriveEventEmphasis(events, now).highlightId).toBe("next");
  });
});

describe("deriveMeetingState", () => {
  const m = (id: string, start: string, end: string): MeetingItem => ({ id, title: id, start, end, url: "" });
  it("finds current and next", () => {
    const meetings = [
      m("cur", "2026-07-22T11:30:00Z", "2026-07-22T12:30:00Z"),
      m("nxt", "2026-07-22T14:00:00Z", "2026-07-22T15:00:00Z"),
    ];
    const { current, next } = deriveMeetingState(meetings, now);
    expect(current?.id).toBe("cur");
    expect(next?.id).toBe("nxt");
  });
});

describe("filterDriveFiles", () => {
  const f = (id: string, category: DriveFileItem["category"]): DriveFileItem =>
    ({ id, name: id, category, modifiedTime: "", url: "", iconLink: "" });
  it("drops categories whose toggle is off", () => {
    const config: DriveConfig = { showDocs: true, showSheets: false, showSlides: true, showOther: false, limit: 25 };
    const got = filterDriveFiles([f("a", "docs"), f("b", "sheets"), f("c", "other")], config);
    expect(got.map((x) => x.id)).toEqual(["a"]);
  });
});

describe("filterTasksByAge / sortTasks", () => {
  const task = (id: string, completed: boolean, completedAt?: string): TaskItem =>
    ({ id, title: id, due: "", completed, completedAt, url: "" });
  it("keeps incomplete always, drops old completed, fail-open without timestamp", () => {
    const tasks = [
      task("open", false),
      task("old", true, "2026-07-01T00:00:00Z"),
      task("fresh", true, "2026-07-22T09:00:00Z"),
      task("no-ts", true),
    ];
    const got = filterTasksByAge(tasks, "Last 7 days", now);
    expect(got.map((t) => t.id)).toEqual(["open", "fresh", "no-ts"]);
  });
  it("sorts completed last, stable", () => {
    const got = sortTasks([task("done", true, "x"), task("a", false), task("b", false)]);
    expect(got.map((t) => t.id)).toEqual(["a", "b", "done"]);
  });
});
