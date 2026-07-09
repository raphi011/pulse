import { describe, it, expect } from "vitest";
import "@/modules/server";
import "@/modules/client";
import { getServerWidget } from "@/modules/server-registry";
import { getClientWidget } from "@/modules/client-registry";
import { MY_PRS_TYPE, TEAM_PRS_TYPE, FAILING_ACTIONS_TYPE, DEPENDABOT_TYPE } from "@/modules/github/manifest";

describe("github registration barrels", () => {
  it("registers all four widgets on both sides", () => {
    for (const t of [MY_PRS_TYPE, TEAM_PRS_TYPE, FAILING_ACTIONS_TYPE, DEPENDABOT_TYPE]) {
      expect(getServerWidget(t), `server ${t}`).toBeDefined();
      expect(getClientWidget(t), `client ${t}`).toBeDefined();
    }
  });
});
