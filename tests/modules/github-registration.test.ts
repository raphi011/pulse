import { describe, it, expect } from "vitest";
import "@/modules/server";
import "@/modules/client";
import { getServerWidget } from "@/modules/server-registry";
import { getClientWidget } from "@/modules/client-registry";
import { PRS_TYPE, FAILING_ACTIONS_TYPE, DEPENDABOT_TYPE } from "@/modules/github/manifest";

describe("github registration barrels", () => {
  it("registers all three widgets on both sides", () => {
    for (const t of [PRS_TYPE, FAILING_ACTIONS_TYPE, DEPENDABOT_TYPE]) {
      expect(getServerWidget(t), `server ${t}`).toBeDefined();
      expect(getClientWidget(t), `client ${t}`).toBeDefined();
    }
  });

  it("no longer registers the removed My/Team PR types", () => {
    expect(getServerWidget("github.myPrs")).toBeUndefined();
    expect(getServerWidget("github.teamPrs")).toBeUndefined();
  });
});
