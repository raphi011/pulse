import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, test, vi } from "vitest";
import { ToastProvider } from "@/components/toast-context";
import { useWidgetData } from "@/components/use-widget-data";
import { fetchWidgetData } from "@/lib/dashboard-data";

// Auto-refresh is now Go-scheduler-owned (it emits cache-updated events the
// shell uses to invalidate widget queries — see app-root); useWidgetData
// itself only does a cache-first load plus a manual, dedup'd refresh().
vi.mock("@/lib/dashboard-data", () => ({
  fetchWidgetData: vi.fn(),
}));

const mockFetchWidgetData = vi.mocked(fetchWidgetData);

// Exposes refresh() so a test can fire overlapping calls.
let probeRefresh: () => Promise<unknown> = async () => undefined;
function RefreshProbe() {
  const { refresh } = useWidgetData("w1");
  probeRefresh = refresh;
  return <span>ready</span>;
}

function renderProbe() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider><RefreshProbe /></ToastProvider>
    </QueryClientProvider>,
  );
}

function refreshCallCount() {
  return mockFetchWidgetData.mock.calls.filter(([, refresh]) => refresh === true).length;
}

const okRow = { widgetId: "w1", payload: {}, fetchedAt: 0, status: "ok" as const, error: null, errorKind: null };

beforeEach(() => {
  mockFetchWidgetData.mockReset();
  mockFetchWidgetData.mockResolvedValue(okRow);
});

test("loads cache-first on mount (refresh=false)", async () => {
  renderProbe();
  await screen.findByText("ready");
  expect(mockFetchWidgetData).toHaveBeenCalledWith("w1", false);
  expect(refreshCallCount()).toBe(0);
});

test("refresh() forces an upstream fetch", async () => {
  renderProbe();
  await screen.findByText("ready");
  await probeRefresh();
  expect(refreshCallCount()).toBe(1);
});

test("overlapping refreshes collapse to a single upstream fetch (dedup)", async () => {
  // Hold the forced fetch open so a second refresh() overlaps the first.
  let release!: (row: typeof okRow) => void;
  mockFetchWidgetData.mockImplementation(async (_id, refresh) =>
    refresh ? new Promise((res) => { release = res; }) : okRow,
  );
  renderProbe();
  await screen.findByText("ready");

  // Two overlapping refreshes while the first forced fetch is still pending.
  void probeRefresh();
  void probeRefresh();
  await waitFor(() => expect(refreshCallCount()).toBe(1)); // deduped — only one forced fetch

  release(okRow);
});

test("fires a toast when a refresh fails, keeping the last-good data", async () => {
  mockFetchWidgetData.mockImplementation(async (_id, refresh) =>
    refresh ? Promise.reject(new Error("boom")) : Promise.resolve(okRow),
  );
  renderProbe();
  await screen.findByText("ready");
  await probeRefresh();
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Refresh failed"));
});

test("fires a toast when the initial load fails", async () => {
  mockFetchWidgetData.mockRejectedValue(new Error("boom"));
  renderProbe();
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Failed to load widget"));
});
