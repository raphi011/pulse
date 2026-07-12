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
