import { describe, it, expect } from "vitest";
import "@/modules/fetch";
import { getFetchWidget } from "@/modules/fetch-registry";
import { JQL_TYPE } from "@/modules/jira/manifest";

describe("jira server registration", () => {
  it("registers jira.jql on the server registry with defaults", () => {
    const def = getFetchWidget(JQL_TYPE);
    expect(def).toBeDefined();
    expect(def!.defaultConfig).toMatchObject({ limit: 10 });
    expect(typeof def!.fetch).toBe("function");
  });
});

import "@/modules/render";
import { getRenderWidget } from "@/modules/render-registry";

describe("jira client registration", () => {
  it("registers jira.jql on the client registry with title, schema, and defaults", () => {
    const def = getRenderWidget(JQL_TYPE);
    expect(def).toBeDefined();
    expect(def!.title).toBe("Jira Query");
    expect(def!.configSchema).toBeDefined();
    expect(def!.defaultConfig).toMatchObject({ limit: 10 });
  });
});
