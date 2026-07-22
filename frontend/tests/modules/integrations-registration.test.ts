import { describe, it, expect } from "vitest";
import "@/modules/integrations";
import { getIntegration } from "@/modules/integration-registry";

describe("integrations barrel", () => {
  it("registers github, jira and gws with tool metadata", () => {
    for (const id of ["github", "jira", "gws"]) {
      const integ = getIntegration(id);
      expect(integ, id).toBeDefined();
      expect(integ!.tool?.bin, id).toBeTruthy();
      expect(integ!.tool?.installHint, id).toBeTruthy();
      expect(integ!.tool?.authHint, id).toBeTruthy();
    }
  });
});
