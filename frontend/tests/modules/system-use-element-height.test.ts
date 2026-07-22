import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useElementHeight } from "@/modules/system/use-element-height";

let lastCb: ResizeObserverCallback | null = null;

class FakeResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  constructor(cb: ResizeObserverCallback) {
    lastCb = cb;
  }
}

beforeEach(() => {
  lastCb = null;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => vi.unstubAllGlobals());

describe("useElementHeight", () => {
  it("reports the initial and observed content height", () => {
    const { result } = renderHook(() => useElementHeight());

    const node = document.createElement("div");
    node.getBoundingClientRect = () => ({ height: 120 }) as DOMRect;

    act(() => result.current.ref(node));
    expect(result.current.height).toBe(120);

    act(() => {
      lastCb?.(
        [{ contentRect: { height: 300 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });
    expect(result.current.height).toBe(300);
  });
});
