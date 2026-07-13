import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WidgetShell } from "@/components/widget-shell";
import { CardMenu } from "@/components/card-menu";

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

describe("CardMenu move-to-tab", () => {
  it("lists other tabs and moves on click", async () => {
    const onMove = vi.fn();
    render(
      <CardMenu
        onConfigure={() => {}}
        onRemove={() => {}}
        moveTargets={[{ id: "t2", name: "Personal" }]}
        onMove={onMove}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /widget menu/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /move to tab/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Personal" }));
    expect(onMove).toHaveBeenCalledWith("t2");
  });
});
