import { describe, it, expect } from "vitest";
import "@/modules/server";
import "@/modules/client";
import { getServerWidget } from "@/modules/server-registry";
import { getClientWidget } from "@/modules/client-registry";
import { STATUS_TYPE } from "@/modules/core/manifest";

describe("core registration barrels", () => {
  it("registers core.status on both sides", () => {
    expect(getServerWidget(STATUS_TYPE)).toBeDefined();
    expect(getClientWidget(STATUS_TYPE)?.title).toBe("System Status");
  });
});
