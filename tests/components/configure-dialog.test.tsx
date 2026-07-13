import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/dashboard-data", () => ({
  updateWidget: vi.fn(async () => ({ config: { label: "" }, title: null, accent: "teal" })),
  fetchWidgetData: vi.fn(async () => ({ widgetId: "w1", payload: null, fetchedAt: 0, status: "ok", error: null, errorKind: null })),
}));

import "@/modules/render";
import { updateWidget, fetchWidgetData } from "@/lib/dashboard-data";
import { ConfigureDialog } from "@/components/configure-dialog";
import { FIXTURE_TYPE } from "../helpers/fixture-widget";
import type { Widget } from "@/server/config-repo";

const widget: Widget = {
  id: "w1", type: FIXTURE_TYPE, title: null, accent: null,
  order: 0, colSpan: 1, rowSpan: 6, hidden: false, tabId: "default", config: { label: "" },
};

function renderDialog(onSaved = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ConfigureDialog widget={widget} onClose={() => {}} onSaved={onSaved} />
    </QueryClientProvider>,
  );
  return onSaved;
}

beforeEach(() => vi.clearAllMocks());

describe("ConfigureDialog accent picker", () => {
  it("shows a none swatch plus the 8 presets", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "No color" })).toBeInTheDocument();
    for (const name of ["red", "orange", "amber", "green", "teal", "blue", "violet", "pink"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("saves the selected accent and passes the stored value to onSaved", async () => {
    const onSaved = renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "teal" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(vi.mocked(updateWidget)).toHaveBeenCalledWith("w1", expect.objectContaining({ accent: "teal" }));
    expect(onSaved).toHaveBeenCalledWith("w1", expect.anything(), null, "teal");
  });

  it("completes the save instead of hanging on Saving… when the post-save refresh fails (F7)", async () => {
    vi.mocked(fetchWidgetData).mockRejectedValueOnce(new Error("db locked"));
    const onSaved = renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    // The button must return to its idle label, not stay disabled on "Saving…".
    expect(screen.queryByRole("button", { name: "Saving…" })).not.toBeInTheDocument();
    expect(vi.mocked(updateWidget)).toHaveBeenCalled();
  });

  it("marks the current selection with aria-pressed", async () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "No color" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "violet" }));
    expect(screen.getByRole("button", { name: "violet" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "No color" })).toHaveAttribute("aria-pressed", "false");
  });
});
