import { describe, it, expect } from "vitest";
import { nextLayout, FULL_MIN_PX, COMPACT_MAX_PX } from "@/modules/system/layout";

describe("nextLayout", () => {
  it("is full at or above the upper threshold", () => {
    expect(nextLayout(FULL_MIN_PX, "compact")).toBe("full");
    expect(nextLayout(FULL_MIN_PX + 100, "compact")).toBe("full");
  });

  it("is compact at or below the lower threshold", () => {
    expect(nextLayout(COMPACT_MAX_PX, "full")).toBe("compact");
    expect(nextLayout(0, "full")).toBe("compact");
  });

  it("keeps the current mode inside the deadband (hysteresis)", () => {
    const mid = Math.floor((FULL_MIN_PX + COMPACT_MAX_PX) / 2);
    expect(nextLayout(mid, "compact")).toBe("compact");
    expect(nextLayout(mid, "full")).toBe("full");
  });

  it("has a real deadband (upper strictly above lower)", () => {
    expect(FULL_MIN_PX).toBeGreaterThan(COMPACT_MAX_PX + 1);
  });
});
