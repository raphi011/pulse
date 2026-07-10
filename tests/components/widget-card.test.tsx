import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WidgetShell } from "@/components/widget-shell";

describe("WidgetShell issue indicator", () => {
  it("renders a warning marker with the message as its title when issue is set", () => {
    render(
      <WidgetShell title="PRs" state="ok" fetchedAt={null} onRefresh={() => {}}
        issue={{ message: "Not authenticated — run `gh auth login`" }}>
        <div>body</div>
      </WidgetShell>
    );
    const marker = screen.getByLabelText("Has an issue");
    expect(marker).toHaveAttribute("title", expect.stringContaining("gh auth login"));
  });

  it("omits the marker when there is no issue", () => {
    render(<WidgetShell title="PRs" state="ok" fetchedAt={null} onRefresh={() => {}}><div>ok</div></WidgetShell>);
    expect(screen.queryByLabelText("Has an issue")).not.toBeInTheDocument();
  });
});
