import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WidgetShell } from "@/components/widget-shell";
import { CardMenu } from "@/components/card-menu";

vi.mock("@/components/use-widget-data", () => ({ useWidgetData: vi.fn() }));
// WidgetCard also reads the server-owned manifests via useManifests; stub it out so
// this test never has to import the real @/lib/backend (Wails bindings).
vi.mock("@/components/use-manifests", () => ({ useManifest: vi.fn(), useManifests: vi.fn() }));
import { useWidgetData } from "@/components/use-widget-data";
import { useManifests } from "@/components/use-manifests";
import { WidgetCard } from "@/components/widget-card";
import { registerFixtureRenderWidget, FIXTURE_TYPE, fixtureManifest } from "../helpers/fixture-widget";
import type { Widget } from "@/lib/backend";
import { beforeEach } from "vitest";

registerFixtureRenderWidget();
const mockUseWidgetData = useWidgetData as unknown as ReturnType<typeof vi.fn>;
const mockUseManifests = useManifests as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockUseManifests.mockReturnValue({ manifests: [], isPending: false, isError: false });
});
const fixtureWidget: Widget = {
  id: "w1", type: FIXTURE_TYPE, title: null, accent: null,
  order: 0, colSpan: 1, rowSpan: 6, hidden: false, tabId: "default", config: { label: "" },
};

describe("WidgetCard load-failure state (F6)", () => {
  it("renders an error state, not the empty state, when the query rejects with no cached data", () => {
    mockUseWidgetData.mockReturnValue({
      data: undefined, isLoading: false, isError: true,
      error: new Error("database is locked"), refresh: vi.fn(), isRefreshing: false,
    });
    render(<WidgetCard widget={fixtureWidget} />);
    expect(screen.getByText("database is locked")).toBeInTheDocument();
    expect(screen.queryByText("Nothing here yet.")).not.toBeInTheDocument();
  });

  it("still shows the empty state when the query succeeds with no rows", () => {
    mockUseWidgetData.mockReturnValue({
      data: undefined, isLoading: false, isError: false,
      error: null, refresh: vi.fn(), isRefreshing: false,
    });
    render(<WidgetCard widget={fixtureWidget} />);
    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
  });
});

describe("WidgetCard refresh affordance while manifests load", () => {
  const okData = {
    data: { payload: { ok: true }, status: "ok", fetchedAt: 1721700000000, error: null, errorKind: null },
    isLoading: false, isError: false, error: null, refresh: vi.fn(), isRefreshing: false,
  };

  it("hides the refresh button and timestamp until the manifests query resolves", () => {
    mockUseWidgetData.mockReturnValue(okData);
    mockUseManifests.mockReturnValue({ manifests: [], isPending: true, isError: false });
    render(<WidgetCard widget={fixtureWidget} />);
    expect(screen.queryByLabelText("Refresh")).not.toBeInTheDocument();
    expect(screen.queryByText(/ago|now/)).not.toBeInTheDocument();
  });

  it("keeps them hidden for a non-refreshable widget after manifests resolve", () => {
    mockUseWidgetData.mockReturnValue(okData);
    mockUseManifests.mockReturnValue({
      manifests: [{ ...fixtureManifest, refreshable: false }], isPending: false, isError: false,
    });
    render(<WidgetCard widget={fixtureWidget} />);
    expect(screen.queryByLabelText("Refresh")).not.toBeInTheDocument();
  });

  it("shows them for a refreshable widget after manifests resolve", () => {
    mockUseWidgetData.mockReturnValue(okData);
    mockUseManifests.mockReturnValue({ manifests: [fixtureManifest], isPending: false, isError: false });
    render(<WidgetCard widget={fixtureWidget} />);
    expect(screen.getByLabelText("Refresh")).toBeInTheDocument();
  });
});

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
