import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SamplePoint } from "@/modules/system/manifest";

const state = vi.hoisted(() => ({
  snapshot: { points: [] as SamplePoint[], error: false },
  configure: vi.fn(),
}));

vi.mock("@/modules/system/sampler", () => ({
  systemSampler: {
    subscribe: () => () => {},
    getSnapshot: () => state.snapshot,
    configure: state.configure,
  },
}));

const layoutState = vi.hoisted(() => ({ height: 0 }));

vi.mock("@/modules/system/use-element-height", () => ({
  useElementHeight: () => ({ ref: () => {}, height: layoutState.height }),
}));

import { SystemStatsWidget } from "@/modules/system/widgets/system-stats-widget";
import { systemStatsDefaultConfig } from "@/modules/system/manifest";
import type { SystemStatsConfig } from "@/modules/system/manifest";
import { FULL_MIN_PX, COMPACT_MAX_PX } from "@/modules/system/layout";

const GIB = 1024 ** 3;
const point = (t: number, cpu: number): SamplePoint => ({
  t, cpu, memUsed: 8.2 * GIB, memTotal: 32 * GIB, rx: 1.5 * 1024 ** 2, tx: 42 * 1024,
});

function renderWidget(config: SystemStatsConfig = systemStatsDefaultConfig) {
  return render(
    <SystemStatsWidget data={{}} config={config} refresh={async () => {}} />,
  );
}

describe("SystemStatsWidget", () => {
  beforeEach(() => {
    state.snapshot = { points: [], error: false };
    state.configure.mockReset();
    layoutState.height = COMPACT_MAX_PX; // compact
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

  it("renders the network section with current download/upload rates", () => {
    state.snapshot = { points: [point(1000, 10), point(3000, 37.4)], error: false };
    renderWidget();
    expect(screen.getByText("Network")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Network traffic" })).toHaveTextContent("↓ 1.5 MB/s ↑ 42.0 KB/s");
  });

  it("shows the error state when the sampler reports failure", () => {
    state.snapshot = { points: [], error: true };
    renderWidget();
    expect(screen.getByText(/unavailable/i)).toBeInTheDocument();
  });

  it("falls back to the default config when the stored config is invalid, never handing bad values to the sampler timer", () => {
    renderWidget({} as never);
    expect(state.configure).toHaveBeenCalledWith(systemStatsDefaultConfig);
  });

  it("passes a valid config through to the sampler unchanged", () => {
    const config: SystemStatsConfig = { sampleIntervalSeconds: 5, historySeconds: 300 };
    renderWidget(config);
    expect(state.configure).toHaveBeenCalledWith(config);
  });

  it("compact layout (short card) shows CPU and Memory meters and the network rates", () => {
    layoutState.height = COMPACT_MAX_PX - 50;
    state.snapshot = { points: [point(1000, 10), point(3000, 37.4)], error: false };
    renderWidget();

    const meters = screen.getAllByRole("meter");
    expect(meters).toHaveLength(2);
    expect(screen.getByRole("meter", { name: /cpu/i })).toHaveAttribute("aria-valuenow", "37");
    expect(screen.getByText("37%")).toBeInTheDocument();
    expect(screen.getByText("8.2 / 32.0 GB")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Network traffic" })).toHaveTextContent(
      "↓ 1.5 MB/s ↑ 42.0 KB/s",
    );
    expect(screen.queryAllByTestId("system-chart-section")).toHaveLength(0);
  });

  it("full layout (tall card) shows three trend charts and no meters", () => {
    layoutState.height = FULL_MIN_PX + 50;
    state.snapshot = { points: [point(1000, 10), point(3000, 37.4)], error: false };
    renderWidget();

    expect(screen.getAllByTestId("system-chart-section")).toHaveLength(3);
    expect(screen.queryAllByRole("meter")).toHaveLength(0);
    expect(screen.getByText("CPU")).toBeInTheDocument();
    expect(screen.getByText("37%")).toBeInTheDocument();
  });
});
