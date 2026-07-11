import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { WidgetErrorBoundary } from "@/components/widget-error-boundary";

function Boom(): never {
  throw new Error("stale payload shape");
}

afterEach(() => vi.restoreAllMocks());

describe("WidgetErrorBoundary", () => {
  it("renders an in-card error instead of crashing the tree", () => {
    vi.spyOn(console, "error").mockImplementation(() => {}); // React logs caught errors
    render(
      <>
        <WidgetErrorBoundary resetKey={1}>
          <Boom />
        </WidgetErrorBoundary>
        <div>sibling widget</div>
      </>
    );
    expect(screen.getByText(/stale payload shape/)).toBeInTheDocument();
    expect(screen.getByText("sibling widget")).toBeInTheDocument();
  });

  it("re-renders children when resetKey changes", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let shouldThrow = true;
    function Sometimes() {
      if (shouldThrow) throw new Error("boom once");
      return <div>recovered</div>;
    }
    const { rerender } = render(
      <WidgetErrorBoundary resetKey={1}><Sometimes /></WidgetErrorBoundary>
    );
    expect(screen.getByText(/boom once/)).toBeInTheDocument();
    shouldThrow = false;
    rerender(<WidgetErrorBoundary resetKey={2}><Sometimes /></WidgetErrorBoundary>);
    expect(screen.getByText("recovered")).toBeInTheDocument();
  });
});
