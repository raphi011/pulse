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

describe("WidgetShell refreshable", () => {
  it("shows the refresh button and timestamp by default", () => {
    render(
      <WidgetShell title="PRs" state="ok" fetchedAt={Date.now()} onRefresh={() => {}}>
        <div>body</div>
      </WidgetShell>
    );
    expect(screen.getByLabelText("Refresh")).toBeInTheDocument();
    expect(screen.getByText("just now")).toBeInTheDocument();
  });

  it("hides the refresh button and timestamp when refreshable is false", () => {
    render(
      <WidgetShell title="Bookmarks" state="ok" fetchedAt={Date.now()} onRefresh={() => {}} refreshable={false}>
        <div>body</div>
      </WidgetShell>
    );
    expect(screen.queryByLabelText("Refresh")).not.toBeInTheDocument();
    expect(screen.queryByText("just now")).not.toBeInTheDocument();
  });

  it("renders headerExtra alongside the refresh button", () => {
    render(
      <WidgetShell title="X" state="ok" fetchedAt={null} onRefresh={() => {}}
        headerExtra={<button aria-label="Add bookmark">＋</button>}>
        <div>body</div>
      </WidgetShell>
    );
    expect(screen.getByLabelText("Add bookmark")).toBeInTheDocument();
    expect(screen.getByLabelText("Refresh")).toBeInTheDocument();
  });
});
