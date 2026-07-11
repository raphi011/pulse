import { describe, it, expect, vi } from "vitest";

// plugin-os calls invoke() under the hood, which is unavailable in Node — mock it.
vi.mock("@tauri-apps/plugin-os", () => ({
  platform: () => "macos",
  version: () => "15.0",
  arch: () => "aarch64",
}));

import { fetchStatus } from "@/modules/core/fetch";

describe("core.status fetch", () => {
  it("returns a timestamp plus OS platform, version, and arch from plugin-os", async () => {
    const data = await fetchStatus();
    expect(typeof data.now).toBe("string");
    expect(Number.isNaN(Date.parse(data.now))).toBe(false);
    expect(data.platform).toBe("macos");
    expect(data.osVersion).toBe("15.0");
    expect(data.arch).toBe("aarch64");
  });
});
