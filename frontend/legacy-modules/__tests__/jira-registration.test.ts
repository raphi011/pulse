import { describe, it, expect } from "vitest";
import "@/modules/fetch";
import { getFetchWidget } from "@/modules/fetch-registry";
import { JQL_TYPE } from "@/modules/jira/manifest";

describe("jira server registration", () => {
  it("registers jira.jql on the server registry with defaults", () => {
    const def = getFetchWidget(JQL_TYPE);
    expect(def).toBeDefined();
    expect(def!.manifest.defaultConfig).toMatchObject({ limit: 10 });
    expect(typeof def!.fetch).toBe("function");
  });
});

import "@/modules/render";
import { getRenderWidget } from "@/modules/render-registry";

describe("jira client registration", () => {
  it("registers jira.jql on the client registry with title, schema, and defaults", () => {
    const def = getRenderWidget(JQL_TYPE);
    expect(def).toBeDefined();
    expect(def!.manifest.title).toBe("Jira Query");
    expect(def!.manifest.configSchema).toBeDefined();
    expect(def!.manifest.defaultConfig).toMatchObject({ limit: 10 });
  });

  it("both sides share the same manifest object", () => {
    expect(getFetchWidget(JQL_TYPE)!.manifest).toBe(getRenderWidget(JQL_TYPE)!.manifest);
  });
});
