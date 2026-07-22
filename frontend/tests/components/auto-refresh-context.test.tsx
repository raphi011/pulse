import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Auto-refresh is now a backend-owned pref (Dashboard.AutoRefresh/SetAutoRefresh)
// driven by the Go scheduler; this context just reflects/forwards it.
// The real bindings return a Wails CancellablePromise; declaring the mocks
// here (rather than via vi.mocked on the imported binding) keeps their type
// a plain Promise-returning Mock so .mockResolvedValue etc. type-check.
const mocks = vi.hoisted(() => ({
  autoRefresh: vi.fn<() => Promise<boolean>>(),
  setAutoRefresh: vi.fn<(enabled: boolean) => Promise<void>>(),
  refreshAll: vi.fn<() => Promise<void>>(),
}));

vi.mock("@/lib/backend", () => ({
  Dashboard: {
    AutoRefresh: mocks.autoRefresh,
    SetAutoRefresh: mocks.setAutoRefresh,
    RefreshAll: mocks.refreshAll,
  },
}));

import { AutoRefreshProvider, useAutoRefresh } from "@/components/auto-refresh-context";

const mockAutoRefresh = mocks.autoRefresh;
const mockSetAutoRefresh = mocks.setAutoRefresh;
const mockRefreshAll = mocks.refreshAll;

function Probe() {
  const { enabled, toggle, refreshAll } = useAutoRefresh();
  return (
    <div>
      <span data-testid="enabled">{String(enabled)}</span>
      <button onClick={toggle}>toggle</button>
      <button onClick={refreshAll}>refreshAll</button>
    </div>
  );
}

function renderProbe() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <AutoRefreshProvider><Probe /></AutoRefreshProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockAutoRefresh.mockReset().mockResolvedValue(false);
  mockSetAutoRefresh.mockReset().mockResolvedValue(undefined);
  mockRefreshAll.mockReset().mockResolvedValue(undefined);
});

describe("AutoRefreshProvider", () => {
  it("defaults to disabled before the pref query resolves", () => {
    mockAutoRefresh.mockReturnValue(new Promise(() => {})); // never resolves
    renderProbe();
    expect(screen.getByTestId("enabled").textContent).toBe("false");
  });

  it("reflects an enabled backend pref once loaded", async () => {
    mockAutoRefresh.mockResolvedValue(true);
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("enabled").textContent).toBe("true"));
  });

  it("toggle flips the backend pref and re-fetches it", async () => {
    renderProbe();
    await waitFor(() => expect(mockAutoRefresh).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText("toggle"));
    await waitFor(() => expect(mockSetAutoRefresh).toHaveBeenCalledWith(true));
    await waitFor(() => expect(mockAutoRefresh).toHaveBeenCalledTimes(2));
  });

  it("refreshAll delegates straight to Dashboard.RefreshAll", () => {
    renderProbe();
    fireEvent.click(screen.getByText("refreshAll"));
    expect(mockRefreshAll).toHaveBeenCalledOnce();
  });
});

describe("useAutoRefresh", () => {
  it("throws when used outside the provider", () => {
    const Bare = () => {
      useAutoRefresh();
      return null;
    };
    // Suppress the expected React error-boundary console noise.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Bare />)).toThrow(/useAutoRefresh must be used within/);
    spy.mockRestore();
  });
});
