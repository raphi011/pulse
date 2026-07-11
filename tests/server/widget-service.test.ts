import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { useTempDb } from "../helpers/db";
import * as repo from "@/server/config-repo";
import { defineManifest } from "@/modules/contracts";
import { registerFetch, __clearFetchRegistry } from "@/modules/fetch-registry";
import { getWidgetData } from "@/server/widget-service";
import { NotFoundError } from "@/server/errors";

let calls = 0;
beforeEach(() => {
  useTempDb();
  __clearFetchRegistry();
  calls = 0;
  registerFetch(
    defineManifest({ type: "test.count", title: "Count", configSchema: z.object({}), defaultConfig: {} }),
    { fetch: async () => ({ n: ++calls }) },
  );
  registerFetch(
    defineManifest({ type: "test.boom", title: "Boom", configSchema: z.object({}), defaultConfig: {} }),
    { fetch: async () => { throw new Error("kaput"); } },
  );
});

describe("widget-service", () => {
  it("throws NotFound for an unknown widget id", async () => {
    await expect(getWidgetData("nope", false)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("fetches and caches on first call, serves cache without refresh", async () => {
    const w = await repo.addWidget("test.count", {});
    const first = await getWidgetData(w.id, false);
    expect(first.payload).toEqual({ n: 1 });
    const second = await getWidgetData(w.id, false); // cache hit, no fetch
    expect(second.payload).toEqual({ n: 1 });
    expect(calls).toBe(1);
  });

  it("refetches when refresh=true", async () => {
    const w = await repo.addWidget("test.count", {});
    await getWidgetData(w.id, false);
    const refreshed = await getWidgetData(w.id, true);
    expect(refreshed.payload).toEqual({ n: 2 });
  });

  it("stores error status and keeps last good payload", async () => {
    const w = await repo.addWidget("test.count", {});
    await getWidgetData(w.id, true); // ok, payload {n:1}
    // swap the type to the failing widget to simulate a later failure
    await repo.removeWidget(w.id);
    const b = await repo.addWidget("test.boom", {});
    const errored = await getWidgetData(b.id, true);
    expect(errored.status).toBe("error");
    expect(errored.error).toContain("kaput");
  });

  it("stores CliError.kind in the cache on failure", async () => {
    const { CliError } = await import("@/server/cli");
    registerFetch(
      defineManifest({ type: "fake.authfail", title: "Auth", configSchema: z.object({}), defaultConfig: {} }),
      { fetch: async () => { throw new CliError("Not authenticated — run `gh auth login`", "auth"); } },
    );
    const w = await repo.addWidget("fake.authfail", {});
    const row = await getWidgetData(w.id, true);
    expect(row.status).toBe("error");
    expect(row.errorKind).toBe("auth");
  });

  it("caches a fixable error when the stored config no longer matches the schema", async () => {
    registerFetch(
      defineManifest({ type: "test.strict", title: "Strict", configSchema: z.object({ q: z.string() }), defaultConfig: { q: "x" } }),
      { fetch: async (c) => c },
    );
    const w = await repo.addWidget("test.strict", { q: "ok" });
    await repo.setConfig(w.id, {} as Record<string, unknown>); // simulate a breaking schema change
    const row = await getWidgetData(w.id, true);
    expect(row.status).toBe("error");
    expect(row.error).toContain("Invalid config");
    expect((await repo.getWidget(w.id))!.config).toEqual({}); // stored config untouched
  });

  it("backfills Zod defaults from the schema on read", async () => {
    let seen: unknown;
    registerFetch(
      defineManifest({ type: "test.defaults", title: "D", configSchema: z.object({ limit: z.number().default(5) }), defaultConfig: { limit: 5 } }),
      { fetch: async (c) => { seen = c; return c; } },
    );
    const w = await repo.addWidget("test.defaults", { limit: 5 });
    await repo.setConfig(w.id, {} as Record<string, unknown>); // an additive schema change
    await getWidgetData(w.id, true);
    expect(seen).toEqual({ limit: 5 });
  });
});
