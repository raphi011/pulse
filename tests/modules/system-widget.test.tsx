import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SamplePoint } from "@/modules/system/manifest";

const state = vi.hoisted(() => ({
  snapshot: { points: [] as SamplePoint[], error: false },
}));

vi.mock("@/modules/system/sampler", () => ({
  systemSampler: {
    subscribe: () => () => {},
    getSnapshot: () => state.snapshot,
    configure: () => {},
  },
}));

import { SystemStatsWidget } from "@/modules/system/widgets/system-stats-widget";
import { systemStatsDefaultConfig } from "@/modules/system/manifest";

const GIB = 1024 ** 3;
const point = (t: number, cpu: number): SamplePoint => ({ t, cpu, memUsed: 8.2 * GIB, memTotal: 32 * GIB });

function renderWidget() {
  return render(
    <SystemStatsWidget data={{}} config={systemStatsDefaultConfig} refresh={async () => {}} />,
  );
}

describe("SystemStatsWidget", () => {
  beforeEach(() => {
    state.snapshot = { points: [], error: false };
  });

  it("shows a measuring state until two samples exist", () => {
    state.snapshot = { points: [point(1000, 10)], error: false };
    renderWidget();
    expect(screen.getByText(/measuring/i)).toBeInTheDocument();
  });

  it("renders current CPU %, memory used/total, and both section labels", () => {
    state.snapshot = { points: [point(1000, 10), point(3000, 37.4)], error: false };
    renderWidget();
    expect(screen.getByText("CPU")).toBeInTheDocument();
    expect(screen.getByText("37%")).toBeInTheDocument();
    expect(screen.getByText("Memory")).toBeInTheDocument();
    expect(screen.getByText("8.2 / 32.0 GB")).toBeInTheDocument();
  });

  it("shows the error state when the sampler reports failure", () => {
    state.snapshot = { points: [], error: true };
    renderWidget();
    expect(screen.getByText(/unavailable/i)).toBeInTheDocument();
  });
});
