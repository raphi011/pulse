import { useCallback, useState } from "react";

/**
 * Measure an element's live content height via ResizeObserver.
 * Returns a stable ref callback and the latest height (0 before the first
 * measurement, or where ResizeObserver is unavailable — e.g. jsdom/SSR).
 */
export function useElementHeight(): {
  ref: (node: HTMLElement | null) => void;
  height: number;
} {
  const [height, setHeight] = useState(0);

  const ref = useCallback((node: HTMLElement | null) => {
    if (!node || typeof ResizeObserver === "undefined") return;
    setHeight(node.getBoundingClientRect().height);
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setHeight(box.height);
    });
    observer.observe(node);
    // React 19 runs a ref callback's returned cleanup when the node detaches.
    return () => observer.disconnect();
  }, []);

  return { ref, height };
}
