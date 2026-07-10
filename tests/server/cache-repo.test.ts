import { describe, it, expect, beforeEach } from "vitest";
import { useTempDb } from "../helpers/db";
import * as cache from "@/server/cache-repo";

beforeEach(() => useTempDb());

describe("cache-repo", () => {
  it("returns undefined for a miss", async () => {
    expect(await cache.get("w1")).toBeUndefined();
  });

  it("upserts and reads back a payload with a timestamp", async () => {
    const row = await cache.set("w1", { status: "ok", payload: { n: 1 }, error: null });
    expect(row.status).toBe("ok");
    expect(row.payload).toEqual({ n: 1 });
    expect(row.fetchedAt).toBeGreaterThan(0);
    expect((await cache.get("w1"))!.payload).toEqual({ n: 1 });
  });

  it("overwrites on second set", async () => {
    await cache.set("w1", { status: "ok", payload: { n: 1 }, error: null });
    await cache.set("w1", { status: "error", payload: { n: 1 }, error: "boom" });
    const row = (await cache.get("w1"))!;
    expect(row.status).toBe("error");
    expect(row.error).toBe("boom");
  });

  it("persists and reads back errorKind on failure", async () => {
    await cache.set("w1", { status: "error", payload: null, error: "boom", errorKind: "auth" });
    expect((await cache.get("w1"))!.errorKind).toBe("auth");
  });

  it("defaults errorKind to null when omitted", async () => {
    await cache.set("w2", { status: "ok", payload: { n: 1 }, error: null });
    expect((await cache.get("w2"))!.errorKind).toBeNull();
  });
});
