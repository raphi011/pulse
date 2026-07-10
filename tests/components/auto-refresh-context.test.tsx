import { render, screen, act } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import { AutoRefreshProvider, useAutoRefresh } from "@/components/auto-refresh-context";

function Probe() {
  const { enabled, nonce, toggle, refreshAll } = useAutoRefresh();
  return (
    <div>
      <span data-testid="enabled">{String(enabled)}</span>
      <span data-testid="nonce">{nonce}</span>
      <button onClick={toggle}>toggle</button>
      <button onClick={refreshAll}>refreshAll</button>
    </div>
  );
}

function renderProbe() {
  return render(
    <AutoRefreshProvider>
      <Probe />
    </AutoRefreshProvider>,
  );
}

beforeEach(() => localStorage.clear());

test("defaults to disabled with empty storage", () => {
  renderProbe();
  expect(screen.getByTestId("enabled").textContent).toBe("false");
});

test("hydrates enabled from localStorage", () => {
  localStorage.setItem("pulse:auto-refresh", "1");
  renderProbe();
  expect(screen.getByTestId("enabled").textContent).toBe("true");
});

test("toggle flips state and persists to localStorage", () => {
  renderProbe();
  act(() => screen.getByText("toggle").click());
  expect(screen.getByTestId("enabled").textContent).toBe("true");
  expect(localStorage.getItem("pulse:auto-refresh")).toBe("1");
});

test("refreshAll bumps nonce", () => {
  renderProbe();
  expect(screen.getByTestId("nonce").textContent).toBe("0");
  act(() => screen.getByText("refreshAll").click());
  expect(screen.getByTestId("nonce").textContent).toBe("1");
});
