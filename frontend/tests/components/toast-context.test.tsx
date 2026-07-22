import { render, screen, act } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ToastProvider, useToast } from "@/components/toast-context";

function Trigger() {
  const { toast } = useToast();
  return <button onClick={() => toast("boom")}>fire</button>;
}

function renderTrigger() {
  return render(<ToastProvider><Trigger /></ToastProvider>);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test("shows a toast when fired", () => {
  renderTrigger();
  act(() => screen.getByText("fire").click());
  expect(screen.getByRole("alert").textContent).toContain("boom");
});

test("auto-dismisses after the timeout", () => {
  renderTrigger();
  act(() => screen.getByText("fire").click());
  expect(screen.queryByRole("alert")).not.toBeNull();
  act(() => vi.advanceTimersByTime(6000));
  expect(screen.queryByRole("alert")).toBeNull();
});

test("dismiss button removes the toast", () => {
  renderTrigger();
  act(() => screen.getByText("fire").click());
  act(() => screen.getByLabelText("Dismiss").click());
  expect(screen.queryByRole("alert")).toBeNull();
});
