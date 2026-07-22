import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { costColor, formatDate, CcusageWidget } from "@/modules/ccusage/widgets/ccusage-widget";

const noop = async () => {};

describe("costColor", () => {
  it("is green when empty, yellow-green mid, red at/over limit, clamped", () => {
    expect(costColor(0)).toBe("hsl(140 70% 45%)");
    expect(costColor(0.5)).toBe("hsl(70 70% 45%)");
    expect(costColor(1)).toBe("hsl(0 70% 45%)");
    expect(costColor(2)).toBe("hsl(0 70% 45%)");   // clamped above 1
    expect(costColor(-1)).toBe("hsl(140 70% 45%)"); // clamped below 0
  });
});

describe("formatDate", () => {
  it("formats an ISO day as 'Mon D' without timezone drift", () => {
    expect(formatDate("2026-07-13")).toBe("Jul 13");
    expect(formatDate("2026-01-01")).toBe("Jan 1");
    expect(formatDate("2026-12-09")).toBe("Dec 9");
  });
});

describe("CcusageWidget", () => {
  it("shows the date caption, cost, limit and percent, with the ring arc filled to the fraction", () => {
    render(<CcusageWidget data={{ costUsd: 2.65, date: "2026-07-13" }} config={{ dailyLimitUsd: 20 }} refresh={noop} />);
    expect(screen.getByText("Today · Jul 13")).toBeInTheDocument();
    expect(screen.getByText("$2.65")).toBeInTheDocument();
    expect(screen.getByText(/of \$20\.00 · 13%/)).toBeInTheDocument();
    const arc = screen.getByTestId("ccusage-arc");
    // dashoffset = circumference * (1 - 0.1325); circumference = 2π·42
    const circ = 2 * Math.PI * 42;
    expect(Number(arc.getAttribute("stroke-dashoffset"))).toBeCloseTo(circ * (1 - 0.1325), 3);
  });

  it("caps the arc at the full circle and reddens the cost when over the limit", () => {
    render(<CcusageWidget data={{ costUsd: 25, date: "2026-07-13" }} config={{ dailyLimitUsd: 20 }} refresh={noop} />);
    expect(screen.getByText(/· 125%/)).toBeInTheDocument();
    expect(Number(screen.getByTestId("ccusage-arc").getAttribute("stroke-dashoffset"))).toBeCloseTo(0, 3);
    expect(screen.getByText("$25.00").className).toContain("text-danger");
  });

  it("draws no arc and shows 'No limit set' when the limit is 0", () => {
    render(<CcusageWidget data={{ costUsd: 2.65, date: "2026-07-13" }} config={{ dailyLimitUsd: 0 }} refresh={noop} />);
    expect(screen.getByText("No limit set")).toBeInTheDocument();
    expect(screen.queryByTestId("ccusage-arc")).toBeNull();
  });
});
