import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <IntegrationsPanel initial={initial} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { qc };
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

  it("writes fresh statuses into the shared ['integrations'] query cache after a toggle", async () => {
    // Enabling gws (disabled, no widgets) → POST returns updated statuses with gws enabled.
    const updated = [base[0], { ...base[1], enabled: true, override: true }];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(updated))));
    const { qc } = renderPanel(base);
    // The add-widget drawer reads this cache key; nothing has populated it yet.
    expect(qc.getQueryData(["integrations"])).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: /enable google workspace/i }));
    await waitFor(() => {
      const cached = qc.getQueryData<IntegrationStatus[]>(["integrations"]);
      expect(cached?.find((s) => s.id === "gws")?.enabled).toBe(true);
    });
  });
});
