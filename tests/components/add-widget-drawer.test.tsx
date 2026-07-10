import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AddWidgetDrawer } from "@/components/add-widget-drawer";
import { fetchIntegrations } from "@/lib/dashboard-data";
import type { IntegrationStatus } from "@/modules/integration-contracts";

vi.mock("@/modules/render-registry", () => ({
  listRenderWidgets: () => [
    { type: "github.prs", title: "Pull Requests", integration: "github" },
    { type: "jira.jql", title: "Jira Query", integration: "jira" },
    { type: "core.status", title: "System Status" },
  ],
}));

vi.mock("@/lib/dashboard-data", () => ({
  fetchIntegrations: vi.fn(),
}));

const mockFetchIntegrations = vi.mocked(fetchIntegrations);

const statuses: IntegrationStatus[] = [
  { id: "github", name: "GitHub", tool: null, health: { installed: true, authed: true }, enabled: true, override: null, widgetCount: 0 },
  { id: "jira", name: "Jira", tool: null, health: { installed: true, authed: true }, enabled: false, override: null, widgetCount: 0 },
];

beforeEach(() => {
  mockFetchIntegrations.mockReset();
  mockFetchIntegrations.mockResolvedValue(statuses);
});

function open() {
  const qc = new QueryClient();
  render(<QueryClientProvider client={qc}><AddWidgetDrawer onAdd={() => {}} /></QueryClientProvider>);
  fireEvent.click(screen.getByText("Add widget"));
}

describe("AddWidgetDrawer", () => {
  it("shows widgets from enabled integrations and always-available widgets", async () => {
    open();
    expect(await screen.findByText("Pull Requests")).toBeInTheDocument(); // github enabled
    expect(screen.getByText("System Status")).toBeInTheDocument();         // no integration
  });
  it("hides widgets from disabled integrations", async () => {
    open();
    await screen.findByText("Pull Requests");
    expect(screen.queryByText("Jira Query")).not.toBeInTheDocument();      // jira disabled
  });
});
