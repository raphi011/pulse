import { describe, it, expect } from "vitest";
import { columnCountForWidth, clampSpan, spanFromDelta } from "@/lib/grid";

describe("grid math", () => {
  it("derives column count from width (3 -> 6 -> 9 at ~300px units)", () => {
    expect(columnCountForWidth(900)).toBe(3);
    expect(columnCountForWidth(1800)).toBe(6);
    expect(columnCountForWidth(2700)).toBe(9);
  });

  it("never returns fewer than 1 column", () => {
    expect(columnCountForWidth(0)).toBe(1);
    expect(columnCountForWidth(120)).toBe(1);
  });

  it("caps at MAX_COLS", () => {
    expect(columnCountForWidth(100_000)).toBe(12);
  });

  it("clamps a span between 1 and the column count", () => {
    expect(clampSpan(3, 6)).toBe(3);
    expect(clampSpan(9, 6)).toBe(6);
    expect(clampSpan(0, 6)).toBe(1);
  });

  it("computes a new span from a drag delta, snapping to whole cells", () => {
    expect(spanFromDelta(2, 0, 300)).toBe(2);
    expect(spanFromDelta(2, 320, 300)).toBe(3); // +1.06 cells -> round to +1
    expect(spanFromDelta(2, -700, 300)).toBe(1); // clamps to 1
  });
});
