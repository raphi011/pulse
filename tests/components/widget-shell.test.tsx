import { describe, it, test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WidgetShell } from "@/components/widget-shell";

describe("WidgetShell", () => {
  it("shows a loading state", () => {
    render(<WidgetShell title="X" state="loading" fetchedAt={null} onRefresh={() => {}} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows an error message", () => {
    render(<WidgetShell title="X" state="error" error="gh not found" fetchedAt={null} onRefresh={() => {}} />);
    expect(screen.getByText(/gh not found/i)).toBeInTheDocument();
  });

  it("renders children when ok and fires refresh", async () => {
    const onRefresh = vi.fn();
    render(
      <WidgetShell title="X" state="ok" fetchedAt={Date.now()} onRefresh={onRefresh}>
        <p>body</p>
      </WidgetShell>,
    );
    expect(screen.getByText("body")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});

test("spins and disables the refresh button while refreshing", () => {
  const { getByLabelText, container } = render(
    <WidgetShell title="X" state="ok" fetchedAt={null} onRefresh={() => {}} refreshing>
      <div>body</div>
    </WidgetShell>,
  );
  expect(getByLabelText("Refresh")).toBeDisabled();
  expect(container.querySelector(".animate-spin")).not.toBeNull();
});
