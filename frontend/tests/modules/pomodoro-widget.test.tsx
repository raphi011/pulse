import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PomodoroSnapshot } from "@/modules/pomodoro/engine";

const state = vi.hoisted(() => ({
  snapshot: {
    phase: "work",
    status: "idle",
    remainingMs: 25 * 60_000,
    durationMs: 25 * 60_000,
    completedToday: 0,
    notifyBlocked: false,
  } as PomodoroSnapshot,
  configure: vi.fn(),
}));

vi.mock("@/modules/pomodoro/engine", () => ({
  pomodoroEngine: {
    subscribe: () => () => {},
    getSnapshot: () => state.snapshot,
    configure: state.configure,
    start: vi.fn(),
    pause: vi.fn(),
    reset: vi.fn(),
    skip: vi.fn(),
  },
}));

import { PomodoroWidget } from "@/modules/pomodoro/widgets/pomodoro-widget";
import { pomodoroDefaultConfig } from "@/modules/pomodoro/manifest";
import type { PomodoroConfig } from "@/modules/pomodoro/manifest";

function renderWidget(config: PomodoroConfig = pomodoroDefaultConfig) {
  return render(<PomodoroWidget data={{}} config={config} refresh={async () => {}} />);
}

const idleSnapshot: PomodoroSnapshot = {
  phase: "work",
  status: "idle",
  remainingMs: 25 * 60_000,
  durationMs: 25 * 60_000,
  completedToday: 0,
  notifyBlocked: false,
};

describe("PomodoroWidget", () => {
  beforeEach(() => {
    state.snapshot = idleSnapshot;
    state.configure.mockReset();
  });

  it("renders the idle state from the engine snapshot", () => {
    renderWidget();
    expect(screen.getByText("Focus")).toBeInTheDocument();
    expect(screen.getByText("25:00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
  });

  it("falls back to the default config when the stored config is invalid, never handing bad values to the engine", () => {
    renderWidget({} as never);
    expect(state.configure).toHaveBeenCalledWith(pomodoroDefaultConfig);
  });

  it("shows Skip break only when the phase is a break", () => {
    state.snapshot = { ...idleSnapshot, phase: "shortBreak", status: "finished" };
    renderWidget();
    expect(screen.getByRole("button", { name: "Skip break" })).toBeInTheDocument();
  });

  it("hides Skip break during the work phase", () => {
    renderWidget(); // idleSnapshot: phase "work"
    expect(screen.queryByRole("button", { name: "Skip break" })).not.toBeInTheDocument();
  });
});
