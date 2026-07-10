import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WidgetShell } from "@/components/widget-shell";

describe("WidgetShell issue indicator", () => {
  it("renders a warning marker with the message as its title when issue is set", () => {
    render(
      <WidgetShell title="PRs" state="ok" fetchedAt={null} onRefresh={() => {}}
        issue={{ message: "Not authenticated — run `gh auth login`", kind: "auth" }}>
        <div>body</div>
      </WidgetShell>
    );
    const marker = screen.getByLabelText("Authentication issue");
    expect(marker).toHaveAttribute("title", expect.stringContaining("gh auth login"));
  });

  it("shows an amber warning with a kind-specific label for auth issues", () => {
    render(
      <WidgetShell title="PRs" state="ok" fetchedAt={null} onRefresh={() => {}}
        issue={{ message: "Not authenticated — run `gh auth login`", kind: "auth" }}>
        <div>body</div>
      </WidgetShell>
    );
    const marker = screen.getByLabelText("Authentication issue");
    expect(marker).toHaveAttribute("title", expect.stringContaining("gh auth login"));
    expect(marker.className).toContain("text-warn");
  });

  it("shows a red error marker for a plain failure", () => {
    render(
      <WidgetShell title="Q" state="ok" fetchedAt={null} onRefresh={() => {}}
        issue={{ message: "Bad JQL", kind: "failed" }}>
        <div>body</div>
      </WidgetShell>
    );
    const marker = screen.getByLabelText("Error");
    expect(marker.className).toContain("text-danger");
  });

  it("omits the marker when there is no issue", () => {
    render(<WidgetShell title="PRs" state="ok" fetchedAt={null} onRefresh={() => {}}><div>ok</div></WidgetShell>);
    expect(screen.queryByLabelText("Authentication issue")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Error")).not.toBeInTheDocument();
  });
});
