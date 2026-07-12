import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SummaryWidget } from "@/modules/github-stats/widgets/summary-widget";
import { summaryDefaultConfig } from "@/modules/github-stats/manifest";
import type { StatsData } from "@/modules/github-stats/manifest";

const data: StatsData = {
  commits: 42, prs: 7, reviews: 5, issues: 3, total: 57,
  trend: [
    { date: "2026-07-06", count: 0 },
    { date: "2026-07-07", count: 4 },
  ],
};

function renderWidget(d: StatsData) {
  return render(<SummaryWidget data={d} config={summaryDefaultConfig} refresh={async () => {}} />);
}

describe("SummaryWidget", () => {
  it("renders the four KPI tiles with labels", () => {
    renderWidget(data);
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("Commits")).toBeInTheDocument();
    expect(screen.getByText("PRs")).toBeInTheDocument();
    expect(screen.getByText("Reviews")).toBeInTheDocument();
    expect(screen.getByText("Issues")).toBeInTheDocument();
  });

  it("shows an empty state when there is no activity", () => {
    renderWidget({ commits: 0, prs: 0, reviews: 0, issues: 0, total: 0, trend: [] });
    expect(screen.getByText(/No activity in this timeframe/i)).toBeInTheDocument();
  });
});
