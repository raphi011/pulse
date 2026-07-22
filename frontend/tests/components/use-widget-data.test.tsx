import { render, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AutoRefreshProvider, useAutoRefresh } from "@/components/auto-refresh-context";
import { ToastProvider } from "@/components/toast-context";
import { useWidgetData } from "@/components/use-widget-data";
import { fetchWidgetData } from "@/lib/dashboard-data";

vi.mock("@/lib/dashboard-data", () => ({
  fetchWidgetData: vi.fn(),
}));

const mockFetchWidgetData = vi.mocked(fetchWidgetData);

function Probe() {
  const { refresh } = useWidgetData("w1");
  void refresh;
  return <span>ready</span>;
}

// Exposes refresh() so a test can fire overlapping calls.
let probeRefresh: () => Promise<unknown> = async () => undefined;
function RefreshProbe() {
  const { refresh } = useWidgetData("w1");
  probeRefresh = refresh;
  return <span>ready</span>;
}

function StaticProbe() {
  const { refresh } = useWidgetData("w1", false);
  void refresh;
  return <span>ready</span>;
}

// Buttons to drive the global context from within the provider.
function Controls() {
  const { toggle, refreshAll } = useAutoRefresh();
  return (
    <>
      <button onClick={toggle}>toggle</button>
      <button onClick={refreshAll}>refreshAll</button>
    </>
  );
}

function renderProbe() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AutoRefreshProvider>
        <ToastProvider>
          <Probe />
          <Controls />
        </ToastProvider>
      </AutoRefreshProvider>
    </QueryClientProvider>,
  );
}

function renderStaticProbe() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AutoRefreshProvider>
        <ToastProvider>
          <StaticProbe />
          <Controls />
        </ToastProvider>
      </AutoRefreshProvider>
    </QueryClientProvider>,
  );
}

function refreshCallCount() {
  return mockFetchWidgetData.mock.calls.filter(([, refresh]) => refresh === true).length;
}

const okRow = { widgetId: "w1", payload: {}, fetchedAt: 0, status: "ok" as const, error: null, errorKind: null };

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  mockFetchWidgetData.mockReset();
  mockFetchWidgetData.mockResolvedValue(okRow);
});

afterEach(() => {
  vi.useRealTimers();
});

test("does not auto-refresh while disabled", async () => {
  renderProbe();
  await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000); });
  expect(refreshCallCount()).toBe(0);
});

test("auto-refreshes every 5 minutes while enabled", async () => {
  renderProbe();
  await act(async () => { screen.getByText("toggle").click(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000); });
  expect(refreshCallCount()).toBe(1);
});

test("force-refresh (nonce bump) triggers a refresh, mount does not", async () => {
  renderProbe();
  expect(refreshCallCount()).toBe(0);
  await act(async () => { screen.getByText("refreshAll").click(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(refreshCallCount()).toBe(1);
});

test("fires a toast when a refresh fails", async () => {
  mockFetchWidgetData.mockImplementation(async (_id, refresh) =>
    refresh ? Promise.reject(new Error("boom")) : Promise.resolve(okRow),
  );
  renderProbe();
  await act(async () => { screen.getByText("refreshAll").click(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByRole("alert").textContent).toContain("Refresh failed");
});

test("fires a toast when the initial load fails", async () => {
  mockFetchWidgetData.mockRejectedValue(new Error("boom"));
  renderProbe();
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByRole("alert").textContent).toContain("Failed to load widget");
});

test("stops auto-refreshing after toggling off", async () => {
  renderProbe();
  await act(async () => { screen.getByText("toggle").click(); }); // enable
  await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000); }); // one refresh
  await act(async () => { screen.getByText("toggle").click(); }); // disable
  await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60 * 1000); });
  expect(refreshCallCount()).toBe(1); // no further refreshes after disabling
});

test("overlapping refreshes collapse to a single upstream fetch (dedup)", async () => {
  // Hold the forced fetch open so a second refresh() overlaps the first.
  let release!: (row: typeof okRow) => void;
  mockFetchWidgetData.mockImplementation(async (_id, refresh) =>
    refresh ? new Promise((res) => { release = res; }) : okRow,
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AutoRefreshProvider><ToastProvider><RefreshProbe /></ToastProvider></AutoRefreshProvider>
    </QueryClientProvider>,
  );
  await act(async () => { await vi.advanceTimersByTimeAsync(0); }); // flush cache-first load

  // Two overlapping refreshes while the first forced fetch is still pending.
  await act(async () => { void probeRefresh(); void probeRefresh(); await vi.advanceTimersByTimeAsync(0); });
  expect(refreshCallCount()).toBe(1); // deduped — only one forced fetch

  await act(async () => { release(okRow); await vi.advanceTimersByTimeAsync(0); });
});

test("refreshable=false ignores auto-refresh interval and refreshAll", async () => {
  mockFetchWidgetData.mockResolvedValue({
    widgetId: "w1", payload: { ok: true }, fetchedAt: Date.now(), status: "ok", error: null, errorKind: null,
  });
  renderStaticProbe();
  await act(async () => { await vi.advanceTimersByTimeAsync(0); }); // flush the cache-first load
  expect(screen.getByText("ready")).toBeInTheDocument();
  const initialCalls = mockFetchWidgetData.mock.calls.length; // the cache-first load
  await act(async () => { screen.getByText("toggle").click(); });        // enable auto-refresh
  await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1000); });
  await act(async () => { screen.getByText("refreshAll").click(); });
  expect(
    mockFetchWidgetData.mock.calls.slice(initialCalls).filter(([, refresh]) => refresh === true),
  ).toHaveLength(0);
});
