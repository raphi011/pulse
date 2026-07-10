import { render, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AutoRefreshProvider, useAutoRefresh } from "@/components/auto-refresh-context";
import { ToastProvider } from "@/components/toast-context";
import { useWidgetData } from "@/components/use-widget-data";

function Probe() {
  const { refresh } = useWidgetData("w1");
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

function refreshCallCount() {
  return (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
    ([url]) => String(url).includes("refresh=1"),
  ).length;
}

const okRow = { widgetId: "w1", payload: {}, fetchedAt: 0, status: "ok", error: null };

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => okRow })));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
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
  (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) =>
    String(url).includes("refresh=1")
      ? { ok: false, status: 500, json: async () => ({}) }
      : { ok: true, json: async () => okRow },
  );
  renderProbe();
  await act(async () => { screen.getByText("refreshAll").click(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByRole("alert").textContent).toContain("Refresh failed");
});
