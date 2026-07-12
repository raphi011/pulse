import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HeatmapWidget } from "@/modules/github-stats/widgets/heatmap-widget";
import { heatmapDefaultConfig } from "@/modules/github-stats/manifest";
import type { HeatmapData } from "@/modules/github-stats/manifest";

const data: HeatmapData = {
  total: 16,
  weeks: [
    { days: [
      { date: "2026-07-06", count: 0, level: 0 },
      { date: "2026-07-07", count: 4, level: 2 },
    ] },
    { days: [
      { date: "2026-07-13", count: 12, level: 4 },
    ] },
  ],
};

function renderWidget(d: HeatmapData) {
  return render(<HeatmapWidget data={d} config={heatmapDefaultConfig} refresh={async () => {}} />);
}

describe("HeatmapWidget", () => {
  it("renders one cell per contribution day", () => {
    const { container } = renderWidget(data);
    expect(container.querySelectorAll("span[title]")).toHaveLength(3);
  });

  it("labels a cell with its count and date", () => {
    renderWidget(data);
    expect(screen.getByTitle(/4 contributions on Jul 7/i)).toBeInTheDocument();
  });

  it("shows an empty state when the year has no activity", () => {
    renderWidget({ total: 0, weeks: [] });
    expect(screen.getByText(/No activity this year/i)).toBeInTheDocument();
  });
});
