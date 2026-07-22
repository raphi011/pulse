import { describe, it, expect, beforeEach } from "vitest";
import { useTempDb } from "../helpers/db";
import { CACHE_VERSION, ensureCacheVersion } from "@/server/cache-version";
import { getPref } from "@/server/config-repo";
import * as cache from "@/server/cache-repo";

beforeEach(() => useTempDb());

describe("cache versioning", () => {
  it("wipes the cache when the stored version differs (incl. fresh DB)", async () => {
    await cache.set("w1", { status: "ok", payload: { a: 1 }, error: null });
    await ensureCacheVersion();
    expect(await cache.get("w1")).toBeUndefined();
    expect(await getPref("cacheVersion", "")).toBe(String(CACHE_VERSION));
  });

  it("keeps the cache when the version matches", async () => {
    await ensureCacheVersion();
    await cache.set("w1", { status: "ok", payload: { a: 1 }, error: null });
    await ensureCacheVersion();
    expect((await cache.get("w1"))?.payload).toEqual({ a: 1 });
  });
});
