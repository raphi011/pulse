import { describe, it, expect } from "vitest";
import { ACCENT_NAMES, isAccentName, accentClass } from "@/lib/accents";

describe("accents", () => {
  it("exposes the 8 preset names", () => {
    expect(ACCENT_NAMES).toEqual(["red", "orange", "amber", "green", "teal", "blue", "violet", "pink"]);
  });

  it("resolves a class for every preset", () => {
    for (const name of ACCENT_NAMES) {
      expect(accentClass(name)).toEqual(expect.stringContaining(`bg-${name}-`));
    }
  });

  it("degrades unknown, null, and undefined to null instead of throwing", () => {
    expect(accentClass("magenta")).toBeNull();
    expect(accentClass(null)).toBeNull();
    expect(accentClass(undefined)).toBeNull();
  });

  it("type-guards preset names", () => {
    expect(isAccentName("teal")).toBe(true);
    expect(isAccentName("magenta")).toBe(false);
    expect(isAccentName(null)).toBe(false);
    expect(isAccentName(42)).toBe(false);
  });
});
