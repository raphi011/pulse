import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AddWidgetDrawer } from "@/components/add-widget-drawer";

vi.mock("@/modules/client-registry", () => ({
  listClientWidgets: () => [
    { type: "github.prs", title: "Pull Requests", integration: "github" },
    { type: "jira.jql", title: "Jira Query", integration: "jira" },
    { type: "core.status", title: "System Status" },
  ],
}));

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([
    { id: "github", enabled: true }, { id: "jira", enabled: false },
  ]))));
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
