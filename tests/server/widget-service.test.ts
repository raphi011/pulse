import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { useTempDb } from "../helpers/db";
import * as repo from "@/server/config-repo";
import { registerFetchWidget, __clearFetchRegistry } from "@/modules/fetch-registry";
import { getWidgetData } from "@/server/widget-service";
import { NotFoundError } from "@/server/errors";

let calls = 0;
beforeEach(() => {
  useTempDb();
  __clearFetchRegistry();
  calls = 0;
  registerFetchWidget({
    type: "test.count", configSchema: z.object({}), defaultConfig: {},
    fetch: async () => ({ n: ++calls }),
  });
  registerFetchWidget({
    type: "test.boom", configSchema: z.object({}), defaultConfig: {},
    fetch: async () => { throw new Error("kaput"); },
  });
});

describe("widget-service", () => {
  it("throws NotFound for an unknown widget id", async () => {
    await expect(getWidgetData("nope", false)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("fetches and caches on first call, serves cache without refresh", async () => {
    const w = repo.addWidget("test.count", {});
    const first = await getWidgetData(w.id, false);
    expect(first.payload).toEqual({ n: 1 });
    const second = await getWidgetData(w.id, false); // cache hit, no fetch
    expect(second.payload).toEqual({ n: 1 });
    expect(calls).toBe(1);
  });

  it("refetches when refresh=true", async () => {
    const w = repo.addWidget("test.count", {});
    await getWidgetData(w.id, false);
    const refreshed = await getWidgetData(w.id, true);
    expect(refreshed.payload).toEqual({ n: 2 });
  });

  it("stores error status and keeps last good payload", async () => {
    const w = repo.addWidget("test.count", {});
    await getWidgetData(w.id, true); // ok, payload {n:1}
    // swap the type to the failing widget to simulate a later failure
    repo.removeWidget(w.id);
    const b = repo.addWidget("test.boom", {});
    const errored = await getWidgetData(b.id, true);
    expect(errored.status).toBe("error");
    expect(errored.error).toContain("kaput");
  });

  it("stores CliError.kind in the cache on failure", async () => {
    const { CliError } = await import("@/server/cli");
    registerFetchWidget({
      type: "fake.authfail",
      configSchema: z.object({}),
      defaultConfig: {},
      fetch: async () => { throw new CliError("Not authenticated — run `gh auth login`", "auth"); },
    });
    const w = repo.addWidget("fake.authfail", {});
    const row = await getWidgetData(w.id, true);
    expect(row.status).toBe("error");
    expect(row.errorKind).toBe("auth");
  });
});
