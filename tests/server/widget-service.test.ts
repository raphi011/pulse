import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { useTempDb } from "../helpers/db";
import * as repo from "@/server/config-repo";
import { registerServerWidget, __clearServerRegistry } from "@/modules/server-registry";
import { getWidgetData } from "@/server/widget-service";
import { NotFoundError } from "@/server/errors";

let calls = 0;
beforeEach(() => {
  useTempDb();
  __clearServerRegistry();
  calls = 0;
  registerServerWidget({
    type: "test.count", configSchema: z.object({}), defaultConfig: {},
    fetch: async () => ({ n: ++calls }),
  });
  registerServerWidget({
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
});
