import { describe, it, expect } from "vitest";
import "@/modules/fetch";
import "@/modules/render";
import { getFetchWidget } from "@/modules/fetch-registry";
import { getRenderWidget } from "@/modules/render-registry";
import { PRS_TYPE, FAILING_ACTIONS_TYPE, DEPENDABOT_TYPE } from "@/modules/github/manifest";

describe("github registration barrels", () => {
  it("registers all three widgets on both sides", () => {
    for (const t of [PRS_TYPE, FAILING_ACTIONS_TYPE, DEPENDABOT_TYPE]) {
      expect(getFetchWidget(t), `server ${t}`).toBeDefined();
      expect(getRenderWidget(t), `client ${t}`).toBeDefined();
      expect(getFetchWidget(t)!.manifest).toBe(getRenderWidget(t)!.manifest);
    }
  });

  it("no longer registers the removed My/Team PR types", () => {
    expect(getFetchWidget("github.myPrs")).toBeUndefined();
    expect(getFetchWidget("github.teamPrs")).toBeUndefined();
  });
});
