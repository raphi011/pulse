import { describe, it, expect } from "vitest";
import { fetchStatus } from "@/modules/core/fetch";

describe("core.status fetch", () => {
  it("returns a timestamp, node version, and platform", async () => {
    const data = await fetchStatus();
    expect(typeof data.now).toBe("string");
    expect(data.node).toBe(process.version);
    expect(data.platform).toBe(process.platform);
  });
});
