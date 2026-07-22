import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AddWidgetDrawer } from "@/components/add-widget-drawer";
import { fetchIntegrations, fetchManifests } from "@/lib/dashboard-data";
import type { IntegrationStatus } from "@/modules/integration-contracts";

// listRenderWidgets contributes only {type, icon}; title/integration now come from
// the server-owned manifest (fetchManifests), joined in the component itself.
vi.mock("@/modules/render-registry", () => ({
  listRenderWidgets: () => [
    { type: "github.prs" },
    { type: "jira.jql" },
    { type: "test.fixture" },
  ],
}));

vi.mock("@/lib/dashboard-data", () => ({
  fetchIntegrations: vi.fn(),
  fetchManifests: vi.fn(),
}));

const mockFetchIntegrations = vi.mocked(fetchIntegrations);
const mockFetchManifests = vi.mocked(fetchManifests);

const statuses: IntegrationStatus[] = [
  { id: "github", name: "GitHub", tool: null, health: { installed: true, authed: true }, enabled: true, override: null, widgetCount: 0 },
  { id: "jira", name: "Jira", tool: null, health: { installed: true, authed: true }, enabled: false, override: null, widgetCount: 0 },
];

beforeEach(() => {
  mockFetchIntegrations.mockReset();
  mockFetchIntegrations.mockResolvedValue(statuses);
  mockFetchManifests.mockReset();
  mockFetchManifests.mockResolvedValue([
    { type: "github.prs", title: "Pull Requests", configFields: [], refreshable: true, integration: "github" },
    { type: "jira.jql", title: "Jira Query", configFields: [], refreshable: true, integration: "jira" },
    { type: "test.fixture", title: "Test Fixture", configFields: [], refreshable: true },
  ]);
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
    expect(screen.getByText("Test Fixture")).toBeInTheDocument();          // no integration
  });
  it("hides widgets from disabled integrations", async () => {
    open();
    await screen.findByText("Pull Requests");
    expect(screen.queryByText("Jira Query")).not.toBeInTheDocument();      // jira disabled
  });
});
