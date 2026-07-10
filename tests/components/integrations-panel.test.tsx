import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { IntegrationsPanel } from "@/components/integrations-panel";
import { ToastProvider } from "@/components/toast-context";
import type { IntegrationStatus } from "@/modules/integration-contracts";

const base: IntegrationStatus[] = [
  { id: "github", name: "GitHub", tool: { bin: "gh", installHint: "install gh", authHint: "gh auth login" },
    health: { installed: true, authed: false, detail: "Not authenticated" }, enabled: true, override: null, widgetCount: 0 },
  { id: "gws", name: "Google Workspace", tool: { bin: "gws", installHint: "install gws", authHint: "gws auth login" },
    health: { installed: false, authed: false }, enabled: false, override: null, widgetCount: 0 },
];

function renderPanel(initial: IntegrationStatus[]) {
  return render(
    <ToastProvider>
      <IntegrationsPanel initial={initial} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(base))));
});

describe("IntegrationsPanel", () => {
  it("lists integrations and shows the auth hint when unauthenticated", () => {
    renderPanel(base);
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.getByText(/gh auth login/)).toBeInTheDocument();      // authHint shown
    expect(screen.getByText(/install gws/)).toBeInTheDocument();        // installHint shown for missing tool
  });

  it("prompts for confirmation before disabling an integration with widgets", async () => {
    const withWidgets = [{ ...base[0], widgetCount: 3 }];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(withWidgets))));
    renderPanel(withWidgets);
    fireEvent.click(screen.getByRole("button", { name: /disable github/i }));
    expect(await screen.findByText(/permanently removes 3/i)).toBeInTheDocument();
  });

  it("surfaces a toast when a toggle request fails", async () => {
    // Enabled integration with no widgets → toggle posts directly (no confirm dialog).
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    renderPanel(base);
    fireEvent.click(screen.getByRole("button", { name: /disable github/i }));
    expect(await screen.findByText(/failed to update integration/i)).toBeInTheDocument();
  });
});
