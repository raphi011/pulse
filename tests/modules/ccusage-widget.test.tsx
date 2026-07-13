import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { costColor, CcusageWidget } from "@/modules/ccusage/widgets/ccusage-widget";

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

describe("CcusageWidget", () => {
  it("shows cost, limit and percent, with a bar filled to the fraction", () => {
    render(<CcusageWidget data={{ costUsd: 2.65, date: "2026-07-13" }} config={{ dailyLimitUsd: 20 }} refresh={noop} />);
    expect(screen.getByText("$2.65")).toBeInTheDocument();
    expect(screen.getByText(/of \$20\.00 · 13%/)).toBeInTheDocument();
    expect(screen.getByTestId("ccusage-bar").style.width).toBe("13.25%");
  });

  it("caps the bar at 100% and reddens the cost when over the limit", () => {
    render(<CcusageWidget data={{ costUsd: 25, date: "2026-07-13" }} config={{ dailyLimitUsd: 20 }} refresh={noop} />);
    expect(screen.getByText(/· 125%/)).toBeInTheDocument();
    expect(screen.getByTestId("ccusage-bar").style.width).toBe("100%");
    expect(screen.getByText("$25.00").className).toContain("text-danger");
  });

  it("hides the bar and shows 'No limit set' when the limit is 0", () => {
    render(<CcusageWidget data={{ costUsd: 2.65, date: "2026-07-13" }} config={{ dailyLimitUsd: 0 }} refresh={noop} />);
    expect(screen.getByText("No limit set")).toBeInTheDocument();
    expect(screen.queryByTestId("ccusage-bar")).toBeNull();
  });
});
